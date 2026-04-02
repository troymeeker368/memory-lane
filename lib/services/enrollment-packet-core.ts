import { createHash, createHmac, randomBytes } from "node:crypto";

import {
  getDefaultEnrollmentPacketIntakePayload,
  normalizeEnrollmentPacketIntakePayload,
  type EnrollmentPacketIntakePayload
} from "@/lib/services/enrollment-packet-intake-payload";
import {
  STAFF_TRANSPORTATION_OPTIONS,
  type EnrollmentPacketFieldsRow,
  type EnrollmentPacketRequestRow,
  type EnrollmentPacketRequestSummary,
  type EnrollmentPacketStatus,
  type StaffTransportationOption
} from "@/lib/services/enrollment-packet-types";
import { toSendWorkflowDeliveryStatus } from "@/lib/services/send-workflow-state";
import { getPublicAppUrl } from "@/lib/runtime";
import { buildMissingSchemaMessage, isMissingSchemaObjectError } from "@/lib/supabase/schema-errors";

const TOKEN_BYTE_LENGTH = 32;
const COMPLETED_PACKET_DOWNLOAD_TOKEN_TTL_SECONDS = 15 * 60;

export function clean(value: string | null | undefined) {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

export function cleanEmail(value: string | null | undefined) {
  const normalized = clean(value);
  return normalized ? normalized.toLowerCase() : null;
}

export function isPostgresUniqueViolation(
  error: { code?: string | null; message?: string | null; details?: string | null } | null | undefined
) {
  const text = [error?.message, error?.details].filter(Boolean).join(" ").toLowerCase();
  return error?.code === "23505" || text.includes("duplicate key value") || text.includes("unique constraint");
}

export function isActiveEnrollmentPacketUniqueViolation(
  error: { code?: string | null; message?: string | null; details?: string | null } | null | undefined
) {
  const text = [error?.message, error?.details].filter(Boolean).join(" ").toLowerCase();
  return isPostgresUniqueViolation(error) && text.includes("idx_enrollment_packet_requests_active_member_unique");
}

export function normalizeStaffTransportation(value: string | null | undefined): StaffTransportationOption {
  const normalized = clean(value);
  if (!normalized) {
    throw new Error("Transportation selection is required.");
  }

  if (STAFF_TRANSPORTATION_OPTIONS.includes(normalized as StaffTransportationOption)) {
    return normalized as StaffTransportationOption;
  }

  throw new Error("Transportation must be None, Door to Door, Bus Stop, or Mixed.");
}

export function splitMemberName(fullName: string | null | undefined) {
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

export function payloadMemberDisplayName(payload: EnrollmentPacketIntakePayload) {
  const firstName = clean(payload.memberLegalFirstName);
  const lastName = clean(payload.memberLegalLastName);
  const combined = [firstName, lastName].filter((value): value is string => Boolean(value)).join(" ");
  return clean(combined);
}

export function normalizeStoredIntakePayload(fields: EnrollmentPacketFieldsRow) {
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

export function mergePublicProgressPayload(input: {
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

export function isEmail(value: string | null | undefined) {
  const normalized = cleanEmail(value);
  if (!normalized) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
}

export function isMissingRpcFunctionError(error: unknown, functionName: string) {
  const candidate =
    error && typeof error === "object"
      ? (error as {
          code?: unknown;
          message?: unknown;
          details?: unknown;
          hint?: unknown;
          cause?: { code?: unknown; message?: unknown; details?: unknown; hint?: unknown } | null;
        })
      : null;
  const code = String(candidate?.code ?? candidate?.cause?.code ?? "").toUpperCase();
  const message = [
    candidate?.message,
    candidate?.details,
    candidate?.hint,
    candidate?.cause?.message,
    candidate?.cause?.details,
    candidate?.cause?.hint
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

export function safeNumber(value: number | null | undefined, fallback = 0) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Number(value.toFixed(2));
}

export function toStatus(value: string | null | undefined): EnrollmentPacketStatus {
  const normalized = clean(value)?.toLowerCase() ?? "draft";
  if (normalized === "sent") return "sent";
  if (normalized === "opened" || normalized === "partially_completed" || normalized === "in_progress") {
    return "in_progress";
  }
  if (normalized === "expired") return "expired";
  if (normalized === "completed" || normalized === "filed") return "completed";
  if (normalized === "voided") return "voided";
  return "draft";
}

export function toDeliveryStatus(row: Pick<EnrollmentPacketRequestRow, "status" | "delivery_status">) {
  const status = toStatus(row.status);
  const fallback =
    status === "sent" || status === "in_progress" || status === "completed"
      ? "sent"
      : status === "draft"
        ? "ready_to_send"
        : "pending_preparation";
  return toSendWorkflowDeliveryStatus(row.delivery_status, fallback);
}

export function toSummary(row: EnrollmentPacketRequestRow): EnrollmentPacketRequestSummary {
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
    openedAt: row.opened_at ?? null,
    completedAt: row.completed_at,
    lastFamilyActivityAt: row.last_family_activity_at ?? null,
    updatedAt: row.updated_at,
    voidedAt: row.voided_at ?? null,
    voidedByUserId: clean(row.voided_by_user_id),
    voidReason: clean(row.void_reason)
  };
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function toBase64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function fromBase64Url(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function getCompletedPacketDownloadTokenSecret() {
  const configured =
    clean(process.env.ENROLLMENT_PACKET_COMPLETED_DOWNLOAD_TOKEN_SECRET) ??
    clean(process.env.NEXTAUTH_SECRET) ??
    clean(process.env.AUTH_SECRET);
  if (configured) return configured;
  if ((process.env.NODE_ENV ?? "").toLowerCase() === "production") {
    throw new Error(
      "Completed enrollment packet download token secret is not configured. Set ENROLLMENT_PACKET_COMPLETED_DOWNLOAD_TOKEN_SECRET or NEXTAUTH_SECRET."
    );
  }
  return "memory-lane-dev-completed-packet-download-token";
}

export function createCompletedPacketDownloadToken(input: {
  packetId: string;
  memberId: string;
  completedAt: string | null;
  expiresAt?: string | null;
}) {
  const completedAt = clean(input.completedAt);
  if (!clean(input.packetId) || !clean(input.memberId) || !completedAt) {
    throw new Error("Completed enrollment packet download token requires packet, member, and completedAt.");
  }
  const expiresAt =
    clean(input.expiresAt) ??
    new Date(Date.now() + COMPLETED_PACKET_DOWNLOAD_TOKEN_TTL_SECONDS * 1000).toISOString();
  const payload = JSON.stringify({
    packetId: input.packetId,
    memberId: input.memberId,
    completedAt,
    expiresAt
  });
  const body = toBase64Url(payload);
  const signature = createHmac("sha256", getCompletedPacketDownloadTokenSecret()).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function verifyCompletedPacketDownloadToken(token: string) {
  const normalized = clean(token);
  if (!normalized) {
    throw new Error("Completed enrollment packet download authorization is invalid.");
  }

  const [body, signature] = normalized.split(".");
  if (!body || !signature) {
    throw new Error("Completed enrollment packet download authorization is invalid.");
  }

  const expectedSignature = createHmac("sha256", getCompletedPacketDownloadTokenSecret())
    .update(body)
    .digest("base64url");
  if (signature !== expectedSignature) {
    throw new Error("Completed enrollment packet download authorization is invalid.");
  }

  const parsed = JSON.parse(fromBase64Url(body)) as {
    packetId?: unknown;
    memberId?: unknown;
    completedAt?: unknown;
    expiresAt?: unknown;
  };
  const packetId = clean(typeof parsed.packetId === "string" ? parsed.packetId : null);
  const memberId = clean(typeof parsed.memberId === "string" ? parsed.memberId : null);
  const completedAt = clean(typeof parsed.completedAt === "string" ? parsed.completedAt : null);
  const expiresAt = clean(typeof parsed.expiresAt === "string" ? parsed.expiresAt : null);
  if (!packetId || !memberId || !completedAt || !expiresAt) {
    throw new Error("Completed enrollment packet download authorization is invalid.");
  }
  if (Date.parse(expiresAt) <= Date.now()) {
    throw new Error("Completed enrollment packet download authorization has expired.");
  }

  return {
    packetId,
    memberId,
    completedAt,
    expiresAt
  };
}

export function generateSigningToken() {
  return randomBytes(TOKEN_BYTE_LENGTH).toString("hex");
}

export function isExpired(expiresAt: string) {
  const expiresMs = Date.parse(expiresAt);
  if (Number.isNaN(expiresMs)) return true;
  return Date.now() > expiresMs;
}

export function buildAppBaseUrl(requestBaseUrl?: string | null) {
  void requestBaseUrl;
  return getPublicAppUrl();
}

export function isRowFoundError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: string }).code ?? "");
  return code === "PGRST116";
}

export function throwEnrollmentPacketSchemaError(error: unknown, objectName: string): never {
  if (isMissingSchemaObjectError(error)) {
    throw new Error(
      buildMissingSchemaMessage({
        objectName,
        migration: objectName === "enrollment_packet_requests" ? "0053_artifact_drift_replay_hardening.sql" : "0024_enrollment_packet_workflow.sql"
      })
    );
  }
  throw error instanceof Error ? error : new Error(`Enrollment packet schema error for ${objectName}.`);
}
