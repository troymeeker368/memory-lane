import Link from "next/link";
import { notFound } from "next/navigation";

import { updateManagedUserStatusAction } from "@/lib/actions/user-management";
import { BackArrowButton } from "@/components/ui/back-arrow-button";
import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import { getManagedUserById, getManagedUserRecentActivity, summarizePermissionSet } from "@/lib/services/user-management";
import { formatDateTime, formatOptionalDateTime } from "@/lib/utils";

function firstString(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function ManagedUserDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ userId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireModuleAccess("user-management");
  const { userId } = await params;
  const query: Record<string, string | string[] | undefined> = searchParams ? await searchParams : {};
  const from = firstString(query.from);
  const to = firstString(query.to);
  const user = getManagedUserById(userId);

  if (!user) {
    notFound();
  }

  const permissionRows = summarizePermissionSet(user.permissions);
  const recentActivity = getManagedUserRecentActivity(user.id, { from, to, limit: 200 });
  const groupedRecentActivity = recentActivity.items.reduce<Array<{ activityType: string; items: typeof recentActivity.items }>>((groups, item) => {
    const existing = groups.find((group) => group.activityType === item.activityType);
    if (existing) {
      existing.items.push(item);
      return groups;
    }

    groups.push({ activityType: item.activityType, items: [item] });
    return groups;
  }, []);

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>{user.displayName}</CardTitle>
            <p className="mt-1 text-sm text-muted">{user.email}</p>
          </div>
          <div className="flex items-center gap-2">
            <BackArrowButton fallbackHref="/time-hr/user-management" ariaLabel="Back to user management list" />
            <Link href={`/time-hr/user-management/${user.id}/edit`} className="rounded-lg border border-border px-3 py-2 text-sm font-semibold text-brand">Edit User</Link>
            <Link href={`/time-hr/user-management/${user.id}/permissions`} className="rounded-lg border border-border px-3 py-2 text-sm font-semibold text-brand">Manage Permissions</Link>
          </div>
        </div>
      </Card>

      <Card>
        <CardTitle>User Details</CardTitle>
        <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
          <p><span className="font-semibold">Role:</span> {user.role}</p>
          <p><span className="font-semibold">Status:</span> {user.status}</p>
          <p><span className="font-semibold">Phone:</span> {user.phone ?? "-"}</p>
          <p><span className="font-semibold">Title:</span> {user.title ?? "-"}</p>
          <p><span className="font-semibold">Department:</span> {user.department ?? "-"}</p>
          <p><span className="font-semibold">Default Landing:</span> {user.defaultLanding}</p>
          <p><span className="font-semibold">Last Login:</span> {formatOptionalDateTime(user.lastLogin)}</p>
          <p><span className="font-semibold">Updated:</span> {formatDateTime(user.updatedAt)}</p>
        </div>

        <form action={updateManagedUserStatusAction} className="mt-4">
          <input type="hidden" name="userId" value={user.id} />
          <input type="hidden" name="nextStatus" value={user.status === "active" ? "inactive" : "active"} />
          <button type="submit" className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white">
            {user.status === "active" ? "Deactivate User" : "Reactivate User"}
          </button>
        </form>
      </Card>

      <Card className="table-wrap">
        <CardTitle>Module Access Summary</CardTitle>
        <table>
          <thead>
            <tr>
              <th>Module</th>
              <th>View</th>
              <th>Create</th>
              <th>Edit</th>
              <th>Admin</th>
            </tr>
          </thead>
          <tbody>
            {permissionRows.map((row) => (
              <tr key={row.module}>
                <td>{row.module}</td>
                <td>{row.canView ? "Yes" : "No"}</td>
                <td>{row.canCreate ? "Yes" : "No"}</td>
                <td>{row.canEdit ? "Yes" : "No"}</td>
                <td>{row.canAdmin ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="table-wrap">
        <CardTitle>Recent Activity</CardTitle>
        <p className="mt-1 text-sm text-muted">Date range: {recentActivity.from} to {recentActivity.to}</p>

        <form className="mt-3 grid gap-2 md:grid-cols-4" method="get">
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted" htmlFor="from">From</label>
            <input id="from" name="from" type="date" defaultValue={recentActivity.from} className="h-10 w-full rounded-lg border border-border px-3 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted" htmlFor="to">To</label>
            <input id="to" name="to" type="date" defaultValue={recentActivity.to} className="h-10 w-full rounded-lg border border-border px-3 text-sm" />
          </div>
          <div className="md:col-span-2 flex items-end gap-2">
            <button type="submit" className="h-10 rounded-lg bg-brand px-3 text-sm font-semibold text-white">Apply Dates</button>
            <Link href={`/time-hr/user-management/${user.id}`} className="h-10 rounded-lg border border-border px-3 text-sm font-semibold leading-10">
              Clear Filters
            </Link>
          </div>
        </form>

        <div className="mt-3 rounded-lg border border-border p-3 text-sm">
          <p><span className="font-semibold">Entries:</span> {recentActivity.total}</p>
          <p className="mt-1 text-xs text-muted">
            {recentActivity.counts.length > 0
              ? recentActivity.counts.map((row) => `${row.activityType}: ${row.count}`).join(" | ")
              : "No activity found for this date range."}
          </p>
        </div>

        {groupedRecentActivity.length === 0 ? (
          <div className="mt-3 rounded-lg border border-border p-3 text-center text-sm text-muted">
            No recent activity for this user in this date range.
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            {groupedRecentActivity.map((group) => (
              <div key={group.activityType} className="rounded-lg border border-border">
                <div className="border-b border-border bg-sky-50 px-3 py-2 text-sm font-semibold text-primary-text">
                  {group.activityType} ({group.items.length})
                </div>
                <table>
                  <thead>
                    <tr>
                      <th>Date/Time</th>
                      <th>Context</th>
                      <th>Details</th>
                      <th>Open</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map((item) => (
                      <tr key={item.id}>
                        <td>{formatDateTime(item.occurredAt)}</td>
                        <td>{item.context}</td>
                        <td>{item.details}</td>
                        <td><Link className="font-semibold text-brand" href={item.href}>Open</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
