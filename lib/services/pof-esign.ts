import { Buffer } from "node:buffer";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Resend } from "resend";

import {
  getPhysicianOrderById,
  processSignedPhysicianOrderPostSignSync,
  type PhysicianOrderForm
} from "@/lib/services/physician-orders-supabase";
import { recordWorkflowMilestone } from "@/lib/services/lifecycle-milestones";
import { buildPofSignatureRequestTemplate } from "@/lib/email/templates/pof-signature-request";
import {
  MEMBER_DOCUMENTS_BUCKET,
  nextMemberFileId,
  parseDataUrlPayload,
  parseMemberDocumentStorageUri,
  uploadMemberDocumentObject
} from "@/lib/services/member-files";
import { buildPofDocumentPdfBytes } from "@/lib/services/pof-document-pdf";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";
import { easternDateTimeLocalToISO, toEasternDate, toEasternISO } from "@/lib/timezone";
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

export const POF_REQUEST_STATUS_VALUES = ["draft", "sent", "opened", "signed", "declined", "expired"] as const;
export type PofRequestStatus = (typeof POF_REQUEST_STATUS_VALUES)[number];

const TOKEN_BYTE_LENGTH = 32;
const RPC_FINALIZE_POF_SIGNATURE = "rpc_finalize_pof_signature";

type PofRequestRow = {
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
  pof_payload_json: unknown;
  member_file_id: string | null;
  created_by_user_id: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_by_user_id: string | null;
  updated_by_name: string | null;
  updated_at: string;
};

export type PofRequestSummary = {
  id: string;
  physicianOrderId: string;
  memberId: string;
  providerName: string;
  providerEmail: string;
  nurseName: string;
  fromEmail: string;
  sentByUserId: string;
  status: PofRequestStatus;
  deliveryStatus: SendWorkflowDeliveryStatus;
  deliveryError: string | null;
  lastDeliveryAttemptAt: string | null;
  deliveryFailedAt: string | null;
  optionalMessage: string | null;
  sentAt: string | null;
  openedAt: string | null;
  signedAt: string | null;
  expiresAt: string;
  signatureRequestUrl: string;
  unsignedPdfUrl: string | null;
  signedPdfUrl: string | null;
  memberFileId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PofDocumentEvent = {
  id: string;
  documentId: string;
  memberId: string;
  physicianOrderId: string | null;
  eventType: "created" | "sent" | "send_failed" | "opened" | "signed" | "declined" | "expired" | "resent";
  actorType: "user" | "provider" | "system";
  actorUserId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  actorIp: string | null;
  actorUserAgent: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

type SendPofSignatureInput = {
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

type ResendPofSignatureInput = {
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

type VoidPofSignatureInput = {
  requestId: string;
  memberId: string;
  actor: { id: string; fullName: string };
  reason?: string | null;
};

type SubmitPublicPofSignatureInput = {
  token: string;
  providerTypedName: string;
  signatureImageDataUrl: string;
  attested: boolean;
  providerIp: string | null;
  providerUserAgent: string | null;
};

type RpcFinalizePofSignatureRow = {
  request_id: string;
  physician_order_id: string;
  member_id: string;
  member_file_id: string;
  queue_id: string;
  queue_attempt_count: number;
  queue_next_retry_at: string | null;
};

type PostgrestErrorLike = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

export type PublicPofSigningContext =
  | { state: "invalid" }
  | { state: "expired"; request: PofRequestSummary }
  | { state: "declined"; request: PofRequestSummary }
  | { state: "signed"; request: PofRequestSummary }
  | { state: "ready"; request: PofRequestSummary; pofPayload: PhysicianOrderForm };

function clean(value: string | null | undefined) {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function extractErrorText(error: PostgrestErrorLike | null | undefined) {
  return [error?.message, error?.details, error?.hint].filter(Boolean).join(" ").toLowerCase();
}

function isPostgresUniqueViolation(error: PostgrestErrorLike | null | undefined) {
  const text = extractErrorText(error);
  if (!text) return false;
  return error?.code === "23505" || text.includes("duplicate key value") || text.includes("unique constraint");
}

function mapPofRequestWriteError(error: PostgrestErrorLike | null | undefined, fallbackMessage: string) {
  const text = extractErrorText(error);
  if (isPostgresUniqueViolation(error) && text.includes("idx_pof_requests_active_per_order_unique")) {
    return "An active signature request already exists for this physician order. Use Resend.";
  }
  return clean(error?.message) ?? fallbackMessage;
}

function isMissingRpcFunctionError(error: unknown, rpcName: string) {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: string }).code ?? "").toUpperCase();
  const text = String((error as { message?: string }).message ?? "").toLowerCase();
  return (code === "PGRST202" || code === "42883") && text.includes(rpcName.toLowerCase());
}

function toRpcFinalizePofSignatureRow(data: unknown): RpcFinalizePofSignatureRow {
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
    queue_next_retry_at: row.queue_next_retry_at ?? null
  };
}

function parseEmailAddress(value: string | null | undefined) {
  const normalized = clean(value);
  if (!normalized) return null;
  const angledMatch = /<([^<>]+)>/.exec(normalized);
  const candidate = clean(angledMatch ? angledMatch[1] : normalized);
  if (!candidate) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null;
}

function isEmail(value: string | null | undefined) {
  return Boolean(parseEmailAddress(value));
}

type PofRuntimeDiagnostics = {
  hasResendApiKey: boolean;
  hasClinicalSenderEmail: boolean;
  hasSupabaseServiceRoleKey: boolean;
  missing: string[];
};

export function getPofRuntimeDiagnostics(input?: {
  requireResend?: boolean;
}): PofRuntimeDiagnostics {
  const hasResendApiKey = Boolean(clean(process.env.RESEND_API_KEY));
  const hasClinicalSenderEmail = Boolean(getConfiguredClinicalSenderEmail());
  const hasSupabaseServiceRoleKey = Boolean(
    clean(process.env.SUPABASE_SERVICE_ROLE_KEY) ?? clean(process.env.SUPABASE_SERVICE_KEY)
  );
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

function assertPofRuntimeDiagnostics(input: {
  context: string;
  requireResend?: boolean;
}) {
  const diagnostics = getPofRuntimeDiagnostics({ requireResend: input.requireResend });
  if ((process.env.NODE_ENV ?? "").toLowerCase() !== "production") {
    console.info(`[POF e-sign diagnostics:${input.context}]`, {
      hasResendApiKey: diagnostics.hasResendApiKey,
      hasClinicalSenderEmail: diagnostics.hasClinicalSenderEmail,
      hasSupabaseServiceRoleKey: diagnostics.hasSupabaseServiceRoleKey
    });
  }
  if (diagnostics.missing.length > 0) {
    throw new Error(
      `Missing required environment configuration for POF e-sign: ${diagnostics.missing.join(", ")}.`
    );
  }
}

function toStatus(value: string | null | undefined): PofRequestStatus {
  const normalized = (value ?? "").toLowerCase();
  if (normalized === "draft") return "draft";
  if (normalized === "sent") return "sent";
  if (normalized === "opened") return "opened";
  if (normalized === "signed") return "signed";
  if (normalized === "declined") return "declined";
  if (normalized === "expired") return "expired";
  return "draft";
}

function toDeliveryStatus(row: Pick<PofRequestRow, "status" | "delivery_status">) {
  const fallback = toStatus(row.status) === "sent" || toStatus(row.status) === "opened" || toStatus(row.status) === "signed"
    ? "sent"
    : "pending_preparation";
  return toSendWorkflowDeliveryStatus(row.delivery_status, fallback);
}

function toSummary(row: PofRequestRow): PofRequestSummary {
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

function toIsoAtEndOfDate(dateOnly: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly.trim())) {
    throw new Error("Expiration date must be a valid date.");
  }
  const expiresAt = easternDateTimeLocalToISO(`${dateOnly}T23:59`);
  if (Number.isNaN(Date.parse(expiresAt))) {
    throw new Error("Expiration date is invalid.");
  }
  return expiresAt;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function generateSigningToken() {
  return randomBytes(TOKEN_BYTE_LENGTH).toString("hex");
}

function clonePofPayloadSnapshot(form: PhysicianOrderForm): PhysicianOrderForm {
  return JSON.parse(JSON.stringify(form)) as PhysicianOrderForm;
}

function parsePofPayloadSnapshot(value: unknown): PhysicianOrderForm | null {
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

function getRequestPayloadSnapshotOrThrow(request: PofRequestRow) {
  const snapshot = parsePofPayloadSnapshot(request.pof_payload_json);
  if (!snapshot) {
    throw new Error("POF request payload snapshot is missing. Ask your care team to resend this request.");
  }
  if (snapshot.id !== request.physician_order_id || snapshot.memberId !== request.member_id) {
    throw new Error("POF request payload snapshot does not match the linked member/order.");
  }
  return snapshot;
}

async function assertPhysicianOrderMember(physicianOrderId: string, memberId: string) {
  console.info("[POF member lookup] Supabase lookup attempt", {
    lookupField: "physician_orders.id",
    hasPhysicianOrderId: Boolean(clean(physicianOrderId)),
    hasMemberId: Boolean(clean(memberId))
  });
  const form = await getPhysicianOrderById(physicianOrderId, { serviceRole: true });
  if (!form) {
    throw new Error(`Physician order lookup failed for physician_orders.id=${physicianOrderId}.`);
  }
  if (form.memberId !== memberId) {
    throw new Error(
      `Physician order/member mismatch for physician_orders.id=${physicianOrderId}: selected member=${memberId}, order member=${form.memberId}.`
    );
  }
  console.info("[POF member lookup] resolved", {
    lookupField: "physician_orders.id",
    matchedSelectedMember: true
  });
  return form;
}

function buildAppBaseUrl(requestBaseUrl?: string | null) {
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

function isExpired(expiresAt: string) {
  const expiryMs = Date.parse(expiresAt);
  if (Number.isNaN(expiryMs)) return false;
  return Date.now() > expiryMs;
}

async function createSignedStorageUrl(storageUri: string, expiresInSeconds = 60 * 15) {
  const objectPath = parseMemberDocumentStorageUri(storageUri);
  if (!objectPath) throw new Error("Storage object path is invalid.");
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.storage.from(MEMBER_DOCUMENTS_BUCKET).createSignedUrl(objectPath, expiresInSeconds);
  if (error || !data?.signedUrl) throw new Error(error?.message ?? "Unable to create signed document URL.");
  return data.signedUrl;
}

async function downloadStorageAssetOrThrow(storageUri: string, label: string) {
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

function parseProviderCredentials(name: string | null | undefined) {
  const normalized = clean(name);
  if (!normalized) return null;
  const trailingParen = /\(([^)]+)\)\s*$/.exec(normalized);
  if (trailingParen && clean(trailingParen[1])) return clean(trailingParen[1])!;
  const trailingComma = /,\s*([a-zA-Z][a-zA-Z.\s]{1,16})$/.exec(normalized);
  if (trailingComma && clean(trailingComma[1])) return clean(trailingComma[1])!;
  return null;
}

async function sendSignatureEmail(input: {
  toEmail: string;
  providerName: string;
  nurseName: string;
  fromEmail: string;
  requestUrl: string;
  expiresAt: string;
  memberName: string;
  optionalMessage?: string | null;
}) {
  assertPofRuntimeDiagnostics({
    context: "send-signature-email",
    requireResend: true
  });

  const resend = new Resend(process.env.RESEND_API_KEY);
  const clinicalSenderEmail = getConfiguredClinicalSenderEmail();
  if (!clinicalSenderEmail) {
    throw new Error("Clinical sender email is missing or invalid. Configure CLINICAL_SENDER_EMAIL.");
  }

  const emailTemplate = buildPofSignatureRequestTemplate({
    providerName: input.providerName,
    nurseName: input.nurseName,
    memberName: input.memberName,
    requestUrl: input.requestUrl,
    expiresAt: input.expiresAt,
    optionalMessage: input.optionalMessage
  });

  const response = await resend.emails.send({
    from: `${emailTemplate.fromDisplayName} <${clinicalSenderEmail}>`,
    to: [input.toEmail],
    subject: emailTemplate.subject,
    html: emailTemplate.html,
    text: emailTemplate.text,
    ...(isEmail(input.fromEmail) ? { replyTo: parseEmailAddress(input.fromEmail)! } : {})
  });
  if (response.error) {
    const detail = clean(response.error.message) ?? "Unknown Resend error.";
    if (detail.toLowerCase().includes("you can only send testing emails to your own email address")) {
      throw new Error(
        "Resend is in test mode. Verify your sending domain in Resend and set CLINICAL_SENDER_EMAIL to that verified domain before sending live provider signature requests."
      );
    }
    throw new Error(`Unable to deliver signature email. ${detail}`.trim());
  }
}

async function loadRequestById(requestId: string) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("pof_requests").select("*").eq("id", requestId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as PofRequestRow | null) ?? null;
}

async function loadRequestByToken(token: string) {
  const hashed = hashToken(token);
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("pof_requests")
    .select("*")
    .eq("signature_request_token", hashed)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as PofRequestRow | null) ?? null;
}

async function listPofRequestsByPhysicianOrderIdsWithAdmin(memberId: string, physicianOrderIds: string[]) {
  if (physicianOrderIds.length === 0) return [] as PofRequestRow[];
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("pof_requests")
    .select("*")
    .eq("member_id", memberId)
    .in("physician_order_id", physicianOrderIds)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as PofRequestRow[];
  await refreshExpiredRequests(rows);
  return rows;
}

async function createDocumentEvent(input: {
  documentId: string;
  memberId: string;
  physicianOrderId: string | null;
  eventType: "created" | "sent" | "send_failed" | "opened" | "signed" | "declined" | "expired" | "resent";
  actorType: "user" | "provider" | "system";
  actorUserId?: string | null;
  actorName?: string | null;
  actorEmail?: string | null;
  actorIp?: string | null;
  actorUserAgent?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("document_events").insert({
    document_type: "pof_request",
    document_id: input.documentId,
    member_id: input.memberId,
    physician_order_id: input.physicianOrderId,
    event_type: input.eventType,
    actor_type: input.actorType,
    actor_user_id: input.actorUserId ?? null,
    actor_name: input.actorName ?? null,
    actor_email: input.actorEmail ?? null,
    actor_ip: input.actorIp ?? null,
    actor_user_agent: input.actorUserAgent ?? null,
    metadata: input.metadata ?? {}
  });
  if (error) throw new Error(error.message);
}

async function markRequestExpired(input: { request: PofRequestRow; actorName: string }) {
  const now = toEasternISO();
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("pof_requests")
    .update({
      status: "expired",
      updated_by_user_id: input.request.sent_by_user_id,
      updated_by_name: input.actorName,
      updated_at: now
    })
    .eq("id", input.request.id);
  if (error) throw new Error(error.message);
  await createDocumentEvent({
    documentId: input.request.id,
    memberId: input.request.member_id,
    physicianOrderId: input.request.physician_order_id,
    eventType: "expired",
    actorType: "system",
    actorUserId: input.request.sent_by_user_id,
    actorName: input.actorName
  });
}

async function refreshExpiredRequests(rows: PofRequestRow[]) {
  const updates = rows
    .filter((row) => isExpired(row.expires_at))
    .filter((row) => {
      const status = toStatus(row.status);
      return status !== "expired" && status !== "signed" && status !== "declined";
    });
  for (const row of updates) {
    await markRequestExpired({ request: row, actorName: row.nurse_name });
    row.status = "expired";
  }
}

async function setPhysicianOrderSentState(input: {
  physicianOrderId: string;
  providerName: string;
  actorId: string;
  actorName: string;
}) {
  const now = toEasternISO();
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("physician_orders")
    .update({
      status: "sent",
      provider_name: input.providerName,
      sent_at: now,
      updated_by_user_id: input.actorId,
      updated_by_name: input.actorName,
      updated_at: now
    })
    .eq("id", input.physicianOrderId)
    .neq("status", "signed");
  if (error) throw new Error(error.message);
}

async function markPofRequestDeliveryState(input: {
  requestId: string;
  actor: { id: string; fullName: string };
  deliveryStatus: SendWorkflowDeliveryStatus;
  attemptAt: string;
  status?: PofRequestStatus;
  sentAt?: string | null;
  openedAt?: string | null;
  signedAt?: string | null;
  deliveryError?: string | null;
}) {
  const admin = createSupabaseAdminClient();
  const patch: Record<string, unknown> = {
    delivery_status: input.deliveryStatus,
    last_delivery_attempt_at: input.attemptAt,
    delivery_failed_at: input.deliveryStatus === "send_failed" ? input.attemptAt : null,
    delivery_error: clean(input.deliveryError),
    updated_by_user_id: input.actor.id,
    updated_by_name: input.actor.fullName,
    updated_at: input.attemptAt
  };
  if (input.status) {
    patch.status = input.status;
  }
  if (input.sentAt !== undefined) patch.sent_at = input.sentAt;
  if (input.openedAt !== undefined) patch.opened_at = input.openedAt;
  if (input.signedAt !== undefined) patch.signed_at = input.signedAt;
  const { error } = await admin.from("pof_requests").update(patch).eq("id", input.requestId);
  if (error) {
    throw new Error(mapPofRequestWriteError(error, "Unable to update POF request delivery state."));
  }
}

async function buildSignedPdfBytes(input: {
  pofPayload: PhysicianOrderForm;
  providerTypedName: string;
  providerCredentials?: string | null;
  signatureImageBytes: Buffer;
  signatureContentType: string;
  signedAt: string;
}) {
  return buildPofDocumentPdfBytes({
    form: input.pofPayload,
    title: "Physician Order Form",
    metaLines: [
      `Member: ${input.pofPayload.memberNameSnapshot}`,
      `POF ID: ${input.pofPayload.id}`
    ],
    signature: {
      providerTypedName: input.providerTypedName,
      providerCredentials: clean(input.providerCredentials),
      signedAt: input.signedAt,
      signatureImageBytes: input.signatureImageBytes,
      signatureContentType: input.signatureContentType
    }
  });
}

export function getConfiguredClinicalSenderEmail() {
  const preferred =
    parseEmailAddress(process.env.CLINICAL_SENDER_EMAIL) ??
    parseEmailAddress(process.env.DEFAULT_CLINICAL_SENDER_EMAIL) ??
    parseEmailAddress(process.env.RESEND_FROM_EMAIL);
  return preferred ?? "";
}

export async function listPofRequestsForMember(memberId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("pof_requests")
    .select("*")
    .eq("member_id", memberId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as PofRequestRow[];
  await refreshExpiredRequests(rows);
  return rows.map(toSummary);
}

export async function listPofRequestsByPhysicianOrderIds(memberId: string, physicianOrderIds: string[]) {
  if (physicianOrderIds.length === 0) return [] as PofRequestSummary[];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("pof_requests")
    .select("*")
    .eq("member_id", memberId)
    .in("physician_order_id", physicianOrderIds)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as PofRequestRow[];
  await refreshExpiredRequests(rows);
  return rows.map(toSummary);
}

export async function getPofRequestTimeline(requestId: string, memberId?: string) {
  const supabase = await createClient();
  let requestQuery = supabase.from("pof_requests").select("*").eq("id", requestId);
  if (memberId) requestQuery = requestQuery.eq("member_id", memberId);
  const { data: requestData, error: requestError } = await requestQuery.maybeSingle();
  if (requestError) throw new Error(requestError.message);
  if (!requestData) return null;
  await refreshExpiredRequests([requestData as PofRequestRow]);

  const { data: eventsData, error: eventsError } = await supabase
    .from("document_events")
    .select("*")
    .eq("document_id", requestId)
    .order("created_at", { ascending: true });
  if (eventsError) throw new Error(eventsError.message);

  const events = ((eventsData ?? []) as any[]).map(
    (row): PofDocumentEvent => ({
      id: row.id,
      documentId: row.document_id,
      memberId: row.member_id,
      physicianOrderId: row.physician_order_id,
      eventType: row.event_type,
      actorType: row.actor_type,
      actorUserId: row.actor_user_id,
      actorName: row.actor_name,
      actorEmail: row.actor_email,
      actorIp: row.actor_ip,
      actorUserAgent: row.actor_user_agent,
      metadata: row.metadata ?? {},
      createdAt: row.created_at
    })
  );

  return {
    request: toSummary(requestData as PofRequestRow),
    events
  };
}

export async function listPofTimelineForPhysicianOrder(physicianOrderId: string) {
  const supabase = await createClient();
  const { data: requestsData, error: requestsError } = await supabase
    .from("pof_requests")
    .select("*")
    .eq("physician_order_id", physicianOrderId)
    .order("created_at", { ascending: false });
  if (requestsError) throw new Error(requestsError.message);
  const requestRows = (requestsData ?? []) as PofRequestRow[];
  await refreshExpiredRequests(requestRows);
  const requests = requestRows.map(toSummary);
  if (requests.length === 0) return { requests, events: [] as PofDocumentEvent[] };

  const requestIds = requests.map((row) => row.id);
  const { data: eventsData, error: eventsError } = await supabase
    .from("document_events")
    .select("*")
    .in("document_id", requestIds)
    .order("created_at", { ascending: true });
  if (eventsError) throw new Error(eventsError.message);

  const events = ((eventsData ?? []) as any[]).map(
    (row): PofDocumentEvent => ({
      id: row.id,
      documentId: row.document_id,
      memberId: row.member_id,
      physicianOrderId: row.physician_order_id,
      eventType: row.event_type,
      actorType: row.actor_type,
      actorUserId: row.actor_user_id,
      actorName: row.actor_name,
      actorEmail: row.actor_email,
      actorIp: row.actor_ip,
      actorUserAgent: row.actor_user_agent,
      metadata: row.metadata ?? {},
      createdAt: row.created_at
    })
  );

  return { requests, events };
}

export async function sendNewPofSignatureRequest(input: SendPofSignatureInput) {
  assertPofRuntimeDiagnostics({
    context: "send-new-request",
    requireResend: true
  });
  const providerName = clean(input.providerName);
  const providerEmail = clean(input.providerEmail);
  const nurseName = clean(input.nurseName);
  const fromEmail = clean(input.fromEmail);
  const optionalMessage = clean(input.optionalMessage);
  if (!providerName) throw new Error("Provider name is required.");
  if (!isEmail(providerEmail)) throw new Error("Provider email is invalid.");
  if (!nurseName) throw new Error("Nurse name is required.");
  if (!isEmail(fromEmail)) throw new Error("From email is invalid.");

  const form = clonePofPayloadSnapshot(await assertPhysicianOrderMember(input.physicianOrderId, input.memberId));
  const existing = await listPofRequestsByPhysicianOrderIdsWithAdmin(input.memberId, [input.physicianOrderId]);
  const active = existing.find((row) => toStatus(row.status) === "sent" || toStatus(row.status) === "opened");
  if (active) throw new Error("An active signature request already exists. Use Resend.");

  const now = toEasternISO();
  const expiresAt = toIsoAtEndOfDate(input.expiresOnDate);
  const requestId = randomUUID();
  const unsignedPdfBytes = await buildPofDocumentPdfBytes({
    form,
    title: "Physician Order Form",
    metaLines: [`Request ID: ${requestId}`, "Status: Pending Provider Signature"]
  });
  const unsignedPath = `members/${input.memberId}/pof/${input.physicianOrderId}/requests/${requestId}/unsigned.pdf`;
  const unsignedStorageUri = await uploadMemberDocumentObject({
    objectPath: unsignedPath,
    bytes: unsignedPdfBytes,
    contentType: "application/pdf"
  });

  const token = generateSigningToken();
  const hashedToken = hashToken(token);
  const signatureRequestUrl = `${buildAppBaseUrl(input.appBaseUrl)}/sign/pof/${token}`;
  const admin = createSupabaseAdminClient();
  const { error: createError } = await admin.from("pof_requests").insert({
    id: requestId,
    physician_order_id: input.physicianOrderId,
    member_id: input.memberId,
    provider_name: providerName,
    provider_email: providerEmail,
    nurse_name: nurseName,
    from_email: fromEmail,
    sent_by_user_id: input.actor.id,
    status: "draft",
    delivery_status: "pending_preparation",
    optional_message: optionalMessage,
    sent_at: null,
    opened_at: null,
    signed_at: null,
    expires_at: expiresAt,
    signature_request_token: hashedToken,
    signature_request_url: signatureRequestUrl,
    unsigned_pdf_url: unsignedStorageUri,
    signed_pdf_url: null,
    pof_payload_json: form,
    member_file_id: null,
    created_by_user_id: input.actor.id,
    created_by_name: input.actor.fullName,
    created_at: now,
    updated_by_user_id: input.actor.id,
    updated_by_name: input.actor.fullName,
    updated_at: now
  });
  if (createError) {
    throw new Error(mapPofRequestWriteError(createError, "Unable to create POF signature request."));
  }

  await createDocumentEvent({
    documentId: requestId,
    memberId: input.memberId,
    physicianOrderId: input.physicianOrderId,
    eventType: "created",
    actorType: "user",
    actorUserId: input.actor.id,
    actorName: input.actor.fullName,
    actorEmail: fromEmail,
    metadata: {
      providerEmail,
      expiresAt
    }
  });

  await markPofRequestDeliveryState({
    requestId,
    actor: input.actor,
    status: "draft",
    deliveryStatus: "ready_to_send",
    sentAt: null,
    openedAt: null,
    signedAt: null,
    deliveryError: null,
    attemptAt: toEasternISO()
  });

  try {
    await sendSignatureEmail({
      toEmail: providerEmail!,
      providerName: providerName!,
      nurseName: nurseName!,
      fromEmail: fromEmail!,
      requestUrl: signatureRequestUrl,
      expiresAt,
      memberName: form.memberNameSnapshot,
      optionalMessage
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unable to deliver signature email.";
    const failedAt = toEasternISO();
    await markPofRequestDeliveryState({
      requestId,
      actor: input.actor,
      status: "draft",
      deliveryStatus: "send_failed",
      sentAt: null,
      openedAt: null,
      signedAt: null,
      deliveryError: reason,
      attemptAt: failedAt
    });
    await createDocumentEvent({
      documentId: requestId,
      memberId: input.memberId,
      physicianOrderId: input.physicianOrderId,
      eventType: "send_failed",
      actorType: "user",
      actorUserId: input.actor.id,
      actorName: input.actor.fullName,
      actorEmail: fromEmail,
      metadata: {
        providerEmail,
        retryAvailable: true,
        error: reason
      }
    });
    await recordWorkflowEvent({
      eventType: "pof_request_failed",
      entityType: "pof_request",
      entityId: requestId,
      actorType: "user",
      actorUserId: input.actor.id,
      status: "failed",
      severity: "medium",
      metadata: {
        member_id: input.memberId,
        physician_order_id: input.physicianOrderId,
        phase: "delivery",
        delivery_status: "send_failed",
        retry_available: true,
        error: reason
      }
    });
    await maybeRecordRepeatedFailureAlert({
      workflowEventType: "pof_request_failed",
      entityType: "pof_request",
      entityId: requestId,
      actorUserId: input.actor.id,
      threshold: 2,
      metadata: {
        member_id: input.memberId,
        physician_order_id: input.physicianOrderId,
        phase: "delivery"
      }
    });
    throw buildRetryableWorkflowDeliveryError({
      requestId,
      requestUrl: signatureRequestUrl,
      reason,
      workflowLabel: "POF signature request",
      retryLabel: "Use Resend to retry delivery after the email issue is fixed."
    });
  }

  const sentAt = toEasternISO();
  await markPofRequestDeliveryState({
    requestId,
    actor: input.actor,
    status: "sent",
    deliveryStatus: "sent",
    sentAt,
    deliveryError: null,
    attemptAt: sentAt
  });

  await createDocumentEvent({
    documentId: requestId,
    memberId: input.memberId,
    physicianOrderId: input.physicianOrderId,
    eventType: "sent",
    actorType: "user",
    actorUserId: input.actor.id,
    actorName: input.actor.fullName,
    actorEmail: fromEmail
  });
  await recordWorkflowEvent({
    eventType: "pof_request_sent",
    entityType: "pof_request",
    entityId: requestId,
    actorType: "user",
    actorUserId: input.actor.id,
    status: "sent",
    severity: "low",
    metadata: {
      member_id: input.memberId,
      physician_order_id: input.physicianOrderId,
      provider_email: providerEmail,
      sent_at: sentAt
    }
  });

  await setPhysicianOrderSentState({
    physicianOrderId: input.physicianOrderId,
    providerName: providerName!,
    actorId: input.actor.id,
    actorName: input.actor.fullName
  });

  const created = await loadRequestById(requestId);
  if (!created) throw new Error("POF signature request could not be loaded.");
  return toSummary(created);
}

export async function resendPofSignatureRequest(input: ResendPofSignatureInput) {
  assertPofRuntimeDiagnostics({
    context: "resend-request",
    requireResend: true
  });
  const request = await loadRequestById(input.requestId);
  if (!request) throw new Error("POF signature request was not found.");
  if (request.member_id !== input.memberId) throw new Error("Request/member mismatch.");
  const status = toStatus(request.status);
  if (status === "signed") throw new Error("Signed requests cannot be resent.");
  if (status === "declined") throw new Error("Voided requests cannot be resent.");

  const providerName = clean(input.providerName);
  const providerEmail = clean(input.providerEmail);
  const nurseName = clean(input.nurseName);
  const fromEmail = clean(input.fromEmail);
  const optionalMessage = clean(input.optionalMessage);
  if (!providerName) throw new Error("Provider name is required.");
  if (!isEmail(providerEmail)) throw new Error("Provider email is invalid.");
  if (!nurseName) throw new Error("Nurse name is required.");
  if (!isEmail(fromEmail)) throw new Error("From email is invalid.");

  const form = clonePofPayloadSnapshot(await assertPhysicianOrderMember(request.physician_order_id, input.memberId));
  const expiresAt = toIsoAtEndOfDate(input.expiresOnDate);
  const token = generateSigningToken();
  const hashedToken = hashToken(token);
  const signatureRequestUrl = `${buildAppBaseUrl(input.appBaseUrl)}/sign/pof/${token}`;

  const unsignedPdfBytes = await buildPofDocumentPdfBytes({
    form,
    title: "Physician Order Form",
    metaLines: [`Request ID: ${request.id}`, "Status: Pending Provider Signature"]
  });
  const unsignedPath = `members/${input.memberId}/pof/${request.physician_order_id}/requests/${request.id}/unsigned.pdf`;
  const unsignedStorageUri = await uploadMemberDocumentObject({
    objectPath: unsignedPath,
    bytes: unsignedPdfBytes,
    contentType: "application/pdf"
  });

  const preSendUpdatedAt = toEasternISO();
  const admin = createSupabaseAdminClient();
  const { error: preSendError } = await admin
    .from("pof_requests")
    .update({
      provider_name: providerName,
      provider_email: providerEmail,
      nurse_name: nurseName,
      from_email: fromEmail,
      optional_message: optionalMessage,
      status: "draft",
      delivery_status: "retry_pending",
      sent_at: null,
      opened_at: null,
      signed_at: null,
      delivery_error: null,
      delivery_failed_at: null,
      expires_at: expiresAt,
      signature_request_token: hashedToken,
      signature_request_url: signatureRequestUrl,
      unsigned_pdf_url: unsignedStorageUri,
      pof_payload_json: form,
      updated_by_user_id: input.actor.id,
      updated_by_name: input.actor.fullName,
      updated_at: preSendUpdatedAt
    })
    .eq("id", input.requestId);
  if (preSendError) {
    throw new Error(mapPofRequestWriteError(preSendError, "Unable to prepare POF resend request."));
  }

  await markPofRequestDeliveryState({
    requestId: input.requestId,
    actor: input.actor,
    status: "draft",
    deliveryStatus: "ready_to_send",
    sentAt: null,
    openedAt: null,
    signedAt: null,
    deliveryError: null,
    attemptAt: toEasternISO()
  });

  try {
    await sendSignatureEmail({
      toEmail: providerEmail!,
      providerName: providerName!,
      nurseName: nurseName!,
      fromEmail: fromEmail!,
      requestUrl: signatureRequestUrl,
      expiresAt,
      memberName: form.memberNameSnapshot,
      optionalMessage
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unable to deliver signature email.";
    const failedAt = toEasternISO();
    await markPofRequestDeliveryState({
      requestId: input.requestId,
      actor: input.actor,
      status: "draft",
      deliveryStatus: "send_failed",
      sentAt: null,
      openedAt: null,
      signedAt: null,
      deliveryError: reason,
      attemptAt: failedAt
    });
    await createDocumentEvent({
      documentId: input.requestId,
      memberId: request.member_id,
      physicianOrderId: request.physician_order_id,
      eventType: "send_failed",
      actorType: "user",
      actorUserId: input.actor.id,
      actorName: input.actor.fullName,
      actorEmail: fromEmail,
      metadata: {
        providerEmail,
        retryAvailable: true,
        error: reason
      }
    });
    await recordWorkflowEvent({
      eventType: "pof_request_failed",
      entityType: "pof_request",
      entityId: input.requestId,
      actorType: "user",
      actorUserId: input.actor.id,
      status: "failed",
      severity: "medium",
      metadata: {
        member_id: request.member_id,
        physician_order_id: request.physician_order_id,
        phase: "delivery",
        delivery_status: "send_failed",
        retry_available: true,
        error: reason
      }
    });
    await maybeRecordRepeatedFailureAlert({
      workflowEventType: "pof_request_failed",
      entityType: "pof_request",
      entityId: input.requestId,
      actorUserId: input.actor.id,
      threshold: 2,
      metadata: {
        member_id: request.member_id,
        physician_order_id: request.physician_order_id,
        phase: "delivery"
      }
    });
    throw buildRetryableWorkflowDeliveryError({
      requestId: input.requestId,
      requestUrl: signatureRequestUrl,
      reason,
      workflowLabel: "POF signature request",
      retryLabel: "Use Resend to retry delivery after the email issue is fixed."
    });
  }

  const now = toEasternISO();
  await markPofRequestDeliveryState({
    requestId: input.requestId,
    actor: input.actor,
    status: "sent",
    deliveryStatus: "sent",
    sentAt: now,
    openedAt: null,
    signedAt: null,
    deliveryError: null,
    attemptAt: now
  });

  await createDocumentEvent({
    documentId: input.requestId,
    memberId: request.member_id,
    physicianOrderId: request.physician_order_id,
    eventType: "resent",
    actorType: "user",
    actorUserId: input.actor.id,
    actorName: input.actor.fullName,
    actorEmail: fromEmail
  });
  await recordWorkflowEvent({
    eventType: "pof_request_sent",
    entityType: "pof_request",
    entityId: input.requestId,
    actorType: "user",
    actorUserId: input.actor.id,
    status: "sent",
    severity: "low",
    metadata: {
      member_id: request.member_id,
      physician_order_id: request.physician_order_id,
      provider_email: providerEmail,
      resent_at: now
    }
  });

  await setPhysicianOrderSentState({
    physicianOrderId: request.physician_order_id,
    providerName: providerName!,
    actorId: input.actor.id,
    actorName: input.actor.fullName
  });

  const refreshed = await loadRequestById(input.requestId);
  if (!refreshed) throw new Error("POF signature request could not be loaded.");
  return toSummary(refreshed);
}

export async function voidPofSignatureRequest(input: VoidPofSignatureInput) {
  const request = await loadRequestById(input.requestId);
  if (!request) throw new Error("POF signature request was not found.");
  if (request.member_id !== input.memberId) throw new Error("Request/member mismatch.");
  const status = toStatus(request.status);
  if (status === "signed") throw new Error("Signed requests cannot be voided.");
  if (status === "declined") return toSummary(request);

  const now = toEasternISO();
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("pof_requests")
    .update({
      status: "declined",
      updated_by_user_id: input.actor.id,
      updated_by_name: input.actor.fullName,
      updated_at: now
    })
    .eq("id", input.requestId);
  if (error) throw new Error(error.message);

  await createDocumentEvent({
    documentId: input.requestId,
    memberId: request.member_id,
    physicianOrderId: request.physician_order_id,
    eventType: "declined",
    actorType: "user",
    actorUserId: input.actor.id,
    actorName: input.actor.fullName,
    metadata: {
      reason: clean(input.reason) ?? "voided_by_staff"
    }
  });

  const refreshed = await loadRequestById(input.requestId);
  if (!refreshed) throw new Error("POF signature request could not be loaded.");
  return toSummary(refreshed);
}

export async function getPublicPofSigningContext(
  token: string,
  metadata?: {
    ip?: string | null;
    userAgent?: string | null;
  }
): Promise<PublicPofSigningContext> {
  const normalizedToken = clean(token);
  if (!normalizedToken) return { state: "invalid" };
  const request = await loadRequestByToken(normalizedToken);
  if (!request) return { state: "invalid" };

  const summary = toSummary(request);
  if (isExpired(request.expires_at) && toStatus(request.status) !== "expired" && toStatus(request.status) !== "signed") {
    await markRequestExpired({ request, actorName: request.nurse_name });
    const expired = await loadRequestById(request.id);
    if (!expired) return { state: "expired", request: summary };
    return { state: "expired", request: toSummary(expired) };
  }

  const status = toStatus(request.status);
  if (status === "expired") return { state: "expired", request: summary };
  if (status === "declined") return { state: "declined", request: summary };
  if (status === "signed") return { state: "signed", request: summary };

  if (!request.opened_at) {
    const now = toEasternISO();
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from("pof_requests")
      .update({
        status: "opened",
        opened_at: now,
        updated_by_user_id: request.sent_by_user_id,
        updated_by_name: request.nurse_name,
        updated_at: now
      })
      .eq("id", request.id);
    if (error) throw new Error(error.message);
    await createDocumentEvent({
      documentId: request.id,
      memberId: request.member_id,
      physicianOrderId: request.physician_order_id,
      eventType: "opened",
      actorType: "provider",
      actorEmail: request.provider_email,
      actorName: request.provider_name,
      actorIp: metadata?.ip ?? null,
      actorUserAgent: metadata?.userAgent ?? null
    });
  }

  let pofPayload: PhysicianOrderForm;
  try {
    pofPayload = getRequestPayloadSnapshotOrThrow(request);
  } catch {
    return { state: "invalid" };
  }
  const refreshed = await loadRequestById(request.id);
  if (!refreshed) return { state: "invalid" };
  return { state: "ready", request: toSummary(refreshed), pofPayload };
}

export async function submitPublicPofSignature(input: SubmitPublicPofSignatureInput) {
  assertPofRuntimeDiagnostics({
    context: "submit-public-signature"
  });
  const token = clean(input.token);
  const providerTypedName = clean(input.providerTypedName);
  if (!token) throw new Error("Signature token is required.");
  if (!providerTypedName) throw new Error("Typed provider name is required.");
  if (!input.attested) throw new Error("Attestation is required before signing.");

  const signature = parseDataUrlPayload(input.signatureImageDataUrl);
  if (!signature.contentType.startsWith("image/")) {
    throw new Error("Signature image format is invalid.");
  }

  const request = await loadRequestByToken(token);
  if (!request) throw new Error("This signature link is invalid.");
  if (request.status === "signed") throw new Error("This signature link has already been used.");
  if (request.status === "declined") throw new Error("This signature request was voided.");
  if (request.status === "expired" || isExpired(request.expires_at)) {
    if (request.status !== "expired") {
      await markRequestExpired({ request, actorName: request.nurse_name });
    }
    throw new Error("This signature link has expired.");
  }

  try {
    const now = toEasternISO();
    const day = toEasternDate(now);
    const snapshot = getRequestPayloadSnapshotOrThrow(request);
    const signaturePath = `members/${request.member_id}/pof/${request.physician_order_id}/requests/${request.id}/provider-signature.png`;
    const signatureUri = await uploadMemberDocumentObject({
      objectPath: signaturePath,
      bytes: signature.bytes,
      contentType: signature.contentType
    });

    const signatureArtifact = await downloadStorageAssetOrThrow(signatureUri, "Provider signature image artifact");
    if (!signatureArtifact.contentType.startsWith("image/")) {
      throw new Error(
        `Provider signature image artifact has invalid content type (${signatureArtifact.contentType}).`
      );
    }

    const signedPdfBytes = await buildSignedPdfBytes({
      pofPayload: snapshot,
      providerTypedName: providerTypedName!,
      providerCredentials: parseProviderCredentials(snapshot.providerName) ?? parseProviderCredentials(providerTypedName),
      signatureImageBytes: signatureArtifact.bytes,
      signatureContentType: signatureArtifact.contentType,
      signedAt: now
    });
    const signedPdfPath = `members/${request.member_id}/pof/${request.physician_order_id}/requests/${request.id}/signed.pdf`;
    const signedPdfUri = await uploadMemberDocumentObject({
      objectPath: signedPdfPath,
      bytes: signedPdfBytes,
      contentType: "application/pdf"
    });

    const signedPdfDataUrl = `data:application/pdf;base64,${signedPdfBytes.toString("base64")}`;
    const memberFileName = `POF Signed - ${snapshot.memberNameSnapshot} - ${day}.pdf`;
    const signatureMetadata = {
      signedVia: "pof-esign",
      providerSignatureImageUrl: signatureUri,
      providerIp: clean(input.providerIp),
      providerUserAgent: clean(input.providerUserAgent),
      signedAt: now
    };
    const rotatedToken = hashToken(generateSigningToken());
    const admin = createSupabaseAdminClient();
    let finalizedRaw: unknown;
    try {
      finalizedRaw = await invokeSupabaseRpcOrThrow<unknown>(admin, RPC_FINALIZE_POF_SIGNATURE, {
        p_request_id: request.id,
        p_provider_typed_name: providerTypedName,
        p_provider_signature_image_url: signatureUri,
        p_provider_ip: clean(input.providerIp),
        p_provider_user_agent: clean(input.providerUserAgent),
        p_signed_pdf_url: signedPdfUri,
        p_member_file_id: nextMemberFileId(),
        p_member_file_name: memberFileName,
        p_member_file_data_url: signedPdfDataUrl,
        p_member_file_storage_object_path: parseMemberDocumentStorageUri(signedPdfUri),
        p_actor_user_id: request.sent_by_user_id,
        p_actor_name: request.nurse_name,
        p_signed_at: now,
        p_opened_at: request.opened_at ?? now,
        p_signature_request_token: rotatedToken,
        p_signature_metadata: signatureMetadata
      });
    } catch (error) {
      if (isMissingRpcFunctionError(error, RPC_FINALIZE_POF_SIGNATURE)) {
        throw new Error(
          "POF signing finalization RPC is not available. Apply Supabase migration 0037_shared_rpc_standardization_lead_pof.sql and refresh PostgREST schema cache."
        );
      }
      throw error;
    }
    const finalized = toRpcFinalizePofSignatureRow(finalizedRaw);

    const postSignResult = await processSignedPhysicianOrderPostSignSync({
      pofId: finalized.physician_order_id,
      memberId: finalized.member_id,
      queueId: finalized.queue_id,
      queueAttemptCount: finalized.queue_attempt_count,
      actor: {
        id: request.sent_by_user_id,
        fullName: request.nurse_name
      },
      signedAtIso: now,
      pofRequestId: finalized.request_id,
      serviceRole: true
    });

    await recordWorkflowMilestone({
      event: {
        event_type: "physician_order_signed",
        entity_type: "physician_order",
        entity_id: finalized.physician_order_id,
        actor_type: "provider",
        status: "signed",
        severity: "low",
        metadata: {
          member_id: finalized.member_id,
          pof_request_id: finalized.request_id,
          member_file_id: finalized.member_file_id,
          queue_id: finalized.queue_id,
          post_sign_status: postSignResult.postSignStatus,
          post_sign_attempt_count: postSignResult.attemptCount,
          post_sign_next_retry_at: postSignResult.nextRetryAt
        }
      },
      notification: {
        recipientUserId: request.sent_by_user_id,
        title: "POF Signed",
        message: `POF signed for ${snapshot.memberNameSnapshot}`,
        entityType: "pof_request",
        entityId: request.id,
        metadata: {
          memberId: request.member_id,
          physicianOrderId: request.physician_order_id,
          requestId: request.id
        },
        serviceRole: true
      }
    });
    await recordWorkflowEvent({
      eventType: "pof_request_signed",
      entityType: "pof_request",
      entityId: finalized.request_id,
      actorType: "provider",
      status: "signed",
      severity: "low",
      metadata: {
        member_id: finalized.member_id,
        physician_order_id: finalized.physician_order_id,
        member_file_id: finalized.member_file_id,
        post_sign_status: postSignResult.postSignStatus,
        post_sign_attempt_count: postSignResult.attemptCount,
        post_sign_next_retry_at: postSignResult.nextRetryAt
      }
    });

    return {
      requestId: finalized.request_id,
      memberId: finalized.member_id,
      memberFileId: finalized.member_file_id,
      signedPdfUrl: await createSignedStorageUrl(signedPdfUri, 60 * 15)
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unable to complete POF signing.";
    await recordWorkflowEvent({
      eventType: "pof_request_failed",
      entityType: "pof_request",
      entityId: request.id,
      actorType: "provider",
      status: "failed",
      severity: "high",
      metadata: {
        member_id: request.member_id,
        physician_order_id: request.physician_order_id,
        phase: "signature_completion",
        error: reason
      }
    });
    await recordImmediateSystemAlert({
      entityType: "pof_request",
      entityId: request.id,
      actorUserId: request.sent_by_user_id,
      severity: "high",
      alertKey: "pof_signature_completion_failed",
      metadata: {
        member_id: request.member_id,
        physician_order_id: request.physician_order_id,
        error: reason
      }
    });
    throw error;
  }
}

export async function getSignedPofPdfUrlForMember(input: { requestId: string; memberId: string }) {
  const request = await loadRequestById(input.requestId);
  if (!request) throw new Error("POF signature request was not found.");
  if (request.member_id !== input.memberId) throw new Error("Request/member mismatch.");
  if (toStatus(request.status) !== "signed") throw new Error("Signed PDF is not available for this request.");
  if (!request.signed_pdf_url) throw new Error("Signed PDF storage path is missing.");
  return createSignedStorageUrl(request.signed_pdf_url, 60 * 15);
}

export async function getUnsignedPofPdfUrlForMember(input: { requestId: string; memberId: string }) {
  const request = await loadRequestById(input.requestId);
  if (!request) throw new Error("POF signature request was not found.");
  if (request.member_id !== input.memberId) throw new Error("Request/member mismatch.");
  if (!request.unsigned_pdf_url) throw new Error("Unsigned PDF storage path is missing.");
  return createSignedStorageUrl(request.unsigned_pdf_url, 60 * 15);
}
