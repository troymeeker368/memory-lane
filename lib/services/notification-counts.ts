import "server-only";

import { createClient } from "@/lib/supabase/server";

function normalizeText(value: string | null | undefined) {
  const cleaned = (value ?? "").trim();
  return cleaned.length > 0 ? cleaned : null;
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

async function queryUnreadNotificationCount(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  options?: { useHead?: boolean; useLegacyReadAt?: boolean }
) {
  let query = supabase.from("user_notifications").select("id", {
    count: "exact",
    head: options?.useHead ?? true
  });

  query = query.eq("recipient_user_id", userId);
  if (options?.useLegacyReadAt) {
    return query.is("read_at", null).limit(1);
  }
  return query.eq("status", "unread").limit(1);
}

export async function countUnreadUserNotificationsForUser(userId: string, options?: { serviceRole?: boolean }) {
  const normalizedUserId = normalizeText(userId);
  if (!normalizedUserId) throw new Error("User ID is required.");

  const supabase = await createClient({ serviceRole: options?.serviceRole });
  let useLegacyReadAt = false;
  let { count, error } = await queryUnreadNotificationCount(supabase, normalizedUserId);

  if (error && isMissingNotificationColumnError(error, "status")) {
    useLegacyReadAt = true;
    const fallback = await queryUnreadNotificationCount(supabase, normalizedUserId, { useLegacyReadAt: true });
    count = fallback.count;
    error = fallback.error;
  }

  if (error) {
    const fallback = await queryUnreadNotificationCount(supabase, normalizedUserId, {
      useHead: false,
      useLegacyReadAt
    });
    count = fallback.count;
    error = fallback.error;
  }

  if (error && !useLegacyReadAt && isMissingNotificationColumnError(error, "status")) {
    const fallback = await queryUnreadNotificationCount(supabase, normalizedUserId, {
      useHead: false,
      useLegacyReadAt: true
    });
    count = fallback.count;
    error = fallback.error;
  }

  if (error) {
    console.error("[notifications] unable to count unread notifications", {
      error,
      reason: mapNotificationError(error),
      userId: normalizedUserId
    });
    return 0;
  }

  return Number(count ?? 0);
}
