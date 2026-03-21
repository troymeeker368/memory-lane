import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";
import {
  clean,
  hashToken,
  isExpired,
  mapPofRequestWriteError,
  toStatus,
  toSummary,
  type PofRequestRow,
  type PofTokenMatch,
  type PostgrestErrorLike
} from "@/lib/services/pof-esign-core";
import type { PofRequestStatus, PofRequestSummary } from "@/lib/services/pof-types";
import { toEasternISO } from "@/lib/timezone";
import {
  recordImmediateSystemAlert
} from "@/lib/services/workflow-observability";
import {
  toSendWorkflowDeliveryStatus,
  type SendWorkflowDeliveryStatus
} from "@/lib/services/send-workflow-state";

const TRANSITION_POF_REQUEST_DELIVERY_STATE_RPC = "rpc_transition_pof_request_delivery_state";
const POF_DELIVERY_TRANSITION_COMPARE_AND_SET_MIGRATION = "0098_false_failure_read_path_hardening.sql";

async function recordPofAlertSafely(
  input: Parameters<typeof recordImmediateSystemAlert>[0],
  context: string
) {
  try {
    await recordImmediateSystemAlert(input);
  } catch (error) {
    console.error("[pof-esign] unable to persist follow-up system alert", {
      context,
      entityId: input.entityId ?? null,
      alertKey: input.alertKey,
      message: error instanceof Error ? error.message : "Unknown system alert error."
    });
  }
}

export async function loadPofRequestById(requestId: string) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("pof_requests").select("*").eq("id", requestId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as PofRequestRow | null) ?? null;
}

export async function loadPofRequestByToken(token: string): Promise<PofTokenMatch | null> {
  const hashed = hashToken(token);
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("pof_requests")
    .select("*")
    .eq("signature_request_token", hashed)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data) {
    return {
      request: data as PofRequestRow,
      tokenMatch: "active"
    };
  }

  const { data: consumedData, error: consumedError } = await admin
    .from("pof_requests")
    .select("*")
    .eq("last_consumed_signature_token_hash", hashed)
    .maybeSingle();
  if (consumedError) throw new Error(consumedError.message);
  if (!consumedData) return null;
  return {
    request: consumedData as PofRequestRow,
    tokenMatch: "consumed"
  };
}

export function buildPofRequestSummary(input: {
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
}) {
  const summary: PofRequestSummary = {
    id: input.id,
    physicianOrderId: input.physicianOrderId,
    memberId: input.memberId,
    providerName: input.providerName,
    providerEmail: input.providerEmail,
    nurseName: input.nurseName,
    fromEmail: input.fromEmail,
    sentByUserId: input.sentByUserId,
    status: input.status,
    deliveryStatus: input.deliveryStatus,
    deliveryError: input.deliveryError,
    lastDeliveryAttemptAt: input.lastDeliveryAttemptAt,
    deliveryFailedAt: input.deliveryFailedAt,
    optionalMessage: input.optionalMessage,
    sentAt: input.sentAt,
    openedAt: input.openedAt,
    signedAt: input.signedAt,
    expiresAt: input.expiresAt,
    signatureRequestUrl: input.signatureRequestUrl,
    unsignedPdfUrl: input.unsignedPdfUrl,
    signedPdfUrl: input.signedPdfUrl,
    memberFileId: input.memberFileId,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt
  };
  return summary;
}

export async function createPofDocumentEvent(input: {
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
  if (!error) return true;

  console.error("[pof-esign] document event insert failed after committed workflow write", {
    documentId: input.documentId,
    eventType: input.eventType,
    message: error.message
  });
  await recordPofAlertSafely({
    entityType: "pof_request",
    entityId: input.documentId,
    actorUserId: input.actorUserId ?? null,
    severity: "medium",
    alertKey: "pof_document_event_insert_failed",
    metadata: {
      member_id: input.memberId,
      physician_order_id: input.physicianOrderId,
      event_type: input.eventType,
      error: error.message
    }
  }, "createPofDocumentEvent");
  return false;
}

export async function markPofRequestDeliveryState(input: {
  requestId: string;
  actor: { id: string; fullName: string };
  deliveryStatus: SendWorkflowDeliveryStatus;
  attemptAt: string;
  status?: PofRequestStatus;
  sentAt?: string | null;
  openedAt?: string | null;
  signedAt?: string | null;
  deliveryError?: string | null;
  providerName?: string | null;
  updatePhysicianOrderSent?: boolean;
  expectedCurrentStatus?: PofRequestStatus | null;
  expectedCurrentDeliveryStatus?: SendWorkflowDeliveryStatus | null;
  requireOpenedAtNull?: boolean;
}) {
  const admin = createSupabaseAdminClient();
  try {
    type TransitionResultRow = {
      request_id: string;
      status: string;
      delivery_status: string;
      physician_order_id: string | null;
      did_transition: boolean;
    };
    const data = await invokeSupabaseRpcOrThrow<unknown>(admin, TRANSITION_POF_REQUEST_DELIVERY_STATE_RPC, {
      p_request_id: input.requestId,
      p_actor_user_id: input.actor.id,
      p_actor_name: input.actor.fullName,
      p_delivery_status: input.deliveryStatus,
      p_attempt_at: input.attemptAt,
      p_status: input.status ?? null,
      p_sent_at: input.sentAt ?? null,
      p_opened_at: input.openedAt ?? null,
      p_signed_at: input.signedAt ?? null,
      p_delivery_error: clean(input.deliveryError),
      p_provider_name: clean(input.providerName),
      p_update_physician_order_sent: Boolean(input.updatePhysicianOrderSent),
      p_expected_current_status: input.expectedCurrentStatus ?? null,
      p_expected_current_delivery_status: input.expectedCurrentDeliveryStatus ?? null,
      p_require_opened_at_null: Boolean(input.requireOpenedAtNull)
    });
    const row = (Array.isArray(data) ? data[0] : null) as TransitionResultRow | null;
    return {
      requestId: row?.request_id ?? input.requestId,
      status: toStatus(row?.status ?? input.status ?? null),
      deliveryStatus: toSendWorkflowDeliveryStatus(row?.delivery_status ?? input.deliveryStatus, input.deliveryStatus),
      physicianOrderId: row?.physician_order_id ?? null,
      didTransition: Boolean(row?.did_transition)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update POF request delivery state.";
    if (message.includes(TRANSITION_POF_REQUEST_DELIVERY_STATE_RPC)) {
      throw new Error(
        `POF delivery state RPC is not available. Apply Supabase migration ${POF_DELIVERY_TRANSITION_COMPARE_AND_SET_MIGRATION} and refresh PostgREST schema cache.`
      );
    }
    const writeError = error as PostgrestErrorLike | null | undefined;
    if (writeError && mapPofRequestWriteError) {
      const isUniqueViolation = (value: PostgrestErrorLike | null | undefined) =>
        value?.code === "23505" ||
        clean(value?.message)?.toLowerCase().includes("duplicate key") === true;
      if (isUniqueViolation(writeError)) {
        throw new Error(mapPofRequestWriteError(writeError, "Unable to update POF request delivery state."));
      }
    }
    throw error;
  }
}

export async function markPofRequestExpired(input: { request: PofRequestRow; actorName: string }) {
  const now = toEasternISO();
  await markPofRequestDeliveryState({
    requestId: input.request.id,
    actor: {
      id: input.request.sent_by_user_id,
      fullName: input.actorName
    },
    status: "expired",
    deliveryStatus: toSendWorkflowDeliveryStatus(input.request.delivery_status, "sent"),
    sentAt: input.request.sent_at,
    openedAt: input.request.opened_at,
    signedAt: input.request.signed_at,
    attemptAt: now
  });
  await createPofDocumentEvent({
    documentId: input.request.id,
    memberId: input.request.member_id,
    physicianOrderId: input.request.physician_order_id,
    eventType: "expired",
    actorType: "system",
    actorUserId: input.request.sent_by_user_id,
    actorName: input.actorName
  });
}

export async function refreshExpiredPofRequests(rows: PofRequestRow[]) {
  const updates = rows
    .filter((row) => isExpired(row.expires_at))
    .filter((row) => {
      const status = toStatus(row.status);
      return status !== "expired" && status !== "signed" && status !== "declined";
    });
  for (const row of updates) {
    await markPofRequestExpired({ request: row, actorName: row.nurse_name });
    row.status = "expired";
  }
}

export async function listPofRequestsByPhysicianOrderIdsWithAdmin(memberId: string, physicianOrderIds: string[]) {
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
  await refreshExpiredPofRequests(rows);
  return rows;
}

export async function getPublicPofSigningContextRuntime(
  token: string,
  metadata: {
    ip?: string | null;
    userAgent?: string | null;
  } | undefined,
  loadPayload: (request: PofRequestRow) => unknown
): Promise<
  | { state: "invalid" }
  | { state: "expired"; request: PofRequestSummary }
  | { state: "declined"; request: PofRequestSummary }
  | { state: "signed"; request: PofRequestSummary }
  | { state: "ready"; request: PofRequestSummary; pofPayload: unknown }
> {
  const normalizedToken = clean(token);
  if (!normalizedToken) return { state: "invalid" };
  const matched = await loadPofRequestByToken(normalizedToken);
  if (!matched) return { state: "invalid" };
  let currentRequest = matched.request;

  const summary = toSummary(currentRequest);
  if (
    isExpired(currentRequest.expires_at) &&
    toStatus(currentRequest.status) !== "expired" &&
    toStatus(currentRequest.status) !== "signed"
  ) {
    await markPofRequestExpired({ request: currentRequest, actorName: currentRequest.nurse_name });
    const expired = await loadPofRequestById(currentRequest.id);
    if (!expired) return { state: "expired", request: summary };
    return { state: "expired", request: toSummary(expired) };
  }

  let status = toStatus(currentRequest.status);
  if (status === "expired") return { state: "expired", request: summary };
  if (status === "declined") return { state: "declined", request: summary };
  if (status === "signed") return { state: "signed", request: summary };

  if (!currentRequest.opened_at) {
    const now = toEasternISO();
    const transition = await markPofRequestDeliveryState({
      requestId: currentRequest.id,
      actor: {
        id: currentRequest.sent_by_user_id,
        fullName: currentRequest.nurse_name
      },
      status: "opened",
      deliveryStatus: toSendWorkflowDeliveryStatus(currentRequest.delivery_status, "sent"),
      sentAt: currentRequest.sent_at,
      openedAt: now,
      signedAt: currentRequest.signed_at,
      deliveryError: null,
      attemptAt: now,
      expectedCurrentStatus: "sent",
      expectedCurrentDeliveryStatus: toSendWorkflowDeliveryStatus(currentRequest.delivery_status, "sent"),
      requireOpenedAtNull: true
    });
    if (transition.didTransition) {
      await createPofDocumentEvent({
        documentId: currentRequest.id,
        memberId: currentRequest.member_id,
        physicianOrderId: currentRequest.physician_order_id,
        eventType: "opened",
        actorType: "provider",
        actorEmail: currentRequest.provider_email,
        actorName: currentRequest.provider_name,
        actorIp: metadata?.ip ?? null,
        actorUserAgent: metadata?.userAgent ?? null
      });
    }

    const refreshedAfterOpenAttempt = await loadPofRequestById(currentRequest.id);
    if (!refreshedAfterOpenAttempt) return { state: "invalid" };
    currentRequest = refreshedAfterOpenAttempt;
    status = toStatus(currentRequest.status);
    if (status === "expired") return { state: "expired", request: toSummary(currentRequest) };
    if (status === "declined") return { state: "declined", request: toSummary(currentRequest) };
    if (status === "signed") return { state: "signed", request: toSummary(currentRequest) };
  }

  let pofPayload: unknown;
  try {
    pofPayload = loadPayload(currentRequest);
  } catch {
    return { state: "invalid" };
  }
  const refreshed = await loadPofRequestById(currentRequest.id);
  if (!refreshed) return { state: "invalid" };
  return { state: "ready", request: toSummary(refreshed), pofPayload };
}
