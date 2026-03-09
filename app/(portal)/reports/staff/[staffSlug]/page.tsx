import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Card, CardTitle } from "@/components/ui/card";
import { BackArrowButton } from "@/components/ui/back-arrow-button";
import { PunchTypeBadge } from "@/components/ui/punch-type-badge";
import { requireModuleAccess } from "@/lib/auth";
import { getStaffActivitySnapshot, getStaffSnapshotStaffOptions, staffNameToSlug } from "@/lib/services/activity-snapshots";
import { formatDate, formatDateTime } from "@/lib/utils";

function firstString(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function buildStaffHref(staffSlug: string, from?: string, to?: string) {
  const query = new URLSearchParams();
  if (from) query.set("from", from);
  if (to) query.set("to", to);
  const suffix = query.toString();
  return `/reports/staff/${staffSlug}${suffix ? `?${suffix}` : ""}`;
}

const LOG_TABLES: Array<{ key: string; title: string }> = [
  { key: "Participation Log", title: "Participation Logs" },
  { key: "Toilet Log", title: "Toilet Logs" },
  { key: "Shower Log", title: "Shower Logs" },
  { key: "Transportation", title: "Transportation Logs" },
  { key: "Blood Sugar", title: "Blood Sugar Logs" },
  { key: "Photo Upload", title: "Photo Upload Logs" },
  { key: "Assessment", title: "Assessment Logs" },
  { key: "Time Punch", title: "Time Punch Logs" },
  { key: "Lead Activity", title: "Lead Activity Logs" },
  { key: "Partner Activity", title: "Partner Activity Logs" }
];

export default async function StaffActivitySnapshotPage({
  params,
  searchParams
}: {
  params: Promise<{ staffSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireModuleAccess("reports");

  const [routeParams, query, staffOptions] = await Promise.all([params, searchParams, getStaffSnapshotStaffOptions()]);
  const from = firstString(query.from);
  const to = firstString(query.to);
  const requestedStaff = firstString(query.staff);

  if (requestedStaff && requestedStaff !== routeParams.staffSlug) {
    redirect(buildStaffHref(requestedStaff, from, to));
  }

  const snapshot = await getStaffActivitySnapshot(routeParams.staffSlug, from, to);
  if (!snapshot.staff) notFound();

  const activeStaffSlug = staffNameToSlug(snapshot.staff.full_name);

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>{snapshot.staff.full_name} Activity Snapshot</CardTitle>
        <p className="mt-1 text-sm text-muted">Date range: {formatDate(snapshot.range.from)} to {formatDate(snapshot.range.to)}</p>

        <form className="mt-3 grid gap-2 md:grid-cols-5">
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted" htmlFor="staff">Staff</label>
            <select id="staff" name="staff" defaultValue={activeStaffSlug} className="h-10 w-full rounded-lg border border-border px-3 text-sm">
              {staffOptions.map((option) => (
                <option key={option.id} value={option.slug}>
                  {option.full_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted" htmlFor="from">From</label>
            <input id="from" name="from" type="date" defaultValue={snapshot.range.from} className="h-10 w-full rounded-lg border border-border px-3 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted" htmlFor="to">To</label>
            <input id="to" name="to" type="date" defaultValue={snapshot.range.to} className="h-10 w-full rounded-lg border border-border px-3 text-sm" />
          </div>
          <div className="md:col-span-2 flex items-end gap-2">
            <button type="submit" className="h-10 rounded-lg bg-brand px-3 text-sm font-semibold text-white">Apply</button>
            <Link href={`/reports/staff/${activeStaffSlug}`} className="h-10 rounded-lg border border-border px-3 text-sm font-semibold leading-10">
              Clear Filters
            </Link>
            <Link href="/reports/staff" className="h-10 rounded-lg border border-border px-3 text-sm font-semibold leading-10">Staff Selector</Link>
            <BackArrowButton fallbackHref="/reports" ariaLabel="Back to reports" />
          </div>
        </form>
      </Card>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Card><CardTitle>Total Entries</CardTitle><p className="text-2xl font-bold">{snapshot.totalEntries}</p></Card>
        <Card><CardTitle>Documentation</CardTitle><p className="text-sm">Participation {snapshot.counts.dailyActivity} | Toilet {snapshot.counts.toilet} | Shower {snapshot.counts.shower} | Transport {snapshot.counts.transportation}</p></Card>
        <Card><CardTitle>Clinical</CardTitle><p className="text-sm">Blood Sugar {snapshot.counts.bloodSugar} | Assessments {snapshot.counts.assessments}</p></Card>
        <Card><CardTitle>Media / Charges</CardTitle><p className="text-sm">Photos {snapshot.counts.photoUpload}</p></Card>
        <Card><CardTitle>Time / Sales</CardTitle><p className="text-sm">Punches {snapshot.counts.timePunches} | Lead Acts {snapshot.counts.leadActivities} | Partner Acts {snapshot.counts.partnerActivities}</p></Card>
      </section>

      {LOG_TABLES.map((table) => {
        const rows = snapshot.activities.filter((activity) => activity.type === table.key);
        const contextLabel = table.key === "Time Punch" ? "In Fence" : "Member/Context";
        return (
          <Card key={table.key} className="table-wrap">
            <CardTitle>{table.title}</CardTitle>
            <table>
              <thead>
                <tr>
                  <th>Date/Time</th>
                  <th>{contextLabel}</th>
                  <th>Details</th>
                  <th>Open</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="text-center text-sm text-muted">No {table.title.toLowerCase()} found in this date range.</td>
                  </tr>
                ) : (
                  rows.map((activity) => (
                    <tr key={activity.id}>
                      <td>{formatDateTime(activity.when)}</td>
                      <td>{activity.memberName}</td>
                      <td>{activity.type === "Time Punch" ? <PunchTypeBadge punchType={activity.details === "IN" ? "in" : "out"} /> : activity.details}</td>
                      <td><Link className="font-semibold text-brand" href={activity.href}>Open</Link></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </Card>
        );
      })}
    </div>
  );
}


