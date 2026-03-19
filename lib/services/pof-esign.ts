import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

import {
  getPhysicianOrderById,
  processSignedPhysicianOrderPostSignSync,
  type PhysicianOrderForm
} from "@/lib/services/physician-orders-supabase";
import {
  buildAppBaseUrl,
  clean,
  clonePofPayloadSnapshot,
  createSignedStorageUrl,
  downloadStorageAssetOrThrow,
  generateSigningToken,
  getConfiguredClinicalSenderEmail,
  getPofRuntimeDiagnostics,
  getRequestPayloadSnapshotOrThrow,
  hashToken,
  isEmail,
  isExpired,
  isMissingRpcFunctionError,
  isPostgresUniqueViolation,
  mapPofRequestWriteError,
  parseEmailAddress,
  parseProviderCredentials,
  toIsoAtEndOfDate,
  toRpcFinalizePofSignatureRow,
  toRpcPreparePofRequestDeliveryRow,
  toStatus,
  toSummary,
  type PofRequestRow,
  type PofTokenMatch,
  type PostgrestErrorLike,
  type PublicPofSigningContext,
  type ResendPofSignatureInput,
  type SendPofSignatureInput,
  type SubmitPublicPofSignatureInput,
  type VoidPofSignatureInput
} from "@/lib/services/pof-esign-core";
import { recordWorkflowMilestone } from "@/lib/services/lifecycle-milestones";
import { buildPofSignatureRequestTemplate } from "@/lib/email/templates/pof-signature-request";
import {
  deleteMemberDocumentObject,
  nextMemberFileId,
  parseDataUrlPayload,
  parseMemberDocumentStorageUri,
  uploadMemberDocumentObject
} from "@/lib/services/member-files";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";
import type { PofRequestStatus } from "@/lib/services/pof-types";
import { toEasternDate, toEasternISO } from "@/lib/timezone";
import {
  maybeRecordRepeatedFailureAlert,
  recordImmediateSystemAlert,
  recordWorkflowEvent
} from "@/lib/services/workflow-observability";
import {
  buildRetryableWorkflowDeliveryError,
  throwDeliveryStateFinalizeFailure,
  toSendWorkflowDeliveryStatus,
  type SendWorkflowDeliveryStatus
} from "@/lib/services/send-workflow-state";

export { POF_REQUEST_STATUS_VALUES } from "@/lib/services/pof-types";
export type { PofDocumentEvent, PofRequestStatus, PofRequestSummary } from "@/lib/services/pof-types";
export { getConfiguredClinicalSenderEmail, getPofRuntimeDiagnostics } from "@/lib/services/pof-esign-core";
export type { PublicPofSigningContext } from "@/lib/services/pof-esign-core";
export {
  getPofRequestSummaryById,
  getPofRequestTimeline,
  listPofRequestsByPhysicianOrderIds,
  listPofRequestsForMember,
  listPofTimelineForPhysicianOrder
} from "@/lib/services/pof-read";

const RPC_FINALIZE_POF_SIGNATURE = "rpc_finalize_pof_signature";
const PREPARE_POF_REQUEST_DELIVERY_RPC = "rpc_prepare_pof_request_delivery";
const TRANSITION_POF_REQUEST_DELIVERY_STATE_RPC = "rpc_transition_pof_request_delivery_state";
const POF_DELIVERY_RPC_MIGRATION = "0073_delivery_and_member_file_rpc_hardening.sql";
const POF_DELIVERY_TRANSITION_COMPARE_AND_SET_MIGRATION = "0089_pof_public_open_compare_and_set.sql";

async function createResendClient() {
  const { Resend } = await import("resend");
  return new Resend(process.env.RESEND_API_KEY);
}

async function loadPofDocumentPdfBuilder() {
  const { buildPofDocumentPdfBytes } = await import("@/lib/services/pof-document-pdf");
  return buildPofDocumentPdfBytes;
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

  const resend = await createResendClient();
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

async function loadRequestByToken(token: string): Promise<PofTokenMatch | null> {
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

async function cleanupFailedPofSignatureArtifacts(input: {
  requestId: string;
  memberId: string;
  actorUserId: string;
  signatureObjectPath: string | null;
  signedPdfObjectPath: string | null;
  reason: string;
}) {
  try {
    if (input.signatureObjectPath) {
      await deleteMemberDocumentObject(input.signatureObjectPath);
    }
    if (input.signedPdfObjectPath) {
      await deleteMemberDocumentObject(input.signedPdfObjectPath);
    }
  } catch (cleanupError) {
    await recordImmediateSystemAlert({
      entityType: "pof_request",
      entityId: input.requestId,
      actorUserId: input.actorUserId,
      severity: "high",
      alertKey: "pof_signature_cleanup_failed",
      metadata: {
        member_id: input.memberId,
        error: input.reason,
        cleanup_error: cleanupError instanceof Error ? cleanupError.message : "Unknown cleanup error.",
        signature_object_path: input.signatureObjectPath,
        signed_pdf_object_path: input.signedPdfObjectPath
      }
    });
  }
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
  if (!error) return true;

  console.error("[pof-esign] document event insert failed after committed workflow write", {
    documentId: input.documentId,
    eventType: input.eventType,
    message: error.message
  });
  await recordImmediateSystemAlert({
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
  });
  return false;
}

async function markRequestExpired(input: { request: PofRequestRow; actorName: string }) {
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
  providerName?: string | null;
  updatePhysicianOrderSent?: boolean;
  expectedCurrentStatus?: PofRequestStatus | null;
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
      p_expected_current_status: input.expectedCurrentStatus ?? null
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
    if (isPostgresUniqueViolation(error as PostgrestErrorLike | null | undefined)) {
      throw new Error(mapPofRequestWriteError(error as PostgrestErrorLike, "Unable to update POF request delivery state."));
    }
    throw error;
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
  const buildPofDocumentPdfBytes = await loadPofDocumentPdfBuilder();
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
  if (!providerEmail || !isEmail(providerEmail)) throw new Error("Provider email is invalid.");
  if (!nurseName) throw new Error("Nurse name is required.");
  if (!fromEmail || !isEmail(fromEmail)) throw new Error("From email is invalid.");
  const validatedProviderEmail = providerEmail;
  const validatedNurseName = nurseName;
  const validatedFromEmail = fromEmail;

  const form = clonePofPayloadSnapshot(await assertPhysicianOrderMember(input.physicianOrderId, input.memberId));
  const existing = await listPofRequestsByPhysicianOrderIdsWithAdmin(input.memberId, [input.physicianOrderId]);
  const active = existing.find((row) => toStatus(row.status) === "sent" || toStatus(row.status) === "opened");
  if (active) throw new Error("An active signature request already exists. Use Resend.");

  const now = toEasternISO();
  const expiresAt = toIsoAtEndOfDate(input.expiresOnDate);
  const provisionalRequestId = randomUUID();
  const buildPofDocumentPdfBytes = await loadPofDocumentPdfBuilder();
  const unsignedPdfBytes = await buildPofDocumentPdfBytes({
    form,
    title: "Physician Order Form",
    metaLines: [`Request ID: ${provisionalRequestId}`, "Status: Pending Provider Signature"]
  });
  const unsignedPath = `members/${input.memberId}/pof/${input.physicianOrderId}/requests/${provisionalRequestId}/unsigned.pdf`;
  const unsignedStorageUri = await uploadMemberDocumentObject({
    objectPath: unsignedPath,
    bytes: unsignedPdfBytes,
    contentType: "application/pdf"
  });

  const token = generateSigningToken();
  const hashedToken = hashToken(token);
  const signatureRequestUrl = `${buildAppBaseUrl(input.appBaseUrl)}/sign/pof/${token}`;
  const admin = createSupabaseAdminClient();
  let requestId: string = provisionalRequestId;
  try {
    const prepared = toRpcPreparePofRequestDeliveryRow(
      await invokeSupabaseRpcOrThrow<unknown>(admin, PREPARE_POF_REQUEST_DELIVERY_RPC, {
        p_request_id: provisionalRequestId,
        p_physician_order_id: input.physicianOrderId,
        p_member_id: input.memberId,
        p_provider_name: providerName,
        p_provider_email: providerEmail,
        p_nurse_name: nurseName,
        p_from_email: fromEmail,
        p_sent_by_user_id: input.actor.id,
        p_optional_message: optionalMessage,
        p_expires_at: expiresAt,
        p_signature_request_token: hashedToken,
        p_signature_request_url: signatureRequestUrl,
        p_unsigned_pdf_url: unsignedStorageUri,
        p_pof_payload_json: form,
        p_actor_user_id: input.actor.id,
        p_actor_name: input.actor.fullName,
        p_now: now
      })
    );
    requestId = prepared.request_id;
  } catch (error) {
    const createErrorMessage = error instanceof Error ? error.message : "Unable to create POF signature request.";
    try {
      await deleteMemberDocumentObject(unsignedPath);
    } catch (cleanupError) {
      await recordImmediateSystemAlert({
        entityType: "pof_request",
        entityId: provisionalRequestId,
        actorUserId: input.actor.id,
        severity: "high",
        alertKey: "pof_request_unsigned_pdf_cleanup_failed",
        metadata: {
          member_id: input.memberId,
          physician_order_id: input.physicianOrderId,
          unsigned_object_path: unsignedPath,
          create_error: createErrorMessage,
          cleanup_error: cleanupError instanceof Error ? cleanupError.message : "Unknown cleanup error."
        }
      });
    }
    if (isMissingRpcFunctionError(error, PREPARE_POF_REQUEST_DELIVERY_RPC)) {
      throw new Error(
        `POF request preparation RPC is not available. Apply Supabase migration ${POF_DELIVERY_RPC_MIGRATION} and refresh PostgREST schema cache.`
      );
    }
    throw new Error(mapPofRequestWriteError(error as PostgrestErrorLike, "Unable to create POF signature request."));
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

  try {
    await sendSignatureEmail({
      toEmail: validatedProviderEmail,
      providerName,
      nurseName: validatedNurseName,
      fromEmail: validatedFromEmail,
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
    await recordWorkflowMilestone({
      event: {
        eventType: "pof_request_failed",
        entityType: "pof_request",
        entityId: requestId,
        actorType: "user",
        actorUserId: input.actor.id,
        status: "failed",
        severity: "high",
        metadata: {
          member_id: input.memberId,
          physician_order_id: input.physicianOrderId,
          phase: "delivery",
          error: reason
        }
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
  try {
    await markPofRequestDeliveryState({
      requestId,
      actor: input.actor,
      status: "sent",
      deliveryStatus: "sent",
      sentAt,
      deliveryError: null,
      attemptAt: sentAt,
      providerName,
      updatePhysicianOrderSent: true
    });
  } catch (error) {
    await throwDeliveryStateFinalizeFailure({
      entityType: "pof_request",
      entityId: requestId,
      actorUserId: input.actor.id,
      alertKey: "pof_delivery_state_finalize_failed",
      metadata: {
        member_id: input.memberId,
        physician_order_id: input.physicianOrderId,
        provider_email: providerEmail,
        email_delivery_state: "email_sent_but_sent_state_not_persisted",
        prepared_delivery_status: "ready_to_send",
        error: error instanceof Error ? error.message : "Unable to finalize POF sent state."
      },
      message:
        "POF signature email was delivered, but the sent state could not be finalized. The signature link remains active in Ready to Send state. Review operational alerts before retrying."
    });
  }

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
  try {
    await recordWorkflowMilestone({
      event: {
        event_type: "pof_request_sent",
        entity_type: "pof_request",
        entity_id: requestId,
        actor_type: "user",
        actor_id: input.actor.id,
        actor_user_id: input.actor.id,
        status: "sent",
        severity: "low",
        metadata: {
          member_id: input.memberId,
          physician_order_id: input.physicianOrderId,
          provider_email: providerEmail,
          sent_at: sentAt
        }
      }
    });
  } catch (error) {
    console.error("[pof-esign] unable to emit post-send workflow milestone", error);
  }

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
  if (!providerEmail || !isEmail(providerEmail)) throw new Error("Provider email is invalid.");
  if (!nurseName) throw new Error("Nurse name is required.");
  if (!fromEmail || !isEmail(fromEmail)) throw new Error("From email is invalid.");

  const form = clonePofPayloadSnapshot(await assertPhysicianOrderMember(request.physician_order_id, input.memberId));
  const expiresAt = toIsoAtEndOfDate(input.expiresOnDate);
  const token = generateSigningToken();
  const hashedToken = hashToken(token);
  const signatureRequestUrl = `${buildAppBaseUrl(input.appBaseUrl)}/sign/pof/${token}`;

  const buildPofDocumentPdfBytes = await loadPofDocumentPdfBuilder();
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
  try {
    await invokeSupabaseRpcOrThrow<unknown>(admin, PREPARE_POF_REQUEST_DELIVERY_RPC, {
      p_request_id: input.requestId,
      p_physician_order_id: request.physician_order_id,
      p_member_id: input.memberId,
      p_provider_name: providerName,
      p_provider_email: providerEmail,
      p_nurse_name: nurseName,
      p_from_email: fromEmail,
      p_sent_by_user_id: input.actor.id,
      p_optional_message: optionalMessage,
      p_expires_at: expiresAt,
      p_signature_request_token: hashedToken,
      p_signature_request_url: signatureRequestUrl,
      p_unsigned_pdf_url: unsignedStorageUri,
      p_pof_payload_json: form,
      p_actor_user_id: input.actor.id,
      p_actor_name: input.actor.fullName,
      p_now: preSendUpdatedAt
    });
  } catch (error) {
    if (isMissingRpcFunctionError(error, PREPARE_POF_REQUEST_DELIVERY_RPC)) {
      throw new Error(
        `POF request preparation RPC is not available. Apply Supabase migration ${POF_DELIVERY_RPC_MIGRATION} and refresh PostgREST schema cache.`
      );
    }
    throw new Error(mapPofRequestWriteError(error as PostgrestErrorLike, "Unable to prepare POF resend request."));
  }

  try {
    await sendSignatureEmail({
      toEmail: providerEmail,
      providerName,
      nurseName,
      fromEmail,
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
    await recordWorkflowMilestone({
      event: {
        eventType: "pof_request_failed",
        entityType: "pof_request",
        entityId: input.requestId,
        actorType: "user",
        actorUserId: input.actor.id,
        status: "failed",
        severity: "high",
        metadata: {
          member_id: request.member_id,
          physician_order_id: request.physician_order_id,
          phase: "delivery",
          error: reason
        }
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
  try {
    await markPofRequestDeliveryState({
      requestId: input.requestId,
      actor: input.actor,
      status: "sent",
      deliveryStatus: "sent",
      sentAt: now,
      openedAt: null,
      signedAt: null,
      deliveryError: null,
      attemptAt: now,
      providerName,
      updatePhysicianOrderSent: true
    });
  } catch (error) {
    await throwDeliveryStateFinalizeFailure({
      entityType: "pof_request",
      entityId: input.requestId,
      actorUserId: input.actor.id,
      alertKey: "pof_delivery_state_finalize_failed",
      metadata: {
        member_id: request.member_id,
        physician_order_id: request.physician_order_id,
        provider_email: providerEmail,
        email_delivery_state: "email_sent_but_sent_state_not_persisted",
        prepared_delivery_status: "ready_to_send",
        error: error instanceof Error ? error.message : "Unable to finalize resent POF state."
      },
      message:
        "POF signature email was delivered, but the sent state could not be finalized. The signature link remains active in Ready to Send state. Review operational alerts before retrying."
    });
  }

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
  try {
    await recordWorkflowMilestone({
      event: {
        event_type: "pof_request_sent",
        entity_type: "pof_request",
        entity_id: input.requestId,
        actor_type: "user",
        actor_id: input.actor.id,
        actor_user_id: input.actor.id,
        status: "sent",
        severity: "low",
        metadata: {
          member_id: request.member_id,
          physician_order_id: request.physician_order_id,
          provider_email: providerEmail,
          resent_at: now
        }
      }
    });
  } catch (error) {
    console.error("[pof-esign] unable to emit post-resend workflow milestone", error);
  }

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
  await markPofRequestDeliveryState({
    requestId: input.requestId,
    actor: input.actor,
    status: "declined",
    deliveryStatus: toSendWorkflowDeliveryStatus(request.delivery_status, "sent"),
    sentAt: request.sent_at,
    openedAt: request.opened_at,
    signedAt: request.signed_at,
    deliveryError: null,
    attemptAt: now
  });

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
  const matched = await loadRequestByToken(normalizedToken);
  if (!matched) return { state: "invalid" };
  let currentRequest = matched.request;

  const summary = toSummary(currentRequest);
  if (
    isExpired(currentRequest.expires_at) &&
    toStatus(currentRequest.status) !== "expired" &&
    toStatus(currentRequest.status) !== "signed"
  ) {
    await markRequestExpired({ request: currentRequest, actorName: currentRequest.nurse_name });
    const expired = await loadRequestById(currentRequest.id);
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
      expectedCurrentStatus: "sent"
    });
    if (transition.didTransition) {
      await createDocumentEvent({
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

    const refreshedAfterOpenAttempt = await loadRequestById(currentRequest.id);
    if (!refreshedAfterOpenAttempt) return { state: "invalid" };
    currentRequest = refreshedAfterOpenAttempt;
    status = toStatus(currentRequest.status);
    if (status === "expired") return { state: "expired", request: toSummary(currentRequest) };
    if (status === "declined") return { state: "declined", request: toSummary(currentRequest) };
    if (status === "signed") return { state: "signed", request: toSummary(currentRequest) };
  }

  let pofPayload: PhysicianOrderForm;
  try {
    pofPayload = getRequestPayloadSnapshotOrThrow(currentRequest);
  } catch {
    return { state: "invalid" };
  }
  const refreshed = await loadRequestById(currentRequest.id);
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

  const matched = await loadRequestByToken(token);
  if (!matched) throw new Error("This signature link is invalid.");
  const request = matched.request;
  if (matched.tokenMatch === "consumed" && request.status === "signed") {
    if (!request.signed_pdf_url || !request.member_file_id) {
      throw new Error("This signature link was already used, but the final signed artifact is missing.");
    }
    return {
      requestId: request.id,
      memberId: request.member_id,
      memberFileId: request.member_file_id,
      signedPdfUrl: await createSignedStorageUrl(request.signed_pdf_url, 60 * 15)
    };
  }
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
      providerTypedName,
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
    const consumedTokenHash = hashToken(token);
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
        p_signature_metadata: signatureMetadata,
        p_consumed_signature_token_hash: consumedTokenHash
      });
    } catch (error) {
      await cleanupFailedPofSignatureArtifacts({
        requestId: request.id,
        memberId: request.member_id,
        actorUserId: request.sent_by_user_id,
        signatureObjectPath: signaturePath,
        signedPdfObjectPath: signedPdfPath,
        reason: error instanceof Error ? error.message : "Unable to complete POF signing."
      });
      if (isMissingRpcFunctionError(error, RPC_FINALIZE_POF_SIGNATURE)) {
        throw new Error(
          "POF signing finalization RPC is not available. Apply Supabase migration 0053_artifact_drift_replay_hardening.sql and refresh PostgREST schema cache."
        );
      }
      throw error;
    }
    const finalized = toRpcFinalizePofSignatureRow(finalizedRaw);

    if (finalized.was_already_signed) {
      await cleanupFailedPofSignatureArtifacts({
        requestId: request.id,
        memberId: request.member_id,
        actorUserId: request.sent_by_user_id,
        signatureObjectPath: signaturePath,
        signedPdfObjectPath: signedPdfPath,
        reason: "Replay-safe POF signature finalization reused committed signed state."
      });
      const signedRequest = await loadRequestById(finalized.request_id);
      if (!signedRequest?.signed_pdf_url || !signedRequest.member_file_id) {
        throw new Error("POF signature was already finalized, but the signed document could not be loaded.");
      }
      return {
        requestId: finalized.request_id,
        memberId: finalized.member_id,
        memberFileId: signedRequest.member_file_id,
        signedPdfUrl: await createSignedStorageUrl(signedRequest.signed_pdf_url, 60 * 15)
      };
    }

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
    await recordWorkflowMilestone({
      event: {
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
