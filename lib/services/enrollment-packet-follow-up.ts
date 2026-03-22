import "server-only";

import { recordWorkflowMilestone } from "@/lib/services/lifecycle-milestones";
import {
  recordImmediateSystemAlert,
  recordWorkflowEvent
} from "@/lib/services/workflow-observability";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { toEasternISO } from "@/lib/timezone";

export const ENROLLMENT_PACKET_FOLLOW_UP_TASK_TYPES = [
  "lead_activity_sync",
  "critical_notification_delivery"
] as const;

export type EnrollmentPacketFollowUpTaskType = (typeof ENROLLMENT_PACKET_FOLLOW_UP_TASK_TYPES)[number];
export type EnrollmentPacketFollowUpStatus = "action_required" | "completed";

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
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

const ENROLLMENT_PACKET_FOLLOW_UP_QUEUE_SELECT =
  "id, packet_id, member_id, lead_id, task_type, status, title, message, action_url, payload, attempt_count, last_error, last_attempted_at, resolved_at, created_at, updated_at";
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
  const actorUserId = clean(input.actorUserId);
  const actorName = clean(input.actorName);
  const errorMessage = clean(input.errorMessage) ?? "Unknown enrollment follow-up failure.";
  const presentation = buildTaskPresentation(input.taskType, input.actionUrl);
  let attemptCount = 1;

  const rowPatch = {
    member_id: input.memberId,
    lead_id: input.leadId ?? null,
    task_type: input.taskType,
    status: "action_required" as const,
    title: presentation.title,
    message: presentation.message,
    action_url: presentation.actionUrl,
    payload: input.payload ?? {},
    attempt_count: attemptCount,
    last_error: errorMessage,
    last_attempted_at: now,
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
      member_id: input.memberId,
      lead_id: input.leadId ?? null,
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
            member_id: input.memberId,
            lead_id: input.leadId ?? null,
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
      member_id: input.memberId,
      lead_id: input.leadId ?? null,
      follow_up_task_type: input.taskType,
      attempt_count: attemptCount,
      action_url: presentation.actionUrl,
      error: errorMessage
    }
  });

  return savedRow;
}
