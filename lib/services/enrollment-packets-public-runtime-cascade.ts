import "server-only";

import {
  type EnrollmentPacketCompletionCascadeResult,
  runEnrollmentPacketCompletionCascade
} from "@/lib/services/enrollment-packet-completion-cascade";
import {
  buildPublicEnrollmentPacketSubmitResult
} from "@/lib/services/enrollment-packet-public-helpers";
import { loadEnrollmentPacketArtifactOps, loadPacketFields, loadRequestById, recordEnrollmentPacketActionRequired } from "@/lib/services/enrollment-packet-mapping-runtime";
import { resolveEnrollmentPacketCompletionFollowUp, persistEnrollmentPacketCompletionFollowUpState } from "@/lib/services/enrollment-packets-public-runtime-follow-up";
import { recordWorkflowMilestone } from "@/lib/services/lifecycle-milestones";
import { recordImmediateSystemAlert } from "@/lib/services/workflow-observability";
import { toEasternISO } from "@/lib/timezone";
import type { EnrollmentPacketRequestRow, MemberRow } from "@/lib/services/enrollment-packet-types";
import type { PersistedPublicEnrollmentPacketArtifact } from "@/lib/services/enrollment-packets-public-runtime-artifacts";

type EnrollmentPacketCompletionAgreementSummary = Pick<
  EnrollmentPacketCompletionCascadeResult,
  | "senderNotificationDelivered"
  | "leadActivitySynced"
  | "completedPacketArtifactLinked"
  | "operationalShellsReady"
>;

async function runEnrollmentPacketCompletionCascadeWithRecovery(input: {
  request: EnrollmentPacketRequestRow;
  member: MemberRow;
  senderSignatureName: string;
  caregiverEmail: string | null;
  uploadedArtifacts: PersistedPublicEnrollmentPacketArtifact[];
  uploadBatchId: string | null;
}) {
  const refreshedRequest = await loadRequestById(input.request.id);
  const refreshedFields = await loadPacketFields(input.request.id);

  if (!refreshedRequest || !refreshedFields) {
    const missingFieldsMessage =
      "Enrollment packet was completed, but downstream sync could not start because the packet fields could not be reloaded. Review the packet and complete the downstream handoff before relying on MCC/MHP/POF data.";

    try {
      const artifactOps = await loadEnrollmentPacketArtifactOps();
      await artifactOps.updateEnrollmentPacketMappingSyncState({
        packetId: input.request.id,
        status: "failed",
        attemptedAt: toEasternISO(),
        error: "Enrollment packet fields are missing after filing.",
        mappingRunId: null
      });
    } catch (syncStateError) {
      console.error("[enrollment-packets] unable to persist missing-fields mapping failure state", syncStateError);
    }
    await recordImmediateSystemAlert({
      entityType: "enrollment_packet_request",
      entityId: input.request.id,
      actorUserId: input.request.sender_user_id,
      severity: "high",
      alertKey: "enrollment_packet_mapping_missing_fields",
      metadata: {
        member_id: input.member.id,
        lead_id: input.request.lead_id
      }
    });
    await recordEnrollmentPacketActionRequired({
      packetId: input.request.id,
      memberId: input.member.id,
      leadId: input.request.lead_id,
      actorUserId: input.request.sender_user_id,
      title: "Enrollment Packet Sync Blocked",
      message: missingFieldsMessage,
      actionUrl: `/sales/pipeline/enrollment-packets`,
      eventKeySuffix: "mapping-missing-fields"
    });

    return {
      mappingSummary: {
        mappingRunId: null,
        status: "failed" as const,
        error: "Enrollment packet fields are missing after filing."
      },
      completionCascadeSummary: null,
      completionFollowUpStatus: "action_required" as const,
      completionFollowUpError: missingFieldsMessage,
      failedMappingRunId: null
    };
  }

  try {
    const cascadeSummary = await runEnrollmentPacketCompletionCascade({
      request: refreshedRequest,
      member: input.member,
      fields: refreshedFields,
      senderSignatureName: input.senderSignatureName,
      caregiverEmail: input.caregiverEmail,
      memberFileArtifacts: input.uploadedArtifacts.map((artifact) => ({
        uploadCategory: artifact.uploadCategory,
        memberFileId: artifact.memberFileId
      })),
      actorType: "user",
      ensureCompletedPacketArtifact: false
    });

    return {
      mappingSummary: {
        mappingRunId: cascadeSummary.mappingRunId,
        status: cascadeSummary.mappingStatus
      },
      completionCascadeSummary: {
        senderNotificationDelivered: cascadeSummary.senderNotificationDelivered,
        leadActivitySynced: cascadeSummary.leadActivitySynced,
        completedPacketArtifactLinked: cascadeSummary.completedPacketArtifactLinked,
        operationalShellsReady: cascadeSummary.operationalShellsReady
      } satisfies EnrollmentPacketCompletionAgreementSummary,
      completionFollowUpStatus: "pending" as const,
      completionFollowUpError: null,
      failedMappingRunId: cascadeSummary.mappingRunId
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unable to run enrollment packet completion cascade.";
    const cascadeFollowUpMessage =
      "Enrollment packet was completed, but downstream sync could not start. Review the packet and complete the downstream handoff before relying on MCC/MHP/POF data.";

    try {
      const artifactOps = await loadEnrollmentPacketArtifactOps();
      await artifactOps.updateEnrollmentPacketMappingSyncState({
        packetId: input.request.id,
        status: "failed",
        attemptedAt: toEasternISO(),
        error: reason,
        mappingRunId: null
      });
    } catch (syncStateError) {
      console.error("[enrollment-packets] unable to persist cascade failure mapping state", syncStateError);
    }
    await recordImmediateSystemAlert({
      entityType: "enrollment_packet_request",
      entityId: input.request.id,
      actorUserId: input.request.sender_user_id,
      severity: "medium",
      alertKey: "enrollment_packet_completion_cascade_failed",
      metadata: {
        member_id: input.member.id,
        lead_id: input.request.lead_id,
        error: reason,
        upload_batch_id: input.uploadBatchId
      }
    });
    await recordEnrollmentPacketActionRequired({
      packetId: input.request.id,
      memberId: input.member.id,
      leadId: input.request.lead_id,
      actorUserId: input.request.sender_user_id,
      title: "Enrollment Packet Sync Blocked",
      message: cascadeFollowUpMessage,
      actionUrl: `/sales/pipeline/enrollment-packets`,
      eventKeySuffix: "mapping-cascade-failed"
    });

    return {
      mappingSummary: {
        mappingRunId: null,
        status: "failed" as const,
        error: reason
      },
      completionCascadeSummary: null,
      completionFollowUpStatus: "action_required" as const,
      completionFollowUpError: cascadeFollowUpMessage,
      failedMappingRunId: null
    };
  }
}

async function recordEnrollmentPacketUploadMilestones(input: {
  request: EnrollmentPacketRequestRow;
  member: MemberRow;
  uploadedArtifacts: PersistedPublicEnrollmentPacketArtifact[];
}) {
  const reviewableUploads = input.uploadedArtifacts.filter(
    (artifact) => artifact.uploadCategory !== "completed_packet" && artifact.uploadCategory !== "signature_artifact"
  );

  if (reviewableUploads.length > 0) {
    await recordWorkflowMilestone({
      event: {
        eventType: "document_uploaded",
        entityType: "enrollment_packet_request",
        entityId: input.request.id,
        actorType: "user",
        actorUserId: input.request.sender_user_id,
        status: "completed",
        severity: "low",
        metadata: {
          member_id: input.member.id,
          lead_id: input.request.lead_id,
          document_label:
            reviewableUploads.length === 1
              ? `Enrollment ${reviewableUploads[0].uploadCategory.replaceAll("_", " ")} document`
              : `${reviewableUploads.length} enrollment documents`
        }
      }
    });
    return;
  }

  await recordWorkflowMilestone({
    event: {
      eventType: "missing_required_document",
      entityType: "enrollment_packet_request",
      entityId: input.request.id,
      actorType: "system",
      actorUserId: input.request.sender_user_id,
      status: "open",
      severity: "high",
      metadata: {
        member_id: input.member.id,
        lead_id: input.request.lead_id
      }
    }
  });
}

export async function runEnrollmentPacketCascadeAndBuildResult(input: {
  request: EnrollmentPacketRequestRow;
  member: MemberRow;
  senderSignatureName: string;
  caregiverEmail: string | null;
  uploadedArtifacts: PersistedPublicEnrollmentPacketArtifact[];
  uploadBatchId: string | null;
  fallbackMappingSyncStatus: string;
}) {
  const cascadeResult = await runEnrollmentPacketCompletionCascadeWithRecovery(input);

  await recordEnrollmentPacketUploadMilestones({
    request: input.request,
    member: input.member,
    uploadedArtifacts: input.uploadedArtifacts
  });

  let completionFollowUpStatus: "pending" | "completed" | "action_required" =
    cascadeResult.completionFollowUpStatus;
  let completionFollowUpError = cascadeResult.completionFollowUpError;

  const provisionalSubmitResult = buildPublicEnrollmentPacketSubmitResult({
    packetId: input.request.id,
    memberId: input.member.id,
    mappingSyncStatus: cascadeResult.mappingSummary.status ?? input.fallbackMappingSyncStatus,
    completionFollowUpStatus,
    completionFollowUpError,
    wasAlreadyFiled: false
  });

  if (cascadeResult.mappingSummary.status === "completed" && cascadeResult.completionCascadeSummary) {
    const resolvedFollowUp = await resolveEnrollmentPacketCompletionFollowUp({
      request: input.request,
      memberId: input.member.id,
      operationalReadinessStatus: provisionalSubmitResult.operationalReadinessStatus,
      senderNotificationDelivered: cascadeResult.completionCascadeSummary.senderNotificationDelivered,
      leadActivitySynced: cascadeResult.completionCascadeSummary.leadActivitySynced,
      completedPacketArtifactLinked: cascadeResult.completionCascadeSummary.completedPacketArtifactLinked,
      operationalShellsReady: cascadeResult.completionCascadeSummary.operationalShellsReady,
      source: "submitPublicEnrollmentPacket.preReturn",
      currentStatus: completionFollowUpStatus,
      currentError: completionFollowUpError
    });
    completionFollowUpStatus = resolvedFollowUp.completionFollowUpStatus;
    completionFollowUpError = resolvedFollowUp.completionFollowUpError;
  }

  await persistEnrollmentPacketCompletionFollowUpState({
    request: input.request,
    memberId: input.member.id,
    status: completionFollowUpStatus,
    error: completionFollowUpError
  });

  return {
    failedMappingRunId: cascadeResult.failedMappingRunId,
    mappingSyncStatus: cascadeResult.mappingSummary.status ?? input.fallbackMappingSyncStatus,
    completionFollowUpError,
    submitResult: buildPublicEnrollmentPacketSubmitResult({
      packetId: input.request.id,
      memberId: input.member.id,
      mappingSyncStatus: cascadeResult.mappingSummary.status ?? input.fallbackMappingSyncStatus,
      completionFollowUpStatus,
      completionFollowUpError,
      wasAlreadyFiled: false
    })
  };
}
