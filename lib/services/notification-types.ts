export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export const NOTIFICATION_EVENT_TYPES = [
  "action_required",
  "care_plan_created",
  "care_plan_reviewed",
  "care_plan_sent",
  "care_plan_signed",
  "document_uploaded",
  "enrollment_packet_expired",
  "enrollment_packet_failed",
  "enrollment_packet_sent",
  "enrollment_packet_submitted",
  "intake_completed",
  "legacy_notification",
  "missing_required_document",
  "pof_expiring",
  "pof_failed",
  "pof_sent",
  "pof_signed",
  "workflow_error"
] as const;

export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];
export type NotificationStatus = "unread" | "read" | "dismissed";
export type NotificationPriority = "low" | "medium" | "high" | "critical";

export type UserNotification = {
  id: string;
  recipientUserId: string;
  actorUserId: string | null;
  eventType: string;
  title: string;
  message: string;
  entityType: string | null;
  entityId: string | null;
  status: NotificationStatus;
  priority: NotificationPriority;
  readAt: string | null;
  actionUrl: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type CreateNotificationInput = {
  recipientUserId: string;
  actorUserId?: string | null;
  eventType: NotificationEventType | string;
  title: string;
  message: string;
  entityType?: string | null;
  entityId?: string | null;
  status?: NotificationStatus;
  priority?: NotificationPriority;
  actionUrl?: string | null;
  metadata?: Record<string, JsonValue>;
  eventKey?: string | null;
  reopenOnConflict?: boolean;
  serviceRole?: boolean;
};

export type CreateUserNotificationInput = {
  recipientUserId: string;
  title: string;
  message: string;
  entityType?: string | null;
  entityId?: string | null;
  priority?: NotificationPriority;
  actionUrl?: string | null;
  metadata?: Record<string, JsonValue>;
  serviceRole?: boolean;
};

export type DispatchNotificationEventInput = {
  eventType?: string;
  event_type?: string;
  entityType?: string;
  entity_type?: string;
  entityId?: string | null;
  entity_id?: string | null;
  actorType?: string | null;
  actor_type?: string | null;
  actorId?: string | null;
  actor_id?: string | null;
  actorUserId?: string | null;
  actor_user_id?: string | null;
  status?: string | null;
  severity?: string | null;
  metadata?: Record<string, JsonValue> | null;
  recipientUserIds?: string[];
  eventKeySuffix?: string | null;
  reopenOnConflict?: boolean;
  requireRecipients?: boolean;
};

export type WorkflowRecipientContext = {
  entityType: string;
  entityId: string | null;
  memberId: string | null;
  memberName: string | null;
  leadId: string | null;
  leadOwnerUserId: string | null;
  enrollmentSenderUserId: string | null;
  physicianOrderId: string | null;
  pofRequestId: string | null;
  pofSenderUserId: string | null;
  pofOwnerUserId: string | null;
  carePlanId: string | null;
  carePlanCreatedByUserId: string | null;
  carePlanUpdatedByUserId: string | null;
  carePlanNurseDesigneeUserId: string | null;
  carePlanNurseSignedByUserId: string | null;
  caregiverSentByUserId: string | null;
  intakeAssessmentId: string | null;
  intakeCompletedByUserId: string | null;
  intakeSignedByUserId: string | null;
  memberFileId: string | null;
  memberFileUploadedByUserId: string | null;
  documentationAssignedStaffUserId: string | null;
  metadata: Record<string, JsonValue>;
};

export type NotificationContent = {
  actionUrl: string | null;
  message: string;
  priority: NotificationPriority;
  title: string;
};
