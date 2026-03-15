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
import { recordWorkflowMilestone } from "@/lib/services/lifecycle-milestones";
import { resolveEnrollmentPricingForRequestedDays } from "@/lib/services/enrollment-pricing";
import {
  deleteMemberDocumentObject,
  deleteMemberFileRecord,
  parseDataUrlPayload,
  parseMemberDocumentStorageUri,
  safeFileName,
  uploadMemberDocumentObject,
  upsertMemberFileByDocumentSource
} from "@/lib/services/member-files";
import {
  maybeRecordRepeatedFailureAlert,
  recordImmediateSystemAlert,
  recordWorkflowEvent
} from "@/lib/services/workflow-observability";
import {
  buildRetryableWorkflowDeliveryError,
  toSendWorkflowDeliveryStatus,
  type SendWorkflowDeliveryStatus
} from "@/lib/services/send-workflow-state";
import { buildMissingSchemaMessage, isMissingSchemaObjectError } from "@/lib/supabase/schema-errors";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { toEasternDate, toEasternISO } from "@/lib/timezone";

const TOKEN_BYTE_LENGTH = 32;
const STAFF_TRANSPORTATION_OPTIONS = ["None", "Door to Door", "Bus Stop", "Mixed"] as const;
const ENROLLMENT_PACKET_COMPLETION_RPC = "rpc_finalize_enrollment_packet_submission";
const ENROLLMENT_PACKET_COMPLETION_MIGRATION = "0053_artifact_drift_replay_hardening.sql";

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
  deliveryStatus: SendWorkflowDeliveryStatus;
  deliveryError: string | null;
  lastDeliveryAttemptAt: string | null;
  deliveryFailedAt: string | null;
  tokenExpiresAt: string;
  createdAt: string;
  sentAt: string | null;
  completedAt: string | null;
};

export type CompletedEnrollmentPacketListItem = EnrollmentPacketRequestSummary & {
  memberName: string;
  leadMemberName: string | null;
  senderName: string | null;
};

export type CompletedEnrollmentPacketFilters = {
  limit?: number;
  status?: "completed" | "filed" | "all";
  fromDate?: string | null;
  toDate?: string | null;
  search?: string | null;
};

type EnrollmentPacketRequestRow = {
  id: string;
  member_id: string;
  lead_id: string | null;
  sender_user_id: string;
  caregiver_email: string;
  status: string;
  delivery_status: string | null;
  last_delivery_attempt_at: string | null;
  delivery_failed_at: string | null;
  delivery_error: string | null;
  token: string;
  last_consumed_submission_token_hash: string | null;
  token_expires_at: string;
  created_at: string;
  sent_at: string | null;
  completed_at: string | null;
  mapping_sync_status: string | null;
  mapping_sync_error: string | null;
  mapping_sync_attempted_at: string | null;
  latest_mapping_run_id: string | null;
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
  member_dob: string | null;
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

type EnrollmentPacketTokenMatch = {
  request: EnrollmentPacketRequestRow;
  tokenMatch: "active" | "consumed";
};

type FinalizedEnrollmentPacketSubmissionRpcRow = {
  packet_id: string;
  status: string;
  mapping_sync_status: string;
  was_already_filed: boolean;
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

function isPostgresUniqueViolation(error: { code?: string | null; message?: string | null; details?: string | null } | null | undefined) {
  const text = [error?.message, error?.details].filter(Boolean).join(" ").toLowerCase();
  return error?.code === "23505" || text.includes("duplicate key value") || text.includes("unique constraint");
}

function isActiveEnrollmentPacketUniqueViolation(error: { code?: string | null; message?: string | null; details?: string | null } | null | undefined) {
  const text = [error?.message, error?.details].filter(Boolean).join(" ").toLowerCase();
  return isPostgresUniqueViolation(error) && text.includes("idx_enrollment_packet_requests_active_member_unique");
}

function normalizeStaffTransportation(value: string | null | undefined): StaffTransportationOption {
  const normalized = clean(value);
  if (!normalized) {
    throw new Error("Transportation selection is required.");
  }

  if (STAFF_TRANSPORTATION_OPTIONS.includes(normalized as StaffTransportationOption)) {
    return normalized as StaffTransportationOption;
  }

  throw new Error("Transportation must be None, Door to Door, Bus Stop, or Mixed.");
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
  primaryContactAddressLine1?: string | null;
  primaryContactCity?: string | null;
  primaryContactState?: string | null;
  primaryContactZip?: string | null;
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
  secondaryContactAddressLine1?: string | null;
  secondaryContactCity?: string | null;
  secondaryContactState?: string | null;
  secondaryContactZip?: string | null;
  notes?: string | null;
}) {
  return normalizeEnrollmentPacketIntakePayload({
    ...input.storedPayload,
    ...(input.intakePayload ?? {}),
    primaryContactName: clean(input.caregiverName) ?? input.storedPayload.primaryContactName,
    primaryContactPhone: clean(input.caregiverPhone) ?? input.storedPayload.primaryContactPhone,
    primaryContactEmail: cleanEmail(input.caregiverEmail) ?? input.storedPayload.primaryContactEmail,
    primaryContactAddressLine1:
      clean(input.primaryContactAddressLine1) ??
      clean(input.primaryContactAddress) ??
      input.storedPayload.primaryContactAddressLine1,
    primaryContactCity: clean(input.primaryContactCity) ?? input.storedPayload.primaryContactCity,
    primaryContactState: clean(input.primaryContactState) ?? input.storedPayload.primaryContactState,
    primaryContactZip: clean(input.primaryContactZip) ?? input.storedPayload.primaryContactZip,
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
    secondaryContactAddressLine1:
      clean(input.secondaryContactAddressLine1) ??
      clean(input.secondaryContactAddress) ??
      input.storedPayload.secondaryContactAddressLine1,
    secondaryContactCity: clean(input.secondaryContactCity) ?? input.storedPayload.secondaryContactCity,
    secondaryContactState: clean(input.secondaryContactState) ?? input.storedPayload.secondaryContactState,
    secondaryContactZip: clean(input.secondaryContactZip) ?? input.storedPayload.secondaryContactZip,
    secondaryContactAddress: clean(input.secondaryContactAddress) ?? input.storedPayload.secondaryContactAddress,
    additionalNotes: clean(input.notes) ?? input.storedPayload.additionalNotes
  });
}

function isEmail(value: string | null | undefined) {
  const normalized = cleanEmail(value);
  if (!normalized) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
}

function isMissingRpcFunctionError(error: any, functionName: string) {
  const code = String(error?.code ?? error?.cause?.code ?? "").toUpperCase();
  const message = [
    error?.message,
    error?.details,
    error?.hint,
    error?.cause?.message,
    error?.cause?.details,
    error?.cause?.hint
  ]
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase();
  const normalizedName = functionName.toLowerCase();

  return (
    code === "PGRST202" ||
    message.includes(`function ${normalizedName}`) ||
    (message.includes(normalizedName) && message.includes("could not find")) ||
    (message.includes(normalizedName) && message.includes("does not exist"))
  );
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

function toDeliveryStatus(row: Pick<EnrollmentPacketRequestRow, "status" | "delivery_status">) {
  const status = toStatus(row.status);
  const fallback =
    status === "sent" || status === "opened" || status === "partially_completed" || status === "completed" || status === "filed"
      ? "sent"
      : status === "prepared"
        ? "ready_to_send"
        : "pending_preparation";
  return toSendWorkflowDeliveryStatus(row.delivery_status, fallback);
}

function toSummary(row: EnrollmentPacketRequestRow): EnrollmentPacketRequestSummary {
  return {
    id: row.id,
    memberId: row.member_id,
    leadId: row.lead_id,
    senderUserId: row.sender_user_id,
    caregiverEmail: row.caregiver_email,
    status: toStatus(row.status),
    deliveryStatus: toDeliveryStatus(row),
    deliveryError: clean(row.delivery_error),
    lastDeliveryAttemptAt: row.last_delivery_attempt_at ?? null,
    deliveryFailedAt: row.delivery_failed_at ?? null,
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

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
      "id, member_name, member_dob, member_start_date, referral_name, caregiver_email, caregiver_name, caregiver_relationship, caregiver_phone"
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

async function loadRequestByToken(rawToken: string): Promise<EnrollmentPacketTokenMatch | null> {
  const hashed = hashToken(rawToken);
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("enrollment_packet_requests")
    .select("*")
    .eq("token", hashed)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data) {
    return {
      request: data as EnrollmentPacketRequestRow,
      tokenMatch: "active"
    };
  }

  const { data: consumedData, error: consumedError } = await admin
    .from("enrollment_packet_requests")
    .select("*")
    .eq("last_consumed_submission_token_hash", hashed)
    .maybeSingle();
  if (consumedError) throw new Error(consumedError.message);
  if (!consumedData) return null;
  return {
    request: consumedData as EnrollmentPacketRequestRow,
    tokenMatch: "consumed"
  };
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

async function invokeFinalizeEnrollmentPacketCompletionRpc(input: {
  packetId: string;
  rotatedToken: string;
  consumedSubmissionTokenHash: string;
  completedAt: string;
  filedAt: string;
  signerName: string;
  signerEmail: string | null;
  signatureBlob: string;
  ipAddress: string | null;
  actorUserId: string;
  actorEmail: string | null;
  uploadBatchId: string;
  completedMetadata: Record<string, unknown>;
  filedMetadata: Record<string, unknown>;
}) {
  const admin = createSupabaseAdminClient();
  try {
    const data = await admin.rpc(ENROLLMENT_PACKET_COMPLETION_RPC, {
      p_packet_id: input.packetId,
      p_rotated_token: input.rotatedToken,
      p_consumed_submission_token_hash: input.consumedSubmissionTokenHash,
      p_completed_at: input.completedAt,
      p_filed_at: input.filedAt,
      p_signer_name: input.signerName,
      p_signer_email: input.signerEmail,
      p_signature_blob: input.signatureBlob,
      p_ip_address: input.ipAddress,
      p_actor_user_id: input.actorUserId,
      p_actor_email: input.actorEmail,
      p_upload_batch_id: input.uploadBatchId,
      p_completed_metadata: input.completedMetadata,
      p_filed_metadata: input.filedMetadata
    }) as { data: unknown; error: { message?: string } | null };
    if (data.error) throw new Error(data.error.message ?? "Unable to finalize enrollment packet submission.");
    const row = (Array.isArray(data.data) ? data.data[0] : null) as FinalizedEnrollmentPacketSubmissionRpcRow | null;
    if (!row?.packet_id || !row?.status) {
      throw new Error("Enrollment packet finalization RPC did not return expected identifiers.");
    }
    return {
      packetId: row.packet_id,
      status: row.status,
      mappingSyncStatus: row.mapping_sync_status ?? "pending",
      wasAlreadyFiled: Boolean(row.was_already_filed)
    };
  } catch (error) {
    if (isMissingRpcFunctionError(error, ENROLLMENT_PACKET_COMPLETION_RPC)) {
      throw new Error(
        `Enrollment packet completion finalization RPC is not available yet. Apply Supabase migration ${ENROLLMENT_PACKET_COMPLETION_MIGRATION} first.`
      );
    }
    throw error;
  }
}

async function listActivePacketRows(memberId: string) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("enrollment_packet_requests")
    .select("*")
    .eq("member_id", memberId)
    .order("created_at", { ascending: false });
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

export async function listCompletedEnrollmentPacketRequests(
  filters: CompletedEnrollmentPacketFilters = {}
): Promise<CompletedEnrollmentPacketListItem[]> {
  const safeLimit = Math.max(1, Math.min(500, Math.trunc(filters.limit ?? 200)));
  const normalizedStatus = filters.status === "completed" || filters.status === "filed" ? filters.status : "all";
  const fromDate = clean(filters.fromDate);
  const toDate = clean(filters.toDate);
  const searchNeedle = clean(filters.search)?.toLowerCase() ?? null;

  const admin = createSupabaseAdminClient();
  let query = admin
    .from("enrollment_packet_requests")
    .select("*")
    .order("completed_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(safeLimit);
  if (normalizedStatus === "all") {
    query = query.in("status", ["completed", "filed"]);
  } else {
    query = query.eq("status", normalizedStatus);
  }
  if (fromDate) {
    query = query.gte("completed_at", `${fromDate}T00:00:00`);
  }
  if (toDate) {
    query = query.lte("completed_at", `${toDate}T23:59:59`);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as EnrollmentPacketRequestRow[];
  if (rows.length === 0) return [];

  const memberIds = Array.from(new Set(rows.map((row) => row.member_id).filter(Boolean)));
  const leadIds = Array.from(new Set(rows.map((row) => row.lead_id).filter((value): value is string => Boolean(value))));
  const senderIds = Array.from(new Set(rows.map((row) => row.sender_user_id).filter(Boolean)));

  const memberNames = new Map<string, string>();
  if (memberIds.length > 0) {
    const { data: members, error: membersError } = await admin.from("members").select("id, display_name").in("id", memberIds);
    if (membersError) throw new Error(membersError.message);
    for (const row of (members ?? []) as Array<{ id: string; display_name: string | null }>) {
      memberNames.set(String(row.id), clean(row.display_name) ?? "Unknown member");
    }
  }

  const leadNames = new Map<string, string>();
  if (leadIds.length > 0) {
    const { data: leads, error: leadsError } = await admin.from("leads").select("id, member_name").in("id", leadIds);
    if (leadsError) throw new Error(leadsError.message);
    for (const row of (leads ?? []) as Array<{ id: string; member_name: string | null }>) {
      leadNames.set(String(row.id), clean(row.member_name) ?? "Unknown lead");
    }
  }

  const senderNames = new Map<string, string>();
  if (senderIds.length > 0) {
    const { data: senders, error: sendersError } = await admin.from("profiles").select("id, full_name").in("id", senderIds);
    if (sendersError) throw new Error(sendersError.message);
    for (const row of (senders ?? []) as Array<{ id: string; full_name: string | null }>) {
      senderNames.set(String(row.id), clean(row.full_name) ?? "Unknown staff");
    }
  }

  const items = rows.map((row) => {
    const summary = toSummary(row);
    return {
      ...summary,
      memberName: memberNames.get(row.member_id) ?? "Unknown member",
      leadMemberName: row.lead_id ? leadNames.get(row.lead_id) ?? null : null,
      senderName: senderNames.get(row.sender_user_id) ?? null
    };
  });

  if (!searchNeedle) return items;

  return items.filter((item) => {
    const haystack = [
      item.memberName,
      item.leadMemberName,
      item.caregiverEmail,
      item.senderName,
      item.senderUserId,
      item.memberId,
      item.leadId
    ]
      .map((value) => clean(value)?.toLowerCase())
      .filter((value): value is string => Boolean(value));
    return haystack.some((value) => value.includes(searchNeedle));
  });
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
  const signature = parseDataUrlPayload(input.signatureImageDataUrl);
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

async function markEnrollmentPacketDeliveryState(input: {
  packetId: string;
  status?: EnrollmentPacketStatus;
  deliveryStatus: SendWorkflowDeliveryStatus;
  deliveryError?: string | null;
  sentAt?: string | null;
  attemptAt: string;
}) {
  const admin = createSupabaseAdminClient();
  const patch: Record<string, unknown> = {
    delivery_status: input.deliveryStatus,
    last_delivery_attempt_at: input.attemptAt,
    delivery_failed_at: input.deliveryStatus === "send_failed" ? input.attemptAt : null,
    delivery_error: clean(input.deliveryError),
    updated_at: input.attemptAt
  };
  if (input.status) {
    patch.status = input.status;
  }
  if (input.sentAt !== undefined) {
    patch.sent_at = input.sentAt;
  }
  const { error } = await admin.from("enrollment_packet_requests").update(patch).eq("id", input.packetId);
  if (error) throw new Error(error.message);
}

async function prepareEnrollmentPacketFields(input: {
  packetId: string;
  requestedDays: string[];
  transportation: StaffTransportationOption;
  communityFee: number;
  dailyRate: number;
  pricingCommunityFeeId: string | null;
  pricingDailyRateId: string | null;
  pricingSnapshot: Record<string, unknown>;
  caregiverName: string | null;
  caregiverPhone: string | null;
  caregiverEmail: string;
  intakePayload: EnrollmentPacketIntakePayload;
  updatedAt: string;
}) {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("enrollment_packet_fields").upsert(
    {
      packet_id: input.packetId,
      requested_days: input.requestedDays,
      transportation: input.transportation,
      community_fee: input.communityFee,
      daily_rate: input.dailyRate,
      pricing_community_fee_id: input.pricingCommunityFeeId,
      pricing_daily_rate_id: input.pricingDailyRateId,
      pricing_snapshot: input.pricingSnapshot,
      caregiver_name: input.caregiverName,
      caregiver_phone: input.caregiverPhone,
      caregiver_email: input.caregiverEmail,
      intake_payload: input.intakePayload,
      updated_at: input.updatedAt
    },
    { onConflict: "packet_id" }
  );
  if (error) throwEnrollmentPacketSchemaError(error, "enrollment_packet_fields");
}

async function insertEnrollmentPacketSenderSignature(input: {
  packetId: string;
  senderEmail: string;
  signatureProfile: SenderProfileRow;
  signedAt: string;
}) {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("enrollment_packet_signatures").insert({
    packet_id: input.packetId,
    signer_name: input.signatureProfile.signature_name,
    signer_email: input.senderEmail,
    signer_role: "sender_staff",
    signature_blob: input.signatureProfile.signature_blob,
    ip_address: null,
    signed_at: input.signedAt,
    created_at: input.signedAt,
    updated_at: input.signedAt
  });
  if (error) throw new Error(error.message);
}

async function prepareEnrollmentPacketRequestForDelivery(input: {
  existingRequest: EnrollmentPacketRequestRow | null;
  memberId: string;
  leadId: string | null;
  senderUserId: string;
  caregiverEmail: string;
  expiresAt: string;
  hashedToken: string;
  requestedDays: string[];
  transportation: StaffTransportationOption;
  communityFee: number;
  dailyRate: number;
  pricingCommunityFeeId: string | null;
  pricingDailyRateId: string | null;
  pricingSnapshot: Record<string, unknown>;
  caregiverName: string | null;
  caregiverPhone: string | null;
  intakePayload: EnrollmentPacketIntakePayload;
  signatureProfile: SenderProfileRow;
  senderEmail: string;
  eventMetadata: Record<string, unknown>;
  preparedAt: string;
}) {
  const admin = createSupabaseAdminClient();
  const packetId = input.existingRequest?.id ?? randomUUID();

  if (input.existingRequest) {
    const { error } = await admin
      .from("enrollment_packet_requests")
      .update({
        member_id: input.memberId,
        lead_id: input.leadId,
        sender_user_id: input.senderUserId,
        caregiver_email: input.caregiverEmail,
        status: "prepared",
        delivery_status: "retry_pending",
        token: input.hashedToken,
        token_expires_at: input.expiresAt,
        sent_at: null,
        completed_at: null,
        delivery_error: null,
        delivery_failed_at: null,
        updated_at: input.preparedAt
      })
      .eq("id", packetId);
    if (error) {
      if (isActiveEnrollmentPacketUniqueViolation(error)) {
        throw new Error("An active enrollment packet already exists for this member.");
      }
      throw new Error(error.message);
    }
  } else {
    const { error } = await admin.from("enrollment_packet_requests").insert({
      id: packetId,
      member_id: input.memberId,
      lead_id: input.leadId,
      sender_user_id: input.senderUserId,
      caregiver_email: input.caregiverEmail,
      status: "draft",
      delivery_status: "pending_preparation",
      token: input.hashedToken,
      token_expires_at: input.expiresAt,
      created_at: input.preparedAt,
      sent_at: null,
      completed_at: null,
      updated_at: input.preparedAt
    });
    if (error) {
      if (isActiveEnrollmentPacketUniqueViolation(error)) {
        throw new Error("An active enrollment packet already exists for this member.");
      }
      throw new Error(error.message);
    }
  }

  await prepareEnrollmentPacketFields({
    packetId,
    requestedDays: input.requestedDays,
    transportation: input.transportation,
    communityFee: input.communityFee,
    dailyRate: input.dailyRate,
    pricingCommunityFeeId: input.pricingCommunityFeeId,
    pricingDailyRateId: input.pricingDailyRateId,
    pricingSnapshot: input.pricingSnapshot,
    caregiverName: input.caregiverName,
    caregiverPhone: input.caregiverPhone,
    caregiverEmail: input.caregiverEmail,
    intakePayload: input.intakePayload,
    updatedAt: input.preparedAt
  });

  await insertEnrollmentPacketSenderSignature({
    packetId,
    senderEmail: input.senderEmail,
    signatureProfile: input.signatureProfile,
    signedAt: input.preparedAt
  });

  await markEnrollmentPacketDeliveryState({
    packetId,
    status: "prepared",
    deliveryStatus: "ready_to_send",
    deliveryError: null,
    sentAt: null,
    attemptAt: input.preparedAt
  });

  await insertPacketEvent({
    packetId,
    eventType: "prepared",
    actorUserId: input.senderUserId,
    actorEmail: input.senderEmail,
    metadata: input.eventMetadata
  });

  return packetId;
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
  const requiredCaregiverEmail = caregiverEmail!;
  const memberNameParts = splitMemberName(lead?.member_name ?? member.display_name);

  const active = await listActivePacketRows(member.id);
  const blockingActive = active.find((row) => {
    const status = toStatus(row.status);
    if (status === "sent" || status === "opened" || status === "partially_completed") {
      return true;
    }
    const deliveryStatus = toDeliveryStatus(row);
    return (status === "draft" || status === "prepared") && deliveryStatus !== "send_failed";
  });
  const retryableActive = active.find((row) => {
    const status = toStatus(row.status);
    return (status === "draft" || status === "prepared") && toDeliveryStatus(row) === "send_failed";
  });
  if (blockingActive && (!retryableActive || retryableActive.id !== blockingActive.id)) {
    throw new Error("An active enrollment packet already exists for this member.");
  }

  const now = toEasternISO();
  const token = generateSigningToken();
  const hashedToken = hashToken(token);
  const expiresAtDate = new Date();
  expiresAtDate.setDate(expiresAtDate.getDate() + 14);
  const expiresAt = expiresAtDate.toISOString();
  const requestUrl = `${buildAppBaseUrl(input.appBaseUrl)}/sign/enrollment-packet/${token}`;
  const intakePayload = normalizeEnrollmentPacketIntakePayload({
    memberLegalFirstName: memberNameParts.firstName,
    memberLegalLastName: memberNameParts.lastName,
    memberDob: clean(lead?.member_dob),
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
  });

  const requestId = await prepareEnrollmentPacketRequestForDelivery({
    existingRequest: retryableActive ?? null,
    memberId: member.id,
    leadId: lead?.id ?? null,
    senderUserId,
    caregiverEmail: requiredCaregiverEmail,
    expiresAt,
    hashedToken,
    requestedDays: resolvedPricing.requestedDays,
    transportation: staffTransportation,
    communityFee: effectiveCommunityFee,
    dailyRate: effectiveDailyRate,
    pricingCommunityFeeId: resolvedPricing.communityFeeId,
    pricingDailyRateId: resolvedPricing.dailyRateId,
    pricingSnapshot,
    caregiverName: clean(lead?.caregiver_name),
    caregiverPhone: clean(lead?.caregiver_phone),
    intakePayload,
    signatureProfile,
    senderEmail,
    preparedAt: now,
    eventMetadata: {
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
      totalInitialEnrollmentAmountOverride,
      retryAttempt: Boolean(retryableActive)
    }
  });

  try {
    await sendEnrollmentPacketEmail({
      caregiverEmail: requiredCaregiverEmail,
      caregiverName: lead?.caregiver_name ?? null,
      memberName: member.display_name,
      optionalMessage: input.optionalMessage ?? null,
      requestUrl
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unable to deliver enrollment packet email.";
    const failedAt = toEasternISO();
    await markEnrollmentPacketDeliveryState({
      packetId: requestId,
      status: "prepared",
      deliveryStatus: "send_failed",
      deliveryError: reason,
      sentAt: null,
      attemptAt: failedAt
    });
    await insertPacketEvent({
      packetId: requestId,
      eventType: "send_failed",
      actorUserId: senderUserId,
      actorEmail: senderEmail,
      metadata: {
        memberId: member.id,
        leadId: lead?.id ?? null,
        retryAvailable: true,
        error: reason
      }
    });
    await recordWorkflowEvent({
      eventType: "enrollment_packet_failed",
      entityType: "enrollment_packet_request",
      entityId: requestId,
      actorType: "user",
      actorUserId: senderUserId,
      status: "failed",
      severity: "medium",
      metadata: {
        member_id: member.id,
        lead_id: lead?.id ?? null,
        phase: "delivery",
        delivery_status: "send_failed",
        retry_available: true,
        error: reason
      }
    });
    await maybeRecordRepeatedFailureAlert({
      workflowEventType: "enrollment_packet_failed",
      entityType: "enrollment_packet_request",
      entityId: requestId,
      actorUserId: senderUserId,
      threshold: 2,
      metadata: {
        member_id: member.id,
        lead_id: lead?.id ?? null,
        phase: "delivery"
      }
    });
    throw buildRetryableWorkflowDeliveryError({
      requestId,
      requestUrl,
      reason,
      workflowLabel: "Enrollment packet",
      retryLabel: "Retry sending the same packet once delivery settings are corrected."
    });
  }

  const sentAt = toEasternISO();
  await markEnrollmentPacketDeliveryState({
    packetId: requestId,
    status: "sent",
    deliveryStatus: "sent",
    deliveryError: null,
    sentAt,
    attemptAt: sentAt
  });

  await insertPacketEvent({
    packetId: requestId,
    eventType: "Enrollment Packet Sent",
    actorUserId: senderUserId,
    actorEmail: senderEmail
  });
  await recordWorkflowEvent({
    eventType: "enrollment_packet_sent",
    entityType: "enrollment_packet_request",
    entityId: requestId,
    actorType: "user",
    actorUserId: senderUserId,
    status: "sent",
    severity: "low",
    metadata: {
      member_id: member.id,
      lead_id: lead?.id ?? null,
      caregiver_email: requiredCaregiverEmail,
      sent_at: sentAt
    }
  });
  try {
    await recordWorkflowMilestone({
      event: {
        event_type: "enrollment_packet_sent",
        entity_type: "enrollment_packet_request",
        entity_id: requestId,
        actor_type: "user",
        actor_id: senderUserId,
        actor_user_id: senderUserId,
        status: "sent",
        severity: "low",
        metadata: {
          member_id: member.id,
          lead_id: lead?.id ?? null,
          caregiver_email: requiredCaregiverEmail,
          sent_at: sentAt
        }
      },
      notification: {
        recipientUserId: senderUserId,
        title: "Enrollment Packet Sent",
        message: `Enrollment packet sent for ${member.display_name}`,
        entityType: "enrollment_packet_request",
        entityId: requestId,
        metadata: {
          memberId: member.id,
          leadId: lead?.id ?? null,
          packetId: requestId
        },
        serviceRole: true
      }
    });
  } catch (error) {
    console.error("[enrollment-packets] unable to emit post-send workflow milestone", error);
  }

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
  const matched = await loadRequestByToken(normalizedToken);
  if (!matched) return { state: "invalid" };
  const request = matched.request;

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
  return upsertMemberFileByDocumentSource({
    memberId: input.memberId,
    documentSource: input.documentSource,
    fileName: input.fileName,
    fileType: input.fileType,
    dataUrl: input.dataUrl,
    storageObjectPath: parseMemberDocumentStorageUri(input.storageUri),
    category: input.category,
    uploadedByUserId: input.uploadedByUserId,
    uploadedByName: input.uploadedByName,
    uploadedAtIso: now,
    updatedAtIso: now,
    additionalColumns: {
      enrollment_packet_request_id: input.packetId
    }
  });
}

async function insertUploadAndFile(input: {
  packetId: string;
  memberId: string;
  batchId: string;
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
  const storageUri = await uploadMemberDocumentObject({
    objectPath,
    bytes: input.bytes,
    contentType: input.contentType
  });
  let memberFile;
  try {
    memberFile = await upsertMemberFileBySource({
      memberId: input.memberId,
      documentSource: `Enrollment Packet ${input.uploadCategory}:${input.packetId}:${input.batchId}:${safeName}`,
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
  } catch (error) {
    try {
      await deleteMemberDocumentObject(objectPath);
    } catch (cleanupError) {
      console.error("[enrollment-packets] unable to cleanup orphaned upload object after member_files failure", cleanupError);
    }
    throw error;
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("enrollment_packet_uploads").insert({
    packet_id: input.packetId,
    member_id: input.memberId,
    file_path: storageUri,
    file_name: safeName,
    file_type: input.contentType,
    upload_category: input.uploadCategory,
    member_file_id: memberFile.id,
    finalization_batch_id: input.batchId,
    finalization_status: "staged",
    uploaded_at: toEasternISO()
  });
  if (error) {
    if (memberFile.created) {
      try {
        await Promise.all([deleteMemberFileRecord(memberFile.id), deleteMemberDocumentObject(objectPath)]);
      } catch (cleanupError) {
        console.error("[enrollment-packets] unable to cleanup upload artifacts after enrollment_packet_uploads failure", cleanupError);
      }
    } else {
      try {
        await recordImmediateSystemAlert({
          entityType: "enrollment_packet_request",
          entityId: input.packetId,
          severity: "high",
          alertKey: "enrollment_packet_upload_split_brain",
          metadata: {
            upload_category: input.uploadCategory,
            member_id: input.memberId,
            member_file_id: memberFile.id,
            storage_uri: storageUri
          }
        });
      } catch (alertError) {
        console.error("[enrollment-packets] unable to record split-brain alert", alertError);
      }
    }

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
  return {
    storageUri,
    objectPath,
    memberFileId: memberFile.id,
    memberFileCreated: memberFile.created
  };
}

async function cleanupEnrollmentPacketUploadArtifacts(input: {
  packetId: string;
  memberId: string;
  actorUserId: string | null;
  reason: string;
  uploads: Array<{
    objectPath: string;
    memberFileId: string | null;
    memberFileCreated: boolean;
  }>;
}) {
  const reusableArtifacts = input.uploads.filter((upload) => !upload.memberFileCreated && upload.memberFileId);
  if (reusableArtifacts.length > 0) {
    await recordImmediateSystemAlert({
      entityType: "enrollment_packet_request",
      entityId: input.packetId,
      actorUserId: input.actorUserId,
      severity: "high",
      alertKey: "enrollment_packet_finalize_split_brain",
      metadata: {
        member_id: input.memberId,
        reason: input.reason,
        reusable_member_file_ids: reusableArtifacts.map((upload) => upload.memberFileId)
      }
    });
  }

  const cleanupTargets = input.uploads.filter((upload) => upload.memberFileCreated);
  for (const upload of cleanupTargets) {
    try {
      if (upload.memberFileId) {
        await deleteMemberFileRecord(upload.memberFileId);
      }
      await deleteMemberDocumentObject(upload.objectPath);
    } catch (cleanupError) {
      await recordImmediateSystemAlert({
        entityType: "enrollment_packet_request",
        entityId: input.packetId,
        actorUserId: input.actorUserId,
        severity: "high",
        alertKey: "enrollment_packet_finalize_cleanup_failed",
        metadata: {
          member_id: input.memberId,
          reason: input.reason,
          cleanup_error: cleanupError instanceof Error ? cleanupError.message : "Unknown cleanup error.",
          object_path: upload.objectPath,
          member_file_id: upload.memberFileId
        }
      });
    }
  }
}

async function updateEnrollmentPacketMappingSyncState(input: {
  packetId: string;
  status: "pending" | "completed" | "failed";
  attemptedAt: string;
  error?: string | null;
  mappingRunId?: string | null;
}) {
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("enrollment_packet_requests")
    .update({
      mapping_sync_status: input.status,
      mapping_sync_attempted_at: input.attemptedAt,
      mapping_sync_error: input.status === "failed" ? String(input.error ?? "").trim() || null : null,
      latest_mapping_run_id: input.mappingRunId ?? null,
      updated_at: input.attemptedAt
    })
    .eq("id", input.packetId);
  if (error) throw new Error(error.message);
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
  primaryContactAddressLine1?: string | null;
  primaryContactCity?: string | null;
  primaryContactState?: string | null;
  primaryContactZip?: string | null;
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
  secondaryContactAddressLine1?: string | null;
  secondaryContactCity?: string | null;
  secondaryContactState?: string | null;
  secondaryContactZip?: string | null;
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
    primaryContactAddressLine1: input.primaryContactAddressLine1,
    primaryContactCity: input.primaryContactCity,
    primaryContactState: input.primaryContactState,
    primaryContactZip: input.primaryContactZip,
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
    secondaryContactAddressLine1: input.secondaryContactAddressLine1,
    secondaryContactCity: input.secondaryContactCity,
    secondaryContactState: input.secondaryContactState,
    secondaryContactZip: input.secondaryContactZip,
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
      caregiver_address_line1: mergedPayload.primaryContactAddressLine1 ?? mergedPayload.primaryContactAddress ?? mergedPayload.memberAddressLine1,
      caregiver_address_line2: mergedPayload.memberAddressLine2,
      caregiver_city: mergedPayload.primaryContactCity ?? mergedPayload.memberCity,
      caregiver_state: mergedPayload.primaryContactState ?? mergedPayload.memberState,
      caregiver_zip: mergedPayload.primaryContactZip ?? mergedPayload.memberZip,
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
  primaryContactAddressLine1?: string | null;
  primaryContactCity?: string | null;
  primaryContactState?: string | null;
  primaryContactZip?: string | null;
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
  secondaryContactAddressLine1?: string | null;
  secondaryContactCity?: string | null;
  secondaryContactState?: string | null;
  secondaryContactZip?: string | null;
  notes?: string | null;
  intakePayload?: Partial<Record<string, unknown>> | null;
  uploads?: PacketFileUpload[];
}) {
  const normalizedToken = clean(input.token);
  const caregiverTypedName = clean(input.caregiverTypedName);
  if (!normalizedToken) throw new Error("Signature token is required.");
  if (!caregiverTypedName) throw new Error("Typed caregiver name is required.");
  if (!input.attested) throw new Error("Electronic signature attestation is required.");
  const signature = parseDataUrlPayload(input.caregiverSignatureImageDataUrl);
  if (!signature.contentType.startsWith("image/")) throw new Error("Caregiver signature format is invalid.");

  const matchedRequest = await loadRequestByToken(normalizedToken);
  if (!matchedRequest) throw new Error("This enrollment packet link is invalid.");
  const request = matchedRequest.request;
  const status = toStatus(request.status);
  if (matchedRequest.tokenMatch === "consumed" && (status === "completed" || status === "filed")) {
    return {
      packetId: request.id,
      memberId: request.member_id,
      status: "filed" as const,
      mappingSyncStatus: request.mapping_sync_status ?? "pending",
      wasAlreadyFiled: true as const
    };
  }
  if (status === "completed" || status === "filed") throw new Error("This enrollment packet has already been submitted.");
  if (isExpired(request.token_expires_at)) throw new Error("This enrollment packet link has expired.");

  const member = await getMemberById(request.member_id);
  if (!member) throw new Error("Member record was not found.");
  let senderSignatureName = "Staff";
  let finalizedAt: string | null = null;
  let uploadBatchId: string | null = null;
  let finalizedSubmission:
    | {
        packetId: string;
        status: string;
        mappingSyncStatus: string;
        wasAlreadyFiled: boolean;
      }
    | null = null;
  let failedMappingRunId: string | null = null;
  let mappingSummary:
    | {
        mappingRunId: string | null;
        downstreamSystemsUpdated: string[];
        conflictsRequiringReview: number;
        status: "pending" | "completed" | "failed";
        error?: string | null;
      }
    | null = null;
  const stagedUploads: Array<{
    uploadCategory: EnrollmentPacketUploadCategory;
    objectPath: string;
    memberFileId: string | null;
    memberFileCreated: boolean;
  }> = [];
  const uploadedArtifacts: Array<{
    uploadCategory: EnrollmentPacketUploadCategory;
    memberFileId: string | null;
  }> = [];

  try {
    await savePublicEnrollmentPacketProgress({
      token: normalizedToken,
      caregiverName: input.caregiverName,
      caregiverPhone: input.caregiverPhone,
      caregiverEmail: input.caregiverEmail,
      primaryContactAddress: input.primaryContactAddress,
      primaryContactAddressLine1: input.primaryContactAddressLine1,
      primaryContactCity: input.primaryContactCity,
      primaryContactState: input.primaryContactState,
      primaryContactZip: input.primaryContactZip,
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
      secondaryContactAddressLine1: input.secondaryContactAddressLine1,
      secondaryContactCity: input.secondaryContactCity,
      secondaryContactState: input.secondaryContactState,
      secondaryContactZip: input.secondaryContactZip,
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
    uploadBatchId = randomUUID();

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
    senderSignatureName = senderSignature.data
      ? String((senderSignature.data as { signer_name: string }).signer_name)
      : "Staff";

    const signatureArtifact = await insertUploadAndFile({
      packetId: request.id,
      memberId: member.id,
      batchId: uploadBatchId,
      fileName: `Enrollment Packet Signature - ${toEasternDate(now)}.png`,
      contentType: signature.contentType,
      bytes: signature.bytes,
      uploadCategory: "signature_artifact",
      uploadedByUserId: null,
      uploadedByName: caregiverTypedName,
      dataUrl: input.caregiverSignatureImageDataUrl.trim()
    });
    stagedUploads.push({
      uploadCategory: "signature_artifact",
      objectPath: signatureArtifact.objectPath,
      memberFileId: signatureArtifact.memberFileId,
      memberFileCreated: signatureArtifact.memberFileCreated
    });
    uploadedArtifacts.push({
      uploadCategory: "signature_artifact",
      memberFileId: signatureArtifact.memberFileId
    });

    for (const upload of input.uploads ?? []) {
      const artifact = await insertUploadAndFile({
        packetId: request.id,
        memberId: member.id,
        batchId: uploadBatchId,
        fileName: upload.fileName,
        contentType: upload.contentType,
        bytes: upload.bytes,
        uploadCategory: upload.category,
        uploadedByUserId: null,
        uploadedByName: caregiverTypedName
      });
      stagedUploads.push({
        uploadCategory: upload.category,
        objectPath: artifact.objectPath,
        memberFileId: artifact.memberFileId,
        memberFileCreated: artifact.memberFileCreated
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
      batchId: uploadBatchId,
      fileName: packetDocx.fileName,
      contentType: packetDocx.contentType,
      bytes: packetDocx.bytes,
      uploadCategory: "completed_packet",
      uploadedByUserId: null,
      uploadedByName: caregiverTypedName,
      dataUrl: packetDocx.dataUrl
    });
    stagedUploads.push({
      uploadCategory: "completed_packet",
      objectPath: finalPacketArtifact.objectPath,
      memberFileId: finalPacketArtifact.memberFileId,
      memberFileCreated: finalPacketArtifact.memberFileCreated
    });
    uploadedArtifacts.push({
      uploadCategory: "completed_packet",
      memberFileId: finalPacketArtifact.memberFileId
    });

    finalizedAt = toEasternISO();
    finalizedSubmission = await invokeFinalizeEnrollmentPacketCompletionRpc({
      packetId: request.id,
      rotatedToken,
      consumedSubmissionTokenHash: hashToken(normalizedToken),
      completedAt: now,
      filedAt: finalizedAt,
      signerName: caregiverTypedName,
      signerEmail: cleanEmail(input.caregiverEmail) ?? request.caregiver_email,
      signatureBlob: input.caregiverSignatureImageDataUrl.trim(),
      ipAddress: clean(input.caregiverIp),
      actorUserId: request.sender_user_id,
      actorEmail: cleanEmail(input.caregiverEmail) ?? request.caregiver_email,
      uploadBatchId,
      completedMetadata: {
        caregiverSignatureName: caregiverTypedName,
        completedAt: now,
        signatureArtifactMemberFileId: signatureArtifact.memberFileId,
        finalPacketMemberFileId: finalPacketArtifact.memberFileId
      },
      filedMetadata: {
        caregiverSignatureName: caregiverTypedName,
        initiatedByUserId: request.sender_user_id,
        initiatedByName: senderSignatureName,
        completedAt: now,
        filedAt: finalizedAt,
        mappingSyncStatus: "pending"
      }
    });

    if (finalizedSubmission.wasAlreadyFiled) {
      await cleanupEnrollmentPacketUploadArtifacts({
        packetId: request.id,
        memberId: member.id,
        actorUserId: request.sender_user_id,
        reason: "Replay-safe enrollment packet finalization reused committed filed state.",
        uploads: stagedUploads
      });
      const replayedRequest = await loadRequestById(request.id);
      return {
        packetId: request.id,
        memberId: member.id,
        status: "filed" as const,
        mappingSyncStatus:
          replayedRequest?.mapping_sync_status ?? finalizedSubmission.mappingSyncStatus ?? "pending",
        wasAlreadyFiled: true as const
      };
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unable to complete enrollment packet.";
    if (stagedUploads.length > 0) {
      await cleanupEnrollmentPacketUploadArtifacts({
        packetId: request.id,
        memberId: member.id,
        actorUserId: request.sender_user_id,
        reason,
        uploads: stagedUploads
      });
    }
    await recordWorkflowEvent({
      eventType: "enrollment_packet_failed",
      entityType: "enrollment_packet_request",
      entityId: request.id,
      actorType: "user",
      actorUserId: request.sender_user_id,
      status: "failed",
      severity: "high",
      metadata: {
        member_id: member.id,
        lead_id: request.lead_id,
        phase: finalizedSubmission ? "post_finalize" : "finalization",
        error: reason,
        mapping_run_id: failedMappingRunId,
        upload_batch_id: uploadBatchId
      }
    });
    await recordImmediateSystemAlert({
      entityType: "enrollment_packet_request",
      entityId: request.id,
      actorUserId: request.sender_user_id,
      severity: "high",
      alertKey: "enrollment_packet_completion_failed",
      metadata: {
        member_id: member.id,
        lead_id: request.lead_id,
        error: reason,
        mapping_run_id: failedMappingRunId,
        upload_batch_id: uploadBatchId
      }
    });
    throw error;
  }

  const refreshedFields = await loadPacketFields(request.id);

  try {
    if (!refreshedFields) {
      throw new Error("Enrollment packet fields are missing after filing.");
    }
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
    failedMappingRunId = downstreamMapping.mappingRunId;
    mappingSummary = {
      mappingRunId: downstreamMapping.mappingRunId,
      downstreamSystemsUpdated: downstreamMapping.downstreamSystemsUpdated,
      conflictsRequiringReview: downstreamMapping.conflictsRequiringReview,
      status: "completed"
    };
    await updateEnrollmentPacketMappingSyncState({
      packetId: request.id,
      status: "completed",
      attemptedAt: toEasternISO(),
      mappingRunId: downstreamMapping.mappingRunId
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Enrollment packet mapping failed.";
    const attemptedAt = toEasternISO();
    const packetAfterFailure = await loadRequestById(request.id);
    failedMappingRunId = packetAfterFailure?.latest_mapping_run_id ?? failedMappingRunId;
    mappingSummary = {
      mappingRunId: failedMappingRunId,
      downstreamSystemsUpdated: [],
      conflictsRequiringReview: 0,
      status: "failed",
      error: reason
    };
    try {
      await updateEnrollmentPacketMappingSyncState({
        packetId: request.id,
        status: "failed",
        attemptedAt,
        error: reason,
        mappingRunId: failedMappingRunId
      });
    } catch (syncStateError) {
      console.error("[enrollment-packets] unable to persist mapping failure state", syncStateError);
    }
    await recordWorkflowEvent({
      eventType: "enrollment_packet_mapping_failed",
      entityType: "enrollment_packet_request",
      entityId: request.id,
      actorType: "user",
      actorUserId: request.sender_user_id,
      status: "failed",
      severity: "high",
      metadata: {
        member_id: member.id,
        lead_id: request.lead_id,
        error: reason,
        mapping_run_id: failedMappingRunId
      }
    });
    await recordImmediateSystemAlert({
      entityType: "enrollment_packet_request",
      entityId: request.id,
      actorUserId: request.sender_user_id,
      severity: "high",
      alertKey: "enrollment_packet_mapping_failed",
      metadata: {
        member_id: member.id,
        lead_id: request.lead_id,
        error: reason,
        mapping_run_id: failedMappingRunId
      }
    });
  }

  if (request.lead_id) {
    try {
      const lead = await getLeadById(request.lead_id);
      await addLeadActivity({
        leadId: request.lead_id,
        memberName: lead?.member_name ?? member.display_name,
        activityType: "Email",
        outcome: "Enrollment Packet Completed",
        notes: `Enrollment packet request ${request.id} completed by caregiver and filed to member records.`,
        completedByUserId: request.sender_user_id,
        completedByName: senderSignatureName,
        activityAt: finalizedAt ?? toEasternISO()
      });
    } catch (error) {
      console.error("[enrollment-packets] unable to record lead activity after packet filing", error);
    }
  }

  try {
    await recordWorkflowMilestone({
      event: {
        event_type: "enrollment_packet_completed",
        entity_type: "enrollment_packet_request",
        entity_id: request.id,
        actor_type: "user",
        actor_id: request.sender_user_id,
        actor_user_id: request.sender_user_id,
        status: "completed",
        severity: "low",
        metadata: {
          member_id: member.id,
          lead_id: request.lead_id,
          caregiver_signature_name: caregiverTypedName,
          initiated_by_user_id: request.sender_user_id,
          initiated_by_name: senderSignatureName,
          completed_at: finalizedAt ?? toEasternISO(),
          filed_at: finalizedAt ?? toEasternISO(),
          status: "filed",
          mapping_sync_status: mappingSummary?.status ?? "pending",
          mapping_run_id: mappingSummary?.mappingRunId ?? null,
          downstream_systems_updated: mappingSummary?.downstreamSystemsUpdated ?? [],
          conflicts_requiring_review: mappingSummary?.conflictsRequiringReview ?? 0,
          mapping_error: mappingSummary?.status === "failed" ? mappingSummary.error ?? null : null
        }
      },
      notification: {
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
      }
    });
  } catch (error) {
    console.error("[enrollment-packets] unable to emit post-completion workflow milestone", error);
  }

  return {
    packetId: request.id,
    memberId: member.id,
    status: "filed" as const,
    mappingSyncStatus: mappingSummary?.status ?? finalizedSubmission?.mappingSyncStatus ?? "pending",
    wasAlreadyFiled: false as const
  };
}
