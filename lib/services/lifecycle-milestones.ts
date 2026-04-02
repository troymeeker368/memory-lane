import "server-only";

import {
  dispatchNotification,
  type DispatchNotificationEventInput
} from "@/lib/services/notifications";
import {
  recordImmediateSystemAlert,
  recordWorkflowEvent
} from "@/lib/services/workflow-observability";

export type WorkflowMilestoneInput = {
  event: DispatchNotificationEventInput;
};

export type WorkflowMilestoneResult = {
  delivered: boolean;
  notificationCount: number;
  failureReason: string | null;
  followUpNeeded: boolean;
  deliveryState: "delivered" | "follow_up_needed" | "failed";
};

function normalizeText(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function getMilestoneEntityType(event: DispatchNotificationEventInput) {
  return normalizeText(event.entityType ?? event.entity_type) ?? "workflow_event";
}

function getMilestoneEntityId(event: DispatchNotificationEventInput) {
  return normalizeText(event.entityId ?? event.entity_id);
}

function getMilestoneActorUserId(event: DispatchNotificationEventInput) {
  return (
    normalizeText(event.actorUserId ?? event.actor_user_id) ??
    (normalizeText(event.actorType ?? event.actor_type)?.toLowerCase() === "user"
      ? normalizeText(event.actorId ?? event.actor_id)
      : null)
  );
}

function getMilestoneEventType(event: DispatchNotificationEventInput) {
  return normalizeText(event.eventType ?? event.event_type) ?? "workflow_milestone";
}

function requiresExplicitDeliveryTruth(event: DispatchNotificationEventInput) {
  const eventType = getMilestoneEventType(event).toLowerCase();
  return eventType === "action_required" || eventType.endsWith("_failed") || eventType === "workflow_error";
}

async function recordNotificationFollowUpNeeded(input: {
  event: DispatchNotificationEventInput;
  failureReason: string;
  notificationCount: number;
}) {
  const entityType = getMilestoneEntityType(input.event);
  const entityId = getMilestoneEntityId(input.event);
  const actorUserId = getMilestoneActorUserId(input.event);
  const sourceEventType = getMilestoneEventType(input.event);
  const metadata = {
    source_event_type: sourceEventType,
    notification_count: input.notificationCount,
    notification_error: input.failureReason
  };

  try {
    await recordWorkflowEvent({
      eventType: "notification_dispatch_follow_up_required",
      entityType,
      entityId,
      actorType: "system",
      actorUserId,
      status: "action_required",
      severity: "high",
      metadata
    });
  } catch (recordError) {
    console.error("[workflow-milestones] unable to persist notification follow-up-needed event", recordError);
  }

  try {
    await recordImmediateSystemAlert({
      entityType,
      entityId,
      actorUserId,
      severity: "high",
      alertKey: "workflow_milestone_notification_follow_up_required",
      metadata
    });
  } catch (alertError) {
    console.error("[workflow-milestones] unable to persist notification follow-up-needed alert", alertError);
  }
}

export async function recordWorkflowMilestone(input: WorkflowMilestoneInput) {
  try {
    const notifications = await dispatchNotification(input.event);
    if (notifications.length === 0 && requiresExplicitDeliveryTruth(input.event)) {
      const failureReason = `No user_notifications rows were created for ${getMilestoneEventType(input.event)}. Staff follow-up is still required.`;
      await recordNotificationFollowUpNeeded({
        event: input.event,
        failureReason,
        notificationCount: 0
      });
      return {
        delivered: false,
        notificationCount: 0,
        failureReason,
        followUpNeeded: true,
        deliveryState: "follow_up_needed"
      } satisfies WorkflowMilestoneResult;
    }

    return {
      delivered: true,
      notificationCount: notifications.length,
      failureReason: null,
      followUpNeeded: false,
      deliveryState: "delivered"
    } satisfies WorkflowMilestoneResult;
  } catch (error) {
    console.error("[workflow-milestones] unable to create workflow notification", error);
    const failureReason = error instanceof Error ? error.message : "Unknown notification dispatch error.";
    try {
      await recordWorkflowEvent({
        eventType: "notification_dispatch_failed",
        entityType: getMilestoneEntityType(input.event),
        entityId: getMilestoneEntityId(input.event),
        actorType: "system",
        actorUserId: getMilestoneActorUserId(input.event),
        status: "failed",
        severity: "medium",
        metadata: {
          source_event_type: getMilestoneEventType(input.event),
          notification_error: failureReason
        }
      });
    } catch (recordError) {
      console.error("[workflow-milestones] unable to persist notification dispatch failure", recordError);
    }
    const sourceEventType = getMilestoneEventType(input.event);
    try {
      await recordImmediateSystemAlert({
        entityType: getMilestoneEntityType(input.event),
        entityId: getMilestoneEntityId(input.event),
        actorUserId: getMilestoneActorUserId(input.event),
        severity: "high",
        alertKey: `workflow_milestone_notification_failed:${sourceEventType}`,
        metadata: {
          source_event_type: sourceEventType,
          notification_error: failureReason
        }
      });
    } catch (alertError) {
      console.error("[workflow-milestones] unable to persist workflow milestone alert", alertError);
    }
    return {
      delivered: false,
      notificationCount: 0,
      failureReason,
      followUpNeeded: true,
      deliveryState: "failed"
    } satisfies WorkflowMilestoneResult;
  }
}
