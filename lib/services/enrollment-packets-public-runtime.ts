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
  preparePublicEnrollmentPacketSubmission,
  recordPublicEnrollmentPacketGuardFailure,
  savePublicEnrollmentPacketProgress
} from "@/lib/services/enrollment-packets-public-runtime-submission";
import {
  recordImmediateSystemAlert,
  recordWorkflowEvent
} from "@/lib/services/workflow-observability";
import { toEasternISO } from "@/lib/timezone";
import type { PacketFileUpload } from "@/lib/services/enrollment-packet-types";

export {
  getPublicCompletedEnrollmentPacketArtifact,
  getPublicEnrollmentPacketContext,
  issuePublicCompletedEnrollmentPacketDownloadToken,
  recordPublicEnrollmentPacketGuardFailure,
  savePublicEnrollmentPacketProgress
};

export async function submitPublicEnrollmentPacket(input: {
  token: string;
  caregiverTypedName: string;
  caregiverSignatureImageDataUrl: string;
  attested: boolean;
  caregiverIp: string | null;
  caregiverUserAgent: string | null;
  caregiverName?: string | null;
  caregiverPhone?: string | null;
  caregiverEmail?: string | null;
  primaryContactAddress?: string | null;
  primaryContactAddressLine1?: string | null;
  primaryContactCity?: string | null;
  primaryContactState?: string | null;
  primaryContactZip?: string | null;
  caregiverAddressLine1?: string | null;
  caregiverAddressLine2?: string | null;
  caregiverCity?: string | null;
  caregiverState?: string | null;
  caregiverZip?: string | null;
  secondaryContactName?: string | null;
  secondaryContactPhone?: string | null;
  secondaryContactEmail?: string | null;
  secondaryContactRelationship?: string | null;
  secondaryContactAddress?: string | null;
  secondaryContactAddressLine1?: string | null;
  secondaryContactCity?: string | null;
  secondaryContactState?: string | null;
  secondaryContactZip?: string | null;
  notes?: string | null;
  intakePayload?: Partial<Record<string, unknown>> | null;
  uploads?: PacketFileUpload[];
}) {
  const normalizedToken = clean(input.token);
  const caregiverTypedName = clean(input.caregiverTypedName);
  if (!normalizedToken) throw new Error("Signature token is required.");
  if (!caregiverTypedName) throw new Error("Typed caregiver name is required.");
  if (!input.attested) throw new Error("Electronic signature attestation is required.");
  const signature = parseDataUrlPayload(input.caregiverSignatureImageDataUrl);
  if (!signature.contentType.startsWith("image/")) throw new Error("Caregiver signature format is invalid.");

  const matchedRequest = await loadRequestByToken(normalizedToken);
  if (!matchedRequest) throw new Error("This enrollment packet link is invalid.");
  const request = matchedRequest.request;
  const status = toStatus(request.status);
  if (matchedRequest.tokenMatch === "consumed" && status === "completed") {
    return buildCommittedEnrollmentPacketReplayResult({ request });
  }
  if (status === "completed") {
    return buildCommittedEnrollmentPacketReplayResult({ request });
  }
  if (isExpired(request.token_expires_at)) {
    await recordEnrollmentPacketExpiredIfNeeded(request);
    throw new Error("This enrollment packet link has expired.");
  }

  const member = await getMemberById(request.member_id);
  if (!member) throw new Error("Member record was not found.");

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

  try {
    const preparedSubmission = await preparePublicEnrollmentPacketSubmission({
      request,
      token: normalizedToken,
      caregiverTypedName,
      attested: input.attested,
      caregiverIp: input.caregiverIp,
      caregiverUserAgent: input.caregiverUserAgent,
      caregiverName: input.caregiverName,
      caregiverPhone: input.caregiverPhone,
      caregiverEmail: input.caregiverEmail,
      primaryContactAddress: input.primaryContactAddress,
      primaryContactAddressLine1: input.primaryContactAddressLine1,
      primaryContactCity: input.primaryContactCity,
      primaryContactState: input.primaryContactState,
      primaryContactZip: input.primaryContactZip,
      caregiverAddressLine1: input.caregiverAddressLine1,
      caregiverAddressLine2: input.caregiverAddressLine2,
      caregiverCity: input.caregiverCity,
      caregiverState: input.caregiverState,
      caregiverZip: input.caregiverZip,
      secondaryContactName: input.secondaryContactName,
      secondaryContactPhone: input.secondaryContactPhone,
      secondaryContactEmail: input.secondaryContactEmail,
      secondaryContactRelationship: input.secondaryContactRelationship,
      secondaryContactAddress: input.secondaryContactAddress,
      secondaryContactAddressLine1: input.secondaryContactAddressLine1,
      secondaryContactCity: input.secondaryContactCity,
      secondaryContactState: input.secondaryContactState,
      secondaryContactZip: input.secondaryContactZip,
      notes: input.notes,
      intakePayload: input.intakePayload,
      uploads
    });

    const completedAt = toEasternISO();
    const rotatedToken = hashToken(generateSigningToken());

    finalizedAt = toEasternISO();
    finalizeAttempted = true;
    finalizedSubmission = await invokeFinalizeEnrollmentPacketCompletionRpc({
      packetId: request.id,
      rotatedToken,
      consumedSubmissionTokenHash,
      completedAt,
      filedAt: finalizedAt,
      signerName: caregiverTypedName,
      signerEmail: cleanEmail(input.caregiverEmail) ?? request.caregiver_email,
      signatureBlob: input.caregiverSignatureImageDataUrl.trim(),
      ipAddress: clean(input.caregiverIp),
      actorUserId: request.sender_user_id,
      actorEmail: cleanEmail(input.caregiverEmail) ?? request.caregiver_email,
      uploadBatchId: null,
      completedMetadata: {
        caregiverSignatureName: caregiverTypedName,
        completedAt
      },
      filedMetadata: {
        caregiverSignatureName: caregiverTypedName,
        initiatedByUserId: request.sender_user_id,
        initiatedByName: preparedSubmission.senderSignatureName,
        completedAt,
        filedAt: finalizedAt,
        mappingSyncStatus: "pending"
      }
    });

    if (finalizedSubmission.wasAlreadyFiled) {
      return buildCommittedEnrollmentPacketReplayResult({
        request: (await loadRequestByToken(normalizedToken))?.request ?? request
      });
    }

    return completeCommittedPublicEnrollmentPacketPostCommitWork({
      request,
      member,
      validatedFieldsSnapshot: preparedSubmission.validatedFieldsSnapshot,
      caregiverTypedName,
      senderSignatureName: preparedSubmission.senderSignatureName,
      caregiverEmail: input.caregiverEmail,
      caregiverSignatureDataUrl: input.caregiverSignatureImageDataUrl.trim(),
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
      finalizeVerification = await verifyCommittedEnrollmentPacketFinalizeAfterError({
        packetId: request.id,
        expectedMemberId: member.id,
        actorUserId: request.sender_user_id,
        uploadBatchId: null,
        consumedSubmissionTokenHash,
        stagedUploads: [],
        reason
      });
      if (finalizeVerification.kind === "committed" && finalizeVerification.request) {
        return buildCommittedEnrollmentPacketReplayResult({
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
        member_id: member.id,
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
          member_id: member.id,
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
        member_id: member.id,
        lead_id: request.lead_id,
        error: reason,
        upload_batch_id: null
      }
    });
    throw error;
  }
}
