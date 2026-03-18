import Link from "next/link";

import { countUnreadUserNotificationsForUser } from "@/lib/services/notification-counts";

export async function PortalNotificationLink({ userId }: { userId: string }) {
  const unreadNotifications = await countUnreadUserNotificationsForUser(userId);

  return (
    <Link
      href="/notifications"
      className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-brand hover:bg-slate-50"
    >
      Notifications{unreadNotifications > 0 ? ` (${unreadNotifications})` : ""}
    </Link>
  );
}
