import "server-only";

import { createClient } from "@/lib/supabase/server";
import { normalizeNotificationPriority, normalizeText } from "@/lib/services/notification-content";
import {
  type JsonValue,
  type NotificationEventType,
  type NotificationStatus,
  type UserNotification,
  type WorkflowRecipientContext
} from "@/lib/services/notification-types";
import { loadWorkflowRecipientContext, resolveOperationsRecipients } from "@/lib/services/notifications-workflow-context";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export {
  loadWorkflowRecipientContext,
  resolveOperationsRecipients
} from "@/lib/services/notifications-workflow-context";

type NotificationDbRow = {
  [key: string]: unknown;
  id?: string | null;
  recipient_user_id?: string | null;
  actor_user_id?: string | null;
  event_type?: string | null;
  title?: string | null;
  message?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  status?: string | null;
  priority?: string | null;
  read_at?: string | null;
  action_url?: string | null;
  metadata?: JsonValue | Record<string, unknown> | null;
  created_at?: string | null;
};

function createNotificationPrivilegedClient() {
  return createServiceRoleClient("notification_workflow_context_read");
}

function normalizeMetadata(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => normalizeText(value)).filter(Boolean))) as string[];
}

function normalizeEventKeyPart(value: string | null | undefined) {
  return (normalizeText(value) ?? "none").replace(/[^a-zA-Z0-9:_-]/g, "_");
}

export function buildNotificationEventKey(input: {
  recipientUserId: string;
  eventType: string;
  entityType?: string | null;
  entityId?: string | null;
  suffix?: string | null;
}) {
  return [
    normalizeEventKeyPart(input.eventType),
    normalizeEventKeyPart(input.entityType),
    normalizeEventKeyPart(input.entityId),
    normalizeEventKeyPart(input.recipientUserId),
    normalizeEventKeyPart(input.suffix)
  ].join(":");
}

export function canonicalizeNotificationEventType(eventType: string): NotificationEventType | null {
  const normalized = normalizeText(eventType)?.toLowerCase();
  if (!normalized) return null;

  const aliases: Record<string, NotificationEventType> = {
    action_required: "action_required",
    care_plan_caregiver_signed: "care_plan_signed",
    care_plan_created: "care_plan_created",
    care_plan_reviewed: "care_plan_reviewed",
    care_plan_sent: "care_plan_sent",
    document_uploaded: "document_uploaded",
    enrollment_packet_completed: "enrollment_packet_submitted",
    enrollment_packet_expired: "enrollment_packet_expired",
    enrollment_packet_failed: "enrollment_packet_failed",
    enrollment_packet_mapping_failed: "enrollment_packet_failed",
    enrollment_packet_sent: "enrollment_packet_sent",
    enrollment_packet_submitted: "enrollment_packet_submitted",
    intake_assessment_signed: "intake_completed",
    intake_completed: "intake_completed",
    legacy_notification: "legacy_notification",
    missing_required_document: "missing_required_document",
    physician_order_signed: "pof_signed",
    pof_expiring: "pof_expiring",
    pof_failed: "pof_failed",
    pof_request_failed: "pof_failed",
    pof_request_sent: "pof_sent",
    pof_request_signed: "pof_signed",
    pof_sent: "pof_sent",
    pof_signed: "pof_signed",
    workflow_error: "workflow_error"
  };

  return aliases[normalized] ?? null;
}

export function toRelativeActionUrl(value: string | null | undefined) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  return normalized.startsWith("/") ? normalized : `/${normalized.replace(/^\/+/, "")}`;
}

export function toUserNotificationRow(row: NotificationDbRow): UserNotification {
  const readAt = normalizeText(row.read_at);
  const derivedStatus = normalizeText(row.status) ? (row.status === "read" || row.status === "dismissed" ? row.status : "unread") : readAt ? "read" : "unread";
  return {
    id: String(row.id),
    recipientUserId: String(row.recipient_user_id),
    actorUserId: normalizeText(row.actor_user_id),
    eventType: String(row.event_type ?? "legacy_notification"),
    title: String(row.title ?? ""),
    message: String(row.message ?? ""),
    entityType: normalizeText(row.entity_type),
    entityId: normalizeText(row.entity_id),
    status: derivedStatus,
    priority: normalizeNotificationPriority(row.priority),
    readAt,
    actionUrl: toRelativeActionUrl(row.action_url),
    metadata: normalizeMetadata(row.metadata),
    createdAt: String(row.created_at)
  };
}

async function getActiveProfileIds(profileIds: string[]) {
  const ids = uniqueStrings(profileIds);
  if (ids.length === 0) return [] as string[];
  const supabase = createNotificationPrivilegedClient();
  const { data, error } = await supabase.from("profiles").select("id").in("id", ids).eq("active", true);
  if (error) throw new Error(error.message);
  return uniqueStrings((data ?? []).map((row) => String(row.id)));
}

async function listFallbackAdminRecipientIds() {
  const supabase = createNotificationPrivilegedClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("active", true)
    .in("role", ["admin", "director", "manager"]);
  if (error) throw new Error(error.message);
  return uniqueStrings((data ?? []).map((row) => String(row.id)));
}

export function resolveEnrollmentRecipients(context: WorkflowRecipientContext) {
  return uniqueStrings([context.enrollmentSenderUserId, context.leadOwnerUserId]);
}

export function resolveClinicalRecipients(context: WorkflowRecipientContext) {
  return uniqueStrings([
    context.pofSenderUserId,
    context.pofOwnerUserId,
    context.carePlanCreatedByUserId,
    context.carePlanUpdatedByUserId,
    context.carePlanNurseDesigneeUserId,
    context.carePlanNurseSignedByUserId,
    context.caregiverSentByUserId,
    context.intakeCompletedByUserId,
    context.intakeSignedByUserId
  ]);
}

export async function resolveWorkflowRecipients(input: {
  eventType: NotificationEventType;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, JsonValue> | null;
  explicitRecipientUserIds?: string[];
}) {
  const explicitRecipientUserIds = uniqueStrings(input.explicitRecipientUserIds ?? []);
  if (explicitRecipientUserIds.length > 0) {
    return getActiveProfileIds(explicitRecipientUserIds);
  }

  const context = await loadWorkflowRecipientContext({
    entityType: input.entityType,
    entityId: input.entityId,
    metadata: input.metadata
  });
  const operationsRecipients = await resolveOperationsRecipients({ memberId: context.memberId });
  const enrollmentRecipients = resolveEnrollmentRecipients(context);
  const clinicalRecipients = resolveClinicalRecipients(context);

  let recipients: string[] = [];
  switch (input.eventType) {
    case "enrollment_packet_sent":
    case "enrollment_packet_submitted":
    case "enrollment_packet_expired":
    case "enrollment_packet_failed":
    case "missing_required_document":
      recipients = uniqueStrings([...enrollmentRecipients, ...operationsRecipients]);
      break;
    case "pof_sent":
    case "pof_signed":
    case "pof_expiring":
    case "pof_failed":
      recipients = uniqueStrings([...clinicalRecipients, ...operationsRecipients]);
      break;
    case "intake_completed":
      recipients = uniqueStrings([...clinicalRecipients, ...enrollmentRecipients, ...operationsRecipients]);
      break;
    case "care_plan_created":
    case "care_plan_reviewed":
    case "care_plan_sent":
    case "care_plan_signed":
      recipients = uniqueStrings([...clinicalRecipients, ...operationsRecipients]);
      break;
    case "document_uploaded":
      recipients = uniqueStrings([
        context.memberFileUploadedByUserId,
        ...enrollmentRecipients,
        ...clinicalRecipients,
        ...operationsRecipients
      ]);
      break;
    case "action_required":
    case "workflow_error":
      recipients = uniqueStrings([...enrollmentRecipients, ...clinicalRecipients, ...operationsRecipients]);
      if (recipients.length === 0) {
        recipients = await listFallbackAdminRecipientIds();
      }
      break;
    case "legacy_notification":
    default:
      recipients = uniqueStrings([...enrollmentRecipients, ...clinicalRecipients, ...operationsRecipients]);
      break;
  }

  if (
    recipients.length === 0 &&
    (
      input.eventType === "enrollment_packet_submitted" ||
      input.eventType === "enrollment_packet_failed" ||
      input.eventType === "intake_completed" ||
      input.eventType === "pof_sent" ||
      input.eventType === "pof_signed" ||
      input.eventType === "pof_failed" ||
      input.eventType === "care_plan_signed"
    )
  ) {
    recipients = await listFallbackAdminRecipientIds();
  }

  return getActiveProfileIds(recipients);
}

export async function listUserNotificationsForUser(
  userId: string,
  options?: { limit?: number; serviceRole?: boolean; statuses?: NotificationStatus[] }
) {
  const normalizedUserId = normalizeText(userId);
  if (!normalizedUserId) throw new Error("User ID is required.");
  const limit = Math.max(1, Math.min(options?.limit ?? 50, 200));
  const supabase =
    options?.serviceRole === true
      ? createServiceRoleClient("notification_user_inbox_read")
      : await createClient();

  let query = supabase
    .from("user_notifications")
    .select("*")
    .eq("recipient_user_id", normalizedUserId)
    .order("created_at", { ascending: false })
    .limit(limit);

  const statuses = Array.from(new Set(options?.statuses ?? []));
  if (statuses.length > 0) {
    query = query.in("status", statuses);
  }

  let { data, error } = await query;
  if (error && statuses.length > 0 && String((error as { code?: string }).code ?? "") === "42703") {
    const fallback = await supabase
      .from("user_notifications")
      .select("*")
      .eq("recipient_user_id", normalizedUserId)
      .order("created_at", { ascending: false })
      .limit(limit);
    data = fallback.data;
    error = fallback.error;
    if (!error) {
      return (data ?? [])
        .map((row) => toUserNotificationRow(row))
        .filter((notification) => statuses.includes(notification.status));
    }
  }
  if (error) {
    console.error("[notifications] unable to list user notifications", error);
    return [] as UserNotification[];
  }
  return (data ?? []).map((row) => toUserNotificationRow(row));
}
