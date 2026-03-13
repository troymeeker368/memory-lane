import { Buffer } from "node:buffer";
import { createHash, randomBytes, randomUUID } from "node:crypto";

import {
  getPhysicianOrderById,
  signPhysicianOrder,
  type PhysicianOrderForm
} from "@/lib/services/physician-orders-supabase";
import { buildPofDocumentPdfBytes } from "@/lib/services/pof-document-pdf";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { easternDateTimeLocalToISO, toEasternDate, toEasternISO } from "@/lib/timezone";

export const POF_REQUEST_STATUS_VALUES = ["draft", "sent", "opened", "signed", "declined", "expired"] as const;
export type PofRequestStatus = (typeof POF_REQUEST_STATUS_VALUES)[number];

const STORAGE_BUCKET = "member-documents";
const TOKEN_BYTE_LENGTH = 32;

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
  eventType: "created" | "sent" | "opened" | "signed" | "declined" | "expired" | "resent";
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

function isEmail(value: string | null | undefined) {
  const normalized = clean(value);
  if (!normalized) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
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

function getStorageUri(path: string) {
  return `storage://${STORAGE_BUCKET}/${path}`;
}

function parseStorageUri(uri: string | null | undefined) {
  const normalized = clean(uri);
  if (!normalized) return null;
  const prefix = `storage://${STORAGE_BUCKET}/`;
  if (!normalized.startsWith(prefix)) return null;
  return normalized.slice(prefix.length);
}

function parseDataUrl(dataUrl: string) {
  const normalized = dataUrl.trim();
  const match = /^data:([^;]+);base64,(.+)$/.exec(normalized);
  if (!match) {
    throw new Error("Invalid data URL payload.");
  }
  return {
    contentType: match[1],
    bytes: Buffer.from(match[2], "base64")
  };
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
  if (!candidate.careInformation || typeof candidate.careInformation !== "object") return null;
  if (!candidate.operationalFlags || typeof candidate.operationalFlags !== "object") return null;
  return candidate as PhysicianOrderForm;
}

function getRequestPayloadSnapshotOrThrow(request: PofRequestRow) {
  const snapshot = parsePofPayloadSnapshot(request.pof_payload_json);
  if (!snapshot) {
    throw new Error("POF request payload snapshot is missing. Ask Memory Lane staff to resend this request.");
  }
  if (snapshot.id !== request.physician_order_id || snapshot.memberId !== request.member_id) {
    throw new Error("POF request payload snapshot does not match the linked member/order.");
  }
  return snapshot;
}

async function assertPhysicianOrderMember(physicianOrderId: string, memberId: string) {
  const form = await getPhysicianOrderById(physicianOrderId, { serviceRole: true });
  if (!form) throw new Error("Physician order was not found.");
  if (form.memberId !== memberId) throw new Error("Physician order does not belong to the selected member.");
  return form;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildAppBaseUrl(requestBaseUrl?: string | null) {
  const requested = clean(requestBaseUrl);
  const explicit =
    requested ??
    clean(process.env.NEXT_PUBLIC_APP_URL) ??
    clean(process.env.APP_URL) ??
    clean(process.env.NEXT_PUBLIC_SITE_URL) ??
    clean(process.env.SITE_URL);
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

function nextMemberFileId() {
  return `mf_${randomUUID().replace(/-/g, "")}`;
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

async function createSignedStorageUrl(storageUri: string, expiresInSeconds = 60 * 15) {
  const objectPath = parseStorageUri(storageUri);
  if (!objectPath) throw new Error("Storage object path is invalid.");
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.storage.from(STORAGE_BUCKET).createSignedUrl(objectPath, expiresInSeconds);
  if (error || !data?.signedUrl) throw new Error(error?.message ?? "Unable to create signed document URL.");
  return data.signedUrl;
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
  const apiKey = clean(process.env.RESEND_API_KEY);
  if (!apiKey) {
    throw new Error("POF e-sign email delivery is not configured. Set RESEND_API_KEY.");
  }

  const subject = `Memory Lane POF Signature Request for ${input.memberName}`;
  const expiresOn = input.expiresAt.slice(0, 10);
  const optionalMessage = clean(input.optionalMessage);
  const providerNameEscaped = escapeHtml(input.providerName);
  const nurseNameEscaped = escapeHtml(input.nurseName);
  const requestUrlEscaped = escapeHtml(input.requestUrl);
  const optionalMessageEscaped = optionalMessage ? escapeHtml(optionalMessage) : null;
  const html = `
    <p>Hello ${providerNameEscaped},</p>
    <p>${nurseNameEscaped} sent a Physician Order Form (POF) for review and signature.</p>
    ${optionalMessageEscaped ? `<p><strong>Message:</strong> ${optionalMessageEscaped}</p>` : ""}
    <p><a href="${requestUrlEscaped}">Open secure POF signing page</a></p>
    <p>This secure link expires on ${expiresOn}.</p>
    <p>Thank you,<br/>Memory Lane Clinical Team</p>
  `.trim();
  const text = [
    `Hello ${input.providerName},`,
    `${input.nurseName} sent a Physician Order Form (POF) for review and signature.`,
    optionalMessage ? `Message: ${optionalMessage}` : null,
    `Sign securely: ${input.requestUrl}`,
    `This secure link expires on ${expiresOn}.`,
    "Thank you,",
    "Memory Lane Clinical Team"
  ]
    .filter(Boolean)
    .join("\n");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: input.fromEmail,
      to: [input.toEmail],
      subject,
      html,
      text
    })
  });

  if (!response.ok) {
    let detail = "";
    try {
      detail = await response.text();
    } catch {
      detail = "";
    }
    if (
      response.status === 403 &&
      detail.toLowerCase().includes("you can only send testing emails to your own email address")
    ) {
      throw new Error(
        "Resend is in test mode. Verify your sending domain in Resend and set CLINICAL_SENDER_EMAIL to that verified domain before sending live provider signature requests."
      );
    }
    throw new Error(`Unable to deliver signature email (${response.status}). ${detail}`.trim());
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
  eventType: "created" | "sent" | "opened" | "signed" | "declined" | "expired" | "resent";
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

async function buildSignedPdfBytes(input: {
  pofPayload: PhysicianOrderForm;
  providerTypedName: string;
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
      signedAt: input.signedAt,
      signatureImageBytes: input.signatureImageBytes,
      signatureContentType: input.signatureContentType
    }
  });
}

export function getConfiguredClinicalSenderEmail() {
  return (
    clean(process.env.CLINICAL_SENDER_EMAIL) ??
    clean(process.env.DEFAULT_CLINICAL_SENDER_EMAIL) ??
    clean(process.env.RESEND_FROM_EMAIL) ??
    ""
  );
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
  const unsignedStorageUri = await uploadToStorage({
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
  if (createError) throw new Error(createError.message);

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
    throw new Error(`${reason} Request was saved as Draft. Copy and send this secure link manually: ${signatureRequestUrl}`);
  }

  const sentAt = toEasternISO();
  const { error: sentError } = await admin
    .from("pof_requests")
    .update({
      status: "sent",
      sent_at: sentAt,
      updated_by_user_id: input.actor.id,
      updated_by_name: input.actor.fullName,
      updated_at: sentAt
    })
    .eq("id", requestId);
  if (sentError) throw new Error(sentError.message);

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
  const unsignedStorageUri = await uploadToStorage({
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
      sent_at: null,
      opened_at: null,
      signed_at: null,
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
  if (preSendError) throw new Error(preSendError.message);

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
    throw new Error(`${reason} Request was saved as Draft. Copy and send this secure link manually: ${signatureRequestUrl}`);
  }

  const now = toEasternISO();
  const { error } = await admin
    .from("pof_requests")
    .update({
      provider_name: providerName,
      provider_email: providerEmail,
      nurse_name: nurseName,
      from_email: fromEmail,
      optional_message: optionalMessage,
      status: "sent",
      sent_at: now,
      opened_at: null,
      signed_at: null,
      expires_at: expiresAt,
      signature_request_token: hashedToken,
      signature_request_url: signatureRequestUrl,
      unsigned_pdf_url: unsignedStorageUri,
      pof_payload_json: form,
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
    eventType: "resent",
    actorType: "user",
    actorUserId: input.actor.id,
    actorName: input.actor.fullName,
    actorEmail: fromEmail
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
  const token = clean(input.token);
  const providerTypedName = clean(input.providerTypedName);
  if (!token) throw new Error("Signature token is required.");
  if (!providerTypedName) throw new Error("Typed provider name is required.");
  if (!input.attested) throw new Error("Attestation is required before signing.");

  const signature = parseDataUrl(input.signatureImageDataUrl);
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

  const now = toEasternISO();
  const day = toEasternDate(now);
  const snapshot = getRequestPayloadSnapshotOrThrow(request);
  const signaturePath = `members/${request.member_id}/pof/${request.physician_order_id}/requests/${request.id}/provider-signature.png`;
  const signatureUri = await uploadToStorage({
    objectPath: signaturePath,
    bytes: signature.bytes,
    contentType: signature.contentType
  });

  const signedPdfBytes = await buildSignedPdfBytes({
    pofPayload: snapshot,
    providerTypedName: providerTypedName!,
    signatureImageBytes: signature.bytes,
    signatureContentType: signature.contentType,
    signedAt: now
  });
  const signedPdfPath = `members/${request.member_id}/pof/${request.physician_order_id}/requests/${request.id}/signed.pdf`;
  const signedPdfUri = await uploadToStorage({
    objectPath: signedPdfPath,
    bytes: signedPdfBytes,
    contentType: "application/pdf"
  });

  const signedPdfDataUrl = `data:application/pdf;base64,${signedPdfBytes.toString("base64")}`;
  const memberFileId = nextMemberFileId();
  const admin = createSupabaseAdminClient();
  const memberFileName = `POF Signed - ${snapshot.memberNameSnapshot} - ${day}.pdf`;

  const { error: fileError } = await admin.from("member_files").insert({
    id: memberFileId,
    member_id: request.member_id,
    file_name: memberFileName,
    file_type: "application/pdf",
    file_data_url: signedPdfDataUrl,
    storage_object_path: parseStorageUri(signedPdfUri),
    category: "Orders / POF",
    category_other: null,
    document_source: "POF E-Sign Signed",
    pof_request_id: request.id,
    uploaded_by_user_id: request.sent_by_user_id,
    uploaded_by_name: request.nurse_name,
    uploaded_at: now,
    updated_at: now
  });
  if (fileError) throw new Error(fileError.message);

  const { error: signatureInsertError } = await admin.from("pof_signatures").insert({
    pof_request_id: request.id,
    provider_typed_name: providerTypedName,
    provider_signature_image_url: signatureUri,
    provider_ip: clean(input.providerIp),
    provider_user_agent: clean(input.providerUserAgent),
    signed_at: now,
    created_at: now,
    updated_at: now
  });
  if (signatureInsertError) throw new Error(signatureInsertError.message);

  const rotatedToken = hashToken(generateSigningToken());
  const { error: updateRequestError } = await admin
    .from("pof_requests")
    .update({
      status: "signed",
      opened_at: request.opened_at ?? now,
      signed_at: now,
      signed_pdf_url: signedPdfUri,
      member_file_id: memberFileId,
      signature_request_token: rotatedToken,
      updated_by_user_id: request.sent_by_user_id,
      updated_by_name: request.nurse_name,
      updated_at: now
    })
    .eq("id", request.id);
  if (updateRequestError) throw new Error(updateRequestError.message);

  await createDocumentEvent({
    documentId: request.id,
    memberId: request.member_id,
    physicianOrderId: request.physician_order_id,
    eventType: "signed",
    actorType: "provider",
    actorName: providerTypedName,
    actorEmail: request.provider_email,
    actorIp: clean(input.providerIp),
    actorUserAgent: clean(input.providerUserAgent)
  });

  const signatureMetadata = {
    signedVia: "pof-esign",
    providerSignatureImageUrl: signatureUri,
    providerIp: clean(input.providerIp),
    providerUserAgent: clean(input.providerUserAgent),
    signedAt: now
  };
  const { error: physicianOrderUpdateError } = await admin
    .from("physician_orders")
    .update({
      provider_name: providerTypedName,
      provider_signature: providerTypedName,
      provider_signature_date: day,
      signature_metadata: signatureMetadata,
      updated_by_user_id: request.sent_by_user_id,
      updated_by_name: request.nurse_name,
      updated_at: now
    })
    .eq("id", request.physician_order_id);
  if (physicianOrderUpdateError) throw new Error(physicianOrderUpdateError.message);

  await signPhysicianOrder(
    request.physician_order_id,
    {
      id: request.sent_by_user_id,
      fullName: request.nurse_name
    },
    {
      serviceRole: true,
      signedAtIso: now
    }
  );

  return {
    requestId: request.id,
    memberId: request.member_id,
    memberFileId,
    signedPdfUrl: await createSignedStorageUrl(signedPdfUri, 60 * 15)
  };
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
