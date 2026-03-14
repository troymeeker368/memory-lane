import "server-only";

import {
  createUserNotification,
  type CreateUserNotificationInput
} from "@/lib/services/notifications";
import {
  logSystemEvent,
  type LogSystemEventInput
} from "@/lib/services/system-event-service";

export type WorkflowMilestoneInput = {
  event: LogSystemEventInput;
  notification?: CreateUserNotificationInput;
};

export async function recordWorkflowMilestone(input: WorkflowMilestoneInput) {
  await logSystemEvent(input.event);

  if (input.notification) {
    await createUserNotification({
      ...input.notification,
      serviceRole: input.notification.serviceRole ?? true
    });
  }
}
