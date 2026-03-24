import "server-only";

import { recordWorkflowMilestone } from "@/lib/services/lifecycle-milestones";
import {
  recordImmediateSystemAlert,
  recordWorkflowEvent
} from "@/lib/services/workflow-observability";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";
import { toEasternISO } from "@/lib/timezone";

export const ENROLLMENT_PACKET_FOLLOW_UP_TASK_TYPES = [
  "lead_activity_sync",
  "critical_notification_delivery"
] as const;

export type EnrollmentPacketFollowUpTaskType = (typeof ENROLLMENT_PACKET_FOLLOW_UP_TASK_TYPES)[number];
export type EnrollmentPacketFollowUpStatus = "action_required" | "completed";

const RPC_CLAIM_ENROLLMENT_PACKET_FOLLOW_UP_TASK = "rpc_claim_enrollment_packet_follow_up_task";
const ENROLLMENT_PACKET_FOLLOW_UP_CLAIM_MIGRATION = "0128_intake_follow_up_retry_claims.sql";

type EnrollmentPacketFollowUpQueueRow = {
  id: string;
  packet_id: string;
  member_id: string;
  lead_id: string | null;
  task_type: EnrollmentPacketFollowUpTaskType;
  status: EnrollmentPacketFollowUpStatus;
  title: string;
  message: string;
  action_url: string;
  payload: Record<string, unknown> | null;
  attempt_count: number;
  last_error: string | null;
  last_attempted_at: string | null;
  claimed_at: string | null;
  claimed_by_user_id: string | null;
  claimed_by_name: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

export type EnrollmentPacketFollowUpTask = {
  id: string;
  packetId: string;
  memberId: string;
  leadId: string | null;
  taskType: EnrollmentPacketFollowUpTaskType;
  status: EnrollmentPacketFollowUpStatus;
  title: string;
  message: string;
  actionUrl: string;
  payload: Record<string, unknown> | null;
  attemptCount: number;
  lastError: string | null;
  lastAttemptedAt: string | null;
  claimedAt: string | null;
  claimedByUserId: string | null;
  claimedByName: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const ENROLLMENT_PACKET_FOLLOW_UP_QUEUE_SELECT =
  "id, packet_id, member_id, lead_id, task_type, status, title, message, action_url, payload, attempt_count, last_error, last_attempted_at, claimed_at, claimed_by_user_id, claimed_by_name, resolved_at, created_at, updated_at";
const ENROLLMENT_PACKET_FOLLOW_UP_QUEUE_UNIQUE_CONSTRAINT = "enrollment_packet_follow_up_queue_packet_task_unique";

function clean(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function isUniqueConstraintError(error: { code?: string | null; message?: string | null; details?: string | null } | null) {
  if (!error) return false;
  if (error.code === "23505") return true;
  const message = `${error.message ?? ""} ${error.details ?? ""}`;
  return message.includes(ENROLLMENT_PACKET_FOLLOW_UP_QUEUE_UNIQUE_CONSTRAINT);
}

function mapQueueRow(row: EnrollmentPacketFollowUpQueueRow): EnrollmentPacketFollowUpTask {
  return {
    id: String(row.id),
    packetId: String(row.packet_id),
    memberId: String(row.member_id),
    leadId: clean(row.lead_id),
    taskType: row.task_type,
    status: row.status,
    title: String(row.title),
    message: String(row.message),
    actionUrl: String(row.action_url),
    payload: row.payload ?? null,
    attemptCount: Math.max(0, Number(row.attempt_count ?? 0)),
    lastError: clean(row.last_error),
    lastAttemptedAt: clean(row.last_attempted_at),
    claimedAt: clean(row.claimed_at),
    claimedByUserId: clean(row.claimed_by_user_id),
    claimedByName: clean(row.claimed_by_name),
    resolvedAt: clean(row.resolved_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

async function loadEnrollmentPacketLineage(packetId: string) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("enrollment_packet_requests")
    .select("id, member_id, lead_id")
    .eq("id", packetId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.member_id) {
    throw new Error("Enrollment packet request not found for follow-up queue.");
  }
  return {
    memberId: String(data.member_id),
    leadId: clean(data.lead_id)
  };
}

function buildMissingEnrollmentPacketClaimRpcMessage() {
  return `Enrollment packet follow-up claim RPC is not available. Apply Supabase migration ${ENROLLMENT_PACKET_FOLLOW_UP_CLAIM_MIGRATION} and refresh PostgREST schema cache.`;
}

async function loadEnrollmentPacketFollowUpQueueRow(input: {
  packetId: string;
  taskType: EnrollmentPacketFollowUpTaskType;
}) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("enrollment_packet_follow_up_queue")
    .select(ENROLLMENT_PACKET_FOLLOW_UP_QUEUE_SELECT)
    .eq("packet_id", input.packetId)
    .eq("task_type", input.taskType)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as EnrollmentPacketFollowUpQueueRow | null) ?? null;
}

export async function claimEnrollmentPacketFollowUpTask(input: {
  packetId: string;
  taskType: EnrollmentPacketFollowUpTaskType;
  actorUserId?: string | null;
  actorName?: string | null;
  claimedAt?: string | null;
}) {
  const admin = createSupabaseAdminClient();
  try {
    const data = await invokeSupabaseRpcOrThrow<unknown>(admin, RPC_CLAIM_ENROLLMENT_PACKET_FOLLOW_UP_TASK, {
      p_packet_id: input.packetId,
      p_task_type: input.taskType,
      p_now: clean(input.claimedAt) ?? toEasternISO(),
      p_actor_user_id: clean(input.actorUserId),
      p_actor_name: clean(input.actorName)
    });
    const row = (Array.isArray(data) ? data[0] : null) as EnrollmentPacketFollowUpQueueRow | null;
    return row ? mapQueueRow(row) : null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to claim enrollment packet follow-up task.";
    if (message.includes(RPC_CLAIM_ENROLLMENT_PACKET_FOLLOW_UP_TASK)) {
      throw new Error(buildMissingEnrollmentPacketClaimRpcMessage());
    }
    throw error;
  }
}

export async function releaseEnrollmentPacketFollowUpTaskClaim(input: {
  packetId: string;
  taskType: EnrollmentPacketFollowUpTaskType;
  updatedAt?: string | null;
}) {
  const admin = createSupabaseAdminClient();
  const existing = await loadEnrollmentPacketFollowUpQueueRow({
    packetId: input.packetId,
    taskType: input.taskType
  });
  if (!existing || existing.status !== "action_required") {
    return existing ? mapQueueRow(existing) : null;
  }

  const { data, error } = await admin
    .from("enrollment_packet_follow_up_queue")
    .update({
      claimed_at: null,
      claimed_by_user_id: null,
      claimed_by_name: null,
      updated_at: clean(input.updatedAt) ?? toEasternISO()
    })
    .eq("id", existing.id)
    .select(ENROLLMENT_PACKET_FOLLOW_UP_QUEUE_SELECT)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapQueueRow(data as EnrollmentPacketFollowUpQueueRow) : null;
}

function buildTaskPresentation(taskType: EnrollmentPacketFollowUpTaskType, actionUrl: string) {
  if (taskType === "lead_activity_sync") {
    return {
      title: "Enrollment Packet Lead Activity Repair Needed",
      message:
        "The enrollment packet workflow succeeded, but sales lead activity history still needs repair so follow-up stays aligned.",
      actionUrl,
      alertKey: "enrollment_packet_lead_activity_follow_up_required",
      eventKeySuffix: "lead-activity-follow-up"
    } as const;
  }

  return {
    title: "Enrollment Packet Notification Delivery Repair Needed",
    message:
      "A critical action-required enrollment follow-up could not be delivered to staff. Review and repair operational ownership before relying on notification delivery alone.",
    actionUrl,
    alertKey: "enrollment_packet_notification_follow_up_required",
    eventKeySuffix: "notification-delivery-follow-up"
  } as const;
}

export async function queueEnrollmentPacketFollowUpTask(input: {
  packetId: string;
  memberId: string;
  leadId?: string | null;
  taskType: EnrollmentPacketFollowUpTaskType;
  actionUrl: string;
  actorUserId?: string | null;
  actorName?: string | null;
  errorMessage: string;
  payload?: Record<string, unknown>;
  emitMilestone?: boolean;
}) {
  const admin = createSupabaseAdminClient();
  const now = toEasternISO();
  const canonicalLineage = await loadEnrollmentPacketLineage(input.packetId);
  const requestedMemberId = clean(input.memberId);
  const requestedLeadId = clean(input.leadId);
  if (requestedMemberId && requestedMemberId !== canonicalLineage.memberId) {
    throw new Error("Enrollment packet follow-up member_id does not match the canonical enrollment packet member.");
  }
  if (requestedLeadId !== null && requestedLeadId !== canonicalLineage.leadId) {
    throw new Error("Enrollment packet follow-up lead_id does not match the canonical enrollment packet lead.");
  }
  const actorUserId = clean(input.actorUserId);
  const actorName = clean(input.actorName);
  const errorMessage = clean(input.errorMessage) ?? "Unknown enrollment follow-up failure.";
  const presentation = buildTaskPresentation(input.taskType, input.actionUrl);
  let attemptCount = 1;

  const rowPatch = {
    member_id: canonicalLineage.memberId,
    lead_id: canonicalLineage.leadId,
    task_type: input.taskType,
    status: "action_required" as const,
    title: presentation.title,
    message: presentation.message,
    action_url: presentation.actionUrl,
    payload: input.payload ?? {},
    attempt_count: attemptCount,
    last_error: errorMessage,
    last_attempted_at: now,
    claimed_at: null,
    claimed_by_user_id: null,
    claimed_by_name: null,
    resolved_at: null,
    updated_by_user_id: actorUserId,
    updated_by_name: actorName,
    updated_at: now
  };

  let savedRow: EnrollmentPacketFollowUpQueueRow | null = null;
  const { data: insertedRow, error: insertError } = await admin
    .from("enrollment_packet_follow_up_queue")
    .insert({
      packet_id: input.packetId,
      created_by_user_id: actorUserId,
      created_by_name: actorName,
      created_at: now,
      ...rowPatch
    })
    .select(ENROLLMENT_PACKET_FOLLOW_UP_QUEUE_SELECT)
    .maybeSingle();

  if (!insertError) {
    savedRow = (insertedRow as EnrollmentPacketFollowUpQueueRow | null) ?? null;
  } else if (isUniqueConstraintError(insertError)) {
    const existing = await loadEnrollmentPacketFollowUpQueueRow({
      packetId: input.packetId,
      taskType: input.taskType
    });
    if (!existing) {
      throw new Error("Enrollment packet follow-up queue conflict was detected, but the canonical queue row could not be reloaded.");
    }
    attemptCount = Math.max(0, Number(existing.attempt_count ?? 0)) + 1;
    const { data, error } = await admin
      .from("enrollment_packet_follow_up_queue")
      .update({
        ...rowPatch,
        attempt_count: attemptCount
      })
      .eq("id", existing.id)
      .select(ENROLLMENT_PACKET_FOLLOW_UP_QUEUE_SELECT)
      .maybeSingle();
    if (error) throw new Error(error.message);
    savedRow = (data as EnrollmentPacketFollowUpQueueRow | null) ?? null;
  } else {
    throw new Error(insertError.message);
  }

  attemptCount = Math.max(0, Number(savedRow?.attempt_count ?? attemptCount));

  await recordWorkflowEvent({
    eventType: "enrollment_packet_follow_up_queued",
    entityType: "enrollment_packet_request",
    entityId: input.packetId,
    actorType: actorUserId ? "user" : "system",
    actorUserId,
    status: "action_required",
    severity: "high",
    metadata: {
      member_id: canonicalLineage.memberId,
      lead_id: canonicalLineage.leadId,
      follow_up_task_type: input.taskType,
      attempt_count: attemptCount,
      action_url: presentation.actionUrl,
      error: errorMessage
    }
  });

  if (input.emitMilestone !== false) {
    try {
      await recordWorkflowMilestone({
        event: {
          eventType: "action_required",
          entityType: "enrollment_packet_request",
          entityId: input.packetId,
          actorType: actorUserId ? "user" : "system",
          actorUserId,
          status: "open",
          severity: "high",
          eventKeySuffix: presentation.eventKeySuffix,
          reopenOnConflict: true,
          requireRecipients: true,
          metadata: {
            member_id: canonicalLineage.memberId,
            lead_id: canonicalLineage.leadId,
            follow_up_task_type: input.taskType,
            attempt_count: attemptCount,
            title: presentation.title,
            message: presentation.message,
            priority: "high",
            action_url: presentation.actionUrl
          }
        }
      });
    } catch (milestoneError) {
      console.error("[enrollment-packet-follow-up] unable to emit action-required milestone", milestoneError);
    }
  }

  await recordImmediateSystemAlert({
    entityType: "enrollment_packet_request",
    entityId: input.packetId,
    actorUserId,
    severity: "high",
    alertKey: presentation.alertKey,
    metadata: {
      member_id: canonicalLineage.memberId,
      lead_id: canonicalLineage.leadId,
      follow_up_task_type: input.taskType,
      attempt_count: attemptCount,
      action_url: presentation.actionUrl,
      error: errorMessage
    }
  });

  return savedRow ? mapQueueRow(savedRow) : null;
}

export async function resolveEnrollmentPacketFollowUpTask(input: {
  packetId: string;
  taskType: EnrollmentPacketFollowUpTaskType;
  actorUserId?: string | null;
  actorName?: string | null;
  resolutionNote?: string | null;
}) {
  const admin = createSupabaseAdminClient();
  const now = toEasternISO();
  const actorUserId = clean(input.actorUserId);
  const actorName = clean(input.actorName);
  const resolutionNote = clean(input.resolutionNote);
  const existing = await loadEnrollmentPacketFollowUpQueueRow({
    packetId: input.packetId,
    taskType: input.taskType
  });
  if (!existing) return null;
  if (existing.status === "completed") {
    return mapQueueRow(existing);
  }

  const { data: saved, error: savedError } = await admin
    .from("enrollment_packet_follow_up_queue")
    .update({
      status: "completed",
      last_error: null,
      claimed_at: null,
      claimed_by_user_id: null,
      claimed_by_name: null,
      resolved_at: now,
      updated_by_user_id: actorUserId,
      updated_by_name: actorName,
      updated_at: now
    })
    .eq("id", existing.id)
    .select(ENROLLMENT_PACKET_FOLLOW_UP_QUEUE_SELECT)
    .maybeSingle();
  if (savedError) throw new Error(savedError.message);

  await recordWorkflowEvent({
    eventType: "enrollment_packet_follow_up_completed",
    entityType: "enrollment_packet_request",
    entityId: input.packetId,
    actorType: actorUserId ? "user" : "system",
    actorUserId,
    status: "completed",
    severity: "low",
    metadata: {
      member_id: existing.member_id,
      lead_id: existing.lead_id,
      follow_up_task_type: input.taskType,
      resolution_note: resolutionNote
    }
  });

  const dismissResult = await admin
    .from("user_notifications")
    .update({
      status: "dismissed",
      read_at: now
    })
    .eq("event_type", "action_required")
    .eq("entity_type", "enrollment_packet_request")
    .eq("entity_id", input.packetId)
    .contains("metadata", { follow_up_task_type: input.taskType });
  if (dismissResult.error) {
    console.error("[enrollment-packet-follow-up] unable to dismiss resolved notifications", dismissResult.error);
  }

  return saved ? mapQueueRow(saved as EnrollmentPacketFollowUpQueueRow) : null;
}
