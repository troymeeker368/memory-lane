import "server-only";

import {
  dispatchNotification,
  type DispatchNotificationEventInput
} from "@/lib/services/notifications";
import { recordWorkflowEvent } from "@/lib/services/workflow-observability";

export type WorkflowMilestoneInput = {
  event: DispatchNotificationEventInput;
};

export type WorkflowMilestoneResult = {
  delivered: boolean;
  notificationCount: number;
  failureReason: string | null;
};

export async function recordWorkflowMilestone(input: WorkflowMilestoneInput) {
  try {
    const notifications = await dispatchNotification(input.event);
    return {
      delivered: true,
      notificationCount: notifications.length,
      failureReason: null
    } satisfies WorkflowMilestoneResult;
  } catch (error) {
    console.error("[workflow-milestones] unable to create workflow notification", error);
    const failureReason = error instanceof Error ? error.message : "Unknown notification dispatch error.";
    try {
      const entityType = String(input.event.entityType ?? input.event.entity_type ?? "workflow_event").trim() || "workflow_event";
      const entityId = String(input.event.entityId ?? input.event.entity_id ?? "").trim() || null;
      const actorUserId =
        String(input.event.actorUserId ?? input.event.actor_user_id ?? "").trim() ||
        (String(input.event.actorType ?? input.event.actor_type ?? "").trim().toLowerCase() === "user"
          ? String(input.event.actorId ?? input.event.actor_id ?? "").trim()
          : "") ||
        null;

      await recordWorkflowEvent({
        eventType: "notification_dispatch_failed",
        entityType,
        entityId,
        actorType: "system",
        actorUserId,
        status: "failed",
        severity: "medium",
        metadata: {
          source_event_type: input.event.eventType ?? input.event.event_type ?? null,
          notification_error: failureReason
        }
      });
    } catch (recordError) {
      console.error("[workflow-milestones] unable to persist notification dispatch failure", recordError);
    }
    return {
      delivered: false,
      notificationCount: 0,
      failureReason
    } satisfies WorkflowMilestoneResult;
  }
}
