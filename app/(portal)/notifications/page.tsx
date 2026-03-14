import Link from "next/link";

import { markAllNotificationsReadAction, markNotificationReadAction } from "@/app/(portal)/notifications/actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { requireNavItemAccess } from "@/lib/auth";
import { listUserNotificationsForUser, type UserNotification } from "@/lib/services/notifications";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

function getNotificationLink(notification: UserNotification) {
  const metadata = notification.metadata ?? {};
  if (notification.entityType === "enrollment_packet_request") {
    const memberId = typeof metadata.memberId === "string" ? metadata.memberId : null;
    const leadId = typeof metadata.leadId === "string" ? metadata.leadId : null;
    if (leadId) return `/sales/leads/${leadId}`;
    if (memberId) return `/operations/member-command-center/${memberId}`;
    return null;
  }
  if (notification.entityType === "pof_request") {
    const physicianOrderId = typeof metadata.physicianOrderId === "string" ? metadata.physicianOrderId : null;
    const memberId = typeof metadata.memberId === "string" ? metadata.memberId : null;
    if (physicianOrderId) return `/health/physician-orders/${physicianOrderId}`;
    if (memberId) return `/operations/member-command-center/${memberId}`;
  }
  return null;
}

export default async function NotificationsPage() {
  const profile = await requireNavItemAccess("/notifications");
  const notifications = await listUserNotificationsForUser(profile.id, { limit: 100 });
  const unreadCount = notifications.filter((notification) => !notification.readAt).length;

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Notifications</CardTitle>
        <p className="mt-1 text-sm text-muted">Operational alerts and workflow completions assigned to your user profile.</p>
        <div className="mt-3 flex items-center gap-2">
          <Badge tone={unreadCount > 0 ? "warning" : "default"}>
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

      <Card className="table-wrap">
        <CardTitle>Inbox</CardTitle>
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Title</th>
              <th>Message</th>
              <th>Received</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {notifications.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center text-sm text-muted">
                  No notifications yet.
                </td>
              </tr>
            ) : (
              notifications.map((notification) => {
                const detailLink = getNotificationLink(notification);
                return (
                  <tr key={notification.id}>
                    <td>
                      <Badge tone={notification.readAt ? "default" : "warning"}>{notification.readAt ? "Read" : "Unread"}</Badge>
                    </td>
                    <td className="font-semibold">{notification.title}</td>
                    <td>{notification.message}</td>
                    <td>{formatDateTime(notification.createdAt)}</td>
                    <td className="space-y-2">
                      {detailLink ? (
                        <Link href={detailLink} className="inline-flex rounded-lg border border-border px-3 py-1 text-xs font-semibold text-brand hover:bg-slate-50">
                          Open
                        </Link>
                      ) : null}
                      {!notification.readAt ? (
                        <form action={markNotificationReadAction}>
                          <input type="hidden" name="notificationId" value={notification.id} />
                          <button
                            type="submit"
                            className="inline-flex rounded-lg border border-border px-3 py-1 text-xs font-semibold text-brand hover:bg-slate-50"
                          >
                            Mark read
                          </button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
