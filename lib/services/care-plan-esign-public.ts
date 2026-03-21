import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { toEasternISO } from "@/lib/timezone";
import { buildCarePlanPdfDataUrl } from "@/lib/services/care-plan-pdf";
import { resolvePublicCaregiverLinkState } from "@/lib/services/care-plan-esign-rules";
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
  | { state: "completed"; carePlan: NonNullable<Awaited<ReturnType<typeof getCarePlanById>>>["carePlan"] }
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

async function loadCarePlanRowByToken(token: string): Promise<CarePlanTokenMatch | null> {
  const hashed = hashToken(token);
  const admin = createSupabaseAdminClient();
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
  await transitionCarePlanCaregiverStatus({
    carePlanId: input.carePlanId,
    status: "expired",
    updatedAt: now
  });
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
  const admin = createSupabaseAdminClient();
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
  if (linkState === "completed") return { state: "completed", carePlan: detail.carePlan };
  if (linkState !== "ready") return { state: "invalid" };

  if (!detail.carePlan.caregiverViewedAt) {
    const now = toEasternISO();
    await transitionCarePlanCaregiverStatus({
      carePlanId: detail.carePlan.id,
      status: "viewed",
      updatedAt: now,
      caregiverSentAt: detail.carePlan.caregiverSentAt,
      caregiverViewedAt: now
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
    return {
      carePlanId: tokenRow.id,
      memberId: tokenRow.member_id,
      finalMemberFileId: signedDetail.carePlan.finalMemberFileId
    };
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

  const detail = await getCarePlanById(tokenRow.id, { serviceRole: true });
  if (!detail) throw new Error("Care plan was not found.");

  const now = toEasternISO();
  const signaturePath = `members/${detail.carePlan.memberId}/care-plans/${detail.carePlan.id}/caregiver-signature.png`;
  const signatureUri = await uploadMemberDocumentObject({
    objectPath: signaturePath,
    bytes: signature.bytes,
    contentType: signature.contentType
  });

  const signedPdfStoragePath = `members/${detail.carePlan.memberId}/care-plans/${detail.carePlan.id}/final-signed.pdf`;
  try {
    const generated = await buildCarePlanPdfDataUrl(detail.carePlan.id, { serviceRole: true });
    const parsedPdf = parseDataUrlPayload(generated.dataUrl);
    const signedPdfStorageUri = await uploadMemberDocumentObject({
      objectPath: signedPdfStoragePath,
      bytes: parsedPdf.bytes,
      contentType: "application/pdf"
    });

    const rotatedToken = hashToken(generateSigningToken());
    const finalized = await invokeFinalizeCarePlanCaregiverSignatureRpc({
      carePlanId: detail.carePlan.id,
      rotatedToken,
      consumedTokenHash: hashToken(token),
      signedAt: now,
      updatedAt: toEasternISO(),
      finalMemberFileId: detail.carePlan.finalMemberFileId ?? `mf_${randomUUID().replace(/-/g, "")}`,
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
      return {
        carePlanId: detail.carePlan.id,
        memberId: detail.carePlan.memberId,
        finalMemberFileId: finalized.finalMemberFileId
      };
    }

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
            final_member_file_id: finalized.finalMemberFileId,
            caregiver_email: detail.carePlan.caregiverEmail,
            signature_image_url: signatureUri
          }
        }
      });
    } catch (error) {
      console.error("[care-plan-esign] unable to emit caregiver signature workflow milestone", error);
    }
    await recordWorkflowEvent({
      eventType: "care_plan_signed",
      entityType: "care_plan",
      entityId: detail.carePlan.id,
      actorType: "caregiver",
      status: "signed",
      severity: "low",
      metadata: {
        member_id: detail.carePlan.memberId,
        final_member_file_id: finalized.finalMemberFileId,
        caregiver_email: detail.carePlan.caregiverEmail
      }
    });

    return {
      carePlanId: detail.carePlan.id,
      memberId: detail.carePlan.memberId,
      finalMemberFileId: finalized.finalMemberFileId
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unable to complete care plan filing.";
    await cleanupFailedCarePlanCaregiverArtifacts({
      carePlanId: detail.carePlan.id,
      actorUserId: detail.carePlan.caregiverSentByUserId,
      memberId: detail.carePlan.memberId,
      signatureObjectPath: signaturePath,
      signedPdfObjectPath: signedPdfStoragePath,
      reason
    });
    await transitionCarePlanCaregiverStatus({
      carePlanId: detail.carePlan.id,
      status: detail.carePlan.caregiverSignatureStatus,
      updatedAt: toEasternISO(),
      actor: {
        id: detail.carePlan.caregiverSentByUserId,
        fullName: detail.carePlan.nurseSignedByName ?? detail.carePlan.nurseDesigneeName ?? null
      },
      caregiverSentAt: detail.carePlan.caregiverSentAt,
      caregiverViewedAt: detail.carePlan.caregiverViewedAt,
      caregiverSignatureError: reason
    });
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
    throw error;
  }
}
