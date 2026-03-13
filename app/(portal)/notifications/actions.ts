"use server";

import { revalidatePath } from "next/cache";

import { requireNavItemAccess } from "@/lib/auth";
import { markAllUserNotificationsRead, markUserNotificationRead } from "@/lib/services/notifications";
import { toEasternISO } from "@/lib/timezone";

function readText(formData: FormData, key: string) {
  const value = formData.get(key);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function markNotificationReadAction(formData: FormData) {
  const profile = await requireNavItemAccess("/notifications");
  const notificationId = readText(formData, "notificationId");
  if (!notificationId) {
    return;
  }
  await markUserNotificationRead({
    notificationId,
    userId: profile.id,
    readAt: toEasternISO()
  });
  revalidatePath("/notifications");
}

export async function markAllNotificationsReadAction() {
  const profile = await requireNavItemAccess("/notifications");
  await markAllUserNotificationsRead({
    userId: profile.id,
    readAt: toEasternISO()
  });
  revalidatePath("/notifications");
}
