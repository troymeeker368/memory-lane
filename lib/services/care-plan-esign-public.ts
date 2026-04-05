import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { toEasternISO } from "@/lib/timezone";
import { buildCarePlanPdfDataUrl } from "@/lib/services/care-plan-pdf";
import { resolvePublicCaregiverLinkState } from "@/lib/services/care-plan-esign-rules";
import { buildCarePlanPublicCompletionOutcome } from "@/lib/services/care-plan-post-sign-readiness";
import { getCarePlanById, type CaregiverSignatureStatus } from "@/lib/services/care-plans";
import {
  buildDatedPdfFileName,
  deleteMemberDocumentObject,
  parseDataUrlPayload,
  parseMemberDocumentStorageUri,
  uploadMemberDocumentObject
} from "@/lib/services/member-files";
import { recordWorkflowMilestone } from "@/lib/services/lifecycle-milestones";
import {
  recordWorkflowEvent
} from "@/lib/services/workflow-observability";
import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";
import {
  createCarePlanSignatureEvent,
  recordCarePlanAlertSafely,
  transitionCarePlanCaregiverStatus
} from "@/lib/services/care-plan-esign";
import { markCarePlanPostSignReady as markCarePlanPostSignReadyWorkflow } from "@/lib/services/care-plans-supabase";

const TOKEN_BYTE_LENGTH = 32;
const CARE_PLAN_CAREGIVER_FINALIZATION_RPC = "rpc_finalize_care_plan_caregiver_signature";
const CARE_PLAN_CAREGIVER_FINALIZATION_MIGRATION = "0053_artifact_drift_replay_hardening.sql";

type CarePlanTokenMatch = {
  carePlan: {
    id: string;
    member_id: string;
    caregiver_signature_status: CaregiverSignatureStatus;
    caregiver_signature_expires_at: string | null;
  };
  tokenMatch: "active" | "consumed";
};

type CarePlanCaregiverFinalizeRpcRow = {
  care_plan_id: string;
  member_id: string;
  final_member_file_id: string;
  was_already_signed: boolean;
};

export type PublicCarePlanSigningContext =
  | { state: "invalid" }
  | { state: "expired"; carePlan: NonNullable<Awaited<ReturnType<typeof getCarePlanById>>>["carePlan"] }
  | {
      state: "completed";
      carePlan: NonNullable<Awaited<ReturnType<typeof getCarePlanById>>>["carePlan"];
      completedOutcome: ReturnType<typeof buildCarePlanPublicCompletionOutcome>;
    }
  | { state: "ready"; detail: NonNullable<Awaited<ReturnType<typeof getCarePlanById>>> };

export type SubmitPublicCarePlanSignatureInput = {
  token: string;
  caregiverTypedName: string;
  signatureImageDataUrl: string;
  attested: boolean;
  caregiverIp: string | null;
  caregiverUserAgent: string | null;
};

function clean(value: string | null | undefined) {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function generateSigningToken() {
  return randomBytes(TOKEN_BYTE_LENGTH).toString("hex");
}

function isMissingRpcFunctionError(error: unknown, functionName: string) {
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

function isCarePlanStatusTransitionRaceError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return message.includes("expected current status") || message.includes("cannot move backward");
}

async function loadCarePlanStatusById(carePlanId: string): Promise<CaregiverSignatureStatus | null> {
  const admin = createSupabaseAdminClient("care_plan_signature_workflow");
  const { data, error } = await admin
    .from("care_plans")
    .select("caregiver_signature_status")
    .eq("id", carePlanId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return clean(data?.caregiver_signature_status) as CaregiverSignatureStatus | null;
}

async function loadCarePlanRowByToken(token: string): Promise<CarePlanTokenMatch | null> {
  const hashed = hashToken(token);
  const admin = createSupabaseAdminClient("care_plan_signature_workflow");
  const { data, error } = await admin
    .from("care_plans")
    .select("id, member_id, caregiver_signature_status, caregiver_signature_expires_at")
    .eq("caregiver_signature_request_token", hashed)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data) {
    return {
      carePlan: data as {
        id: string;
        member_id: string;
        caregiver_signature_status: CaregiverSignatureStatus;
        caregiver_signature_expires_at: string | null;
      },
      tokenMatch: "active"
    };
  }

  const { data: consumedData, error: consumedError } = await admin
    .from("care_plans")
    .select("id, member_id, caregiver_signature_status, caregiver_signature_expires_at")
    .eq("last_consumed_caregiver_signature_token_hash", hashed)
    .maybeSingle();
  if (consumedError) throw new Error(consumedError.message);
  if (!consumedData) return null;
  return {
    carePlan: consumedData as {
      id: string;
      member_id: string;
      caregiver_signature_status: CaregiverSignatureStatus;
      caregiver_signature_expires_at: string | null;
    },
    tokenMatch: "consumed"
  };
}

async function markExpiredIfNeeded(input: {
  carePlanId: string;
  memberId: string;
  status: CaregiverSignatureStatus;
  expiresAt: string | null;
}) {
  if (input.status === "signed" || input.status === "expired") return input.status;
  if (resolvePublicCaregiverLinkState({ status: input.status, expiresAt: input.expiresAt }) !== "expired") {
    return input.status;
  }

  const now = toEasternISO();
  try {
    await transitionCarePlanCaregiverStatus({
      carePlanId: input.carePlanId,
      status: "expired",
      updatedAt: now,
      expectedCurrentStatuses: ["ready_to_send", "send_failed", "sent", "viewed"]
    });
  } catch (error) {
    if (!isCarePlanStatusTransitionRaceError(error)) throw error;
    const refreshedStatus = await loadCarePlanStatusById(input.carePlanId);
    if (refreshedStatus) return refreshedStatus;
    return input.status;
  }
  await createCarePlanSignatureEvent({
    carePlanId: input.carePlanId,
    memberId: input.memberId,
    eventType: "expired",
    actorType: "system"
  });
  return "expired" as const;
}

async function invokeFinalizeCarePlanCaregiverSignatureRpc(input: {
  carePlanId: string;
  rotatedToken: string;
  consumedTokenHash: string;
  signedAt: string;
  updatedAt: string;
  finalMemberFileId: string;
  finalMemberFileName: string;
  finalMemberFileDataUrl: string;
  finalMemberFileStorageObjectPath: string | null;
  uploadedByUserId: string | null;
  uploadedByName: string | null;
  actorName: string;
  actorEmail: string | null;
  actorIp: string | null;
  actorUserAgent: string | null;
  signatureImageUrl: string;
}) {
  const admin = createSupabaseAdminClient("care_plan_signature_workflow");
  try {
    const data = await invokeSupabaseRpcOrThrow<unknown>(admin, CARE_PLAN_CAREGIVER_FINALIZATION_RPC, {
      p_care_plan_id: input.carePlanId,
      p_rotated_token: input.rotatedToken,
      p_consumed_signature_token_hash: input.consumedTokenHash,
      p_signed_at: input.signedAt,
      p_updated_at: input.updatedAt,
      p_final_member_file_id: input.finalMemberFileId,
      p_final_member_file_name: input.finalMemberFileName,
      p_final_member_file_data_url: input.finalMemberFileDataUrl,
      p_final_member_file_storage_object_path: input.finalMemberFileStorageObjectPath,
      p_uploaded_by_user_id: input.uploadedByUserId,
      p_uploaded_by_name: input.uploadedByName,
      p_actor_name: input.actorName,
      p_actor_email: input.actorEmail,
      p_actor_ip: input.actorIp,
      p_actor_user_agent: input.actorUserAgent,
      p_signature_image_url: input.signatureImageUrl,
      p_metadata: {
        finalMemberFileId: input.finalMemberFileId,
        signatureImageUrl: input.signatureImageUrl
      }
    });
    const row = (Array.isArray(data) ? data[0] : null) as CarePlanCaregiverFinalizeRpcRow | null;
    if (!row?.care_plan_id || !row?.member_id || !row?.final_member_file_id) {
      throw new Error("Care plan caregiver finalization RPC did not return expected identifiers.");
    }
    return {
      carePlanId: row.care_plan_id,
      memberId: row.member_id,
      finalMemberFileId: row.final_member_file_id,
      wasAlreadySigned: Boolean(row.was_already_signed)
    };
  } catch (error) {
    if (isMissingRpcFunctionError(error, CARE_PLAN_CAREGIVER_FINALIZATION_RPC)) {
      throw new Error(
        `Care plan caregiver finalization RPC is not available yet. Apply Supabase migration ${CARE_PLAN_CAREGIVER_FINALIZATION_MIGRATION} first.`
      );
    }
    throw error;
  }
}

async function cleanupFailedCarePlanCaregiverArtifacts(input: {
  carePlanId: string;
  actorUserId: string | null;
  memberId: string;
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
    await recordCarePlanAlertSafely({
      entityType: "care_plan",
      entityId: input.carePlanId,
      actorUserId: input.actorUserId,
      severity: "high",
      alertKey: "care_plan_signature_cleanup_failed",
      metadata: {
        member_id: input.memberId,
        error: input.reason,
        cleanup_error: cleanupError instanceof Error ? cleanupError.message : "Unknown cleanup error.",
        signature_object_path: input.signatureObjectPath,
        signed_pdf_object_path: input.signedPdfObjectPath
      }
    }, "cleanupFailedCarePlanCaregiverArtifacts");
  }
}

async function requireCommittedSignedCarePlan(input: {
  carePlanId: string;
  expectedMemberId: string;
  expectedFinalMemberFileId?: string | null;
}) {
  const detail = await getCarePlanById(input.carePlanId, { serviceRole: true });
  if (!detail) {
    throw new Error("Care plan could not be reloaded after caregiver signature finalization.");
  }
  if (detail.carePlan.memberId !== input.expectedMemberId) {
    throw new Error("Care plan caregiver signature finalized against the wrong member.");
  }
  if (!detail.carePlan.finalMemberFileId) {
    throw new Error("Final signed care plan member file is missing.");
  }
  if (
    clean(input.expectedFinalMemberFileId) &&
    detail.carePlan.finalMemberFileId !== clean(input.expectedFinalMemberFileId)
  ) {
    throw new Error("Final signed care plan member file drifted after caregiver signature finalization.");
  }
  if (detail.carePlan.caregiverSignatureStatus !== "signed") {
    throw new Error("Caregiver signature state did not finalize to signed.");
  }
  return detail;
}

function buildCommittedCarePlanSubmitResult(input: {
  detail: NonNullable<Awaited<ReturnType<typeof getCarePlanById>>>;
  finalMemberFileId?: string | null;
}) {
  const finalMemberFileId = clean(input.finalMemberFileId) ?? clean(input.detail.carePlan.finalMemberFileId);
  if (!finalMemberFileId) {
    throw new Error("Final signed care plan member file is missing.");
  }

  const completedOutcome = buildCarePlanPublicCompletionOutcome(input.detail.carePlan.postSignReadinessStatus);
  return {
    carePlanId: input.detail.carePlan.id,
    memberId: input.detail.carePlan.memberId,
    finalMemberFileId,
    readinessStage: completedOutcome.readinessStage,
    readinessLabel: completedOutcome.readinessLabel,
    actionNeeded: completedOutcome.actionNeeded,
    actionNeededMessage: completedOutcome.actionNeededMessage
  };
}

async function buildCommittedCarePlanPostCommitFollowUpResult(input: {
  carePlanId: string;
  memberId: string;
  finalMemberFileId: string;
  fallbackPostSignReadinessStatus: NonNullable<Awaited<ReturnType<typeof getCarePlanById>>>["carePlan"]["postSignReadinessStatus"];
}) {
  try {
    const refreshed = await getCarePlanById(input.carePlanId, { serviceRole: true });
    if (
      refreshed &&
      refreshed.carePlan.memberId === input.memberId &&
      clean(refreshed.carePlan.finalMemberFileId) === input.finalMemberFileId &&
      refreshed.carePlan.caregiverSignatureStatus === "signed" &&
      refreshed.carePlan.postSignReadinessStatus !== "ready"
    ) {
      return buildCommittedCarePlanSubmitResult({
        detail: refreshed,
        finalMemberFileId: input.finalMemberFileId
      });
    }
  } catch (error) {
    console.error("[care-plan-esign] unable to reload committed care plan after post-sign follow-up failure", {
      carePlanId: input.carePlanId,
      message: error instanceof Error ? error.message : "Unknown care plan reload error."
    });
  }

  const completedOutcome = buildCarePlanPublicCompletionOutcome(input.fallbackPostSignReadinessStatus);
  return {
    carePlanId: input.carePlanId,
    memberId: input.memberId,
    finalMemberFileId: input.finalMemberFileId,
    readinessStage: completedOutcome.readinessStage,
    readinessLabel: completedOutcome.readinessLabel,
    actionNeeded: true,
    actionNeededMessage:
      completedOutcome.actionNeededMessage ??
      "This care plan was signed, but post-sign follow-up still needs staff attention."
  };
}

async function verifyCommittedCarePlanCaregiverSignatureAfterFinalizeError(input: {
  carePlanId: string;
  expectedMemberId: string;
  expectedFinalMemberFileId: string;
  actorUserId: string | null;
  reason: string;
}) {
  const detail = await getCarePlanById(input.carePlanId, { serviceRole: true });
  if (!detail) {
    await recordCarePlanAlertSafely({
      entityType: "care_plan",
      entityId: input.carePlanId,
      actorUserId: input.actorUserId,
      severity: "high",
      alertKey: "care_plan_signature_finalize_verification_pending",
      metadata: {
        member_id: input.expectedMemberId,
        reason: input.reason,
        verification_result: "care_plan_missing"
      }
    }, "verifyCommittedCarePlanCaregiverSignatureAfterFinalizeError");
    return { kind: "unverified" as const, detail: null };
  }

  if (detail.carePlan.memberId !== input.expectedMemberId) {
    await recordCarePlanAlertSafely({
      entityType: "care_plan",
      entityId: input.carePlanId,
      actorUserId: input.actorUserId,
      severity: "high",
      alertKey: "care_plan_signature_finalize_verification_pending",
      metadata: {
        member_id: input.expectedMemberId,
        refreshed_member_id: detail.carePlan.memberId,
        reason: input.reason,
        verification_result: "member_mismatch"
      }
    }, "verifyCommittedCarePlanCaregiverSignatureAfterFinalizeError");
    return { kind: "unverified" as const, detail };
  }

  const finalMemberFileId = clean(detail.carePlan.finalMemberFileId);
  if (
    detail.carePlan.caregiverSignatureStatus === "signed" &&
    finalMemberFileId &&
    finalMemberFileId === input.expectedFinalMemberFileId
  ) {
    return { kind: "committed" as const, detail };
  }

  if (
    detail.carePlan.caregiverSignatureStatus !== "signed" &&
    finalMemberFileId !== input.expectedFinalMemberFileId
  ) {
    return { kind: "not_committed" as const, detail };
  }

  await recordCarePlanAlertSafely({
    entityType: "care_plan",
    entityId: input.carePlanId,
    actorUserId: input.actorUserId,
    severity: "high",
    alertKey: "care_plan_signature_finalize_verification_pending",
    metadata: {
      member_id: input.expectedMemberId,
      refreshed_status: detail.carePlan.caregiverSignatureStatus,
      refreshed_final_member_file_id: finalMemberFileId,
      expected_final_member_file_id: input.expectedFinalMemberFileId,
      reason: input.reason,
      verification_result: "ambiguous"
    }
  }, "verifyCommittedCarePlanCaregiverSignatureAfterFinalizeError");
  return { kind: "unverified" as const, detail };
}

export async function getPublicCarePlanSigningContext(
  token: string,
  metadata?: { ip?: string | null; userAgent?: string | null }
): Promise<PublicCarePlanSigningContext> {
  const normalizedToken = clean(token);
  if (!normalizedToken) return { state: "invalid" };
  const tokenMatch = await loadCarePlanRowByToken(normalizedToken);
  if (!tokenMatch) return { state: "invalid" };
  const tokenRow = tokenMatch.carePlan;

  const resolvedStatus = await markExpiredIfNeeded({
    carePlanId: tokenRow.id,
    memberId: tokenRow.member_id,
    status: tokenRow.caregiver_signature_status,
    expiresAt: tokenRow.caregiver_signature_expires_at
  });
  const linkState = resolvePublicCaregiverLinkState({
    status: resolvedStatus,
    expiresAt: tokenRow.caregiver_signature_expires_at
  });

  const detail = await getCarePlanById(tokenRow.id, { serviceRole: true });
  if (!detail) return { state: "invalid" };
  if (linkState === "expired") return { state: "expired", carePlan: detail.carePlan };
  if (linkState === "completed") {
    return {
      state: "completed",
      carePlan: detail.carePlan,
      completedOutcome: buildCarePlanPublicCompletionOutcome(detail.carePlan.postSignReadinessStatus)
    };
  }
  if (linkState !== "ready") return { state: "invalid" };

  if (!detail.carePlan.caregiverViewedAt) {
    const now = toEasternISO();
    try {
      await transitionCarePlanCaregiverStatus({
        carePlanId: detail.carePlan.id,
        status: "viewed",
        updatedAt: now,
        caregiverSentAt: detail.carePlan.caregiverSentAt,
        caregiverViewedAt: now,
        expectedCurrentStatuses: ["sent"]
      });
      await createCarePlanSignatureEvent({
        carePlanId: detail.carePlan.id,
        memberId: detail.carePlan.memberId,
        eventType: "opened",
        actorType: "caregiver",
        actorEmail: detail.carePlan.caregiverEmail,
        actorName: detail.carePlan.caregiverName,
        actorIp: metadata?.ip ?? null,
        actorUserAgent: metadata?.userAgent ?? null
      });
    } catch (error) {
      if (!isCarePlanStatusTransitionRaceError(error)) throw error;
    }
  }

  const refreshed = await getCarePlanById(tokenRow.id, { serviceRole: true });
  if (!refreshed) return { state: "invalid" };
  return { state: "ready", detail: refreshed };
}

export async function submitPublicCarePlanSignature(input: SubmitPublicCarePlanSignatureInput) {
  const token = clean(input.token);
  const caregiverTypedName = clean(input.caregiverTypedName);
  if (!token) throw new Error("Signature token is required.");
  if (!caregiverTypedName) throw new Error("Typed caregiver name is required.");
  if (!input.attested) throw new Error("Attestation is required before signing.");

  const signature = parseDataUrlPayload(input.signatureImageDataUrl);
  if (!signature.contentType.startsWith("image/")) {
    throw new Error("Signature image format is invalid.");
  }

  const tokenMatch = await loadCarePlanRowByToken(token);
  if (!tokenMatch) throw new Error("This signature link is invalid.");
  const tokenRow = tokenMatch.carePlan;
  if (tokenMatch.tokenMatch === "consumed" && tokenRow.caregiver_signature_status === "signed") {
    const signedDetail = await getCarePlanById(tokenRow.id, { serviceRole: true });
    if (!signedDetail?.carePlan.finalMemberFileId) {
      throw new Error("This signature link was already used, but the final care plan file is missing.");
    }
    return buildCommittedCarePlanSubmitResult({
      detail: signedDetail,
      finalMemberFileId: signedDetail.carePlan.finalMemberFileId
    });
  }
  const status = await markExpiredIfNeeded({
    carePlanId: tokenRow.id,
    memberId: tokenRow.member_id,
    status: tokenRow.caregiver_signature_status,
    expiresAt: tokenRow.caregiver_signature_expires_at
  });
  if (status === "expired") throw new Error("This signature link has expired.");
  if (status === "signed") throw new Error("This signature link has already been used.");
  if (status !== "sent" && status !== "viewed") throw new Error("This signature link is not active.");

  let detail = await getCarePlanById(tokenRow.id, { serviceRole: true });
  if (!detail) throw new Error("Care plan was not found.");

  const now = toEasternISO();
  const signaturePath = `members/${detail.carePlan.memberId}/care-plans/${detail.carePlan.id}/caregiver-signature.png`;
  const signatureUri = await uploadMemberDocumentObject({
    objectPath: signaturePath,
    bytes: signature.bytes,
    contentType: signature.contentType
  });

  const signedPdfStoragePath = `members/${detail.carePlan.memberId}/care-plans/${detail.carePlan.id}/final-signed.pdf`;
  const expectedFinalMemberFileId = detail.carePlan.finalMemberFileId ?? `mf_${randomUUID().replace(/-/g, "")}`;
  let finalized:
    | {
        carePlanId: string;
        memberId: string;
        finalMemberFileId: string;
        wasAlreadySigned: boolean;
      }
    | null = null;
  let finalizeAttempted = false;
  try {
    const generated = await buildCarePlanPdfDataUrl(detail.carePlan.id, { serviceRole: true });
    const parsedPdf = parseDataUrlPayload(generated.dataUrl);
    const signedPdfStorageUri = await uploadMemberDocumentObject({
      objectPath: signedPdfStoragePath,
      bytes: parsedPdf.bytes,
      contentType: "application/pdf"
    });

    const rotatedToken = hashToken(generateSigningToken());
    finalizeAttempted = true;
    finalized = await invokeFinalizeCarePlanCaregiverSignatureRpc({
      carePlanId: detail.carePlan.id,
      rotatedToken,
      consumedTokenHash: hashToken(token),
      signedAt: now,
      updatedAt: toEasternISO(),
      finalMemberFileId: expectedFinalMemberFileId,
      finalMemberFileName: buildDatedPdfFileName("Care Plan Final Signed", detail.carePlan.memberName, now),
      finalMemberFileDataUrl: generated.dataUrl,
      finalMemberFileStorageObjectPath: parseMemberDocumentStorageUri(signedPdfStorageUri),
      uploadedByUserId: detail.carePlan.nurseSignedByUserId ?? detail.carePlan.nurseDesigneeUserId,
      uploadedByName: detail.carePlan.nurseSignedByName ?? detail.carePlan.nurseDesigneeName,
      actorName: caregiverTypedName,
      actorEmail: detail.carePlan.caregiverEmail,
      actorIp: clean(input.caregiverIp),
      actorUserAgent: clean(input.caregiverUserAgent),
      signatureImageUrl: signatureUri
    });

    if (finalized.wasAlreadySigned) {
      await cleanupFailedCarePlanCaregiverArtifacts({
        carePlanId: detail.carePlan.id,
        actorUserId: detail.carePlan.caregiverSentByUserId,
        memberId: detail.carePlan.memberId,
        signatureObjectPath: signaturePath,
        signedPdfObjectPath: signedPdfStoragePath,
        reason: "Replay-safe caregiver signature finalization reused committed signed state."
      });
      const committedDetail = await requireCommittedSignedCarePlan({
        carePlanId: detail.carePlan.id,
        expectedMemberId: detail.carePlan.memberId,
        expectedFinalMemberFileId: finalized.finalMemberFileId
      });
      return buildCommittedCarePlanSubmitResult({
        detail: committedDetail,
        finalMemberFileId: finalized.finalMemberFileId
      });
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unable to complete care plan filing.";
    const fallbackStatus = detail.carePlan.caregiverSignatureStatus;
    if (!finalized) {
      let finalizeVerification:
        | Awaited<ReturnType<typeof verifyCommittedCarePlanCaregiverSignatureAfterFinalizeError>>
        | null = null;
      if (finalizeAttempted) {
        finalizeVerification = await verifyCommittedCarePlanCaregiverSignatureAfterFinalizeError({
          carePlanId: detail.carePlan.id,
          expectedMemberId: detail.carePlan.memberId,
          expectedFinalMemberFileId,
          actorUserId: detail.carePlan.caregiverSentByUserId,
          reason
        });
      }

      if (finalizeVerification?.kind === "committed" && finalizeVerification.detail?.carePlan.finalMemberFileId) {
        const committedFinalMemberFileId = finalizeVerification.detail.carePlan.finalMemberFileId;
        detail = finalizeVerification.detail;
        finalized = {
          carePlanId: detail.carePlan.id,
          memberId: detail.carePlan.memberId,
          finalMemberFileId: committedFinalMemberFileId,
          wasAlreadySigned: false
        };
      } else {
        const canWriteFallbackStatus =
          fallbackStatus !== "signed" && finalizeVerification?.kind !== "unverified";
        if (finalizeVerification?.kind !== "unverified") {
          await cleanupFailedCarePlanCaregiverArtifacts({
            carePlanId: detail.carePlan.id,
            actorUserId: detail.carePlan.caregiverSentByUserId,
            memberId: detail.carePlan.memberId,
            signatureObjectPath: signaturePath,
            signedPdfObjectPath: signedPdfStoragePath,
            reason
          });
        }
        if (canWriteFallbackStatus) {
          try {
            await transitionCarePlanCaregiverStatus({
              carePlanId: detail.carePlan.id,
              status: fallbackStatus,
              updatedAt: toEasternISO(),
              actor: {
                id: detail.carePlan.caregiverSentByUserId,
                fullName: detail.carePlan.nurseSignedByName ?? detail.carePlan.nurseDesigneeName ?? null
              },
              caregiverSentAt: detail.carePlan.caregiverSentAt,
              caregiverViewedAt: detail.carePlan.caregiverViewedAt,
              caregiverSignatureError: reason,
              expectedCurrentStatuses: ["ready_to_send", "send_failed", "sent", "viewed", "expired"]
            });
          } catch (statusError) {
            if (!isCarePlanStatusTransitionRaceError(statusError)) {
              throw statusError;
            }
          }
        }
        try {
          await recordWorkflowEvent({
            eventType: "care_plan_failed",
            entityType: "care_plan",
            entityId: detail.carePlan.id,
            actorType: "caregiver",
            status: "failed",
            severity: "high",
            metadata: {
              member_id: detail.carePlan.memberId,
              phase: "signature_completion",
              caregiver_email: detail.carePlan.caregiverEmail,
              error: reason
            }
          });
          await recordCarePlanAlertSafely({
            entityType: "care_plan",
            entityId: detail.carePlan.id,
            actorUserId: detail.carePlan.caregiverSentByUserId,
            severity: "high",
            alertKey: "care_plan_signature_completion_failed",
            metadata: {
              member_id: detail.carePlan.memberId,
              caregiver_email: detail.carePlan.caregiverEmail,
              error: reason
            }
          }, "submitPublicCarePlanSignature");
        } catch (followUpError) {
          throw followUpError;
        }
        throw error;
      }
    } else {
      await recordCarePlanAlertSafely({
        entityType: "care_plan",
        entityId: detail.carePlan.id,
        actorUserId: detail.carePlan.caregiverSentByUserId,
        severity: "high",
        alertKey: "care_plan_post_commit_follow_up_failed",
        metadata: {
          member_id: detail.carePlan.memberId,
          caregiver_email: detail.carePlan.caregiverEmail,
          final_member_file_id: finalized.finalMemberFileId,
          error: reason
        }
      }, "submitPublicCarePlanSignature.postCommit");
      console.error("[care-plan-esign] post-commit follow-up failed after caregiver signature finalized", {
        carePlanId: detail.carePlan.id,
        message: reason
      });
      return buildCommittedCarePlanPostCommitFollowUpResult({
        carePlanId: detail.carePlan.id,
        memberId: detail.carePlan.memberId,
        finalMemberFileId: finalized.finalMemberFileId,
        fallbackPostSignReadinessStatus: detail.carePlan.postSignReadinessStatus
      });
    }
  }

  if (!finalized) {
    throw new Error("Care plan caregiver signature finalization did not produce a committed file reference.");
  }
  const finalizedMemberFileId = finalized.finalMemberFileId;

  try {
    await recordWorkflowMilestone({
      event: {
        event_type: "care_plan_caregiver_signed",
        entity_type: "care_plan",
        entity_id: detail.carePlan.id,
        actor_type: "caregiver",
        status: "signed",
        severity: "low",
        metadata: {
          member_id: detail.carePlan.memberId,
          final_member_file_id: finalizedMemberFileId,
          caregiver_email: detail.carePlan.caregiverEmail,
          signature_image_url: signatureUri
        }
      }
    });
  } catch (error) {
    console.error("[care-plan-esign] unable to emit caregiver signature workflow milestone", error);
  }

  try {
    await recordWorkflowEvent({
      eventType: "care_plan_signed",
      entityType: "care_plan",
      entityId: detail.carePlan.id,
      actorType: "caregiver",
      status: "signed",
      severity: "low",
      metadata: {
        member_id: detail.carePlan.memberId,
        final_member_file_id: finalizedMemberFileId,
        caregiver_email: detail.carePlan.caregiverEmail
      }
    });
  } catch (error) {
    console.error("[care-plan-esign] unable to emit caregiver signature workflow event", {
      carePlanId: detail.carePlan.id,
      message: error instanceof Error ? error.message : "Unknown care plan caregiver signature event failure."
    });
  }

  try {
    await markCarePlanPostSignReadyWorkflow({
      carePlanId: detail.carePlan.id,
      actor: {
        id:
          detail.carePlan.caregiverSentByUserId ??
          detail.carePlan.nurseSignedByUserId ??
          detail.carePlan.nurseDesigneeUserId ??
          "system",
        fullName:
          detail.carePlan.nurseSignedByName ??
          detail.carePlan.nurseDesigneeName ??
          detail.carePlan.caregiverName ??
        "Care Plan Caregiver Signature"
      }
    });
    const committedDetail = await requireCommittedSignedCarePlan({
      carePlanId: detail.carePlan.id,
      expectedMemberId: detail.carePlan.memberId,
      expectedFinalMemberFileId: finalizedMemberFileId
    });
    return buildCommittedCarePlanSubmitResult({
      detail: committedDetail,
      finalMemberFileId: finalizedMemberFileId
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unable to complete post-sign readiness update.";
    await recordCarePlanAlertSafely({
      entityType: "care_plan",
      entityId: detail.carePlan.id,
      actorUserId: detail.carePlan.caregiverSentByUserId,
      severity: "high",
      alertKey: "care_plan_post_commit_follow_up_failed",
      metadata: {
        member_id: detail.carePlan.memberId,
        caregiver_email: detail.carePlan.caregiverEmail,
        final_member_file_id: finalizedMemberFileId,
        error: reason
      }
    }, "submitPublicCarePlanSignature.postCommit");
    console.error("[care-plan-esign] unable to complete caregiver signature finalization boundary", {
      carePlanId: detail.carePlan.id,
      message: reason
    });
    return buildCommittedCarePlanPostCommitFollowUpResult({
      carePlanId: detail.carePlan.id,
      memberId: detail.carePlan.memberId,
      finalMemberFileId: finalizedMemberFileId,
      fallbackPostSignReadinessStatus: detail.carePlan.postSignReadinessStatus
    });
  }
}
