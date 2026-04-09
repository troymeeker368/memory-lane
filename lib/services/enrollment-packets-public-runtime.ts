import "server-only";

import { recordWorkflowMilestone } from "@/lib/services/lifecycle-milestones";
import { parseDataUrlPayload } from "@/lib/services/member-files";
import {
  clean,
  cleanEmail,
  generateSigningToken,
  hashToken,
  isExpired,
  toStatus
} from "@/lib/services/enrollment-packet-core";
import { getMemberById } from "@/lib/services/enrollment-packet-mapping-runtime";
import {
  getPublicCompletedEnrollmentPacketArtifact,
  issuePublicCompletedEnrollmentPacketDownloadToken
} from "@/lib/services/enrollment-packets-public-runtime-artifacts";
import {
  getPublicEnrollmentPacketContext,
  loadRequestByToken,
  recordEnrollmentPacketExpiredIfNeeded
} from "@/lib/services/enrollment-packets-public-runtime-context";
import {
  buildCommittedEnrollmentPacketReplayResult,
  invokeFinalizeEnrollmentPacketCompletionRpc,
  verifyCommittedEnrollmentPacketFinalizeAfterError
} from "@/lib/services/enrollment-packets-public-runtime-finalize";
import { completeCommittedPublicEnrollmentPacketPostCommitWork } from "@/lib/services/enrollment-packets-public-runtime-post-commit";
import {
  PublicEnrollmentPacketReplayDetectedError,
  loadPublicEnrollmentPacketPostCommitContext,
  loadPublicEnrollmentPacketSenderSignatureName,
  preparePublicEnrollmentPacketSubmission,
  recordPublicEnrollmentPacketGuardFailure,
  savePublicEnrollmentPacketProgress
} from "@/lib/services/enrollment-packets-public-runtime-submission";
import {
  recordImmediateSystemAlert,
  recordWorkflowEvent
} from "@/lib/services/workflow-observability";
import { toEasternISO } from "@/lib/timezone";
import type { EnrollmentPacketIntakePayload } from "@/lib/services/enrollment-packet-intake-payload";
import type { PacketFileUpload } from "@/lib/services/enrollment-packet-types";

export {
  getPublicCompletedEnrollmentPacketArtifact,
  getPublicEnrollmentPacketContext,
  issuePublicCompletedEnrollmentPacketDownloadToken,
  recordPublicEnrollmentPacketGuardFailure,
  savePublicEnrollmentPacketProgress
};

type SubmitPublicEnrollmentPacketInput = {
  token: string;
  caregiverTypedName: string;
  caregiverSignatureImageDataUrl: string;
  attested: boolean;
  caregiverIp: string | null;
  caregiverUserAgent: string | null;
  intakePayload: EnrollmentPacketIntakePayload;
  uploads?: PacketFileUpload[];
};

export type SubmitPublicEnrollmentPacketDeps = {
  buildCommittedEnrollmentPacketReplayResult: typeof buildCommittedEnrollmentPacketReplayResult;
  completeCommittedPublicEnrollmentPacketPostCommitWork:
    typeof completeCommittedPublicEnrollmentPacketPostCommitWork;
  getMemberById: typeof getMemberById;
  invokeFinalizeEnrollmentPacketCompletionRpc: typeof invokeFinalizeEnrollmentPacketCompletionRpc;
  loadPublicEnrollmentPacketPostCommitContext: typeof loadPublicEnrollmentPacketPostCommitContext;
  loadPublicEnrollmentPacketSenderSignatureName: typeof loadPublicEnrollmentPacketSenderSignatureName;
  loadRequestByToken: typeof loadRequestByToken;
  parseSignatureDataUrl: typeof parseDataUrlPayload;
  preparePublicEnrollmentPacketSubmission: typeof preparePublicEnrollmentPacketSubmission;
  verifyCommittedEnrollmentPacketFinalizeAfterError:
    typeof verifyCommittedEnrollmentPacketFinalizeAfterError;
};

const defaultSubmitPublicEnrollmentPacketDeps: SubmitPublicEnrollmentPacketDeps = {
  buildCommittedEnrollmentPacketReplayResult,
  completeCommittedPublicEnrollmentPacketPostCommitWork,
  getMemberById,
  invokeFinalizeEnrollmentPacketCompletionRpc,
  loadPublicEnrollmentPacketPostCommitContext,
  loadPublicEnrollmentPacketSenderSignatureName,
  loadRequestByToken,
  parseSignatureDataUrl: parseDataUrlPayload,
  preparePublicEnrollmentPacketSubmission,
  verifyCommittedEnrollmentPacketFinalizeAfterError
};

function parseCaregiverSignatureContentType(dataUrl: string) {
  const normalized = dataUrl.trim();
  const base64Match = /^data:([^;,]+)(?:;charset=[^;,]+)?;base64,/i.exec(normalized);
  if (base64Match) return base64Match[1];

  const plainMatch = /^data:([^;,]+)(?:;charset=[^;,]+)?,/i.exec(normalized);
  if (!plainMatch) throw new Error("Caregiver signature format is invalid.");
  return plainMatch[1];
}

export async function submitPublicEnrollmentPacket(
  input: SubmitPublicEnrollmentPacketInput
) {
  return submitPublicEnrollmentPacketWithDeps(input);
}

export async function submitPublicEnrollmentPacketWithDeps(
  input: SubmitPublicEnrollmentPacketInput,
  deps: SubmitPublicEnrollmentPacketDeps = defaultSubmitPublicEnrollmentPacketDeps
) {
  const normalizedToken = clean(input.token);
  const caregiverTypedName = clean(input.caregiverTypedName);
  if (!normalizedToken) throw new Error("Signature token is required.");
  if (!caregiverTypedName) throw new Error("Typed caregiver name is required.");
  if (!input.attested) throw new Error("Electronic signature attestation is required.");
  const caregiverSignatureDataUrl = input.caregiverSignatureImageDataUrl.trim();
  const signatureContentType = parseCaregiverSignatureContentType(caregiverSignatureDataUrl);
  if (!signatureContentType.startsWith("image/")) {
    throw new Error("Caregiver signature format is invalid.");
  }

  const matchedRequest = await deps.loadRequestByToken(normalizedToken);
  if (!matchedRequest) throw new Error("This enrollment packet link is invalid.");
  const request = matchedRequest.request;
  const status = toStatus(request.status);
  if (matchedRequest.tokenMatch === "consumed" && status === "completed") {
    return deps.buildCommittedEnrollmentPacketReplayResult({ request });
  }
  if (status === "completed") {
    return deps.buildCommittedEnrollmentPacketReplayResult({ request });
  }
  if (isExpired(request.token_expires_at)) {
    await recordEnrollmentPacketExpiredIfNeeded(request);
    throw new Error("This enrollment packet link has expired.");
  }

  const uploads = input.uploads ?? [];
  const consumedSubmissionTokenHash = hashToken(normalizedToken);
  let finalizeAttempted = false;
  let finalizedAt: string | null = null;
  let finalizedSubmission:
    | {
        packetId: string;
        status: string;
        mappingSyncStatus: string;
        wasAlreadyFiled: boolean;
      }
    | null = null;
  let member: Awaited<ReturnType<typeof getMemberById>> | null = null;
  let senderSignatureName = "Staff";

  try {
    let preparedSubmission: Awaited<ReturnType<typeof deps.preparePublicEnrollmentPacketSubmission>>;
    try {
      preparedSubmission = await deps.preparePublicEnrollmentPacketSubmission({
        request,
        token: normalizedToken,
        caregiverTypedName,
        attested: input.attested,
        caregiverIp: input.caregiverIp,
        caregiverUserAgent: input.caregiverUserAgent,
        intakePayload: input.intakePayload,
        uploads
      });
    } catch (error) {
      if (error instanceof PublicEnrollmentPacketReplayDetectedError) {
        return deps.buildCommittedEnrollmentPacketReplayResult({
          request: error.request
        });
      }
      throw error;
    }
    const replayCheck = await deps.loadRequestByToken(normalizedToken);
    if (replayCheck?.request && toStatus(replayCheck.request.status) === "completed") {
      return deps.buildCommittedEnrollmentPacketReplayResult({
        request: replayCheck.request
      });
    }
    senderSignatureName = await deps.loadPublicEnrollmentPacketSenderSignatureName(request.id);

    const completedAt = toEasternISO();
    const rotatedToken = hashToken(generateSigningToken());

    finalizedAt = toEasternISO();
    finalizeAttempted = true;
    finalizedSubmission = await deps.invokeFinalizeEnrollmentPacketCompletionRpc({
      packetId: request.id,
      rotatedToken,
      consumedSubmissionTokenHash,
      completedAt,
      filedAt: finalizedAt,
      signerName: caregiverTypedName,
      signerEmail: cleanEmail(preparedSubmission.validatedPayload.primaryContactEmail) ?? request.caregiver_email,
      signatureBlob: caregiverSignatureDataUrl,
      ipAddress: clean(input.caregiverIp),
      actorUserId: request.sender_user_id,
      actorEmail: cleanEmail(preparedSubmission.validatedPayload.primaryContactEmail) ?? request.caregiver_email,
      uploadBatchId: null,
      completedMetadata: {
        caregiverSignatureName: caregiverTypedName,
        completedAt
      },
      filedMetadata: {
        caregiverSignatureName: caregiverTypedName,
        initiatedByUserId: request.sender_user_id,
        initiatedByName: senderSignatureName,
        completedAt,
        filedAt: finalizedAt,
        mappingSyncStatus: "pending"
      }
    });

    if (finalizedSubmission.wasAlreadyFiled) {
      return deps.buildCommittedEnrollmentPacketReplayResult({
        request: (await deps.loadRequestByToken(normalizedToken))?.request ?? request
      });
    }

    member = await deps.getMemberById(request.member_id);
    if (!member) throw new Error("Member record was not found.");

    const postCommitContext = await deps.loadPublicEnrollmentPacketPostCommitContext(request.id);
    const signature = deps.parseSignatureDataUrl(caregiverSignatureDataUrl);
    if (!signature.contentType.startsWith("image/")) {
      throw new Error("Caregiver signature format is invalid.");
    }

    return deps.completeCommittedPublicEnrollmentPacketPostCommitWork({
      request,
      member,
      validatedFieldsSnapshot: postCommitContext.validatedFieldsSnapshot,
      caregiverTypedName,
      senderSignatureName,
      caregiverEmail: preparedSubmission.validatedPayload.primaryContactEmail,
      caregiverSignatureDataUrl,
      caregiverSignature: signature,
      uploads,
      finalizedAt,
      fallbackMappingSyncStatus: finalizedSubmission.mappingSyncStatus
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unable to complete enrollment packet.";
    let finalizeVerification:
      | Awaited<ReturnType<typeof verifyCommittedEnrollmentPacketFinalizeAfterError>>
      | null = null;

    if (!finalizedSubmission && finalizeAttempted) {
      finalizeVerification = await deps.verifyCommittedEnrollmentPacketFinalizeAfterError({
        packetId: request.id,
        expectedMemberId: request.member_id,
        actorUserId: request.sender_user_id,
        uploadBatchId: null,
        consumedSubmissionTokenHash,
        stagedUploads: [],
        reason
      });
      if (finalizeVerification.kind === "committed" && finalizeVerification.request) {
        return deps.buildCommittedEnrollmentPacketReplayResult({
          request: finalizeVerification.request
        });
      }
    }

    await recordWorkflowEvent({
      eventType: "enrollment_packet_failed",
      entityType: "enrollment_packet_request",
      entityId: request.id,
      actorType: "user",
      actorUserId: request.sender_user_id,
      status: "failed",
      severity: "high",
      metadata: {
        member_id: request.member_id,
        lead_id: request.lead_id,
        phase: finalizedSubmission ? "post_finalize" : "finalization",
        error: reason,
        upload_batch_id: null
      }
    });
    await recordWorkflowMilestone({
      event: {
        eventType: "enrollment_packet_failed",
        entityType: "enrollment_packet_request",
        entityId: request.id,
        actorType: "user",
        actorUserId: request.sender_user_id,
        status: "failed",
        severity: "high",
        metadata: {
          member_id: request.member_id,
          lead_id: request.lead_id,
          phase: finalizedSubmission ? "post_finalize" : "finalization",
          error: reason
        }
      }
    });
    await recordImmediateSystemAlert({
      entityType: "enrollment_packet_request",
      entityId: request.id,
      actorUserId: request.sender_user_id,
      severity: "high",
      alertKey: "enrollment_packet_completion_failed",
      metadata: {
        member_id: request.member_id,
        lead_id: request.lead_id,
        error: reason,
        upload_batch_id: null
      }
    });
    throw error;
  }
}
