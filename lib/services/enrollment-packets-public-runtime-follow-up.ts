import "server-only";

import {
  buildPublicEnrollmentPacketSubmitResult
} from "@/lib/services/enrollment-packet-public-helpers";
import { clean } from "@/lib/services/enrollment-packet-core";
import { loadEnrollmentPacketArtifactOps } from "@/lib/services/enrollment-packet-mapping-runtime";
import {
  recordImmediateSystemAlert,
  recordWorkflowEvent
} from "@/lib/services/workflow-observability";
import { toEasternISO } from "@/lib/timezone";
import type { EnrollmentPacketRequestRow } from "@/lib/services/enrollment-packet-types";

export function buildEnrollmentPacketPostCommitFollowUpMessage(input: {
  existingMessage?: string | null;
  reason: string;
}) {
  const existingMessage = clean(input.existingMessage);
  if (existingMessage) return existingMessage;

  const reason = clean(input.reason);
  return reason
    ? `Enrollment packet was completed, but post-commit follow-up still needs staff review (${reason}). Review the packet and complete the downstream handoff before relying on MCC/MHP/POF data.`
    : "Enrollment packet was completed, but post-commit follow-up still needs staff review. Review the packet and complete the downstream handoff before relying on MCC/MHP/POF data.";
}

export async function recordEnrollmentPacketPostCommitFollowUpFailure(input: {
  request: EnrollmentPacketRequestRow;
  memberId: string;
  reason: string;
  mappingSyncStatus: string | null | undefined;
  completionFollowUpError: string;
  mappingRunId: string | null;
  uploadBatchId: string | null;
}) {
  try {
    await recordWorkflowEvent({
      eventType: "enrollment_packet_post_commit_follow_up_failed",
      entityType: "enrollment_packet_request",
      entityId: input.request.id,
      actorType: "user",
      actorUserId: input.request.sender_user_id,
      status: "failed",
      severity: "high",
      metadata: {
        member_id: input.memberId,
        lead_id: input.request.lead_id,
        error: input.reason,
        mapping_sync_status: input.mappingSyncStatus ?? null,
        completion_follow_up_error: input.completionFollowUpError,
        mapping_run_id: input.mappingRunId,
        upload_batch_id: input.uploadBatchId
      }
    });
  } catch (workflowEventError) {
    console.error("[enrollment-packets] unable to record post-commit follow-up workflow event", workflowEventError);
  }

  try {
    await recordImmediateSystemAlert({
      entityType: "enrollment_packet_request",
      entityId: input.request.id,
      actorUserId: input.request.sender_user_id,
      severity: "high",
      alertKey: "enrollment_packet_post_commit_follow_up_failed",
      metadata: {
        member_id: input.memberId,
        lead_id: input.request.lead_id,
        error: input.reason,
        mapping_sync_status: input.mappingSyncStatus ?? null,
        completion_follow_up_error: input.completionFollowUpError,
        mapping_run_id: input.mappingRunId,
        upload_batch_id: input.uploadBatchId
      }
    });
  } catch (alertError) {
    console.error("[enrollment-packets] unable to persist post-commit follow-up alert", alertError);
  }
}

function buildEnrollmentPacketCompletionAgreementMessage(input: {
  operationalReadinessStatus: string;
  senderNotificationDelivered: boolean;
  leadActivitySynced: boolean;
  completedPacketArtifactLinked: boolean;
  operationalShellsReady: boolean;
  hasLead: boolean;
}) {
  const issues: string[] = [];
  if (input.operationalReadinessStatus !== "operationally_ready") {
    issues.push("downstream mapping is not fully complete");
  }
  if (!input.completedPacketArtifactLinked) {
    issues.push("completed packet artifact linkage did not finalize");
  }
  if (!input.operationalShellsReady) {
    issues.push("member operational shell sync did not finalize");
  }
  if (!input.senderNotificationDelivered) {
    issues.push("sender notification did not finalize");
  }
  if (input.hasLead && !input.leadActivitySynced) {
    issues.push("lead activity sync did not finalize");
  }

  if (issues.length === 0) return null;
  return `Enrollment packet was filed, but ${issues.join(", ")}. Staff should repair the packet workflow before treating this member as operationally ready.`;
}

export async function resolveEnrollmentPacketCompletionFollowUp(input: {
  request: EnrollmentPacketRequestRow;
  memberId: string;
  operationalReadinessStatus: string;
  senderNotificationDelivered: boolean;
  leadActivitySynced: boolean;
  completedPacketArtifactLinked: boolean;
  operationalShellsReady: boolean;
  source: string;
  currentStatus: "pending" | "completed" | "action_required";
  currentError: string | null;
}) {
  const message = buildEnrollmentPacketCompletionAgreementMessage({
    operationalReadinessStatus: input.operationalReadinessStatus,
    senderNotificationDelivered: input.senderNotificationDelivered,
    leadActivitySynced: input.leadActivitySynced,
    completedPacketArtifactLinked: input.completedPacketArtifactLinked,
    operationalShellsReady: input.operationalShellsReady,
    hasLead: Boolean(input.request.lead_id)
  });

  let completionFollowUpStatus = input.currentStatus;
  let completionFollowUpError = input.currentError;

  if (message) {
    completionFollowUpStatus = "action_required";
    completionFollowUpError = message;
    await recordImmediateSystemAlert({
      entityType: "enrollment_packet_request",
      entityId: input.request.id,
      actorUserId: input.request.sender_user_id,
      severity: "high",
      alertKey: "enrollment_packet_completion_consensus_failed",
      metadata: {
        member_id: input.request.member_id,
        lead_id: input.request.lead_id,
        operational_readiness_status: input.operationalReadinessStatus,
        sender_notification_delivered: input.senderNotificationDelivered,
        lead_activity_synced: input.leadActivitySynced,
        completed_packet_artifact_linked: input.completedPacketArtifactLinked,
        operational_shells_ready: input.operationalShellsReady,
        source: input.source
      }
    });
  } else if (completionFollowUpStatus === "pending") {
    completionFollowUpStatus = "completed";
    completionFollowUpError = null;
  }

  return {
    completionFollowUpStatus,
    completionFollowUpError
  };
}

export async function persistEnrollmentPacketCompletionFollowUpState(input: {
  request: EnrollmentPacketRequestRow;
  memberId: string;
  status: "pending" | "completed" | "action_required";
  error: string | null;
}) {
  try {
    const artifactOps = await loadEnrollmentPacketArtifactOps();
    await artifactOps.updateEnrollmentPacketCompletionFollowUpState({
      packetId: input.request.id,
      status: input.status,
      checkedAt: toEasternISO(),
      error: input.error
    });
  } catch (followUpStateError) {
    const message =
      followUpStateError instanceof Error
        ? followUpStateError.message
        : "Unable to persist enrollment packet completion follow-up state.";
    console.error("[enrollment-packets] unable to persist completion follow-up state", followUpStateError);
    await recordImmediateSystemAlert({
      entityType: "enrollment_packet_request",
      entityId: input.request.id,
      actorUserId: input.request.sender_user_id,
      severity: "high",
      alertKey: "enrollment_packet_completion_follow_up_state_failed",
      metadata: {
        member_id: input.memberId,
        lead_id: input.request.lead_id,
        status: input.status,
        error: message
      }
    });
  }
}

export async function buildEnrollmentPacketPostCommitFailureResult(input: {
  request: EnrollmentPacketRequestRow;
  memberId: string;
  mappingSyncStatus: string;
  reason: string;
  existingCompletionFollowUpError: string | null;
  mappingRunId: string | null;
  uploadBatchId: string | null;
}) {
  const followUpMessage = buildEnrollmentPacketPostCommitFollowUpMessage({
    existingMessage: input.existingCompletionFollowUpError,
    reason: input.reason
  });

  console.error("[enrollment-packets] post-commit follow-up failed after enrollment packet finalization", {
    packetId: input.request.id,
    message: input.reason
  });

  try {
    const artifactOps = await loadEnrollmentPacketArtifactOps();
    await artifactOps.updateEnrollmentPacketCompletionFollowUpState({
      packetId: input.request.id,
      status: "action_required",
      checkedAt: toEasternISO(),
      error: followUpMessage
    });
  } catch (followUpStateError) {
    console.error("[enrollment-packets] unable to persist committed post-commit follow-up state", followUpStateError);
  }

  await recordEnrollmentPacketPostCommitFollowUpFailure({
    request: input.request,
    memberId: input.memberId,
    reason: input.reason,
    mappingSyncStatus: input.mappingSyncStatus,
    completionFollowUpError: followUpMessage,
    mappingRunId: input.mappingRunId,
    uploadBatchId: input.uploadBatchId
  });

  return buildPublicEnrollmentPacketSubmitResult({
    packetId: input.request.id,
    memberId: input.memberId,
    mappingSyncStatus: input.mappingSyncStatus,
    completionFollowUpStatus: "action_required",
    completionFollowUpError: followUpMessage,
    wasAlreadyFiled: false
  });
}
