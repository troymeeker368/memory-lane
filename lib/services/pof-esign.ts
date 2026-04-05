import { randomUUID as cryptoRandomUUID } from "node:crypto";

import { getPhysicianOrderById } from "@/lib/services/physician-orders-read";
import {
  buildAppBaseUrl,
  clean,
  clonePofPayloadSnapshot,
  createSignedStorageUrl,
  generateSigningToken,
  getConfiguredClinicalSenderEmail,
  getPofRuntimeDiagnostics,
  hashToken,
  isEmail,
  isMissingRpcFunctionError,
  mapPofRequestWriteError,
  parseEmailAddress,
  toIsoAtEndOfDate,
  toRpcPreparePofRequestDeliveryRow,
  toStatus,
  toSummary,
  type PostgrestErrorLike,
  type ResendPofSignatureInput,
  type SendPofSignatureInput,
  type VoidPofSignatureInput
} from "@/lib/services/pof-esign-core";
import { recordWorkflowMilestone } from "@/lib/services/lifecycle-milestones";
import { buildPofSignatureRequestTemplate } from "@/lib/email/templates/pof-signature-request";
import {
  deleteMemberDocumentObject,
  uploadMemberDocumentObject
} from "@/lib/services/member-files";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";
import {
  buildPofRequestSummary,
  createPofDocumentEvent,
  listPofRequestsByPhysicianOrderIdsWithAdmin,
  loadPofRequestById,
  markPofRequestDeliveryState
} from "@/lib/services/pof-request-runtime";
import { toEasternISO } from "@/lib/timezone";
import {
  maybeRecordRepeatedFailureAlert,
  recordImmediateSystemAlert,
  recordWorkflowEvent
} from "@/lib/services/workflow-observability";
import {
  buildRetryableWorkflowDeliveryError,
  throwDeliveryStateFinalizeFailure,
  toSendWorkflowDeliveryStatus
} from "@/lib/services/send-workflow-state";

export { POF_REQUEST_STATUS_VALUES } from "@/lib/services/pof-types";
export type { PofDocumentEvent, PofRequestStatus, PofRequestSummary } from "@/lib/services/pof-types";
export { getConfiguredClinicalSenderEmail, getPofRuntimeDiagnostics } from "@/lib/services/pof-esign-core";
export {
  getPofRequestSummaryById,
  getPofRequestTimeline,
  listPofRequestsByPhysicianOrderIds,
  listPofRequestsForMember,
  listPofTimelineForPhysicianOrder
} from "@/lib/services/pof-read";

const PREPARE_POF_REQUEST_DELIVERY_RPC = "rpc_prepare_pof_request_delivery";
const POF_DELIVERY_RPC_MIGRATION = "0073_delivery_and_member_file_rpc_hardening.sql";

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
  const provisionalRequestId = cryptoRandomUUID();
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
  const admin = createSupabaseAdminClient("pof_signature_workflow");
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
      await recordPofAlertSafely({
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
      }, "sendNewPofSignatureRequest.cleanupUnsignedPdf");
    }
    if (isMissingRpcFunctionError(error, PREPARE_POF_REQUEST_DELIVERY_RPC)) {
      throw new Error(
        `POF request preparation RPC is not available. Apply Supabase migration ${POF_DELIVERY_RPC_MIGRATION} and refresh PostgREST schema cache.`
      );
    }
    throw new Error(mapPofRequestWriteError(error as PostgrestErrorLike, "Unable to create POF signature request."));
  }

  await createPofDocumentEvent({
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
    await createPofDocumentEvent({
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

  await createPofDocumentEvent({
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

  return buildPofRequestSummary({
    id: requestId,
    physicianOrderId: input.physicianOrderId,
    memberId: input.memberId,
    providerName,
    providerEmail,
    nurseName,
    fromEmail,
    sentByUserId: input.actor.id,
    status: "sent",
    deliveryStatus: "sent",
    deliveryError: null,
    lastDeliveryAttemptAt: sentAt,
    deliveryFailedAt: null,
    optionalMessage,
    sentAt,
    openedAt: null,
    signedAt: null,
    expiresAt,
    signatureRequestUrl,
    unsignedPdfUrl: unsignedStorageUri,
    signedPdfUrl: null,
    memberFileId: null,
    createdAt: now,
    updatedAt: sentAt
  });
}

export async function resendPofSignatureRequest(input: ResendPofSignatureInput) {
  assertPofRuntimeDiagnostics({
    context: "resend-request",
    requireResend: true
  });
  const request = await loadPofRequestById(input.requestId);
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
  const admin = createSupabaseAdminClient("pof_signature_workflow");
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
    await createPofDocumentEvent({
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

  await createPofDocumentEvent({
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

  return buildPofRequestSummary({
    id: input.requestId,
    physicianOrderId: request.physician_order_id,
    memberId: request.member_id,
    providerName,
    providerEmail,
    nurseName,
    fromEmail,
    sentByUserId: input.actor.id,
    status: "sent",
    deliveryStatus: "sent",
    deliveryError: null,
    lastDeliveryAttemptAt: now,
    deliveryFailedAt: null,
    optionalMessage,
    sentAt: now,
    openedAt: null,
    signedAt: null,
    expiresAt,
    signatureRequestUrl,
    unsignedPdfUrl: unsignedStorageUri,
    signedPdfUrl: request.signed_pdf_url,
    memberFileId: request.member_file_id,
    createdAt: request.created_at,
    updatedAt: now
  });
}

export async function voidPofSignatureRequest(input: VoidPofSignatureInput) {
  const request = await loadPofRequestById(input.requestId);
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

  await createPofDocumentEvent({
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

  const refreshed = await loadPofRequestById(input.requestId);
  if (!refreshed) throw new Error("POF signature request could not be loaded.");
  return toSummary(refreshed);
}

export async function getSignedPofPdfUrlForMember(input: { requestId: string; memberId: string }) {
  const request = await loadPofRequestById(input.requestId);
  if (!request) throw new Error("POF signature request was not found.");
  if (request.member_id !== input.memberId) throw new Error("Request/member mismatch.");
  if (toStatus(request.status) !== "signed") throw new Error("Signed PDF is not available for this request.");
  if (!request.signed_pdf_url) throw new Error("Signed PDF storage path is missing.");
  return createSignedStorageUrl(request.signed_pdf_url, 60 * 15);
}

export async function getUnsignedPofPdfUrlForMember(input: { requestId: string; memberId: string }) {
  const request = await loadPofRequestById(input.requestId);
  if (!request) throw new Error("POF signature request was not found.");
  if (request.member_id !== input.memberId) throw new Error("Request/member mismatch.");
  if (!request.unsigned_pdf_url) throw new Error("Unsigned PDF storage path is missing.");
  return createSignedStorageUrl(request.unsigned_pdf_url, 60 * 15);
}
