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
  ensureMemberAttendanceScheduleSupabase,
  ensureMemberCommandCenterProfileSupabase
} from "@/lib/services/member-command-center-supabase";
import { createUserNotification } from "@/lib/services/notifications";
import { resolveEnrollmentPricingForRequestedDays } from "@/lib/services/enrollment-pricing";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { toEasternDate, toEasternISO } from "@/lib/timezone";

const STORAGE_BUCKET = "member-documents";
const TOKEN_BYTE_LENGTH = 32;

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
};

type MemberRow = {
  id: string;
  display_name: string;
  enrollment_date: string | null;
};

type LeadRow = {
  id: string;
  member_name: string | null;
  caregiver_email: string | null;
  caregiver_name: string | null;
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
  category: "insurance" | "poa" | "supporting";
};

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
    .select("id, member_name, caregiver_email, caregiver_name, caregiver_phone")
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
  if (error) throw new Error(error.message);
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
  requestedDays: string[];
  transportation: string | null;
  communityFeeOverride?: number | null;
  dailyRateOverride?: number | null;
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
  const resolvedPricing = await resolveEnrollmentPricingForRequestedDays({
    requestedDays: input.requestedDays
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
  const pricingSnapshot = {
    ...(resolvedPricing.snapshot ?? {}),
    selectedValues: {
      communityFee: effectiveCommunityFee,
      dailyRate: effectiveDailyRate
    },
    overrides: {
      communityFee: communityFeeOverride,
      dailyRate: dailyRateOverride
    }
  };
  const caregiverEmail = cleanEmail(input.caregiverEmail) ?? cleanEmail(lead?.caregiver_email);
  if (!isEmail(caregiverEmail)) throw new Error("Caregiver email is required.");

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
    transportation: clean(input.transportation),
    community_fee: effectiveCommunityFee,
    daily_rate: effectiveDailyRate,
    pricing_community_fee_id: resolvedPricing.communityFeeId,
    pricing_daily_rate_id: resolvedPricing.dailyRateId,
    pricing_snapshot: pricingSnapshot,
    caregiver_name: clean(lead?.caregiver_name),
    caregiver_phone: clean(lead?.caregiver_phone),
    caregiver_email: caregiverEmail,
    created_at: now,
    updated_at: now
  });
  if (fieldsError) throw new Error(fieldsError.message);

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
      communityFeeOverride,
      dailyRateOverride
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
  return {
    state: "ready",
    request: toSummary(request),
    memberName,
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
      notes: fields.notes
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
  uploadCategory: "insurance" | "poa" | "supporting" | "completed_packet" | "signature_artifact";
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
    category: input.uploadCategory === "insurance" || input.uploadCategory === "poa" ? "Legal" : "Admin",
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
  if (error) throw new Error(error.message);
  return { storageUri, memberFileId };
}

function attendanceDaysFromRequestedDays(days: string[]) {
  const normalized = new Set(days.map((day) => day.trim().toLowerCase()));
  return {
    monday: normalized.has("monday") || normalized.has("mon"),
    tuesday: normalized.has("tuesday") || normalized.has("tue"),
    wednesday: normalized.has("wednesday") || normalized.has("wed"),
    thursday: normalized.has("thursday") || normalized.has("thu"),
    friday: normalized.has("friday") || normalized.has("fri")
  };
}

function normalizeTransportationMode(value: string | null | undefined): "Door to Door" | "Bus Stop" | null {
  const normalized = clean(value)?.toLowerCase() ?? null;
  if (!normalized) return null;
  if (normalized.includes("door")) return "Door to Door";
  if (normalized.includes("bus")) return "Bus Stop";
  if (normalized === "yes") return "Door to Door";
  if (normalized === "no") return null;
  return null;
}

function isEmptyText(value: unknown) {
  return clean(typeof value === "string" ? value : null) == null;
}

async function ensureMccRows(input: {
  memberId: string;
  senderUserId: string;
  senderName: string;
}): Promise<{
  profileRow: Record<string, unknown>;
  scheduleRow: Record<string, unknown>;
}> {
  const [profileRow, scheduleRow] = await Promise.all([
    ensureMemberCommandCenterProfileSupabase(input.memberId, {
      serviceRole: true,
      actor: {
        userId: input.senderUserId,
        name: input.senderName
      }
    }),
    ensureMemberAttendanceScheduleSupabase(input.memberId, {
      serviceRole: true,
      actor: {
        userId: input.senderUserId,
        name: input.senderName
      }
    })
  ]);
  return {
    profileRow: profileRow as unknown as Record<string, unknown>,
    scheduleRow: scheduleRow as unknown as Record<string, unknown>
  };
}

async function importPacketDataToMcc(input: {
  packetId: string;
  request: EnrollmentPacketRequestRow;
  fields: EnrollmentPacketFieldsRow;
  senderName: string;
}) {
  const admin = createSupabaseAdminClient();
  const now = toEasternISO();
  const populated: string[] = [];
  const conflicts: string[] = [];
  const { profileRow, scheduleRow } = await ensureMccRows({
    memberId: input.request.member_id,
    senderUserId: input.request.sender_user_id,
    senderName: input.senderName
  });

  const profilePatch: Record<string, unknown> = {
    updated_by_user_id: input.request.sender_user_id,
    updated_by_name: input.senderName,
    updated_at: now
  };
  const setProfileField = (field: string, value: string | null, label: string) => {
    if (!value) return;
    const existing = profileRow[field];
    if (isEmptyText(existing)) {
      profilePatch[field] = value;
      populated.push(`member_command_centers.${field}`);
      return;
    }
    if (clean(String(existing)) !== clean(value)) {
      conflicts.push(`${label} conflict (existing retained).`);
    }
  };

  setProfileField("street_address", input.fields.caregiver_address_line1, "Caregiver address line 1");
  setProfileField("city", input.fields.caregiver_city, "Caregiver city");
  setProfileField("state", input.fields.caregiver_state, "Caregiver state");
  setProfileField("zip", input.fields.caregiver_zip, "Caregiver zip");

  if (Object.keys(profilePatch).length > 3) {
    const { error } = await admin.from("member_command_centers").update(profilePatch).eq("id", String(profileRow.id));
    if (error) throw new Error(error.message);
  }

  const days = attendanceDaysFromRequestedDays(input.fields.requested_days ?? []);
  const schedulePatch: Record<string, unknown> = {
    updated_by_user_id: input.request.sender_user_id,
    updated_by_name: input.senderName,
    updated_at: now
  };
  const existingHasAttendanceDays = Boolean(
    scheduleRow.monday || scheduleRow.tuesday || scheduleRow.wednesday || scheduleRow.thursday || scheduleRow.friday
  );
  if (!existingHasAttendanceDays) {
    schedulePatch.monday = days.monday;
    schedulePatch.tuesday = days.tuesday;
    schedulePatch.wednesday = days.wednesday;
    schedulePatch.thursday = days.thursday;
    schedulePatch.friday = days.friday;
    schedulePatch.attendance_days_per_week = [days.monday, days.tuesday, days.wednesday, days.thursday, days.friday].filter(Boolean).length;
    populated.push("member_attendance_schedules.requested_days");
  } else if (
    scheduleRow.monday !== days.monday ||
    scheduleRow.tuesday !== days.tuesday ||
    scheduleRow.wednesday !== days.wednesday ||
    scheduleRow.thursday !== days.thursday ||
    scheduleRow.friday !== days.friday
  ) {
    conflicts.push("Attendance days conflict (existing schedule retained).");
  }

  const transportationMode = normalizeTransportationMode(input.fields.transportation);
  const existingTransportationMode = clean(typeof scheduleRow.transportation_mode === "string" ? scheduleRow.transportation_mode : null);
  if (!existingTransportationMode && transportationMode) {
    schedulePatch.transportation_mode = transportationMode;
    schedulePatch.transportation_required = true;
    populated.push("member_attendance_schedules.transportation_mode");
  } else if (existingTransportationMode && transportationMode && existingTransportationMode !== transportationMode) {
    conflicts.push("Transportation preference conflict (existing value retained).");
  }

  if (scheduleRow.daily_rate == null && input.fields.daily_rate != null) {
    schedulePatch.daily_rate = safeNumber(input.fields.daily_rate);
    populated.push("member_attendance_schedules.daily_rate");
  } else if (
    scheduleRow.daily_rate != null &&
    input.fields.daily_rate != null &&
    Number(scheduleRow.daily_rate) !== Number(input.fields.daily_rate)
  ) {
    conflicts.push("Daily rate conflict (existing value retained).");
  }

  if (Object.keys(schedulePatch).length > 3) {
    const { error } = await admin.from("member_attendance_schedules").update(schedulePatch).eq("id", String(scheduleRow.id));
    if (error) throw new Error(error.message);
  }

  const { data: contactsData, error: contactsError } = await admin
    .from("member_contacts")
    .select("*")
    .eq("member_id", input.request.member_id)
    .order("updated_at", { ascending: false });
  if (contactsError) throw new Error(contactsError.message);
  const contacts = (contactsData ?? []) as Array<Record<string, unknown>>;
  const responsibleContact =
    contacts.find((row) => clean(String(row.category ?? ""))?.toLowerCase() === "responsible party") ??
    contacts.find((row) => clean(String(row.category ?? ""))?.toLowerCase() === "emergency contact") ??
    null;

  const caregiverName = clean(input.fields.caregiver_name) ?? "Caregiver";
  const caregiverContactPatch = {
    contact_name: caregiverName,
    relationship_to_member: "Caregiver",
    category: "Responsible Party",
    category_other: null,
    email: cleanEmail(input.fields.caregiver_email),
    cellular_number: clean(input.fields.caregiver_phone),
    work_number: null,
    home_number: null,
    street_address: clean(input.fields.caregiver_address_line1),
    city: clean(input.fields.caregiver_city),
    state: clean(input.fields.caregiver_state),
    zip: clean(input.fields.caregiver_zip),
    updated_at: now
  };

  if (!responsibleContact) {
    const { error } = await admin.from("member_contacts").insert({
      id: `contact-${randomUUID().replace(/-/g, "")}`,
      member_id: input.request.member_id,
      ...caregiverContactPatch,
      created_by_user_id: input.request.sender_user_id,
      created_by_name: input.senderName,
      created_at: now
    });
    if (error) throw new Error(error.message);
    populated.push("member_contacts.responsible_party");
  } else {
    const updatePatch: Record<string, unknown> = { updated_at: now };
    const setContactField = (field: string, value: string | null, label: string) => {
      if (!value) return;
      const existing = clean(typeof responsibleContact[field] === "string" ? String(responsibleContact[field]) : null);
      if (!existing) {
        updatePatch[field] = value;
        populated.push(`member_contacts.${field}`);
        return;
      }
      if (existing !== value) conflicts.push(`${label} conflict (existing contact retained).`);
    };
    setContactField("email", caregiverContactPatch.email, "Caregiver email");
    setContactField("cellular_number", caregiverContactPatch.cellular_number, "Caregiver phone");
    setContactField("street_address", caregiverContactPatch.street_address, "Caregiver address");
    setContactField("city", caregiverContactPatch.city, "Caregiver city");
    setContactField("state", caregiverContactPatch.state, "Caregiver state");
    setContactField("zip", caregiverContactPatch.zip, "Caregiver zip");
    if (Object.keys(updatePatch).length > 1) {
      const { error } = await admin.from("member_contacts").update(updatePatch).eq("id", String(responsibleContact.id));
      if (error) throw new Error(error.message);
    }
  }

  const secondaryName = clean(input.fields.secondary_contact_name);
  if (secondaryName) {
    const secondary = contacts.find((row) => {
      const existingName = clean(typeof row.contact_name === "string" ? row.contact_name : null);
      return existingName?.toLowerCase() === secondaryName.toLowerCase();
    });
    if (!secondary) {
      const { error } = await admin.from("member_contacts").insert({
        id: `contact-${randomUUID().replace(/-/g, "")}`,
        member_id: input.request.member_id,
        contact_name: secondaryName,
        relationship_to_member: clean(input.fields.secondary_contact_relationship),
        category: "Emergency Contact",
        category_other: null,
        email: cleanEmail(input.fields.secondary_contact_email),
        cellular_number: clean(input.fields.secondary_contact_phone),
        work_number: null,
        home_number: null,
        street_address: null,
        city: null,
        state: null,
        zip: null,
        created_by_user_id: input.request.sender_user_id,
        created_by_name: input.senderName,
        created_at: now,
        updated_at: now
      });
      if (error) throw new Error(error.message);
      populated.push("member_contacts.secondary_contact");
    } else {
      conflicts.push("Secondary contact already exists (existing record retained).");
    }
  }

  await insertPacketEvent({
    packetId: input.packetId,
    eventType: conflicts.length > 0 ? "mcc_import_conflict" : "mcc_imported",
    actorUserId: input.request.sender_user_id,
    metadata: {
      populatedFields: populated,
      conflicts
    }
  });
  return { populated, conflicts };
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
    caregiverSignatureName: input.caregiverSignatureName,
    senderSignatureName: input.senderSignatureName
  });
}

export async function savePublicEnrollmentPacketProgress(input: {
  token: string;
  caregiverName?: string | null;
  caregiverPhone?: string | null;
  caregiverEmail?: string | null;
  caregiverAddressLine1?: string | null;
  caregiverAddressLine2?: string | null;
  caregiverCity?: string | null;
  caregiverState?: string | null;
  caregiverZip?: string | null;
  secondaryContactName?: string | null;
  secondaryContactPhone?: string | null;
  secondaryContactEmail?: string | null;
  secondaryContactRelationship?: string | null;
  notes?: string | null;
}) {
  const context = await getPublicEnrollmentPacketContext(input.token);
  if (context.state !== "ready") throw new Error("Enrollment packet link is not active.");
  const now = toEasternISO();
  const admin = createSupabaseAdminClient();
  const { error: fieldsError } = await admin
    .from("enrollment_packet_fields")
    .update({
      caregiver_name: clean(input.caregiverName),
      caregiver_phone: clean(input.caregiverPhone),
      caregiver_email: cleanEmail(input.caregiverEmail),
      caregiver_address_line1: clean(input.caregiverAddressLine1),
      caregiver_address_line2: clean(input.caregiverAddressLine2),
      caregiver_city: clean(input.caregiverCity),
      caregiver_state: clean(input.caregiverState),
      caregiver_zip: clean(input.caregiverZip),
      secondary_contact_name: clean(input.secondaryContactName),
      secondary_contact_phone: clean(input.secondaryContactPhone),
      secondary_contact_email: cleanEmail(input.secondaryContactEmail),
      secondary_contact_relationship: clean(input.secondaryContactRelationship),
      notes: clean(input.notes),
      updated_at: now
    })
    .eq("packet_id", context.request.id);
  if (fieldsError) throw new Error(fieldsError.message);

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
    actorEmail: cleanEmail(input.caregiverEmail) ?? context.request.caregiverEmail
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
  caregiverAddressLine1?: string | null;
  caregiverAddressLine2?: string | null;
  caregiverCity?: string | null;
  caregiverState?: string | null;
  caregiverZip?: string | null;
  secondaryContactName?: string | null;
  secondaryContactPhone?: string | null;
  secondaryContactEmail?: string | null;
  secondaryContactRelationship?: string | null;
  notes?: string | null;
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

  const fields = await loadPacketFields(request.id);
  if (!fields) throw new Error("Enrollment packet fields were not found.");
  const member = await getMemberById(request.member_id);
  if (!member) throw new Error("Member record was not found.");

  await savePublicEnrollmentPacketProgress({
    token: normalizedToken,
    caregiverName: input.caregiverName,
    caregiverPhone: input.caregiverPhone,
    caregiverEmail: input.caregiverEmail,
    caregiverAddressLine1: input.caregiverAddressLine1,
    caregiverAddressLine2: input.caregiverAddressLine2,
    caregiverCity: input.caregiverCity,
    caregiverState: input.caregiverState,
    caregiverZip: input.caregiverZip,
    secondaryContactName: input.secondaryContactName,
    secondaryContactPhone: input.secondaryContactPhone,
    secondaryContactEmail: input.secondaryContactEmail,
    secondaryContactRelationship: input.secondaryContactRelationship,
    notes: input.notes
  });

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

  for (const upload of input.uploads ?? []) {
    await insertUploadAndFile({
      packetId: request.id,
      memberId: member.id,
      fileName: upload.fileName,
      contentType: upload.contentType,
      bytes: upload.bytes,
      uploadCategory: upload.category,
      uploadedByUserId: null,
      uploadedByName: caregiverTypedName
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

  const mccImport = await importPacketDataToMcc({
    packetId: request.id,
    request,
    fields: refreshedFields,
    senderName: senderSignatureName
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
      conflicts: mccImport.conflicts
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
