import "server-only";

import { Buffer } from "node:buffer";
import { createHash, randomBytes, randomUUID } from "node:crypto";

import {
  ensureCanonicalMemberForLead,
  resolveCanonicalLeadRef,
  resolveCanonicalMemberRef
} from "@/lib/services/canonical-person-ref";
import { buildEnrollmentPacketTemplate } from "@/lib/email/templates/enrollment-packet";
import { buildCompletedEnrollmentPacketDocxData } from "@/lib/services/enrollment-packet-docx";
import {
  getDefaultEnrollmentPacketIntakePayload,
  normalizeEnrollmentPacketIntakePayload,
  type EnrollmentPacketIntakePayload
} from "@/lib/services/enrollment-packet-intake-payload";
import { mapEnrollmentPacketToDownstream } from "@/lib/services/enrollment-packet-intake-mapping";
import {
  calculateInitialEnrollmentAmount,
  normalizeEnrollmentDateOnly
} from "@/lib/services/enrollment-packet-proration";
import { validateEnrollmentPacketCompletion } from "@/lib/services/enrollment-packet-public-schema";
import { createUserNotification } from "@/lib/services/notifications";
import { resolveEnrollmentPricingForRequestedDays } from "@/lib/services/enrollment-pricing";
import { buildMissingSchemaMessage, isMissingSchemaObjectError } from "@/lib/supabase/schema-errors";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { toEasternDate, toEasternISO } from "@/lib/timezone";

const STORAGE_BUCKET = "member-documents";
const TOKEN_BYTE_LENGTH = 32;
const STAFF_TRANSPORTATION_OPTIONS = ["Door to Door", "Bus Stop", "Mixed"] as const;

type StaffTransportationOption = (typeof STAFF_TRANSPORTATION_OPTIONS)[number];

export const ENROLLMENT_PACKET_STATUS_VALUES = [
  "draft",
  "prepared",
  "sent",
  "opened",
  "partially_completed",
  "completed",
  "filed"
] as const;

export type EnrollmentPacketStatus = (typeof ENROLLMENT_PACKET_STATUS_VALUES)[number];

export type EnrollmentPacketRequestSummary = {
  id: string;
  memberId: string;
  leadId: string | null;
  senderUserId: string;
  caregiverEmail: string;
  status: EnrollmentPacketStatus;
  tokenExpiresAt: string;
  createdAt: string;
  sentAt: string | null;
  completedAt: string | null;
};

type EnrollmentPacketRequestRow = {
  id: string;
  member_id: string;
  lead_id: string | null;
  sender_user_id: string;
  caregiver_email: string;
  status: string;
  token: string;
  token_expires_at: string;
  created_at: string;
  sent_at: string | null;
  completed_at: string | null;
};

type EnrollmentPacketFieldsRow = {
  id: string;
  packet_id: string;
  requested_days: string[] | null;
  transportation: string | null;
  community_fee: number | null;
  daily_rate: number | null;
  pricing_community_fee_id: string | null;
  pricing_daily_rate_id: string | null;
  pricing_snapshot: Record<string, unknown> | null;
  caregiver_name: string | null;
  caregiver_phone: string | null;
  caregiver_email: string | null;
  caregiver_address_line1: string | null;
  caregiver_address_line2: string | null;
  caregiver_city: string | null;
  caregiver_state: string | null;
  caregiver_zip: string | null;
  secondary_contact_name: string | null;
  secondary_contact_phone: string | null;
  secondary_contact_email: string | null;
  secondary_contact_relationship: string | null;
  notes: string | null;
  intake_payload: Record<string, unknown> | null;
};

type MemberRow = {
  id: string;
  display_name: string;
  enrollment_date: string | null;
};

type LeadRow = {
  id: string;
  member_name: string | null;
  member_start_date: string | null;
  referral_name: string | null;
  caregiver_email: string | null;
  caregiver_name: string | null;
  caregiver_relationship: string | null;
  caregiver_phone: string | null;
};

type SenderProfileRow = {
  user_id: string;
  signature_name: string;
  signature_blob: string;
  created_at: string;
  updated_at: string;
};

type PacketFileUpload = {
  fileName: string;
  contentType: string;
  bytes: Buffer;
  category:
    | "insurance"
    | "poa"
    | "supporting"
    | "medicare_card"
    | "private_insurance"
    | "supplemental_insurance"
    | "poa_guardianship"
    | "dnr_dni_advance_directive"
    | "signed_membership_agreement"
    | "signed_exhibit_a_payment_authorization";
};

type EnrollmentPacketUploadCategory = PacketFileUpload["category"] | "completed_packet" | "signature_artifact";

export type PublicEnrollmentPacketContext =
  | { state: "invalid" }
  | { state: "expired" }
  | { state: "completed"; request: EnrollmentPacketRequestSummary }
  | {
      state: "ready";
      request: EnrollmentPacketRequestSummary;
      fields: {
        requestedDays: string[];
        transportation: string | null;
        communityFee: number;
        dailyRate: number;
        caregiverName: string | null;
        caregiverPhone: string | null;
        caregiverEmail: string | null;
        caregiverAddressLine1: string | null;
        caregiverAddressLine2: string | null;
        caregiverCity: string | null;
        caregiverState: string | null;
        caregiverZip: string | null;
        secondaryContactName: string | null;
        secondaryContactPhone: string | null;
        secondaryContactEmail: string | null;
        secondaryContactRelationship: string | null;
        notes: string | null;
        intakePayload: EnrollmentPacketIntakePayload;
      };
      memberName: string;
    };

function clean(value: string | null | undefined) {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function cleanEmail(value: string | null | undefined) {
  const normalized = clean(value);
  return normalized ? normalized.toLowerCase() : null;
}

function normalizeStaffTransportation(value: string | null | undefined): StaffTransportationOption {
  const normalized = clean(value);
  if (!normalized) {
    throw new Error("Transportation selection is required.");
  }

  if (STAFF_TRANSPORTATION_OPTIONS.includes(normalized as StaffTransportationOption)) {
    return normalized as StaffTransportationOption;
  }

  throw new Error("Transportation must be Door to Door, Bus Stop, or Mixed.");
}

function splitMemberName(fullName: string | null | undefined) {
  const normalized = clean(fullName);
  if (!normalized) {
    return { firstName: null, lastName: null };
  }

  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: null };
  }

  return {
    firstName: parts[0] ?? null,
    lastName: parts.slice(1).join(" ") || null
  };
}

function payloadMemberDisplayName(payload: EnrollmentPacketIntakePayload) {
  const firstName = clean(payload.memberLegalFirstName);
  const lastName = clean(payload.memberLegalLastName);
  const combined = [firstName, lastName].filter((value): value is string => Boolean(value)).join(" ");
  return clean(combined);
}

function normalizeStoredIntakePayload(fields: EnrollmentPacketFieldsRow) {
  return normalizeEnrollmentPacketIntakePayload({
    ...getDefaultEnrollmentPacketIntakePayload(),
    ...(fields.intake_payload ?? {}),
    requestedAttendanceDays: fields.requested_days ?? [],
    transportationPreference: fields.transportation,
    primaryContactName: fields.caregiver_name,
    primaryContactPhone: fields.caregiver_phone,
    primaryContactEmail: fields.caregiver_email,
    secondaryContactName: fields.secondary_contact_name,
    secondaryContactPhone: fields.secondary_contact_phone,
    secondaryContactEmail: fields.secondary_contact_email,
    secondaryContactRelationship: fields.secondary_contact_relationship,
    additionalNotes: fields.notes
  });
}

function mergePublicProgressPayload(input: {
  storedPayload: EnrollmentPacketIntakePayload;
  intakePayload?: Partial<Record<string, unknown>> | null;
  caregiverName?: string | null;
  caregiverPhone?: string | null;
  caregiverEmail?: string | null;
  primaryContactAddress?: string | null;
  caregiverAddressLine1?: string | null;
  caregiverAddressLine2?: string | null;
  caregiverCity?: string | null;
  caregiverState?: string | null;
  caregiverZip?: string | null;
  secondaryContactName?: string | null;
  secondaryContactPhone?: string | null;
  secondaryContactEmail?: string | null;
  secondaryContactRelationship?: string | null;
  secondaryContactAddress?: string | null;
  notes?: string | null;
}) {
  return normalizeEnrollmentPacketIntakePayload({
    ...input.storedPayload,
    ...(input.intakePayload ?? {}),
    primaryContactName: clean(input.caregiverName) ?? input.storedPayload.primaryContactName,
    primaryContactPhone: clean(input.caregiverPhone) ?? input.storedPayload.primaryContactPhone,
    primaryContactEmail: cleanEmail(input.caregiverEmail) ?? input.storedPayload.primaryContactEmail,
    primaryContactAddress: clean(input.primaryContactAddress) ?? input.storedPayload.primaryContactAddress,
    memberAddressLine1: clean(input.caregiverAddressLine1) ?? input.storedPayload.memberAddressLine1,
    memberAddressLine2: clean(input.caregiverAddressLine2) ?? input.storedPayload.memberAddressLine2,
    memberCity: clean(input.caregiverCity) ?? input.storedPayload.memberCity,
    memberState: clean(input.caregiverState) ?? input.storedPayload.memberState,
    memberZip: clean(input.caregiverZip) ?? input.storedPayload.memberZip,
    secondaryContactName: clean(input.secondaryContactName) ?? input.storedPayload.secondaryContactName,
    secondaryContactPhone: clean(input.secondaryContactPhone) ?? input.storedPayload.secondaryContactPhone,
    secondaryContactEmail: cleanEmail(input.secondaryContactEmail) ?? input.storedPayload.secondaryContactEmail,
    secondaryContactRelationship:
      clean(input.secondaryContactRelationship) ?? input.storedPayload.secondaryContactRelationship,
    secondaryContactAddress: clean(input.secondaryContactAddress) ?? input.storedPayload.secondaryContactAddress,
    additionalNotes: clean(input.notes) ?? input.storedPayload.additionalNotes
  });
}

function isEmail(value: string | null | undefined) {
  const normalized = cleanEmail(value);
  if (!normalized) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
}

function safeNumber(value: number | null | undefined, fallback = 0) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Number(value.toFixed(2));
}

function toStatus(value: string | null | undefined): EnrollmentPacketStatus {
  const normalized = clean(value)?.toLowerCase() ?? "draft";
  if (normalized === "prepared") return "prepared";
  if (normalized === "sent") return "sent";
  if (normalized === "opened") return "opened";
  if (normalized === "partially_completed") return "partially_completed";
  if (normalized === "completed") return "completed";
  if (normalized === "filed") return "filed";
  return "draft";
}

function toSummary(row: EnrollmentPacketRequestRow): EnrollmentPacketRequestSummary {
  return {
    id: row.id,
    memberId: row.member_id,
    leadId: row.lead_id,
    senderUserId: row.sender_user_id,
    caregiverEmail: row.caregiver_email,
    status: toStatus(row.status),
    tokenExpiresAt: row.token_expires_at,
    createdAt: row.created_at,
    sentAt: row.sent_at,
    completedAt: row.completed_at
  };
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function generateSigningToken() {
  return randomBytes(TOKEN_BYTE_LENGTH).toString("hex");
}

function parseDataUrl(dataUrl: string) {
  const normalized = dataUrl.trim();
  const match = /^data:([^;]+);base64,(.+)$/.exec(normalized);
  if (!match) throw new Error("Invalid data URL payload.");
  return {
    contentType: match[1],
    bytes: Buffer.from(match[2], "base64")
  };
}

function isExpired(expiresAt: string) {
  const expiresMs = Date.parse(expiresAt);
  if (Number.isNaN(expiresMs)) return true;
  return Date.now() > expiresMs;
}

function buildAppBaseUrl(requestBaseUrl?: string | null) {
  const explicit =
    clean(requestBaseUrl) ??
    clean(process.env.NEXT_PUBLIC_APP_URL) ??
    clean(process.env.APP_URL) ??
    clean(process.env.NEXT_PUBLIC_SITE_URL) ??
    clean(process.env.SITE_URL);
  const fallbackHost = clean(process.env.VERCEL_PROJECT_PRODUCTION_URL) ?? clean(process.env.VERCEL_URL);
  const raw = explicit ?? fallbackHost ?? null;
  if (!raw) {
    if ((process.env.NODE_ENV ?? "").toLowerCase() === "production") {
      throw new Error(
        "Enrollment packet public URL is not configured. Set NEXT_PUBLIC_APP_URL (or APP_URL/SITE_URL) so signer links are live."
      );
    }
    return "http://localhost:3001";
  }

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const parsed = new URL(withProtocol);
  const localhostHostnames = new Set(["localhost", "127.0.0.1", "::1"]);
  if (parsed.protocol === "http:" && !localhostHostnames.has(parsed.hostname)) {
    parsed.protocol = "https:";
  }
  return parsed.toString().replace(/\/$/, "");
}

function getStorageUri(objectPath: string) {
  return `storage://${STORAGE_BUCKET}/${objectPath}`;
}

function parseStorageUri(storageUri: string | null | undefined) {
  const normalized = clean(storageUri);
  if (!normalized) return null;
  const prefix = `storage://${STORAGE_BUCKET}/`;
  if (!normalized.startsWith(prefix)) return null;
  return normalized.slice(prefix.length);
}

function nextMemberFileId() {
  return `mf_${randomUUID().replace(/-/g, "")}`;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function safeFileName(value: string) {
  return value.replace(/[<>:"/\\|?*]/g, "").trim();
}

function isRowFoundError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: string }).code ?? "");
  return code === "PGRST116";
}

function throwEnrollmentPacketSchemaError(error: unknown, objectName: string) {
  if (isMissingSchemaObjectError(error)) {
    throw new Error(
      buildMissingSchemaMessage({
        objectName,
        migration: "0027_enrollment_packet_intake_mapping.sql"
      })
    );
  }

  const message = error instanceof Error ? error.message : String(error);
  throw new Error(message);
}

async function uploadToStorage(input: {
  objectPath: string;
  bytes: Buffer;
  contentType: string;
}) {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.storage.from(STORAGE_BUCKET).upload(input.objectPath, input.bytes, {
    contentType: input.contentType,
    upsert: true
  });
  if (error) throw new Error(error.message);
  return getStorageUri(input.objectPath);
}

async function getMemberById(memberId: string) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("members")
    .select("id, display_name, enrollment_date")
    .eq("id", memberId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as MemberRow | null) ?? null;
}

async function getLeadById(leadId: string) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("leads")
    .select(
      "id, member_name, member_start_date, referral_name, caregiver_email, caregiver_name, caregiver_relationship, caregiver_phone"
    )
    .eq("id", leadId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as LeadRow | null) ?? null;
}

async function loadRequestById(packetId: string) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("enrollment_packet_requests")
    .select("*")
    .eq("id", packetId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as EnrollmentPacketRequestRow | null) ?? null;
}

async function loadRequestByToken(rawToken: string) {
  const hashed = hashToken(rawToken);
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("enrollment_packet_requests")
    .select("*")
    .eq("token", hashed)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as EnrollmentPacketRequestRow | null) ?? null;
}

async function loadPacketFields(packetId: string) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("enrollment_packet_fields")
    .select("*")
    .eq("packet_id", packetId)
    .maybeSingle();
  if (error) throwEnrollmentPacketSchemaError(error, "enrollment_packet_fields");
  return (data as EnrollmentPacketFieldsRow | null) ?? null;
}

async function insertPacketEvent(input: {
  packetId: string;
  eventType: string;
  actorUserId?: string | null;
  actorEmail?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("enrollment_packet_events").insert({
    packet_id: input.packetId,
    event_type: input.eventType,
    actor_user_id: input.actorUserId ?? null,
    actor_email: cleanEmail(input.actorEmail),
    timestamp: toEasternISO(),
    metadata: input.metadata ?? {}
  });
  if (error) throw new Error(error.message);
}

async function addLeadActivity(input: {
  leadId: string;
  memberName: string | null;
  activityType: string;
  outcome: string;
  notes: string;
  completedByUserId: string;
  completedByName: string;
  activityAt?: string;
}) {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("lead_activities").insert({
    lead_id: input.leadId,
    member_name: input.memberName,
    activity_at: input.activityAt ?? toEasternISO(),
    activity_type: input.activityType,
    outcome: input.outcome,
    notes: input.notes,
    completed_by_user_id: input.completedByUserId,
    completed_by_name: input.completedByName
  });
  if (error) throw new Error(error.message);
}

async function listActivePacketRows(memberId: string, leadId: string | null) {
  const admin = createSupabaseAdminClient();
  let query = admin
    .from("enrollment_packet_requests")
    .select("*")
    .eq("member_id", memberId)
    .order("created_at", { ascending: false });
  if (leadId) {
    query = query.eq("lead_id", leadId);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as EnrollmentPacketRequestRow[];
  return rows.filter((row) => {
    if (isExpired(row.token_expires_at)) return false;
    const status = toStatus(row.status);
    return status === "draft" || status === "prepared" || status === "sent" || status === "opened" || status === "partially_completed";
  });
}

export async function listEnrollmentPacketRequestsForMember(memberId: string) {
  const normalizedMemberId = clean(memberId);
  if (!normalizedMemberId) throw new Error("Member ID is required.");
  const canonical = await resolveCanonicalMemberRef(
    {
      sourceType: "member",
      memberId: normalizedMemberId,
      selectedId: normalizedMemberId
    },
    {
      actionLabel: "listEnrollmentPacketRequestsForMember",
      serviceRole: true
    }
  );
  if (!canonical.memberId) {
    throw new Error("listEnrollmentPacketRequestsForMember expected member.id but canonical member resolution returned empty memberId.");
  }
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("enrollment_packet_requests")
    .select("*")
    .eq("member_id", canonical.memberId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as EnrollmentPacketRequestRow[]).map((row) => toSummary(row));
}

export async function listEnrollmentPacketRequestsForLead(leadId: string) {
  const normalizedLeadId = clean(leadId);
  if (!normalizedLeadId) throw new Error("Lead ID is required.");
  const canonical = await resolveCanonicalLeadRef(
    {
      sourceType: "lead",
      leadId: normalizedLeadId,
      selectedId: normalizedLeadId
    },
    {
      actionLabel: "listEnrollmentPacketRequestsForLead",
      serviceRole: true
    }
  );
  if (!canonical.leadId) {
    throw new Error("listEnrollmentPacketRequestsForLead expected lead.id but canonical lead resolution returned empty leadId.");
  }
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("enrollment_packet_requests")
    .select("*")
    .eq("lead_id", canonical.leadId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as EnrollmentPacketRequestRow[]).map((row) => toSummary(row));
}

export async function getEnrollmentPacketSenderSignatureProfile(userId: string) {
  const normalizedUserId = clean(userId);
  if (!normalizedUserId) throw new Error("User ID is required.");
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("enrollment_packet_sender_signatures")
    .select("*")
    .eq("user_id", normalizedUserId)
    .maybeSingle();
  if (error && !isRowFoundError(error)) throw new Error(error.message);
  return (data as SenderProfileRow | null) ?? null;
}

export async function upsertEnrollmentPacketSenderSignatureProfile(input: {
  userId: string;
  signatureName: string;
  signatureImageDataUrl: string;
}) {
  const userId = clean(input.userId);
  const signatureName = clean(input.signatureName);
  if (!userId) throw new Error("User ID is required.");
  if (!signatureName) throw new Error("Signature name is required.");
  const signature = parseDataUrl(input.signatureImageDataUrl);
  if (!signature.contentType.startsWith("image/")) {
    throw new Error("Sender signature image must be a valid image.");
  }
  const now = toEasternISO();
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("enrollment_packet_sender_signatures")
    .upsert(
      {
        user_id: userId,
        signature_name: signatureName,
        signature_blob: input.signatureImageDataUrl.trim(),
        updated_at: now
      },
      { onConflict: "user_id" }
    )
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as SenderProfileRow;
}

async function sendEnrollmentPacketEmail(input: {
  caregiverEmail: string;
  caregiverName: string | null;
  memberName: string;
  optionalMessage?: string | null;
  requestUrl: string;
}) {
  const apiKey = clean(process.env.RESEND_API_KEY);
  if (!apiKey) throw new Error("Enrollment packet email delivery is not configured. Set RESEND_API_KEY.");
  const clinicalSenderEmail = resolveClinicalSenderEmail();
  const template = buildEnrollmentPacketTemplate({
    recipientName: clean(input.caregiverName) ?? "Family Member",
    memberName: input.memberName,
    requestUrl: input.requestUrl,
    optionalMessage: input.optionalMessage ?? null
  });

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: `${template.fromDisplayName} <${clinicalSenderEmail}>`,
      to: [input.caregiverEmail],
      subject: template.subject,
      html: template.html,
      text: template.text
    })
  });

  if (!response.ok) {
    let detail = "";
    try {
      detail = await response.text();
    } catch {
      detail = "";
    }
    throw new Error(`Unable to deliver enrollment packet email (${response.status}). ${detail}`.trim());
  }
}

function resolveClinicalSenderEmail() {
  const sender = clean(process.env.CLINICAL_SENDER_EMAIL);
  if (!sender || !isEmail(sender)) {
    throw new Error("CLINICAL_SENDER_EMAIL is missing or invalid.");
  }
  return sender;
}

async function resolveSendContext(input: {
  memberId?: string | null;
  leadId?: string | null;
}) {
  const leadId = clean(input.leadId);
  if (!leadId) {
    throw new Error("sendEnrollmentPacketRequest requires lead.id. Enrollment packet sending is lead-driven.");
  }

  const canonicalLead = await resolveCanonicalLeadRef(
    {
      sourceType: "lead",
      leadId,
      selectedId: leadId
    },
    {
      actionLabel: "sendEnrollmentPacketRequest",
      serviceRole: true
    }
  );
  if (!canonicalLead.leadId) {
    throw new Error("sendEnrollmentPacketRequest expected lead.id but canonical lead resolution returned empty leadId.");
  }

  let member = await ensureCanonicalMemberForLead({
    leadId: canonicalLead.leadId,
    actionLabel: "sendEnrollmentPacketRequest.ensureCanonicalMemberForLead",
    serviceRole: true
  });
  if (!member) {
    throw new Error("Enrollment packet requires canonical member linkage for the selected lead.");
  }

  const memberIdFromInput = clean(input.memberId);
  if (memberIdFromInput) {
    const memberCanonical = await resolveCanonicalMemberRef(
      {
        sourceType: "member",
        memberId: memberIdFromInput,
        selectedId: memberIdFromInput
      },
      {
        actionLabel: "sendEnrollmentPacketRequest.strictLinkCheck",
        serviceRole: true
      }
    );
    if (!memberCanonical.memberId || memberCanonical.memberId !== member.id) {
      throw new Error(
        `sendEnrollmentPacketRequest expected canonical member linked to lead.id ${canonicalLead.leadId}, but member.id ${memberIdFromInput} is not linked to that lead.`
      );
    }
  }

  const lead = await getLeadById(canonicalLead.leadId);
  if (!lead) throw new Error("Lead was not found.");
  const refreshedMember = await getMemberById(member.id);
  if (!refreshedMember) throw new Error("Member was not found.");

  return { member: refreshedMember, lead };
}

export async function sendEnrollmentPacketRequest(input: {
  memberId?: string | null;
  leadId: string;
  senderUserId: string;
  senderFullName: string;
  senderEmail?: string | null;
  caregiverEmail?: string | null;
  requestedStartDate?: string | null;
  requestedDays: string[];
  transportation: string;
  communityFeeOverride?: number | null;
  dailyRateOverride?: number | null;
  totalInitialEnrollmentAmountOverride?: number | null;
  optionalMessage?: string | null;
  appBaseUrl?: string | null;
}) {
  const senderUserId = clean(input.senderUserId);
  const senderFullName = clean(input.senderFullName);
  const senderEmail = resolveClinicalSenderEmail();
  if (!senderUserId) throw new Error("Sender user is required.");
  if (!senderFullName) throw new Error("Sender name is required.");
  if (!isEmail(senderEmail)) throw new Error("Sender email is invalid.");

  const signatureProfile = await getEnrollmentPacketSenderSignatureProfile(senderUserId);
  if (!signatureProfile) {
    const err = new Error("Sender signature is not configured.");
    (err as Error & { code?: string }).code = "signature_setup_required";
    throw err;
  }

  const { member, lead } = await resolveSendContext({
    memberId: input.memberId,
    leadId: input.leadId
  });
  const staffTransportation = normalizeStaffTransportation(input.transportation);
  const requestedStartDate = normalizeEnrollmentDateOnly(
    clean(input.requestedStartDate) ?? clean(lead?.member_start_date) ?? toEasternDate()
  );
  const resolvedPricing = await resolveEnrollmentPricingForRequestedDays({
    requestedDays: input.requestedDays,
    effectiveDate: requestedStartDate
  });
  const communityFeeOverride =
    typeof input.communityFeeOverride === "number" && Number.isFinite(input.communityFeeOverride)
      ? safeNumber(input.communityFeeOverride, resolvedPricing.communityFeeAmount)
      : null;
  const dailyRateOverride =
    typeof input.dailyRateOverride === "number" && Number.isFinite(input.dailyRateOverride)
      ? safeNumber(input.dailyRateOverride, resolvedPricing.dailyRateAmount)
      : null;
  const effectiveCommunityFee = communityFeeOverride ?? safeNumber(resolvedPricing.communityFeeAmount);
  const effectiveDailyRate = dailyRateOverride ?? safeNumber(resolvedPricing.dailyRateAmount);
  const calculatedInitialEnrollmentAmount = calculateInitialEnrollmentAmount({
    requestedStartDate,
    requestedDays: resolvedPricing.requestedDays,
    dailyRate: effectiveDailyRate,
    communityFee: effectiveCommunityFee
  });
  const totalInitialEnrollmentAmountOverride =
    typeof input.totalInitialEnrollmentAmountOverride === "number" &&
    Number.isFinite(input.totalInitialEnrollmentAmountOverride)
      ? safeNumber(input.totalInitialEnrollmentAmountOverride, calculatedInitialEnrollmentAmount)
      : null;
  const effectiveInitialEnrollmentAmount = totalInitialEnrollmentAmountOverride ?? calculatedInitialEnrollmentAmount;
  const pricingSnapshot = {
    ...(resolvedPricing.snapshot ?? {}),
    selectedValues: {
      communityFee: effectiveCommunityFee,
      dailyRate: effectiveDailyRate,
      totalInitialEnrollmentAmount: effectiveInitialEnrollmentAmount,
      requestedStartDate
    },
    overrides: {
      communityFee: communityFeeOverride,
      dailyRate: dailyRateOverride,
      totalInitialEnrollmentAmount: totalInitialEnrollmentAmountOverride
    }
  };
  const caregiverEmail = cleanEmail(input.caregiverEmail) ?? cleanEmail(lead?.caregiver_email);
  if (!isEmail(caregiverEmail)) throw new Error("Caregiver email is required.");
  const memberNameParts = splitMemberName(lead?.member_name ?? member.display_name);

  const active = await listActivePacketRows(member.id, lead?.id ?? null);
  if (active.length > 0) {
    throw new Error("An active enrollment packet already exists for this member.");
  }

  const now = toEasternISO();
  const requestId = randomUUID();
  const token = generateSigningToken();
  const hashedToken = hashToken(token);
  const expiresAtDate = new Date();
  expiresAtDate.setDate(expiresAtDate.getDate() + 14);
  const expiresAt = expiresAtDate.toISOString();
  const requestUrl = `${buildAppBaseUrl(input.appBaseUrl)}/sign/enrollment-packet/${token}`;

  const admin = createSupabaseAdminClient();
  const { error: requestError } = await admin.from("enrollment_packet_requests").insert({
    id: requestId,
    member_id: member.id,
    lead_id: lead?.id ?? null,
    sender_user_id: senderUserId,
    caregiver_email: caregiverEmail,
    status: "draft",
    token: hashedToken,
    token_expires_at: expiresAt,
    created_at: now,
    sent_at: null,
    completed_at: null,
    updated_at: now
  });
  if (requestError) throw new Error(requestError.message);

  const { error: fieldsError } = await admin.from("enrollment_packet_fields").insert({
    packet_id: requestId,
    requested_days: resolvedPricing.requestedDays,
    transportation: staffTransportation,
    community_fee: effectiveCommunityFee,
    daily_rate: effectiveDailyRate,
    pricing_community_fee_id: resolvedPricing.communityFeeId,
    pricing_daily_rate_id: resolvedPricing.dailyRateId,
    pricing_snapshot: pricingSnapshot,
    caregiver_name: clean(lead?.caregiver_name),
    caregiver_phone: clean(lead?.caregiver_phone),
    caregiver_email: caregiverEmail,
    intake_payload: normalizeEnrollmentPacketIntakePayload({
      memberLegalFirstName: memberNameParts.firstName,
      memberLegalLastName: memberNameParts.lastName,
      requestedAttendanceDays: resolvedPricing.requestedDays,
      requestedStartDate,
      transportationPreference: staffTransportation,
      transportationQuestionEnabled: "No",
      referredBy: clean(lead?.referral_name),
      primaryContactName: clean(lead?.caregiver_name),
      primaryContactRelationship: clean(lead?.caregiver_relationship),
      primaryContactPhone: clean(lead?.caregiver_phone),
      primaryContactEmail: caregiverEmail,
      responsiblePartyGuarantorFirstName: clean(lead?.caregiver_name)?.split(" ")[0] ?? null,
      responsiblePartyGuarantorLastName: clean(lead?.caregiver_name)?.split(" ").slice(1).join(" ") || null,
      membershipNumberOfDays: String(resolvedPricing.requestedDays.length),
      membershipDailyAmount: effectiveDailyRate.toFixed(2),
      communityFee: effectiveCommunityFee.toFixed(2),
      totalInitialEnrollmentAmount: effectiveInitialEnrollmentAmount.toFixed(2),
      photoConsentMemberName: clean(lead?.member_name) ?? clean(member.display_name)
    }),
    created_at: now,
    updated_at: now
  });
  if (fieldsError) throwEnrollmentPacketSchemaError(fieldsError, "enrollment_packet_fields");

  const { error: signatureError } = await admin.from("enrollment_packet_signatures").insert({
    packet_id: requestId,
    signer_name: signatureProfile.signature_name,
    signer_email: senderEmail,
    signer_role: "sender_staff",
    signature_blob: signatureProfile.signature_blob,
    ip_address: null,
    signed_at: now,
    created_at: now,
    updated_at: now
  });
  if (signatureError) throw new Error(signatureError.message);

  const preparedAt = toEasternISO();
  const { data: preparedRow, error: preparedError } = await admin
    .from("enrollment_packet_requests")
    .update({ status: "prepared", updated_at: preparedAt })
    .eq("id", requestId)
    .eq("status", "draft")
    .select("id")
    .maybeSingle();
  if (preparedError) throw new Error(preparedError.message);
  if (!preparedRow) {
    throw new Error("Unable to transition enrollment packet from Draft to Prepared.");
  }
  await insertPacketEvent({
    packetId: requestId,
    eventType: "prepared",
    actorUserId: senderUserId,
    actorEmail: senderEmail,
    metadata: {
      memberId: member.id,
      leadId: lead?.id ?? null,
      pricingCommunityFeeId: resolvedPricing.communityFeeId,
      pricingDailyRateId: resolvedPricing.dailyRateId,
      pricingDaysPerWeek: resolvedPricing.daysPerWeek,
      communityFee: effectiveCommunityFee,
      dailyRate: effectiveDailyRate,
      requestedStartDate,
      totalInitialEnrollmentAmount: effectiveInitialEnrollmentAmount,
      communityFeeOverride,
      dailyRateOverride,
      totalInitialEnrollmentAmountOverride
    }
  });

  try {
    await sendEnrollmentPacketEmail({
      caregiverEmail: caregiverEmail!,
      caregiverName: lead?.caregiver_name ?? null,
      memberName: member.display_name,
      optionalMessage: input.optionalMessage ?? null,
      requestUrl
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unable to deliver enrollment packet email.";
    throw new Error(`${reason} Packet saved as Prepared. Copy secure link manually: ${requestUrl}`);
  }

  const sentAt = toEasternISO();
  const { data: sentRow, error: sentError } = await admin
    .from("enrollment_packet_requests")
    .update({
      status: "sent",
      sent_at: sentAt,
      updated_at: sentAt
    })
    .eq("id", requestId)
    .eq("status", "prepared")
    .select("id")
    .maybeSingle();
  if (sentError) throw new Error(sentError.message);
  if (!sentRow) {
    throw new Error("Unable to transition enrollment packet from Prepared to Sent.");
  }

  await insertPacketEvent({
    packetId: requestId,
    eventType: "Enrollment Packet Sent",
    actorUserId: senderUserId,
    actorEmail: senderEmail
  });

  if (lead?.id) {
    await addLeadActivity({
      leadId: lead.id,
      memberName: lead.member_name,
      activityType: "Email",
      outcome: "Enrollment Packet Sent",
      notes: `Enrollment packet request ${requestId} sent to ${caregiverEmail}.`,
      completedByUserId: senderUserId,
      completedByName: senderFullName
    });
  }

  const created = await loadRequestById(requestId);
  if (!created) throw new Error("Enrollment packet request could not be loaded.");
  return {
    request: toSummary(created),
    requestUrl
  };
}

function toPublicContext(
  request: EnrollmentPacketRequestRow,
  fields: EnrollmentPacketFieldsRow,
  memberName: string
): PublicEnrollmentPacketContext {
  const intakePayload = normalizeStoredIntakePayload(fields);
  const prefilledMemberName = payloadMemberDisplayName(intakePayload);
  return {
    state: "ready",
    request: toSummary(request),
    memberName: prefilledMemberName ?? memberName,
    fields: {
      requestedDays: fields.requested_days ?? [],
      transportation: fields.transportation,
      communityFee: safeNumber(fields.community_fee),
      dailyRate: safeNumber(fields.daily_rate),
      caregiverName: fields.caregiver_name,
      caregiverPhone: fields.caregiver_phone,
      caregiverEmail: fields.caregiver_email,
      caregiverAddressLine1: fields.caregiver_address_line1,
      caregiverAddressLine2: fields.caregiver_address_line2,
      caregiverCity: fields.caregiver_city,
      caregiverState: fields.caregiver_state,
      caregiverZip: fields.caregiver_zip,
      secondaryContactName: fields.secondary_contact_name,
      secondaryContactPhone: fields.secondary_contact_phone,
      secondaryContactEmail: fields.secondary_contact_email,
      secondaryContactRelationship: fields.secondary_contact_relationship,
      notes: fields.notes,
      intakePayload
    }
  };
}

export async function getPublicEnrollmentPacketContext(
  token: string,
  metadata?: { ip?: string | null; userAgent?: string | null }
): Promise<PublicEnrollmentPacketContext> {
  const normalizedToken = clean(token);
  if (!normalizedToken) return { state: "invalid" };
  const request = await loadRequestByToken(normalizedToken);
  if (!request) return { state: "invalid" };

  if (isExpired(request.token_expires_at)) return { state: "expired" };
  if (toStatus(request.status) === "completed" || toStatus(request.status) === "filed") {
    return {
      state: "completed",
      request: toSummary(request)
    };
  }

  if (toStatus(request.status) === "sent") {
    const now = toEasternISO();
    const admin = createSupabaseAdminClient();
    const { data: openedRow, error } = await admin
      .from("enrollment_packet_requests")
      .update({
        status: "opened",
        updated_at: now
      })
      .eq("id", request.id)
      .eq("status", "sent")
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (openedRow) {
      await insertPacketEvent({
        packetId: request.id,
        eventType: "opened",
        actorEmail: request.caregiver_email,
        metadata: {
          ip: clean(metadata?.ip),
          userAgent: clean(metadata?.userAgent)
        }
      });
    }
  }

  const [reloaded, fields, member] = await Promise.all([
    loadRequestById(request.id),
    loadPacketFields(request.id),
    getMemberById(request.member_id)
  ]);
  if (!reloaded || !fields || !member) return { state: "invalid" };
  return toPublicContext(reloaded, fields, member.display_name);
}

async function upsertMemberFileBySource(input: {
  memberId: string;
  documentSource: string;
  fileName: string;
  fileType: string;
  dataUrl: string | null;
  storageUri: string | null;
  category: string;
  uploadedByUserId: string | null;
  uploadedByName: string | null;
  packetId: string;
}) {
  const now = toEasternISO();
  const admin = createSupabaseAdminClient();
  const { data: existing, error: existingError } = await admin
    .from("member_files")
    .select("id")
    .eq("member_id", input.memberId)
    .eq("document_source", input.documentSource)
    .maybeSingle();
  if (existingError && !isRowFoundError(existingError)) throw new Error(existingError.message);

  const patch = {
    file_name: input.fileName,
    file_type: input.fileType,
    file_data_url: input.dataUrl,
    storage_object_path: parseStorageUri(input.storageUri),
    category: input.category,
    category_other: null,
    document_source: input.documentSource,
    uploaded_by_user_id: input.uploadedByUserId,
    uploaded_by_name: input.uploadedByName,
    uploaded_at: now,
    updated_at: now,
    enrollment_packet_request_id: input.packetId
  };

  if (existing) {
    const { error: updateError } = await admin.from("member_files").update(patch).eq("id", String(existing.id));
    if (updateError) throw new Error(updateError.message);
    return String(existing.id);
  }

  const memberFileId = nextMemberFileId();
  const { error: insertError } = await admin.from("member_files").insert({
    id: memberFileId,
    member_id: input.memberId,
    ...patch
  });
  if (insertError) throw new Error(insertError.message);
  return memberFileId;
}

async function insertUploadAndFile(input: {
  packetId: string;
  memberId: string;
  fileName: string;
  contentType: string;
  bytes: Buffer;
  uploadCategory: EnrollmentPacketUploadCategory;
  uploadedByUserId: string | null;
  uploadedByName: string | null;
  dataUrl?: string | null;
}) {
  const safeName = safeFileName(input.fileName) || `upload-${randomUUID()}`;
  const objectPath = `members/${input.memberId}/enrollment-packets/${input.packetId}/${input.uploadCategory}/${randomUUID()}-${slugify(safeName)}`;
  const storageUri = await uploadToStorage({
    objectPath,
    bytes: input.bytes,
    contentType: input.contentType
  });
  const memberFileId = await upsertMemberFileBySource({
    memberId: input.memberId,
    documentSource: `Enrollment Packet ${input.uploadCategory}:${input.packetId}:${safeName}`,
    fileName: safeName,
    fileType: input.contentType,
    dataUrl: input.dataUrl ?? null,
    storageUri,
    category: [
      "insurance",
      "poa",
      "medicare_card",
      "private_insurance",
      "supplemental_insurance",
      "poa_guardianship",
      "dnr_dni_advance_directive",
      "signed_membership_agreement",
      "signed_exhibit_a_payment_authorization"
    ].includes(input.uploadCategory)
      ? "Legal"
      : "Admin",
    uploadedByUserId: input.uploadedByUserId,
    uploadedByName: input.uploadedByName,
    packetId: input.packetId
  });

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("enrollment_packet_uploads").insert({
    packet_id: input.packetId,
    member_id: input.memberId,
    file_path: storageUri,
    file_name: safeName,
    file_type: input.contentType,
    upload_category: input.uploadCategory,
    member_file_id: memberFileId,
    uploaded_at: toEasternISO()
  });
  if (error) {
    const text = String(error.message ?? "").toLowerCase();
    if (
      text.includes("enrollment_packet_uploads_upload_category_check") ||
      text.includes("upload_category") ||
      isMissingSchemaObjectError(error)
    ) {
      throw new Error(
        buildMissingSchemaMessage({
          objectName: "enrollment_packet_uploads",
          migration: "0027_enrollment_packet_intake_mapping.sql"
        })
      );
    }
    throw new Error(error.message);
  }
  return { storageUri, memberFileId };
}

async function buildCompletedPacketDocxData(input: {
  memberName: string;
  request: EnrollmentPacketRequestRow;
  fields: EnrollmentPacketFieldsRow;
  caregiverSignatureName: string;
  senderSignatureName: string;
}) {
  return buildCompletedEnrollmentPacketDocxData({
    memberName: input.memberName,
    packetId: input.request.id,
    requestedDays: input.fields.requested_days ?? [],
    transportation: input.fields.transportation,
    communityFee: safeNumber(input.fields.community_fee),
    dailyRate: safeNumber(input.fields.daily_rate),
    caregiverName: input.fields.caregiver_name,
    caregiverPhone: input.fields.caregiver_phone,
    caregiverEmail: input.fields.caregiver_email,
    caregiverAddressLine1: input.fields.caregiver_address_line1,
    caregiverAddressLine2: input.fields.caregiver_address_line2,
    caregiverCity: input.fields.caregiver_city,
    caregiverState: input.fields.caregiver_state,
    caregiverZip: input.fields.caregiver_zip,
    secondaryContactName: input.fields.secondary_contact_name,
    secondaryContactPhone: input.fields.secondary_contact_phone,
    secondaryContactEmail: input.fields.secondary_contact_email,
    secondaryContactRelationship: input.fields.secondary_contact_relationship,
    intakePayload: normalizeStoredIntakePayload(input.fields),
    caregiverSignatureName: input.caregiverSignatureName,
    senderSignatureName: input.senderSignatureName
  });
}

export async function savePublicEnrollmentPacketProgress(input: {
  token: string;
  caregiverName?: string | null;
  caregiverPhone?: string | null;
  caregiverEmail?: string | null;
  primaryContactAddress?: string | null;
  caregiverAddressLine1?: string | null;
  caregiverAddressLine2?: string | null;
  caregiverCity?: string | null;
  caregiverState?: string | null;
  caregiverZip?: string | null;
  secondaryContactName?: string | null;
  secondaryContactPhone?: string | null;
  secondaryContactEmail?: string | null;
  secondaryContactRelationship?: string | null;
  secondaryContactAddress?: string | null;
  notes?: string | null;
  intakePayload?: Partial<Record<string, unknown>> | null;
}) {
  const context = await getPublicEnrollmentPacketContext(input.token);
  if (context.state !== "ready") throw new Error("Enrollment packet link is not active.");
  const mergedPayload = mergePublicProgressPayload({
    storedPayload: context.fields.intakePayload,
    intakePayload: input.intakePayload,
    caregiverName: input.caregiverName,
    caregiverPhone: input.caregiverPhone,
    caregiverEmail: input.caregiverEmail,
    primaryContactAddress: input.primaryContactAddress,
    caregiverAddressLine1: input.caregiverAddressLine1,
    caregiverAddressLine2: input.caregiverAddressLine2,
    caregiverCity: input.caregiverCity,
    caregiverState: input.caregiverState,
    caregiverZip: input.caregiverZip,
    secondaryContactName: input.secondaryContactName,
    secondaryContactPhone: input.secondaryContactPhone,
    secondaryContactEmail: input.secondaryContactEmail,
    secondaryContactRelationship: input.secondaryContactRelationship,
    secondaryContactAddress: input.secondaryContactAddress,
    notes: input.notes
  });
  const now = toEasternISO();
  const admin = createSupabaseAdminClient();
  const { error: fieldsError } = await admin
    .from("enrollment_packet_fields")
    .update({
      caregiver_name: mergedPayload.primaryContactName,
      caregiver_phone: mergedPayload.primaryContactPhone,
      caregiver_email: cleanEmail(mergedPayload.primaryContactEmail),
      caregiver_address_line1: mergedPayload.primaryContactAddress ?? mergedPayload.memberAddressLine1,
      caregiver_address_line2: mergedPayload.memberAddressLine2,
      caregiver_city: mergedPayload.memberCity,
      caregiver_state: mergedPayload.memberState,
      caregiver_zip: mergedPayload.memberZip,
      secondary_contact_name: mergedPayload.secondaryContactName,
      secondary_contact_phone: mergedPayload.secondaryContactPhone,
      secondary_contact_email: cleanEmail(mergedPayload.secondaryContactEmail),
      secondary_contact_relationship: mergedPayload.secondaryContactRelationship,
      notes: mergedPayload.additionalNotes,
      intake_payload: mergedPayload,
      updated_at: now
    })
    .eq("packet_id", context.request.id);
  if (fieldsError) throwEnrollmentPacketSchemaError(fieldsError, "enrollment_packet_fields");

  const adminReq = createSupabaseAdminClient();
  const { data: progressRow, error: progressError } = await adminReq
    .from("enrollment_packet_requests")
    .update({
      status: "partially_completed",
      updated_at: now
    })
    .eq("id", context.request.id)
    .in("status", ["prepared", "sent", "opened", "partially_completed"])
    .select("id")
    .maybeSingle();
  if (progressError) throw new Error(progressError.message);
  if (!progressRow) {
    throw new Error("Unable to save enrollment packet progress because the packet is no longer in an editable state.");
  }

  await insertPacketEvent({
    packetId: context.request.id,
    eventType: "partially_completed",
    actorEmail: cleanEmail(mergedPayload.primaryContactEmail) ?? context.request.caregiverEmail
  });
  return { ok: true as const };
}

export async function submitPublicEnrollmentPacket(input: {
  token: string;
  caregiverTypedName: string;
  caregiverSignatureImageDataUrl: string;
  attested: boolean;
  caregiverIp: string | null;
  caregiverUserAgent: string | null;
  caregiverName?: string | null;
  caregiverPhone?: string | null;
  caregiverEmail?: string | null;
  primaryContactAddress?: string | null;
  caregiverAddressLine1?: string | null;
  caregiverAddressLine2?: string | null;
  caregiverCity?: string | null;
  caregiverState?: string | null;
  caregiverZip?: string | null;
  secondaryContactName?: string | null;
  secondaryContactPhone?: string | null;
  secondaryContactEmail?: string | null;
  secondaryContactRelationship?: string | null;
  secondaryContactAddress?: string | null;
  notes?: string | null;
  intakePayload?: Partial<Record<string, unknown>> | null;
  uploads?: PacketFileUpload[];
}) {
  const normalizedToken = clean(input.token);
  const caregiverTypedName = clean(input.caregiverTypedName);
  if (!normalizedToken) throw new Error("Signature token is required.");
  if (!caregiverTypedName) throw new Error("Typed caregiver name is required.");
  if (!input.attested) throw new Error("Electronic signature attestation is required.");
  const signature = parseDataUrl(input.caregiverSignatureImageDataUrl);
  if (!signature.contentType.startsWith("image/")) throw new Error("Caregiver signature format is invalid.");

  const request = await loadRequestByToken(normalizedToken);
  if (!request) throw new Error("This enrollment packet link is invalid.");
  const status = toStatus(request.status);
  if (status === "completed" || status === "filed") throw new Error("This enrollment packet has already been submitted.");
  if (isExpired(request.token_expires_at)) throw new Error("This enrollment packet link has expired.");

  const member = await getMemberById(request.member_id);
  if (!member) throw new Error("Member record was not found.");

  await savePublicEnrollmentPacketProgress({
    token: normalizedToken,
    caregiverName: input.caregiverName,
    caregiverPhone: input.caregiverPhone,
    caregiverEmail: input.caregiverEmail,
    primaryContactAddress: input.primaryContactAddress,
    caregiverAddressLine1: input.caregiverAddressLine1,
    caregiverAddressLine2: input.caregiverAddressLine2,
    caregiverCity: input.caregiverCity,
    caregiverState: input.caregiverState,
    caregiverZip: input.caregiverZip,
    secondaryContactName: input.secondaryContactName,
    secondaryContactPhone: input.secondaryContactPhone,
    secondaryContactEmail: input.secondaryContactEmail,
    secondaryContactRelationship: input.secondaryContactRelationship,
    secondaryContactAddress: input.secondaryContactAddress,
    notes: input.notes,
    intakePayload: input.intakePayload
  });

  const fieldsForValidation = await loadPacketFields(request.id);
  if (!fieldsForValidation) throw new Error("Enrollment packet fields were not found.");
  const validationPayload = normalizeStoredIntakePayload(fieldsForValidation);
  const completionValidation = validateEnrollmentPacketCompletion({
    payload: validationPayload
  });
  if (!completionValidation.isComplete) {
    throw new Error(
      `Complete all required packet fields before signing. Missing: ${completionValidation.missingItems.join(", ")}.`
    );
  }

  const now = toEasternISO();
  const admin = createSupabaseAdminClient();
  const rotatedToken = hashToken(generateSigningToken());
  const { error: signatureRowError } = await admin.from("enrollment_packet_signatures").insert({
    packet_id: request.id,
    signer_name: caregiverTypedName,
    signer_email: cleanEmail(input.caregiverEmail) ?? request.caregiver_email,
    signer_role: "caregiver",
    signature_blob: input.caregiverSignatureImageDataUrl.trim(),
    ip_address: clean(input.caregiverIp),
    signed_at: now,
    created_at: now,
    updated_at: now
  });
  if (signatureRowError) throw new Error(signatureRowError.message);

  const senderSignature = await admin
    .from("enrollment_packet_signatures")
    .select("signer_name, signature_blob")
    .eq("packet_id", request.id)
    .eq("signer_role", "sender_staff")
    .order("signed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (senderSignature.error && !isRowFoundError(senderSignature.error)) {
    throw new Error(senderSignature.error.message);
  }
  const senderSignatureName = senderSignature.data ? String((senderSignature.data as { signer_name: string }).signer_name) : "Staff";

  const signatureArtifact = await insertUploadAndFile({
    packetId: request.id,
    memberId: member.id,
    fileName: `Enrollment Packet Signature - ${toEasternDate(now)}.png`,
    contentType: signature.contentType,
    bytes: signature.bytes,
    uploadCategory: "signature_artifact",
    uploadedByUserId: null,
    uploadedByName: caregiverTypedName,
    dataUrl: input.caregiverSignatureImageDataUrl.trim()
  });

  const uploadedArtifacts: Array<{ uploadCategory: EnrollmentPacketUploadCategory; memberFileId: string | null }> = [
    { uploadCategory: "signature_artifact", memberFileId: signatureArtifact.memberFileId }
  ];

  for (const upload of input.uploads ?? []) {
    const artifact = await insertUploadAndFile({
      packetId: request.id,
      memberId: member.id,
      fileName: upload.fileName,
      contentType: upload.contentType,
      bytes: upload.bytes,
      uploadCategory: upload.category,
      uploadedByUserId: null,
      uploadedByName: caregiverTypedName
    });
    uploadedArtifacts.push({
      uploadCategory: upload.category,
      memberFileId: artifact.memberFileId
    });
  }

  const refreshedFields = await loadPacketFields(request.id);
  if (!refreshedFields) throw new Error("Enrollment packet fields are missing.");
  const packetDocx = await buildCompletedPacketDocxData({
    memberName: member.display_name,
    request,
    fields: refreshedFields,
    caregiverSignatureName: caregiverTypedName,
    senderSignatureName
  });
  const finalPacketArtifact = await insertUploadAndFile({
    packetId: request.id,
    memberId: member.id,
    fileName: packetDocx.fileName,
    contentType: packetDocx.contentType,
    bytes: packetDocx.bytes,
    uploadCategory: "completed_packet",
    uploadedByUserId: null,
    uploadedByName: caregiverTypedName,
    dataUrl: packetDocx.dataUrl
  });
  uploadedArtifacts.push({
    uploadCategory: "completed_packet",
    memberFileId: finalPacketArtifact.memberFileId
  });

  const { data: completedRow, error: completedError } = await admin
    .from("enrollment_packet_requests")
    .update({
      status: "completed",
      completed_at: now,
      token: rotatedToken,
      updated_at: now
    })
    .eq("id", request.id)
    .in("status", ["prepared", "sent", "opened", "partially_completed"])
    .select("id")
    .maybeSingle();
  if (completedError) throw new Error(completedError.message);
  if (!completedRow) {
    throw new Error("Unable to transition enrollment packet to Completed from its current status.");
  }

  await insertPacketEvent({
    packetId: request.id,
    eventType: "Enrollment Packet Completed",
    actorEmail: cleanEmail(input.caregiverEmail) ?? request.caregiver_email,
    metadata: {
      signatureArtifactMemberFileId: signatureArtifact.memberFileId,
      finalPacketMemberFileId: finalPacketArtifact.memberFileId
    }
  });

  const downstreamMapping = await mapEnrollmentPacketToDownstream({
    packetId: request.id,
    memberId: member.id,
    senderUserId: request.sender_user_id,
    senderName: senderSignatureName,
    senderEmail: null,
    caregiverEmail: cleanEmail(input.caregiverEmail) ?? request.caregiver_email,
    fields: refreshedFields,
    memberFileArtifacts: uploadedArtifacts.map((artifact) => ({
      uploadCategory: artifact.uploadCategory,
      memberFileId: artifact.memberFileId
    }))
  });

  const filedAt = toEasternISO();
  const { data: filedRow, error: filedError } = await admin
    .from("enrollment_packet_requests")
    .update({
      status: "filed",
      updated_at: filedAt
    })
    .eq("id", request.id)
    .in("status", ["completed", "filed"])
    .select("id")
    .maybeSingle();
  if (filedError) throw new Error(filedError.message);
  if (!filedRow) {
    throw new Error("Unable to transition enrollment packet to Filed from its current status.");
  }

  await insertPacketEvent({
    packetId: request.id,
    eventType: "filed",
    actorUserId: request.sender_user_id,
    metadata: {
      downstreamSystemsUpdated: downstreamMapping.downstreamSystemsUpdated,
      conflictsRequiringReview: downstreamMapping.conflictsRequiringReview,
      mappingRunId: downstreamMapping.mappingRunId
    }
  });

  if (request.lead_id) {
    const lead = await getLeadById(request.lead_id);
    await addLeadActivity({
      leadId: request.lead_id,
      memberName: lead?.member_name ?? member.display_name,
      activityType: "Email",
      outcome: "Enrollment Packet Completed",
      notes: `Enrollment packet request ${request.id} completed by caregiver and filed to member records.`,
      completedByUserId: request.sender_user_id,
      completedByName: senderSignatureName,
      activityAt: filedAt
    });
  }

  await createUserNotification({
    recipientUserId: request.sender_user_id,
    title: "Enrollment Packet Completed",
    message: `Enrollment packet completed for ${member.display_name}`,
    entityType: "enrollment_packet_request",
    entityId: request.id,
    metadata: {
      memberId: member.id,
      leadId: request.lead_id,
      packetId: request.id
    },
    serviceRole: true
  });

  return {
    packetId: request.id,
    memberId: member.id,
    status: "filed" as const
  };
}
