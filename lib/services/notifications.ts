import "server-only";

import { createClient } from "@/lib/supabase/server";
import { buildNotificationContent, normalizeText } from "@/lib/services/notification-content";
import {
  NOTIFICATION_EVENT_TYPES,
  type CreateNotificationInput,
  type CreateUserNotificationInput,
  type DispatchNotificationEventInput,
  type JsonValue,
  type NotificationStatus,
  type UserNotification
} from "@/lib/services/notification-types";
import {
  buildNotificationEventKey,
  canonicalizeNotificationEventType,
  loadWorkflowRecipientContext,
  toRelativeActionUrl,
  toUserNotificationRow,
  resolveWorkflowRecipients
} from "@/lib/services/notifications-runtime";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { toEasternISO } from "@/lib/timezone";

export { NOTIFICATION_EVENT_TYPES };
export type {
  CreateNotificationInput,
  CreateUserNotificationInput,
  DispatchNotificationEventInput,
  NotificationPriority,
  NotificationStatus,
  UserNotification,
  WorkflowRecipientContext
} from "@/lib/services/notification-types";
export { countUnreadUserNotificationsForUser } from "@/lib/services/notification-counts";
export { listUserNotificationsForUser, resolveClinicalRecipients, resolveEnrollmentRecipients, resolveOperationsRecipients } from "@/lib/services/notifications-runtime";

function isUniqueViolation(error: unknown) {
  if (!error || typeof error !== "object") return false;
  return String((error as { code?: string }).code ?? "") === "23505";
}

function isMissingNotificationColumnError(error: unknown, columnName: string) {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: string }).code ?? "");
  const message = [
    String((error as { message?: string }).message ?? ""),
    String((error as { details?: string }).details ?? ""),
    String((error as { hint?: string }).hint ?? "")
  ]
    .join(" ")
    .toLowerCase();
  return code === "42703" && message.includes(columnName.toLowerCase());
}

function isMissingSchemaObjectError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: string }).code ?? "");
  const message = String((error as { message?: string }).message ?? "").toLowerCase();
  return (
    code === "PGRST205" ||
    code === "42P01" ||
    message.includes("schema cache") ||
    message.includes("does not exist") ||
    message.includes("could not find the table")
  );
}

function mapNotificationError(error: unknown) {
  if (isMissingSchemaObjectError(error)) {
    return "Missing Supabase schema object public.user_notifications. Apply migration 0060_notification_workflow_engine.sql and refresh PostgREST schema cache.";
  }
  if (!error || typeof error !== "object") return "Unknown notification service error.";
  const text = [
    String((error as { message?: string }).message ?? ""),
    String((error as { details?: string }).details ?? ""),
    String((error as { hint?: string }).hint ?? "")
  ]
    .map((value) => value.trim())
    .filter(Boolean)
    .join(" ");
  return text || "Unknown notification service error.";
}

function createNotificationWriteClient() {
  // Notification inserts are service-only by RLS, so writes must go through the explicit gateway.
  return createServiceRoleClient("notification_dispatch_write");
}

async function getExistingNotificationByEventKey(eventKey: string, serviceRole = true) {
  const supabase = serviceRole ? createNotificationWriteClient() : await createClient();
  const { data, error } = await supabase.from("user_notifications").select("*").eq("event_key", eventKey).maybeSingle();
  if (error) throw new Error(mapNotificationError(error));
  return data ? toUserNotificationRow(data) : null;
}

export async function createNotification(input: CreateNotificationInput) {
  const recipientUserId = normalizeText(input.recipientUserId);
  const title = normalizeText(input.title);
  const message = normalizeText(input.message);
  const eventType = canonicalizeNotificationEventType(String(input.eventType)) ?? "legacy_notification";
  if (!recipientUserId) throw new Error("Notification recipient is required.");
  if (!title) throw new Error("Notification title is required.");
  if (!message) throw new Error("Notification message is required.");

  const serviceRole = input.serviceRole !== false;
  const supabase = serviceRole ? createNotificationWriteClient() : await createClient();
  const eventKey =
    normalizeText(input.eventKey) ??
    buildNotificationEventKey({
      recipientUserId,
      eventType,
      entityType: input.entityType,
      entityId: input.entityId
    });

  const row = {
    recipient_user_id: recipientUserId,
    actor_user_id: normalizeText(input.actorUserId),
    event_type: eventType,
    entity_type: normalizeText(input.entityType),
    entity_id: normalizeText(input.entityId),
    title,
    message,
    status: input.status ?? "unread",
    priority: input.priority ?? "medium",
    read_at: input.status === "read" || input.status === "dismissed" ? toEasternISO() : null,
    action_url: toRelativeActionUrl(input.actionUrl),
    metadata: input.metadata ?? {},
    event_key: eventKey
  };

  const { data, error } = await supabase.from("user_notifications").insert(row).select("*").maybeSingle();
  if (!error && data) return toUserNotificationRow(data);

  if (isUniqueViolation(error)) {
    if (!input.reopenOnConflict) {
      const existing = await getExistingNotificationByEventKey(eventKey, serviceRole);
      if (existing) return existing;
    }

    const { data: reopened, error: reopenError } = await supabase
      .from("user_notifications")
      .update({
        actor_user_id: row.actor_user_id,
        event_type: row.event_type,
        entity_type: row.entity_type,
        entity_id: row.entity_id,
        title: row.title,
        message: row.message,
        status: "unread",
        priority: row.priority,
        read_at: null,
        action_url: row.action_url,
        metadata: row.metadata,
        created_at: toEasternISO()
      })
      .eq("event_key", eventKey)
      .select("*")
      .maybeSingle();
    if (reopenError) throw new Error(mapNotificationError(reopenError));
    if (reopened) return toUserNotificationRow(reopened);
  }

  throw new Error(mapNotificationError(error));
}

export async function createUserNotification(input: CreateUserNotificationInput) {
  return createNotification({
    recipientUserId: input.recipientUserId,
    eventType: "legacy_notification",
    title: input.title,
    message: input.message,
    entityType: input.entityType,
    entityId: input.entityId,
    priority: input.priority ?? "medium",
    actionUrl: input.actionUrl ?? null,
    metadata: input.metadata,
    serviceRole: input.serviceRole
  });
}

export async function dispatchNotification(input: DispatchNotificationEventInput) {
  const eventType = canonicalizeNotificationEventType(input.eventType ?? input.event_type ?? "");
  if (!eventType) return [] as UserNotification[];

  const entityType = input.entityType ?? input.entity_type ?? "";
  const entityId = input.entityId ?? input.entity_id ?? null;
  const actorUserId =
    normalizeText(input.actorUserId ?? input.actor_user_id) ??
    ((normalizeText(input.actorType ?? input.actor_type)?.toLowerCase() === "user"
      ? normalizeText(input.actorId ?? input.actor_id)
      : null) ?? null);

  const context = await loadWorkflowRecipientContext({
    entityType,
    entityId,
    metadata: input.metadata
  });
  const recipients = await resolveWorkflowRecipients({
    eventType,
    entityType,
    entityId,
    metadata: input.metadata,
    explicitRecipientUserIds: input.recipientUserIds
  });
  if (recipients.length === 0) {
    if (input.requireRecipients) {
      throw new Error(`No notification recipients resolved for required ${eventType} event.`);
    }
    return [] as UserNotification[];
  }

  const content = buildNotificationContent(eventType, context);
  return Promise.all(
    recipients.map((recipientUserId) =>
      createNotification({
        recipientUserId,
        actorUserId,
        eventType,
        title: content.title,
        message: content.message,
        entityType,
        entityId,
        priority:
          input.severity === "critical"
            ? "critical"
            : input.severity === "high"
              ? "high"
              : content.priority,
        actionUrl: toRelativeActionUrl(String(input.metadata?.action_url ?? input.metadata?.actionUrl ?? "")) ?? content.actionUrl,
        metadata: {
          ...(input.metadata ?? {}),
          recipient_scope: recipientUserId,
          canonical_event_type: eventType
        },
        eventKey: buildNotificationEventKey({
          recipientUserId,
          eventType,
          entityType,
          entityId,
          suffix: input.eventKeySuffix
        }),
        reopenOnConflict: input.reopenOnConflict ?? false,
        serviceRole: true
      })
    )
  );
}

async function updateUserNotificationStatus(input: {
  notificationId: string;
  userId: string;
  status: NotificationStatus;
  actedAt: string;
  serviceRole?: boolean;
}) {
  const notificationId = normalizeText(input.notificationId);
  const userId = normalizeText(input.userId);
  if (!notificationId || !userId) throw new Error("Notification and user are required.");

  const supabase = await createClient({ serviceRole: input.serviceRole });
  let { data, error } = await supabase
    .from("user_notifications")
    .update({
      status: input.status,
      read_at: input.status === "unread" ? null : input.actedAt
    })
    .eq("id", notificationId)
    .eq("recipient_user_id", userId)
    .select("*")
    .maybeSingle();
  if (error && isMissingNotificationColumnError(error, "status")) {
    const fallback = await supabase
      .from("user_notifications")
      .update({
        read_at: input.status === "unread" ? null : input.actedAt
      })
      .eq("id", notificationId)
      .eq("recipient_user_id", userId)
      .select("*")
      .maybeSingle();
    data = fallback.data;
    error = fallback.error;
    if (!error && data) {
      const row = toUserNotificationRow(data);
      return {
        ...row,
        status: input.status,
        readAt: input.status === "unread" ? null : input.actedAt
      };
    }
  }
  if (error) throw new Error(mapNotificationError(error));
  return data ? toUserNotificationRow(data) : null;
}

export async function markUserNotificationRead(input: {
  notificationId: string;
  userId: string;
  readAt: string;
  serviceRole?: boolean;
}) {
  return updateUserNotificationStatus({
    notificationId: input.notificationId,
    userId: input.userId,
    status: "read",
    actedAt: input.readAt,
    serviceRole: input.serviceRole
  });
}

export async function dismissUserNotification(input: {
  notificationId: string;
  userId: string;
  dismissedAt: string;
  serviceRole?: boolean;
}) {
  return updateUserNotificationStatus({
    notificationId: input.notificationId,
    userId: input.userId,
    status: "dismissed",
    actedAt: input.dismissedAt,
    serviceRole: input.serviceRole
  });
}

export async function dismissWorkflowNotifications(input: {
  entityType: string;
  entityId: string;
  eventType?: string | null;
  dismissedAt: string;
  metadataContains?: Record<string, JsonValue> | null;
  serviceRole?: boolean;
}) {
  const entityType = normalizeText(input.entityType);
  const entityId = normalizeText(input.entityId);
  if (!entityType || !entityId) throw new Error("Entity type and entity id are required.");

  const serviceRole = input.serviceRole !== false;
  const supabase = serviceRole ? createNotificationWriteClient() : await createClient();
  const metadataContains =
    input.metadataContains && Object.keys(input.metadataContains).length > 0 ? input.metadataContains : null;

  let query = supabase
    .from("user_notifications")
    .update({
      status: "dismissed",
      read_at: input.dismissedAt
    })
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .neq("status", "dismissed");

  const eventType = normalizeText(input.eventType);
  if (eventType) {
    query = query.eq("event_type", canonicalizeNotificationEventType(eventType) ?? eventType);
  }
  if (metadataContains) {
    query = query.contains("metadata", metadataContains);
  }

  let { data, error } = await query.select("id");
  if (error && isMissingNotificationColumnError(error, "status")) {
    let fallbackQuery = supabase
      .from("user_notifications")
      .update({
        read_at: input.dismissedAt
      })
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .is("read_at", null);
    if (eventType) {
      fallbackQuery = fallbackQuery.eq("event_type", canonicalizeNotificationEventType(eventType) ?? eventType);
    }
    if (metadataContains) {
      fallbackQuery = fallbackQuery.contains("metadata", metadataContains);
    }
    const fallback = await fallbackQuery.select("id");
    data = fallback.data;
    error = fallback.error;
  }
  if (error) throw new Error(mapNotificationError(error));
  return (data ?? []).length;
}

export async function markAllUserNotificationsRead(input: {
  userId: string;
  readAt: string;
  serviceRole?: boolean;
}) {
  const userId = normalizeText(input.userId);
  if (!userId) throw new Error("User ID is required.");
  const supabase = await createClient({ serviceRole: input.serviceRole });
  let { data, error } = await supabase
    .from("user_notifications")
    .update({
      status: "read",
      read_at: input.readAt
    })
    .eq("recipient_user_id", userId)
    .eq("status", "unread")
    .select("id");
  if (error && isMissingNotificationColumnError(error, "status")) {
    const fallback = await supabase
      .from("user_notifications")
      .update({
        read_at: input.readAt
      })
      .eq("recipient_user_id", userId)
      .is("read_at", null)
      .select("id");
    data = fallback.data;
    error = fallback.error;
  }
  if (error) throw new Error(mapNotificationError(error));
  return (data ?? []).length;
}

export async function dispatchReminderNotifications(input?: {
  nowIso?: string;
  enrollmentWindowHours?: number;
  pofWindowHours?: number;
  carePlanWindowDays?: number;
}) {
  const supabase = createNotificationWriteClient();
  const now = new Date(input?.nowIso ?? toEasternISO());
  const enrollmentWindowHours = Math.max(12, input?.enrollmentWindowHours ?? 48);
  const pofWindowHours = Math.max(6, input?.pofWindowHours ?? 24);
  const carePlanWindowDays = Math.max(1, input?.carePlanWindowDays ?? 7);

  const enrollmentThreshold = new Date(now.getTime() - enrollmentWindowHours * 60 * 60 * 1000).toISOString();
  const pofExpiryThreshold = new Date(now.getTime() + pofWindowHours * 60 * 60 * 1000).toISOString();
  const carePlanDueThreshold = new Date(now.getTime() + carePlanWindowDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const [
    { data: pendingPackets, error: pendingPacketsError },
    { data: expiringPofs, error: expiringPofsError },
    { data: pendingCarePlans, error: pendingCarePlansError }
  ] = await Promise.all([
    supabase
      .from("enrollment_packet_requests")
      .select("id, member_id")
      .in("status", ["sent", "opened", "partially_completed"])
      .lt("created_at", enrollmentThreshold)
      .gt("token_expires_at", now.toISOString()),
    supabase
      .from("pof_requests")
      .select("id, expires_at")
      .in("status", ["sent", "opened"])
      .lte("expires_at", pofExpiryThreshold)
      .gt("expires_at", now.toISOString()),
    supabase
      .from("care_plans")
      .select("id, member_id, next_due_date")
      .lte("next_due_date", carePlanDueThreshold)
      .in("status", ["Due Soon", "Due Now", "Overdue"])
  ]);

  if (pendingPacketsError) throw new Error(pendingPacketsError.message);
  if (expiringPofsError) throw new Error(expiringPofsError.message);
  if (pendingCarePlansError) throw new Error(pendingCarePlansError.message);

  const notifications: UserNotification[] = [];

  for (const row of pendingPackets ?? []) {
    notifications.push(
      ...(await dispatchNotification({
        eventType: "action_required",
        entityType: "enrollment_packet_request",
        entityId: String(row.id),
        metadata: {
          member_id: String(row.member_id),
          title: "Enrollment Packet Follow-up Needed",
          message: "Enrollment packet is still outstanding. Follow up with the caregiver or re-send the packet.",
          action_url: `/operations/member-command-center/${row.member_id}`
        },
        eventKeySuffix: "enrollment-follow-up"
      }))
    );
  }

  for (const row of expiringPofs ?? []) {
    notifications.push(
      ...(await dispatchNotification({
        eventType: "pof_expiring",
        entityType: "pof_request",
        entityId: String(row.id),
        metadata: {
          expires_at: String(row.expires_at ?? "")
        },
        eventKeySuffix: "pof-expiring-24h"
      }))
    );
  }

  for (const row of pendingCarePlans ?? []) {
    notifications.push(
      ...(await dispatchNotification({
        eventType: "action_required",
        entityType: "care_plan",
        entityId: String(row.id),
        metadata: {
          member_id: String(row.member_id),
          title: "Care Plan Review Pending",
          message: "Care plan review is due soon or overdue. Open the care plan and complete the review.",
          action_url: `/health/care-plans/${row.id}`
        },
        eventKeySuffix: "care-plan-review-pending"
      }))
    );
  }

  return notifications;
}
