import Link from "next/link";

import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import { getMemberCommandCenterIndexSupabase } from "@/lib/services/member-command-center-supabase";
import { formatOptionalDate } from "@/lib/utils";

function firstString(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function initials(name: string) {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "NA";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
}

export default async function MemberCommandCenterIndexPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireModuleAccess("operations");
  const params = await searchParams;
  const q = firstString(params.q) ?? "";
  const status = (firstString(params.status) as "all" | "active" | "inactive" | undefined) ?? "active";

  const rows = await getMemberCommandCenterIndexSupabase({ q, status });

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>Member Command Center</CardTitle>
            <p className="mt-1 text-sm text-muted">Center Coordinator member master record hub for operations, enrollment, contacts, legal, diet/allergies, and files.</p>
          </div>
          <Link href="/operations/member-command-center/attendance-billing" className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-brand">
            Attendance/Billing Settings
          </Link>
        </div>
      </Card>

      <Card className="table-wrap">
        <form className="mt-1 grid gap-2 md:grid-cols-4" method="get">
          <input name="q" defaultValue={q} placeholder="Search member" className="h-10 rounded-lg border border-border px-3" />
          <select name="status" defaultValue={status} className="h-10 rounded-lg border border-border px-3">
            <option value="all">All Statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <button type="submit" className="h-10 rounded-lg bg-brand px-3 text-sm font-semibold text-white">Apply</button>
          <Link href="/operations/member-command-center" className="h-10 rounded-lg border border-border px-3 text-center text-sm font-semibold leading-10">Clear</Link>
        </form>

        <p className="mt-2 text-xs text-muted">Total: {rows.length}</p>

        <table className="mt-3">
          <thead>
            <tr>
              <th>Member</th>
              <th>Locker #</th>
              <th>Status</th>
              <th>DOB</th>
              <th>Enrollment</th>
              <th>Months Enrolled</th>
              <th>Attendance Days</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-sm text-muted">No members match this filter.</td>
              </tr>
            ) : (
              rows.map((row) => {
                const attendanceDays = [
                  row.schedule.monday ? "M" : null,
                  row.schedule.tuesday ? "Tu" : null,
                  row.schedule.wednesday ? "W" : null,
                  row.schedule.thursday ? "Th" : null,
                  row.schedule.friday ? "F" : null
                ]
                  .filter(Boolean)
                  .join(", ");
                return (
                  <tr key={row.member.id}>
                    <td>
                      <div className="flex items-center gap-2">
                        {row.profile.profile_image_url ? (
                          <Link href={`/operations/member-command-center/${row.member.id}`} aria-label={`Open ${row.member.display_name} command center`}>
                            <img
                              src={row.profile.profile_image_url}
                              alt={`${row.member.display_name} profile`}
                              className="h-10 w-10 rounded-full border border-border object-cover"
                            />
                          </Link>
                        ) : (
                          <Link
                            href={`/operations/member-command-center/${row.member.id}`}
                            aria-label={`Open ${row.member.display_name} command center`}
                            className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-slate-100 text-[11px] font-semibold text-primary-text"
                          >
                            {initials(row.member.display_name)}
                          </Link>
                        )}
                        <Link href={`/operations/member-command-center/${row.member.id}`} className="font-semibold text-brand">
                          {row.member.display_name}
                        </Link>
                      </div>
                    </td>
                    <td>{row.member.locker_number ?? "-"}</td>
                    <td className="capitalize">{row.member.status}</td>
                    <td>{formatOptionalDate(row.member.dob)}</td>
                    <td>{formatOptionalDate(row.schedule.enrollment_date ?? row.member.enrollment_date)}</td>
                    <td>{row.monthsEnrolled ?? "-"}</td>
                    <td>{attendanceDays || "-"}</td>
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
