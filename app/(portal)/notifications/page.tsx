import Link from "next/link";

import {
  dismissNotificationAction,
  markAllNotificationsReadAction,
  markNotificationReadAction
} from "@/app/(portal)/notifications/actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { requireNavItemAccess } from "@/lib/auth";
import { listUserNotificationsForUser, type NotificationPriority, type UserNotification } from "@/lib/services/notifications";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

function formatEventLabel(eventType: string) {
  return eventType
    .split("_")
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function getPriorityTone(priority: NotificationPriority) {
  if (priority === "critical") return "danger" as const;
  if (priority === "high") return "warning" as const;
  if (priority === "low") return "default" as const;
  return "success" as const;
}

function getStatusTone(notification: UserNotification) {
  if (notification.status === "dismissed") return "default" as const;
  if (notification.status === "read") return "success" as const;
  return "warning" as const;
}

export default async function NotificationsPage() {
  const profile = await requireNavItemAccess("/notifications");
  const notifications = await listUserNotificationsForUser(profile.id, { limit: 100 });
  const unreadCount = notifications.filter((notification) => notification.status === "unread").length;

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Notifications</CardTitle>
        <p className="mt-1 text-sm text-muted">Operational milestones, blockers, and assigned follow-up for your workflow inbox.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge tone={unreadCount > 0 ? "warning" : "success"}>
            {unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}
          </Badge>
          <form action={markAllNotificationsReadAction}>
            <button
              type="submit"
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-brand hover:bg-slate-50"
              disabled={unreadCount === 0}
            >
              Mark all as read
            </button>
          </form>
        </div>
      </Card>

      <div className="space-y-3">
        {notifications.length === 0 ? (
          <Card>
            <p className="text-sm text-muted">No notifications yet.</p>
          </Card>
        ) : (
          notifications.map((notification) => (
            <Card key={notification.id} className={notification.status === "unread" ? "border-amber-200 bg-amber-50/40" : ""}>
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={getStatusTone(notification)}>
                      {notification.status === "unread"
                        ? "Unread"
                        : notification.status === "dismissed"
                          ? "Dismissed"
                          : "Read"}
                    </Badge>
                    <Badge tone={getPriorityTone(notification.priority)}>{notification.priority}</Badge>
                    <Badge tone="default">{formatEventLabel(notification.eventType)}</Badge>
                  </div>
                  <div>
                    <p className="text-base font-semibold text-brand">{notification.title}</p>
                    <p className="mt-1 text-sm text-slate-700">{notification.message}</p>
                  </div>
                  <p className="text-xs text-muted">{formatDateTime(notification.createdAt)}</p>
                </div>

                <div className="flex flex-wrap items-center gap-2 md:justify-end">
                  {notification.actionUrl ? (
                    <Link
                      href={notification.actionUrl}
                      className="inline-flex rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-brand hover:bg-slate-50"
                    >
                      Open
                    </Link>
                  ) : null}
                  {notification.status === "unread" ? (
                    <form action={markNotificationReadAction}>
                      <input type="hidden" name="notificationId" value={notification.id} />
                      <button
                        type="submit"
                        className="inline-flex rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-brand hover:bg-slate-50"
                      >
                        Mark read
                      </button>
                    </form>
                  ) : null}
                  {notification.status !== "dismissed" ? (
                    <form action={dismissNotificationAction}>
                      <input type="hidden" name="notificationId" value={notification.id} />
                      <button
                        type="submit"
                        className="inline-flex rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-brand hover:bg-slate-50"
                      >
                        Dismiss
                      </button>
                    </form>
                  ) : null}
                </div>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
