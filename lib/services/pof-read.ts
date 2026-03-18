import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { toSendWorkflowDeliveryStatus } from "@/lib/services/send-workflow-state";
import { toEasternISO } from "@/lib/timezone";

import type { PofDocumentEvent, PofRequestStatus, PofRequestSummary } from "@/lib/services/pof-types";

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
  signature_request_url: string;
  unsigned_pdf_url: string | null;
  signed_pdf_url: string | null;
  member_file_id: string | null;
  created_at: string;
  updated_at: string;
};

function clean(value: string | null | undefined) {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function parseEmailAddress(value: string | null | undefined) {
  const normalized = clean(value);
  if (!normalized) return null;
  const angledMatch = /<([^<>]+)>/.exec(normalized);
  const candidate = clean(angledMatch ? angledMatch[1] : normalized);
  if (!candidate) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null;
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
  const fallback =
    toStatus(row.status) === "sent" || toStatus(row.status) === "opened" || toStatus(row.status) === "signed"
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

function isExpired(expiresAt: string) {
  const expiresMs = Date.parse(expiresAt);
  return Number.isFinite(expiresMs) && expiresMs < Date.now();
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

export async function getPofRequestSummaryById(requestId: string, memberId?: string | null) {
  const normalizedRequestId = clean(requestId);
  if (!normalizedRequestId) return null;

  const supabase = await createClient();
  let query = supabase.from("pof_requests").select("*").eq("id", normalizedRequestId);
  if (clean(memberId)) {
    query = query.eq("member_id", clean(memberId)!);
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const row = data as PofRequestRow;
  await refreshExpiredRequests([row]);
  return toSummary(row);
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
