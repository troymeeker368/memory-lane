import "server-only";

import type { Buffer } from "node:buffer";

import { cleanEmail } from "@/lib/services/enrollment-packet-core";
import { loadPacketFields } from "@/lib/services/enrollment-packet-mapping-runtime";
import { persistFinalizedPublicEnrollmentPacketArtifacts } from "@/lib/services/enrollment-packets-public-runtime-artifacts";
import { runEnrollmentPacketCascadeAndBuildResult } from "@/lib/services/enrollment-packets-public-runtime-cascade";
import { buildEnrollmentPacketPostCommitFailureResult } from "@/lib/services/enrollment-packets-public-runtime-follow-up";
import type {
  EnrollmentPacketFieldsRow,
  EnrollmentPacketRequestRow,
  MemberRow,
  PacketFileUpload
} from "@/lib/services/enrollment-packet-types";

export async function completeCommittedPublicEnrollmentPacketPostCommitWork(input: {
  request: EnrollmentPacketRequestRow;
  member: MemberRow;
  validatedFieldsSnapshot: EnrollmentPacketFieldsRow;
  caregiverTypedName: string;
  senderSignatureName: string;
  caregiverEmail?: string | null;
  caregiverSignatureDataUrl: string;
  caregiverSignature: {
    contentType: string;
    bytes: Buffer;
  };
  uploads: PacketFileUpload[];
  finalizedAt: string;
  fallbackMappingSyncStatus: string;
}) {
  let uploadBatchId: string | null = null;
  let failedMappingRunId: string | null = null;
  let completionFollowUpError: string | null = null;

  try {
    const artifactFields = (await loadPacketFields(input.request.id)) ?? input.validatedFieldsSnapshot;
    if (!artifactFields) throw new Error("Enrollment packet fields are missing.");

    const persistedArtifacts = await persistFinalizedPublicEnrollmentPacketArtifacts({
      request: input.request,
      member: input.member,
      artifactFields,
      caregiverTypedName: input.caregiverTypedName,
      senderSignatureName: input.senderSignatureName,
      caregiverSignatureDataUrl: input.caregiverSignatureDataUrl,
      caregiverSignature: input.caregiverSignature,
      uploads: input.uploads,
      finalizedAt: input.finalizedAt
    });
    uploadBatchId = persistedArtifacts.uploadBatchId;

    const followUp = await runEnrollmentPacketCascadeAndBuildResult({
      request: input.request,
      member: input.member,
      senderSignatureName: input.senderSignatureName,
      caregiverEmail: cleanEmail(input.caregiverEmail) ?? input.request.caregiver_email,
      uploadedArtifacts: persistedArtifacts.uploadedArtifacts,
      uploadBatchId,
      fallbackMappingSyncStatus: input.fallbackMappingSyncStatus
    });
    failedMappingRunId = followUp.failedMappingRunId;
    completionFollowUpError = followUp.completionFollowUpError;
    return followUp.submitResult;
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "Unable to complete enrollment packet post-commit follow-up.";

    return buildEnrollmentPacketPostCommitFailureResult({
      request: input.request,
      memberId: input.member.id,
      mappingSyncStatus: input.fallbackMappingSyncStatus,
      reason,
      existingCompletionFollowUpError: completionFollowUpError,
      mappingRunId: failedMappingRunId,
      uploadBatchId
    });
  }
}
