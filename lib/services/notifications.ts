import "server-only";

import { createClient } from "@/lib/supabase/server";

export type UserNotification = {
  id: string;
  recipientUserId: string;
  title: string;
  message: string;
  entityType: string | null;
  entityId: string | null;
  readAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

type CreateUserNotificationInput = {
  recipientUserId: string;
  title: string;
  message: string;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  serviceRole?: boolean;
};

function normalizeText(value: string | null | undefined) {
  const cleaned = (value ?? "").trim();
  return cleaned.length > 0 ? cleaned : null;
}

function toRow(row: any): UserNotification {
  return {
    id: String(row.id),
    recipientUserId: String(row.recipient_user_id),
    title: String(row.title ?? ""),
    message: String(row.message ?? ""),
    entityType: normalizeText(row.entity_type),
    entityId: normalizeText(row.entity_id),
    readAt: normalizeText(row.read_at),
    metadata: row.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>) : {},
    createdAt: String(row.created_at)
  };
}

export async function createUserNotification(input: CreateUserNotificationInput) {
  const recipientUserId = normalizeText(input.recipientUserId);
  const title = normalizeText(input.title);
  const message = normalizeText(input.message);
  if (!recipientUserId) throw new Error("Notification recipient is required.");
  if (!title) throw new Error("Notification title is required.");
  if (!message) throw new Error("Notification message is required.");

  const supabase = await createClient({ serviceRole: input.serviceRole });
  const { data, error } = await supabase
    .from("user_notifications")
    .insert({
      recipient_user_id: recipientUserId,
      title,
      message,
      entity_type: normalizeText(input.entityType),
      entity_id: normalizeText(input.entityId),
      metadata: input.metadata ?? {}
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return toRow(data);
}

export async function listUserNotificationsForUser(userId: string, options?: { limit?: number; serviceRole?: boolean }) {
  const normalizedUserId = normalizeText(userId);
  if (!normalizedUserId) throw new Error("User ID is required.");
  const limit = Math.max(1, Math.min(options?.limit ?? 50, 200));
  const supabase = await createClient({ serviceRole: options?.serviceRole });
  const { data, error } = await supabase
    .from("user_notifications")
    .select("*")
    .eq("recipient_user_id", normalizedUserId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => toRow(row));
}

export async function markUserNotificationRead(input: { notificationId: string; userId: string; readAt: string; serviceRole?: boolean }) {
  const notificationId = normalizeText(input.notificationId);
  const userId = normalizeText(input.userId);
  if (!notificationId || !userId) throw new Error("Notification and user are required.");
  const supabase = await createClient({ serviceRole: input.serviceRole });
  const { data, error } = await supabase
    .from("user_notifications")
    .update({ read_at: input.readAt })
    .eq("id", notificationId)
    .eq("recipient_user_id", userId)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toRow(data) : null;
}
