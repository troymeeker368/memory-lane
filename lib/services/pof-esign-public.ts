import "server-only";

import { recordWorkflowMilestone } from "@/lib/services/lifecycle-milestones";
import {
  deleteMemberDocumentObject,
  nextMemberFileId,
  parseDataUrlPayload,
  parseMemberDocumentStorageUri,
  uploadMemberDocumentObject
} from "@/lib/services/member-files";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";
import {
  loadPublicPofPostSignOutcome,
  maybeCreateSignedPofAccessUrl,
  runBestEffortCommittedPofSignatureFollowUp
} from "@/lib/services/pof-post-sign-runtime";
import {
  clean,
  downloadStorageAssetOrThrow,
  generateSigningToken,
  getPofRuntimeDiagnostics,
  getRequestPayloadSnapshotOrThrow,
  hashToken,
  isExpired,
  isMissingRpcFunctionError,
  parseProviderCredentials,
  toRpcFinalizePofSignatureRow,
  toStatus,
  toSummary,
  type PofRequestRow,
  type PublicPofSigningContext,
  type SubmitPublicPofSignatureInput
} from "@/lib/services/pof-esign-core";
import { recordImmediateSystemAlert, recordWorkflowEvent } from "@/lib/services/workflow-observability";
import {
  createPofDocumentEvent,
  loadPofRequestById,
  loadPofRequestByToken,
  markPofRequestDeliveryState,
  markPofRequestExpired
} from "@/lib/services/pof-request-runtime";
import { toEasternDate, toEasternISO } from "@/lib/timezone";
import { toSendWorkflowDeliveryStatus } from "@/lib/services/send-workflow-state";
import type { PhysicianOrderForm } from "@/lib/services/physician-order-model";

async function recordPofAlertSafely(input: Parameters<typeof recordImmediateSystemAlert>[0], context: string) {
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

async function loadPofDocumentPdfBuilder() {
  const { buildPofDocumentPdfBytes } = await import("@/lib/services/pof-document-pdf");
  return buildPofDocumentPdfBytes;
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
    await recordPofAlertSafely({
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
    }, "cleanupFailedPofSignatureArtifacts");
  }
}

async function buildCommittedPofFinalizeReplayResult(request: PofRequestRow) {
  if (!request.signed_pdf_url || !request.member_file_id) {
    throw new Error("This signature link was already used, but the final signed artifact is missing.");
  }

  const postSign = await loadPublicPofPostSignOutcome(request);
  return {
    requestId: request.id,
    memberId: request.member_id,
    memberFileId: request.member_file_id,
    postSignStatus: postSign.postSignStatus,
    readinessStage: postSign.readinessStage,
    readinessLabel: postSign.readinessLabel,
    retry: postSign.retry,
    actionNeeded: postSign.actionNeeded,
    actionNeededMessage: postSign.actionNeededMessage,
    signedPdfUrl: await maybeCreateSignedPofAccessUrl({
      requestId: request.id,
      memberId: request.member_id,
      actorUserId: request.sent_by_user_id,
      signedPdfStorageUrl: request.signed_pdf_url
    })
  };
}

async function verifyCommittedPofSignatureAfterFinalizeError(input: {
  requestId: string;
  expectedMemberId: string;
  expectedMemberFileId: string;
  expectedSignedPdfStorageUrl: string;
  consumedTokenHash: string;
  actorUserId: string;
  reason: string;
}) {
  const refreshed = await loadPofRequestById(input.requestId);
  if (!refreshed) {
    await recordPofAlertSafely({
      entityType: "pof_request",
      entityId: input.requestId,
      actorUserId: input.actorUserId,
      severity: "high",
      alertKey: "pof_signature_finalize_verification_pending",
      metadata: {
        member_id: input.expectedMemberId,
        reason: input.reason,
        verification_result: "request_missing"
      }
    }, "verifyCommittedPofSignatureAfterFinalizeError");
    return { kind: "unverified" as const, request: null };
  }

  if (refreshed.member_id !== input.expectedMemberId) {
    await recordPofAlertSafely({
      entityType: "pof_request",
      entityId: input.requestId,
      actorUserId: input.actorUserId,
      severity: "high",
      alertKey: "pof_signature_finalize_verification_pending",
      metadata: {
        member_id: input.expectedMemberId,
        refreshed_member_id: refreshed.member_id,
        reason: input.reason,
        verification_result: "member_mismatch"
      }
    }, "verifyCommittedPofSignatureAfterFinalizeError");
    return { kind: "unverified" as const, request: refreshed };
  }

  const requestStatus = toStatus(refreshed.status);
  const matchesExpectedArtifacts =
    refreshed.member_file_id === input.expectedMemberFileId &&
    refreshed.signed_pdf_url === input.expectedSignedPdfStorageUrl;
  if (requestStatus === "signed" && matchesExpectedArtifacts) {
    return { kind: "committed" as const, request: refreshed };
  }

  const tokenConsumed = clean(refreshed.last_consumed_signature_token_hash) === input.consumedTokenHash;
  if (requestStatus !== "signed" && !refreshed.member_file_id && !refreshed.signed_pdf_url && !tokenConsumed) {
    return { kind: "not_committed" as const, request: refreshed };
  }

  await recordPofAlertSafely({
    entityType: "pof_request",
    entityId: input.requestId,
    actorUserId: input.actorUserId,
    severity: "high",
    alertKey: "pof_signature_finalize_verification_pending",
    metadata: {
      member_id: input.expectedMemberId,
      refreshed_status: requestStatus,
      refreshed_member_file_id: refreshed.member_file_id,
      refreshed_signed_pdf_url: refreshed.signed_pdf_url,
      expected_member_file_id: input.expectedMemberFileId,
      expected_signed_pdf_url: input.expectedSignedPdfStorageUrl,
      token_consumed: tokenConsumed,
      reason: input.reason,
      verification_result: "ambiguous"
    }
  }, "verifyCommittedPofSignatureAfterFinalizeError");
  return { kind: "unverified" as const, request: refreshed };
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

export async function getPublicPofSigningContext(
  token: string,
  metadata?: {
    ip?: string | null;
    userAgent?: string | null;
  }
): Promise<PublicPofSigningContext> {
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
  if (status === "signed") {
    const signedRequest = (await loadPofRequestById(currentRequest.id)) ?? currentRequest;
    return {
      state: "signed",
      request: toSummary(signedRequest),
      postSignOutcome: await loadPublicPofPostSignOutcome(signedRequest)
    };
  }

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
    if (status === "signed") {
      return {
        state: "signed",
        request: toSummary(currentRequest),
        postSignOutcome: await loadPublicPofPostSignOutcome(currentRequest)
      };
    }
  }

  let pofPayload: PhysicianOrderForm;
  try {
    pofPayload = getRequestPayloadSnapshotOrThrow(currentRequest);
  } catch {
    return { state: "invalid" };
  }
  const refreshed = await loadPofRequestById(currentRequest.id);
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

  const matched = await loadPofRequestByToken(token);
  if (!matched) throw new Error("This signature link is invalid.");
  const request = matched.request;
  if (matched.tokenMatch === "consumed" && request.status === "signed") {
    return buildCommittedPofFinalizeReplayResult(request);
  }
  if (request.status === "signed") throw new Error("This signature link has already been used.");
  if (request.status === "declined") throw new Error("This signature request was voided.");
  if (request.status === "expired" || isExpired(request.expires_at)) {
    if (request.status !== "expired") {
      await markPofRequestExpired({ request, actorName: request.nurse_name });
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
    const expectedMemberFileId = nextMemberFileId();
    const admin = createSupabaseAdminClient("pof_signature_workflow");
    let finalizedRaw: unknown;
    try {
      finalizedRaw = await invokeSupabaseRpcOrThrow<unknown>(admin, "rpc_finalize_pof_signature", {
        p_request_id: request.id,
        p_provider_typed_name: providerTypedName,
        p_provider_signature_image_url: signatureUri,
        p_provider_ip: clean(input.providerIp),
        p_provider_user_agent: clean(input.providerUserAgent),
        p_signed_pdf_url: signedPdfUri,
        p_member_file_id: expectedMemberFileId,
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
      const reason = error instanceof Error ? error.message : "Unable to complete POF signing.";
      const verification = await verifyCommittedPofSignatureAfterFinalizeError({
        requestId: request.id,
        expectedMemberId: request.member_id,
        expectedMemberFileId,
        expectedSignedPdfStorageUrl: signedPdfUri,
        consumedTokenHash,
        actorUserId: request.sent_by_user_id,
        reason
      });
      if (verification.kind === "committed" && verification.request) {
        return buildCommittedPofFinalizeReplayResult(verification.request);
      }
      if (verification.kind === "not_committed") {
        await cleanupFailedPofSignatureArtifacts({
          requestId: request.id,
          memberId: request.member_id,
          actorUserId: request.sent_by_user_id,
          signatureObjectPath: signaturePath,
          signedPdfObjectPath: signedPdfPath,
          reason
        });
      }
      if (isMissingRpcFunctionError(error, "rpc_finalize_pof_signature")) {
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
      const replayResult = await loadPublicPofPostSignOutcome(request);
      return {
        requestId: finalized.request_id,
        memberId: finalized.member_id,
        memberFileId: finalized.member_file_id,
        postSignStatus: replayResult.postSignStatus,
        readinessStage: replayResult.readinessStage,
        readinessLabel: replayResult.readinessLabel,
        retry: replayResult.retry,
        actionNeeded: replayResult.actionNeeded,
        actionNeededMessage: replayResult.actionNeededMessage,
        signedPdfUrl: await maybeCreateSignedPofAccessUrl({
          requestId: finalized.request_id,
          memberId: finalized.member_id,
          actorUserId: request.sent_by_user_id,
          signedPdfStorageUrl: request.signed_pdf_url
        })
      };
    }

    const postSign = await runBestEffortCommittedPofSignatureFollowUp({
      finalized,
      request,
      signedAt: now
    });
    return {
      requestId: finalized.request_id,
      memberId: finalized.member_id,
      memberFileId: finalized.member_file_id,
      postSignStatus: postSign.postSignStatus,
      readinessStage: postSign.readinessStage,
      readinessLabel: postSign.readinessLabel,
      retry: postSign.retry,
      actionNeeded: postSign.actionNeeded,
      actionNeededMessage: postSign.actionNeededMessage,
      signedPdfUrl: await maybeCreateSignedPofAccessUrl({
        requestId: finalized.request_id,
        memberId: finalized.member_id,
        actorUserId: request.sent_by_user_id,
        signedPdfStorageUrl: signedPdfUri
      })
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
    await recordPofAlertSafely({
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
    }, "submitPublicPofSignature");
    throw error;
  }
}
