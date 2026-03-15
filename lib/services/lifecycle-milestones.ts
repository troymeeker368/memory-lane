import "server-only";

import {
  dispatchNotification,
  type DispatchNotificationEventInput
} from "@/lib/services/notifications";

export type WorkflowMilestoneInput = {
  event: DispatchNotificationEventInput;
};

export async function recordWorkflowMilestone(input: WorkflowMilestoneInput) {
  try {
    await dispatchNotification(input.event);
  } catch (error) {
    console.error("[workflow-milestones] unable to create workflow notification", error);
  }
}
