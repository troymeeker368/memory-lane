import "server-only";

import {
  clean,
  isMissingRpcFunctionError,
  isRowFoundError,
  throwEnrollmentPacketSchemaError
} from "@/lib/services/enrollment-packet-core";
import { mapEnrollmentPacketToDownstream } from "@/lib/services/enrollment-packet-intake-mapping";
import { recordWorkflowMilestone } from "@/lib/services/lifecycle-milestones";
import {
  recordImmediateSystemAlert,
  recordWorkflowEvent
} from "@/lib/services/workflow-observability";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";
import { toEasternISO } from "@/lib/timezone";
import type {
  EnrollmentPacketFieldsRow,
  EnrollmentPacketRequestRow,
  EnrollmentPacketUploadCategory,
  LeadRow,
  MemberRow,
  SenderProfileRow
} from "@/lib/services/enrollment-packet-types";

type EnrollmentPacketMemberFileArtifact = {
  uploadCategory: EnrollmentPacketUploadCategory;
  memberFileId: string | null;
};

type EnrollmentPacketDownstreamMappingResult = {
  mappingRunId: string | null;
  downstreamSystemsUpdated: string[];
  conflictsRequiringReview: number;
  status: "completed" | "failed";
  error?: string | null;
};

type ClaimedEnrollmentPacketRetryRow = Pick<
  EnrollmentPacketRequestRow,
  | "id"
  | "member_id"
  | "lead_id"
  | "sender_user_id"
  | "caregiver_email"
  | "status"
  | "mapping_sync_status"
  | "mapping_sync_error"
  | "mapping_sync_attempted_at"
  | "latest_mapping_run_id"
>;

const CLAIM_ENROLLMENT_PACKET_MAPPING_RETRIES_RPC = "rpc_claim_enrollment_packet_mapping_retries";
const CLAIM_ENROLLMENT_PACKET_MAPPING_RETRIES_MIGRATION =
  "0120_enrollment_packet_mapping_retry_claim_rpc.sql";

export async function loadEnrollmentPacketArtifactOps() {
  return import("@/lib/services/enrollment-packet-artifacts");
}

export async function getMemberById(memberId: string) {
  const admin = createSupabaseAdminClient();
  const { ENROLLMENT_PACKET_MEMBER_LOOKUP_SELECT } = await import("@/lib/services/enrollment-packet-selects");
  const { data, error } = await admin
    .from("members")
    .select(ENROLLMENT_PACKET_MEMBER_LOOKUP_SELECT)
    .eq("id", memberId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as MemberRow | null) ?? null;
}

export async function getLeadById(leadId: string) {
  const admin = createSupabaseAdminClient();
  const { ENROLLMENT_PACKET_LEAD_LOOKUP_SELECT } = await import("@/lib/services/enrollment-packet-selects");
  const { data, error } = await admin
    .from("leads")
    .select(ENROLLMENT_PACKET_LEAD_LOOKUP_SELECT)
    .eq("id", leadId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as LeadRow | null) ?? null;
}

export async function loadRequestById(packetId: string) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("enrollment_packet_requests")
    .select("*")
    .eq("id", packetId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as EnrollmentPacketRequestRow | null) ?? null;
}

export async function loadPacketFields(packetId: string) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("enrollment_packet_fields")
    .select("*")
    .eq("packet_id", packetId)
    .maybeSingle();
  if (error) throwEnrollmentPacketSchemaError(error, "enrollment_packet_fields");
  return (data as EnrollmentPacketFieldsRow | null) ?? null;
}

export async function addLeadActivity(input: {
  leadId: string;
  memberName: string | null;
  activityType: string;
  outcome: string;
  notes: string;
  completedByUserId: string;
  completedByName: string;
  activityAt?: string;
}) {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("lead_activities").insert({
    lead_id: input.leadId,
    member_name: input.memberName,
    activity_at: input.activityAt ?? toEasternISO(),
    activity_type: input.activityType,
    outcome: input.outcome,
    notes: input.notes,
    completed_by_user_id: input.completedByUserId,
    completed_by_name: input.completedByName
  });
  if (!error) return true;

  console.error("[enrollment-packets] lead activity insert failed after committed workflow write", {
    leadId: input.leadId,
    activityType: input.activityType,
    message: error.message
  });
  try {
    await recordImmediateSystemAlert({
      entityType: "lead",
      entityId: input.leadId,
      actorUserId: input.completedByUserId,
      severity: "medium",
      alertKey: "lead_activity_insert_failed",
      metadata: {
        activity_type: input.activityType,
        outcome: input.outcome,
        error: error.message
      }
    });
  } catch (alertError) {
    const alertMessage = alertError instanceof Error ? alertError.message : "Unknown system alert error.";
    console.error("[enrollment-packets] system alert insert failed after lead activity insert failure", {
      leadId: input.leadId,
      activityType: input.activityType,
      message: alertMessage
    });
  }
  return false;
}

async function addLeadActivityStrict(input: {
  leadId: string;
  memberName: string | null;
  activityType: string;
  outcome: string;
  notes: string;
  completedByUserId: string;
  completedByName: string;
  activityAt?: string;
}) {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("lead_activities").insert({
    lead_id: input.leadId,
    member_name: input.memberName,
    activity_at: input.activityAt ?? toEasternISO(),
    activity_type: input.activityType,
    outcome: input.outcome,
    notes: input.notes,
    completed_by_user_id: input.completedByUserId,
    completed_by_name: input.completedByName
  });
  if (error) throw new Error(error.message);
}

export async function syncEnrollmentPacketLeadActivityOrQueue(input: {
  packetId: string;
  memberId: string;
  leadId: string;
  memberName: string | null;
  activityType: string;
  outcome: string;
  notes: string;
  completedByUserId: string;
  completedByName: string;
  activityAt?: string;
  actionUrl: string;
}) {
  try {
    await addLeadActivityStrict({
      leadId: input.leadId,
      memberName: input.memberName,
      activityType: input.activityType,
      outcome: input.outcome,
      notes: input.notes,
      completedByUserId: input.completedByUserId,
      completedByName: input.completedByName,
      activityAt: input.activityAt
    });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to sync enrollment packet lead activity.";
    console.error("[enrollment-packets] lead activity insert failed after committed workflow write", {
      leadId: input.leadId,
      activityType: input.activityType,
      message
    });
    const { queueEnrollmentPacketFollowUpTask } = await import("@/lib/services/enrollment-packet-follow-up");
    await queueEnrollmentPacketFollowUpTask({
      packetId: input.packetId,
      memberId: input.memberId,
      leadId: input.leadId,
      taskType: "lead_activity_sync",
      actionUrl: input.actionUrl,
      actorUserId: input.completedByUserId,
      actorName: input.completedByName,
      errorMessage: message,
      payload: {
        activityType: input.activityType,
        outcome: input.outcome,
        notes: input.notes,
        activityAt: input.activityAt ?? null
      }
    });
    return false;
  }
}

export async function recordEnrollmentPacketActionRequired(input: {
  packetId: string;
  memberId: string;
  leadId?: string | null;
  actorUserId: string;
  title: string;
  message: string;
  actionUrl: string;
  eventKeySuffix: string;
}) {
  const milestone = await recordWorkflowMilestone({
    event: {
      eventType: "action_required",
      entityType: "enrollment_packet_request",
      entityId: input.packetId,
      actorType: "user",
      actorUserId: input.actorUserId,
      status: "open",
      severity: "high",
      eventKeySuffix: input.eventKeySuffix,
      reopenOnConflict: true,
      requireRecipients: true,
      metadata: {
        member_id: input.memberId,
        lead_id: input.leadId ?? null,
        title: input.title,
        message: input.message,
        priority: "high",
        action_url: input.actionUrl
      }
    }
  });

  if (!milestone.delivered) {
    console.error("[enrollment-packets] unable to deliver action-required workflow milestone", milestone.failureReason);
    const { queueEnrollmentPacketFollowUpTask } = await import("@/lib/services/enrollment-packet-follow-up");
    await queueEnrollmentPacketFollowUpTask({
      packetId: input.packetId,
      memberId: input.memberId,
      leadId: input.leadId ?? null,
      taskType: "critical_notification_delivery",
      actionUrl: input.actionUrl,
      actorUserId: input.actorUserId,
      errorMessage: milestone.failureReason ?? "Action-required milestone delivery failed.",
      payload: {
        title: input.title,
        message: input.message,
        eventKeySuffix: input.eventKeySuffix
      },
      emitMilestone: false
    });
  }
}

export async function listEnrollmentPacketMemberFileArtifacts(packetId: string): Promise<EnrollmentPacketMemberFileArtifact[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("enrollment_packet_uploads")
    .select("upload_category, member_file_id")
    .eq("packet_id", packetId)
    .order("uploaded_at", { ascending: true });
  if (error) throwEnrollmentPacketSchemaError(error, "enrollment_packet_uploads");
  return ((data ?? []) as Array<{ upload_category: EnrollmentPacketUploadCategory; member_file_id: string | null }>).map((row) => ({
    uploadCategory: row.upload_category,
    memberFileId: row.member_file_id
  }));
}

export async function runEnrollmentPacketDownstreamMapping(input: {
  request: EnrollmentPacketRequestRow;
  member: MemberRow;
  fields: EnrollmentPacketFieldsRow;
  senderSignatureName: string;
  caregiverEmail: string | null;
  memberFileArtifacts: EnrollmentPacketMemberFileArtifact[];
  actorType: "user" | "system";
}) {
  const artifactOps = await loadEnrollmentPacketArtifactOps();
  let failedMappingRunId: string | null = null;

  try {
    const downstreamMapping = await mapEnrollmentPacketToDownstream({
      packetId: input.request.id,
      memberId: input.member.id,
      senderUserId: input.request.sender_user_id,
      senderName: input.senderSignatureName,
      senderEmail: null,
      caregiverEmail: input.caregiverEmail,
      fields: input.fields,
      memberFileArtifacts: input.memberFileArtifacts
    });

    await recordWorkflowEvent({
      eventType: "enrollment_packet_mapping_completed",
      entityType: "enrollment_packet_request",
      entityId: input.request.id,
      actorType: input.actorType,
      actorUserId: input.request.sender_user_id,
      status: "completed",
      severity: "low",
      metadata: {
        member_id: input.member.id,
        lead_id: input.request.lead_id,
        mapping_run_id: downstreamMapping.mappingRunId,
        downstream_systems_updated: downstreamMapping.downstreamSystemsUpdated,
        conflicts_requiring_review: downstreamMapping.conflictsRequiringReview
      }
    });

    return {
      mappingRunId: downstreamMapping.mappingRunId,
      downstreamSystemsUpdated: downstreamMapping.downstreamSystemsUpdated,
      conflictsRequiringReview: downstreamMapping.conflictsRequiringReview,
      status: "completed"
    } satisfies EnrollmentPacketDownstreamMappingResult;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Enrollment packet mapping failed.";
    const attemptedAt = toEasternISO();
    const packetAfterFailure = await loadRequestById(input.request.id);
    failedMappingRunId = packetAfterFailure?.latest_mapping_run_id ?? failedMappingRunId;

    try {
      await artifactOps.updateEnrollmentPacketMappingSyncState({
        packetId: input.request.id,
        status: "failed",
        attemptedAt,
        error: reason,
        mappingRunId: failedMappingRunId
      });
    } catch (syncStateError) {
      console.error("[enrollment-packets] unable to persist mapping failure state", syncStateError);
    }

    await recordWorkflowEvent({
      eventType: "enrollment_packet_mapping_failed",
      entityType: "enrollment_packet_request",
      entityId: input.request.id,
      actorType: input.actorType,
      actorUserId: input.request.sender_user_id,
      status: "failed",
      severity: "high",
      metadata: {
        member_id: input.member.id,
        lead_id: input.request.lead_id,
        error: reason,
        mapping_run_id: failedMappingRunId
      }
    });
    await recordWorkflowMilestone({
      event: {
        eventType: "enrollment_packet_failed",
        entityType: "enrollment_packet_request",
        entityId: input.request.id,
        actorType: input.actorType,
        actorUserId: input.request.sender_user_id,
        status: "failed",
        severity: "high",
        metadata: {
          member_id: input.member.id,
          lead_id: input.request.lead_id,
          phase: "mapping",
          error: reason
        }
      }
    });
    await recordImmediateSystemAlert({
      entityType: "enrollment_packet_request",
      entityId: input.request.id,
      actorUserId: input.request.sender_user_id,
      severity: "high",
      alertKey: "enrollment_packet_mapping_failed",
      metadata: {
        member_id: input.member.id,
        lead_id: input.request.lead_id,
        error: reason,
        mapping_run_id: failedMappingRunId
      }
    });
    await recordEnrollmentPacketActionRequired({
      packetId: input.request.id,
      memberId: input.member.id,
      leadId: input.request.lead_id,
      actorUserId: input.request.sender_user_id,
      title: "Enrollment Packet Downstream Sync Failed",
      message:
        "The enrollment packet was filed, but downstream sync to MCC/MHP/POF staging failed. Review the member record and retry the sync before treating the handoff as complete.",
      actionUrl: `/operations/member-command-center/${input.member.id}`,
      eventKeySuffix: "mapping-failed"
    });

    return {
      mappingRunId: failedMappingRunId,
      downstreamSystemsUpdated: [],
      conflictsRequiringReview: 0,
      status: "failed",
      error: reason
    } satisfies EnrollmentPacketDownstreamMappingResult;
  }
}

export async function getEnrollmentPacketSenderSignatureProfile(userId: string) {
  const normalizedUserId = clean(userId);
  if (!normalizedUserId) throw new Error("User ID is required.");
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("enrollment_packet_sender_signatures")
    .select("*")
    .eq("user_id", normalizedUserId)
    .maybeSingle();
  if (error && !isRowFoundError(error)) throw new Error(error.message);
  return (data as SenderProfileRow | null) ?? null;
}

export async function retryFailedEnrollmentPacketMappings(input?: { limit?: number }) {
  const limit = Math.min(100, Math.max(1, input?.limit ?? 25));
  const artifactOps = await loadEnrollmentPacketArtifactOps();
  const admin = createSupabaseAdminClient();
  let claimedRows: ClaimedEnrollmentPacketRetryRow[];
  try {
    const claimed = await invokeSupabaseRpcOrThrow<unknown>(admin, CLAIM_ENROLLMENT_PACKET_MAPPING_RETRIES_RPC, {
      p_limit: limit,
      p_now: toEasternISO(),
      p_actor_user_id: null,
      p_actor_name: "Enrollment Packet Mapping Retry Runner"
    });
    claimedRows = (Array.isArray(claimed) ? claimed : []) as ClaimedEnrollmentPacketRetryRow[];
  } catch (error) {
    if (isMissingRpcFunctionError(error, CLAIM_ENROLLMENT_PACKET_MAPPING_RETRIES_RPC)) {
      throw new Error(
        `Enrollment packet mapping retry claim RPC is not available. Apply Supabase migration ${CLAIM_ENROLLMENT_PACKET_MAPPING_RETRIES_MIGRATION} and refresh PostgREST schema cache.`
      );
    }
    throw error;
  }

  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  for (const row of claimedRows) {
    processed += 1;
    const request = row as EnrollmentPacketRequestRow;
    const attemptedAt = toEasternISO();

    try {
      const [member, fields, senderSignatureName, memberFileArtifacts] = await Promise.all([
        getMemberById(request.member_id),
        loadPacketFields(request.id),
        getEnrollmentPacketSenderSignatureProfile(request.sender_user_id).then((profile) => profile?.signature_name ?? "Staff"),
        listEnrollmentPacketMemberFileArtifacts(request.id)
      ]);

      if (!member) {
        throw new Error("Member record was not found for enrollment packet mapping retry.");
      }
      if (!fields) {
        throw new Error("Enrollment packet fields are missing for mapping retry.");
      }

      await artifactOps.updateEnrollmentPacketMappingSyncState({
        packetId: request.id,
        status: "pending",
        attemptedAt,
        error: null,
        mappingRunId: request.latest_mapping_run_id,
        clearClaim: false
      });

      const mappingSummary = await runEnrollmentPacketDownstreamMapping({
        request,
        member,
        fields,
        senderSignatureName,
        caregiverEmail: request.caregiver_email,
        memberFileArtifacts,
        actorType: "system"
      });

      if (mappingSummary.status === "completed") {
        succeeded += 1;
        try {
          await artifactOps.releaseEnrollmentPacketMappingClaim({
            packetId: request.id,
            updatedAt: toEasternISO()
          });
        } catch (claimReleaseError) {
          console.error("[enrollment-packets] unable to release mapping retry claim after successful retry", claimReleaseError);
          await recordImmediateSystemAlert({
            entityType: "enrollment_packet_request",
            entityId: request.id,
            actorUserId: request.sender_user_id,
            severity: "medium",
            alertKey: "enrollment_packet_mapping_retry_claim_release_failed",
            metadata: {
              member_id: request.member_id,
              lead_id: request.lead_id,
              mapping_run_id: mappingSummary.mappingRunId,
              error:
                claimReleaseError instanceof Error
                  ? claimReleaseError.message
                  : "Unable to release enrollment packet mapping retry claim."
            }
          });
        }
      } else {
        failed += 1;
      }
    } catch (retryError) {
      failed += 1;
      const reason = retryError instanceof Error ? retryError.message : "Enrollment packet mapping retry failed.";
      try {
        await artifactOps.updateEnrollmentPacketMappingSyncState({
          packetId: request.id,
          status: "failed",
          attemptedAt,
          error: reason,
          mappingRunId: request.latest_mapping_run_id
        });
      } catch (stateError) {
        console.error("[enrollment-packets] unable to persist mapping retry failure state", stateError);
      }
      await recordImmediateSystemAlert({
        entityType: "enrollment_packet_request",
        entityId: request.id,
        actorUserId: request.sender_user_id,
        severity: "high",
        alertKey: "enrollment_packet_mapping_retry_failed",
        metadata: {
          member_id: request.member_id,
          lead_id: request.lead_id,
          error: reason,
          mapping_run_id: request.latest_mapping_run_id
        }
      });
    }
  }

  return {
    processed,
    succeeded,
    failed
  };
}
