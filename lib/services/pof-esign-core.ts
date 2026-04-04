import { Buffer } from "node:buffer";
import { createHash, randomBytes } from "node:crypto";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  MEMBER_DOCUMENTS_BUCKET,
  parseMemberDocumentStorageUri
} from "@/lib/services/member-files";
import type {
  PhysicianOrderForm
} from "@/lib/services/physician-order-model";
import type { PublicPofPostSignOutcome } from "@/lib/services/pof-post-sign-runtime";
import type { PofRequestStatus, PofRequestSummary } from "@/lib/services/pof-types";
import { easternDateTimeLocalToISO } from "@/lib/timezone";
import { toSendWorkflowDeliveryStatus } from "@/lib/services/send-workflow-state";

const TOKEN_BYTE_LENGTH = 32;

export type PofRequestRow = {
  id: string;
  physician_order_id: string;
  member_id: string;
  provider_name: string;
  provider_email: string;
  nurse_name: string;
  from_email: string;
  sent_by_user_id: string;
  status: PofRequestStatus;
  delivery_status: string | null;
  last_delivery_attempt_at: string | null;
  delivery_failed_at: string | null;
  delivery_error: string | null;
  optional_message: string | null;
  sent_at: string | null;
  opened_at: string | null;
  signed_at: string | null;
  expires_at: string;
  signature_request_token: string;
  signature_request_url: string;
  unsigned_pdf_url: string | null;
  signed_pdf_url: string | null;
  last_consumed_signature_token_hash: string | null;
  pof_payload_json: unknown;
  member_file_id: string | null;
  created_by_user_id: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_by_user_id: string | null;
  updated_by_name: string | null;
  updated_at: string;
};

export type SendPofSignatureInput = {
  physicianOrderId: string;
  memberId: string;
  providerName: string;
  providerEmail: string;
  nurseName: string;
  fromEmail: string;
  appBaseUrl?: string | null;
  optionalMessage?: string | null;
  expiresOnDate: string;
  actor: { id: string; fullName: string };
};

export type ResendPofSignatureInput = {
  requestId: string;
  memberId: string;
  providerName: string;
  providerEmail: string;
  nurseName: string;
  fromEmail: string;
  appBaseUrl?: string | null;
  optionalMessage?: string | null;
  expiresOnDate: string;
  actor: { id: string; fullName: string };
};

export type VoidPofSignatureInput = {
  requestId: string;
  memberId: string;
  actor: { id: string; fullName: string };
  reason?: string | null;
};

export type SubmitPublicPofSignatureInput = {
  token: string;
  providerTypedName: string;
  signatureImageDataUrl: string;
  attested: boolean;
  providerIp: string | null;
  providerUserAgent: string | null;
};

export type RpcFinalizePofSignatureRow = {
  request_id: string;
  physician_order_id: string;
  member_id: string;
  member_file_id: string;
  queue_id: string;
  queue_attempt_count: number;
  queue_next_retry_at: string | null;
  was_already_signed: boolean;
};

export type RpcPreparePofRequestDeliveryRow = {
  request_id: string;
  was_created: boolean;
};

export type PofTokenMatch = {
  request: PofRequestRow;
  tokenMatch: "active" | "consumed";
};

export type PostgrestErrorLike = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

export type PublicPofSigningContext =
  | { state: "invalid" }
  | { state: "expired"; request: PofRequestSummary }
  | { state: "declined"; request: PofRequestSummary }
  | { state: "signed"; request: PofRequestSummary; postSignOutcome: PublicPofPostSignOutcome }
  | { state: "ready"; request: PofRequestSummary; pofPayload: PhysicianOrderForm };

export type PofRuntimeDiagnostics = {
  hasResendApiKey: boolean;
  hasClinicalSenderEmail: boolean;
  hasSupabaseServiceRoleKey: boolean;
  missing: string[];
};

export function clean(value: string | null | undefined) {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

export function extractErrorText(error: PostgrestErrorLike | null | undefined) {
  return [error?.message, error?.details, error?.hint].filter(Boolean).join(" ").toLowerCase();
}

export function isPostgresUniqueViolation(error: PostgrestErrorLike | null | undefined) {
  const text = extractErrorText(error);
  if (!text) return false;
  return error?.code === "23505" || text.includes("duplicate key value") || text.includes("unique constraint");
}

export function mapPofRequestWriteError(error: PostgrestErrorLike | null | undefined, fallbackMessage: string) {
  const text = extractErrorText(error);
  if (isPostgresUniqueViolation(error) && text.includes("idx_pof_requests_active_per_order_unique")) {
    return "An active signature request already exists for this physician order. Use Resend.";
  }
  return clean(error?.message) ?? fallbackMessage;
}

export function isMissingRpcFunctionError(error: unknown, rpcName: string) {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: string }).code ?? "").toUpperCase();
  const text = String((error as { message?: string }).message ?? "").toLowerCase();
  return (code === "PGRST202" || code === "42883") && text.includes(rpcName.toLowerCase());
}

export function toRpcPreparePofRequestDeliveryRow(data: unknown): RpcPreparePofRequestDeliveryRow {
  const row = (Array.isArray(data) ? data[0] : null) as RpcPreparePofRequestDeliveryRow | null;
  if (!row?.request_id) {
    throw new Error("POF request preparation RPC did not return a request id.");
  }
  return {
    request_id: row.request_id,
    was_created: Boolean(row.was_created)
  };
}

export function toRpcFinalizePofSignatureRow(data: unknown): RpcFinalizePofSignatureRow {
  const row = (Array.isArray(data) ? data[0] : null) as RpcFinalizePofSignatureRow | null;
  if (!row?.request_id || !row.physician_order_id || !row.member_id || !row.member_file_id || !row.queue_id) {
    throw new Error("POF finalization RPC did not return expected identifiers.");
  }
  return {
    request_id: row.request_id,
    physician_order_id: row.physician_order_id,
    member_id: row.member_id,
    member_file_id: row.member_file_id,
    queue_id: row.queue_id,
    queue_attempt_count: Math.max(0, Number(row.queue_attempt_count ?? 0)),
    queue_next_retry_at: row.queue_next_retry_at ?? null,
    was_already_signed: Boolean(row.was_already_signed)
  };
}

export function parseEmailAddress(value: string | null | undefined) {
  const normalized = clean(value);
  if (!normalized) return null;
  const angledMatch = /<([^<>]+)>/.exec(normalized);
  const candidate = clean(angledMatch ? angledMatch[1] : normalized);
  if (!candidate) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null;
}

export function isEmail(value: string | null | undefined) {
  return Boolean(parseEmailAddress(value));
}

export function getConfiguredClinicalSenderEmail() {
  const preferred =
    parseEmailAddress(process.env.CLINICAL_SENDER_EMAIL) ??
    parseEmailAddress(process.env.DEFAULT_CLINICAL_SENDER_EMAIL) ??
    parseEmailAddress(process.env.RESEND_FROM_EMAIL);
  return preferred ?? "";
}

export function getPofRuntimeDiagnostics(input?: {
  requireResend?: boolean;
}): PofRuntimeDiagnostics {
  const hasResendApiKey = Boolean(clean(process.env.RESEND_API_KEY));
  const hasClinicalSenderEmail = Boolean(getConfiguredClinicalSenderEmail());
  const hasSupabaseServiceRoleKey = Boolean(clean(process.env.SUPABASE_SERVICE_ROLE_KEY));
  const missing: string[] = [];
  if (!hasSupabaseServiceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (input?.requireResend) {
    if (!hasResendApiKey) missing.push("RESEND_API_KEY");
    if (!hasClinicalSenderEmail) missing.push("CLINICAL_SENDER_EMAIL");
  }
  return {
    hasResendApiKey,
    hasClinicalSenderEmail,
    hasSupabaseServiceRoleKey,
    missing
  };
}

export function toStatus(value: string | null | undefined): PofRequestStatus {
  const normalized = (value ?? "").toLowerCase();
  if (normalized === "draft") return "draft";
  if (normalized === "sent") return "sent";
  if (normalized === "opened") return "opened";
  if (normalized === "signed") return "signed";
  if (normalized === "declined") return "declined";
  if (normalized === "expired") return "expired";
  return "draft";
}

export function toDeliveryStatus(row: Pick<PofRequestRow, "status" | "delivery_status">) {
  const fallback = toStatus(row.status) === "sent" || toStatus(row.status) === "opened" || toStatus(row.status) === "signed"
    ? "sent"
    : "pending_preparation";
  return toSendWorkflowDeliveryStatus(row.delivery_status, fallback);
}

export function toSummary(row: PofRequestRow): PofRequestSummary {
  return {
    id: row.id,
    physicianOrderId: row.physician_order_id,
    memberId: row.member_id,
    providerName: row.provider_name,
    providerEmail: row.provider_email,
    nurseName: row.nurse_name,
    fromEmail: row.from_email,
    sentByUserId: row.sent_by_user_id,
    status: toStatus(row.status),
    deliveryStatus: toDeliveryStatus(row),
    deliveryError: clean(row.delivery_error),
    lastDeliveryAttemptAt: row.last_delivery_attempt_at ?? null,
    deliveryFailedAt: row.delivery_failed_at ?? null,
    optionalMessage: row.optional_message,
    sentAt: row.sent_at,
    openedAt: row.opened_at,
    signedAt: row.signed_at,
    expiresAt: row.expires_at,
    signatureRequestUrl: row.signature_request_url,
    unsignedPdfUrl: row.unsigned_pdf_url,
    signedPdfUrl: row.signed_pdf_url,
    memberFileId: row.member_file_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function toIsoAtEndOfDate(dateOnly: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly.trim())) {
    throw new Error("Expiration date must be a valid date.");
  }
  const expiresAt = easternDateTimeLocalToISO(`${dateOnly}T23:59`);
  if (Number.isNaN(Date.parse(expiresAt))) {
    throw new Error("Expiration date is invalid.");
  }
  return expiresAt;
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function generateSigningToken() {
  return randomBytes(TOKEN_BYTE_LENGTH).toString("hex");
}

export function clonePofPayloadSnapshot(form: PhysicianOrderForm): PhysicianOrderForm {
  return JSON.parse(JSON.stringify(form)) as PhysicianOrderForm;
}

export function parsePofPayloadSnapshot(value: unknown): PhysicianOrderForm | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<PhysicianOrderForm>;
  if (typeof candidate.id !== "string") return null;
  if (typeof candidate.memberId !== "string") return null;
  if (typeof candidate.memberNameSnapshot !== "string") return null;
  if (!Array.isArray(candidate.diagnosisRows)) return null;
  if (!Array.isArray(candidate.allergyRows)) return null;
  if (!Array.isArray(candidate.medications)) return null;
  if (!Array.isArray(candidate.standingOrders)) return null;
  if (!candidate.careInformation || typeof candidate.careInformation !== "object") return null;
  if (!Array.isArray((candidate.careInformation as { nutritionDiets?: unknown }).nutritionDiets)) return null;
  if (!candidate.operationalFlags || typeof candidate.operationalFlags !== "object") return null;
  return candidate as PhysicianOrderForm;
}

export function getRequestPayloadSnapshotOrThrow(request: PofRequestRow) {
  const snapshot = parsePofPayloadSnapshot(request.pof_payload_json);
  if (!snapshot) {
    throw new Error("POF request payload snapshot is missing. Ask your care team to resend this request.");
  }
  if (snapshot.id !== request.physician_order_id || snapshot.memberId !== request.member_id) {
    throw new Error("POF request payload snapshot does not match the linked member/order.");
  }
  return snapshot;
}

export function buildAppBaseUrl(requestBaseUrl?: string | null) {
  const requested = clean(requestBaseUrl);
  const explicit =
    clean(process.env.NEXT_PUBLIC_APP_URL) ??
    clean(process.env.APP_URL) ??
    clean(process.env.NEXT_PUBLIC_SITE_URL) ??
    clean(process.env.SITE_URL) ??
    requested;
  const vercelHost =
    clean(process.env.VERCEL_PROJECT_PRODUCTION_URL) ??
    clean(process.env.VERCEL_URL);

  const hasProtocol = (value: string) => /^https?:\/\//i.test(value);
  const normalize = (value: string) => {
    const withProtocol = hasProtocol(value) ? value : `https://${value}`;
    return withProtocol.endsWith("/") ? withProtocol.slice(0, -1) : withProtocol;
  };

  const resolved = explicit ? normalize(explicit) : vercelHost ? normalize(vercelHost) : null;
  if (!resolved) {
    if ((process.env.NODE_ENV ?? "").toLowerCase() === "production") {
      throw new Error(
        "POF e-sign public URL is not configured. Set NEXT_PUBLIC_APP_URL (or APP_URL/SITE_URL) so provider signature links are live."
      );
    }
    return "http://localhost:3001";
  }

  const parsed = new URL(resolved);
  const localhostHostnames = new Set(["localhost", "127.0.0.1", "::1"]);
  if (parsed.protocol === "http:" && !localhostHostnames.has(parsed.hostname)) {
    parsed.protocol = "https:";
  }
  return parsed.toString().replace(/\/$/, "");
}

export function isExpired(expiresAt: string) {
  const expiryMs = Date.parse(expiresAt);
  if (Number.isNaN(expiryMs)) return false;
  return Date.now() > expiryMs;
}

export async function createSignedStorageUrl(storageUri: string, expiresInSeconds = 60 * 15) {
  const objectPath = parseMemberDocumentStorageUri(storageUri);
  if (!objectPath) throw new Error("Storage object path is invalid.");
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.storage.from(MEMBER_DOCUMENTS_BUCKET).createSignedUrl(objectPath, expiresInSeconds);
  if (error || !data?.signedUrl) throw new Error(error?.message ?? "Unable to create signed document URL.");
  return data.signedUrl;
}

export async function downloadStorageAssetOrThrow(storageUri: string, label: string) {
  const objectPath = parseMemberDocumentStorageUri(storageUri);
  if (!objectPath) {
    throw new Error(`${label} storage path is invalid.`);
  }
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.storage.from(MEMBER_DOCUMENTS_BUCKET).download(objectPath);
  if (error || !data) {
    throw new Error(`${label} is missing in storage. Unable to generate signed PDF artifact.`);
  }
  const bytes = Buffer.from(await data.arrayBuffer());
  if (bytes.byteLength === 0) {
    throw new Error(`${label} is empty in storage. Unable to generate signed PDF artifact.`);
  }
  return {
    bytes,
    contentType: clean(data.type) ?? "application/octet-stream",
    objectPath
  };
}

export function parseProviderCredentials(name: string | null | undefined) {
  const normalized = clean(name);
  if (!normalized) return null;
  const trailingParen = /\(([^)]+)\)\s*$/.exec(normalized);
  if (trailingParen && clean(trailingParen[1])) return clean(trailingParen[1])!;
  const trailingComma = /,\s*([a-zA-Z][a-zA-Z.\s]{1,16})$/.exec(normalized);
  if (trailingComma && clean(trailingComma[1])) return clean(trailingComma[1])!;
  return null;
}
