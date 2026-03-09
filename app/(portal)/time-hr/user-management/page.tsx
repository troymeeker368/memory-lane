import Link from "next/link";

import { updateManagedUserStatusAction } from "@/lib/actions/user-management";
import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import { getUserManagementMetrics, listManagedUsers } from "@/lib/services/user-management";
import type { AppRole, UserStatus } from "@/types/app";
import { formatOptionalDateTime } from "@/lib/utils";

function firstParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function parseRole(raw: string | undefined): AppRole | "all" {
  if (raw === "admin" || raw === "manager" || raw === "nurse" || raw === "staff") {
    return raw;
  }
  return "all";
}

function parseStatus(raw: string | undefined): UserStatus | "all" {
  if (raw === "active" || raw === "inactive") {
    return raw;
  }
  return "all";
}

export default async function UserManagementPage({
  searchParams
}: {
  searchParams?: { search?: string | string[]; role?: string | string[]; status?: string | string[] };
}) {
  await requireModuleAccess("user-management");

  const search = firstParam(searchParams?.search).trim();
  const role = parseRole(firstParam(searchParams?.role));
  const status = parseStatus(firstParam(searchParams?.status));

  const users = listManagedUsers({ search, role, status });
  const metrics = getUserManagementMetrics();

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>User Management</CardTitle>
            <p className="mt-1 text-sm text-muted">Admin-only user administration for role, status, and module access.</p>
          </div>
          <Link href="/time-hr/user-management/new" className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white">
            Add User
          </Link>
        </div>

        <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3 lg:grid-cols-6">
          <div className="rounded border border-border px-2 py-1">Total: <span className="font-semibold">{metrics.total}</span></div>
          <div className="rounded border border-border px-2 py-1">Active: <span className="font-semibold">{metrics.active}</span></div>
          <div className="rounded border border-border px-2 py-1">Inactive: <span className="font-semibold">{metrics.inactive}</span></div>
          <div className="rounded border border-border px-2 py-1">Admins: <span className="font-semibold">{metrics.admins}</span></div>
          <div className="rounded border border-border px-2 py-1">Managers: <span className="font-semibold">{metrics.managers}</span></div>
          <div className="rounded border border-border px-2 py-1">Nurses/Staff: <span className="font-semibold">{metrics.nurses + metrics.staff}</span></div>
        </div>
      </Card>

      <Card>
        <form className="grid gap-2 md:grid-cols-5" method="get">
          <input
            className="h-11 rounded-lg border border-border px-3"
            name="search"
            defaultValue={search}
            placeholder="Search name, email, department"
          />
          <select className="h-11 rounded-lg border border-border px-3" name="role" defaultValue={role}>
            <option value="all">All roles</option>
            <option value="admin">admin</option>
            <option value="manager">manager</option>
            <option value="nurse">nurse</option>
            <option value="staff">staff</option>
          </select>
          <select className="h-11 rounded-lg border border-border px-3" name="status" defaultValue={status}>
            <option value="all">All status</option>
            <option value="active">active</option>
            <option value="inactive">inactive</option>
          </select>
          <button type="submit" className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white">Apply Filters</button>
          <Link href="/time-hr/user-management" className="rounded-lg border border-border px-3 py-2 text-sm font-semibold text-center text-brand">
            Clear Filters
          </Link>
        </form>
      </Card>

      <Card className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Last Login</th>
              <th>Department</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>
                  <Link href={`/time-hr/user-management/${user.id}`} className="font-semibold text-brand">
                    {user.displayName}
                  </Link>
                </td>
                <td>{user.email}</td>
                <td><span className="rounded bg-brand-soft px-2 py-1 text-xs font-semibold text-brand">{user.role}</span></td>
                <td>
                  <span className={`rounded px-2 py-1 text-xs font-semibold ${user.status === "active" ? "bg-[#99CC33]/20 text-[#3f6d12]" : "bg-slate-200 text-slate-700"}`}>
                    {user.status}
                  </span>
                </td>
                <td>{formatOptionalDateTime(user.lastLogin)}</td>
                <td>{user.department ?? "-"}</td>
                <td>
                  <div className="flex flex-wrap gap-2">
                    <Link className="text-xs font-semibold text-brand" href={`/time-hr/user-management/${user.id}/edit`}>Edit</Link>
                    <Link className="text-xs font-semibold text-brand" href={`/time-hr/user-management/${user.id}/permissions`}>Permissions</Link>
                    <form action={updateManagedUserStatusAction}>
                      <input type="hidden" name="userId" value={user.id} />
                      <input type="hidden" name="nextStatus" value={user.status === "active" ? "inactive" : "active"} />
                      <button type="submit" className="text-xs font-semibold text-brand">
                        {user.status === "active" ? "Deactivate" : "Reactivate"}
                      </button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
