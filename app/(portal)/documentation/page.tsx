import Link from "next/link";

import { DailyActivityForm } from "@/components/forms/daily-activity-form";
import { Card, CardTitle } from "@/components/ui/card";
import { MobileList } from "@/components/ui/mobile-list";
import { requireModuleAccess } from "@/lib/auth";
import { canAccessIncidentReportsForRole, normalizeRoleKey } from "@/lib/permissions";
import { getStaffActivitySnapshot, staffNameToSlug } from "@/lib/services/activity-snapshots";
import { getDocumentationSummary, getDocumentationTracker, getMembers } from "@/lib/services/documentation";
import { getDocumentationWorkflows } from "@/lib/services/documentation-workflows";
import { getProgressNoteComplianceLabel } from "@/lib/services/progress-note-model";
import { toEasternDate } from "@/lib/timezone";
import { formatDate, formatDateTime, formatPercent } from "@/lib/utils";

const STAFF_LOG_OVERVIEW = [
  { type: "Participation Log", label: "Participation Log", countKey: "dailyActivity" },
  { type: "Toilet Log", label: "Toilet Log", countKey: "toilet" },
  { type: "Shower Log", label: "Shower Log", countKey: "shower" },
  { type: "Transportation", label: "Transportation", countKey: "transportation" },
  { type: "Blood Sugar", label: "Blood Sugar", countKey: "bloodSugar" },
  { type: "Photo Upload", label: "Photo Upload", countKey: "photoUpload" },
  { type: "Assessment", label: "Assessment", countKey: "assessments" }
] as const;
type StaffLogType = (typeof STAFF_LOG_OVERVIEW)[number]["type"];

const STAFF_LOG_TYPES = new Set(STAFF_LOG_OVERVIEW.map((item) => item.type));
const isStaffLogType = (value: string): value is StaffLogType => STAFF_LOG_TYPES.has(value as StaffLogType);
const DOCUMENTATION_ENTRY_LINKS = [
  { href: "/documentation/activity", label: "Participation Log" },
  { href: "/documentation/toilet", label: "Toilet Log" },
  { href: "/documentation/shower", label: "Shower Log" },
  { href: "/documentation/transportation", label: "Transportation Log" },
  { href: "/documentation/incidents", label: "Incident Reports" },
  { href: "/documentation/photo-upload", label: "Photo Upload" },
  { href: "/documentation/blood-sugar", label: "Blood Sugar" },
  { href: "/ancillary", label: "Ancillary Charges" }
] as const;

export default async function DocumentationPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const profile = await requireModuleAccess("documentation");
  const normalizedRole = normalizeRoleKey(profile.role);
  const documentationEntryLinks = DOCUMENTATION_ENTRY_LINKS.filter((item) =>
    item.href === "/documentation/incidents" ? canAccessIncidentReportsForRole(normalizedRole) : true
  );

  if (normalizedRole === "program-assistant") {
    const params = searchParams ? await searchParams : {};
    const from = typeof params.from === "string" ? params.from : undefined;
    const to = typeof params.to === "string" ? params.to : undefined;
    const selectedTypeParam = typeof params.type === "string" ? params.type : "";
    const selectedType = isStaffLogType(selectedTypeParam)
      ? selectedTypeParam
      : "";
    const today = toEasternDate();

    const snapshot = await getStaffActivitySnapshot(staffNameToSlug(profile.full_name), from, to);

    const overviewRows = STAFF_LOG_OVERVIEW.map((item) => ({
      type: item.type,
      label: item.label,
      count: snapshot.counts[item.countKey]
    }));

    const entries = snapshot.activities
      .filter((activity) => isStaffLogType(activity.type))
      .sort((a, b) => {
        const byType = a.type.localeCompare(b.type);
        if (byType !== 0) return byType;
        if (a.when === b.when) return 0;
        return a.when < b.when ? 1 : -1;
      });
    const filteredEntries = selectedType ? entries.filter((entry) => entry.type === selectedType) : entries;

    const buildTypeHref = (type: StaffLogType) => {
      const query = new URLSearchParams({
        from: snapshot.range.from,
        to: snapshot.range.to,
        type
      });
      return `/documentation?${query.toString()}`;
    };

    return (
      <div className="space-y-4">
        <Card>
          <CardTitle>My Documentation Snapshot</CardTitle>
          <p className="mt-1 text-sm text-muted">
            {profile.full_name} | {formatDate(snapshot.range.from)} to {formatDate(snapshot.range.to)}
          </p>

          <form className="mt-3 grid gap-2 md:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted" htmlFor="from">
                From
              </label>
              <input
                id="from"
                name="from"
                type="date"
                defaultValue={snapshot.range.from}
                className="h-10 w-full rounded-lg border border-border px-3 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted" htmlFor="to">
                To
              </label>
              <input
                id="to"
                name="to"
                type="date"
                defaultValue={snapshot.range.to}
                className="h-10 w-full rounded-lg border border-border px-3 text-sm"
              />
            </div>
            <div className="md:col-span-2 flex items-end gap-2">
              <button type="submit" className="h-10 rounded-lg bg-brand px-3 text-sm font-semibold text-white">
                Apply
              </button>
              <Link
                href={`/documentation?from=${today}&to=${today}`}
                className="h-10 rounded-lg border border-border px-3 text-sm font-semibold leading-10"
              >
                Today
              </Link>
              <Link href="/documentation" className="h-10 rounded-lg border border-border px-3 text-sm font-semibold leading-10">
                Reset
              </Link>
            </div>
          </form>
        </Card>

        <Card className="table-wrap">
          <CardTitle>Overview Count Table</CardTitle>
          <div className="mt-1 text-xs text-muted">
            {selectedType ? (
              <>
                Viewing <span className="font-semibold text-foreground">{selectedType}</span> entries only.{" "}
                <Link href={`/documentation?from=${snapshot.range.from}&to=${snapshot.range.to}`} className="font-semibold text-brand">
                  Show all
                </Link>
              </>
            ) : (
              "Click a log type to open only that log's entries for this date range."
            )}
          </div>
          <table>
            <thead>
              <tr>
                <th>Log Type</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              {overviewRows.map((row) => (
                <tr key={row.type}>
                  <td>
                    <Link href={buildTypeHref(row.type)} className="font-semibold text-brand underline-offset-2 hover:underline">
                      {row.label}
                    </Link>
                  </td>
                  <td>{row.count}</td>
                </tr>
              ))}
              <tr>
                <td className="font-semibold">Total</td>
                <td className="font-semibold">{overviewRows.reduce((sum, row) => sum + row.count, 0)}</td>
              </tr>
            </tbody>
          </table>
        </Card>

        <MobileList
          items={filteredEntries.map((entry) => ({
            id: entry.id,
            title: entry.type,
            fields: [
              { label: "When", value: formatDateTime(entry.when) },
              { label: "Member", value: entry.memberName },
              { label: "Details", value: entry.details }
            ]
          }))}
        />

        <Card className="table-wrap hidden md:block">
          <CardTitle>My Entries (Sorted by Log)</CardTitle>
          <table>
            <thead>
              <tr>
                <th>Log Type</th>
                <th>Date/Time</th>
                <th>Member</th>
                <th>Details</th>
                <th>Open</th>
              </tr>
            </thead>
            <tbody>
              {filteredEntries.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center text-sm text-muted">
                    No entries found in this date range.
                  </td>
                </tr>
              ) : (
                filteredEntries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.type}</td>
                    <td>{formatDateTime(entry.when)}</td>
                    <td>{entry.memberName}</td>
                    <td>{entry.details}</td>
                    <td>
                      <Link className="font-semibold text-brand" href={entry.href}>
                        Open
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>
      </div>
    );
  }

  const [members, summary, tracker, workflows] = await Promise.all([
    getMembers(),
    getDocumentationSummary(),
    getDocumentationTracker(),
    getDocumentationWorkflows()
  ]);

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Documentation</CardTitle>
        <p className="mt-1 text-sm text-muted">Fast mobile-first logs with manager dashboards mirroring day-to-day AppSheet workflows.</p>
        {normalizedRole === "admin" ? (
          <details className="mt-3 rounded-lg border border-border bg-brandSoft">
            <summary className="cursor-pointer list-none px-3 py-2 text-sm font-semibold text-brand">Documentation Entry Menu</summary>
            <div className="grid gap-2 border-t border-border p-2 sm:grid-cols-2">
              {documentationEntryLinks.map((item) => (
                <Link key={item.href} href={item.href} className="rounded-lg border border-border bg-white px-3 py-2 text-sm font-semibold text-brand">
                  {item.label}
                </Link>
              ))}
            </div>
          </details>
        ) : (
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {documentationEntryLinks.map((item) => (
              <Link key={item.href} href={item.href} className="rounded-lg border border-border bg-brandSoft px-3 py-2 text-sm font-semibold text-brand">
                {item.label}
              </Link>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardTitle>Quick Participation Log Entry</CardTitle>
        <div className="mt-3">
          <DailyActivityForm members={members} />
        </div>
      </Card>

      <MobileList items={summary.today.map((row: any) => ({ id: row.staff_name, title: row.staff_name, fields: [{ label: "Total", value: row.total_count }, { label: "Uploaded", value: row.uploaded_today ? "Yes" : "No" }, { label: "Toilet", value: row.toilet_count }, { label: "Shower", value: row.shower_count }] }))} />

      <Card className="table-wrap hidden md:block">
        <CardTitle>Documentation Dashboard</CardTitle>
        <table>
          <thead>
            <tr>
              <th>Staff</th>
              <th>Participation</th>
              <th>Toilet</th>
              <th>Shower</th>
              <th>Transportation</th>
              <th>Ancillary</th>
              <th>Total</th>
              <th>Uploaded?</th>
            </tr>
          </thead>
          <tbody>
            {summary.today.map((row: any, idx: number) => (
              <tr key={`${row.staff_name}-${idx}`}>
                <td>{row.staff_name}</td>
                <td>{row.participation_count}</td>
                <td>{row.toilet_count}</td>
                <td>{row.shower_count}</td>
                <td>{row.transport_count}</td>
                <td>{row.ancillary_count}</td>
                <td>{row.total_count}</td>
                <td>{row.uploaded_today ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="table-wrap">
        <CardTitle>Timely Documentation</CardTitle>
        <table>
          <thead>
            <tr>
              <th>Staff</th>
              <th>On-time</th>
              <th>Late</th>
              <th>Total</th>
              <th>On-time %</th>
            </tr>
          </thead>
          <tbody>
            {summary.timely.map((row: any) => (
              <tr key={row.staff_name}>
                <td>{row.staff_name}</td>
                <td>{row.on_time}</td>
                <td>{row.late}</td>
                <td>{row.total}</td>
                <td>{formatPercent(row.on_time_percent || 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="table-wrap">
        <CardTitle>Care Tracker Dashboard</CardTitle>
        <table>
          <thead>
            <tr>
              <th>Member</th>
              <th>Assigned Staff</th>
              <th>Next Care Plan Due</th>
              <th>Care Plan Done</th>
              <th>Next Progress Note Due</th>
              <th>Progress Note Status</th>
            </tr>
          </thead>
          <tbody>
            {tracker.map((row: any) => (
              <tr key={row.id}>
                <td>{row.member_name}</td>
                <td>{row.assigned_staff_name}</td>
                <td>{formatDate(row.next_care_plan_due)}</td>
                <td>{row.care_plan_done ? "Yes" : "No"}</td>
                <td>{formatDate(row.next_progress_note_due)}</td>
                <td>
                  {getProgressNoteComplianceLabel(row.progress_note_status)}
                  {row.has_progress_note_draft ? " | Draft" : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="table-wrap">
        <CardTitle>Recent Workflow Entries</CardTitle>
        <table>
          <thead><tr><th>Type</th><th>Recent Count</th></tr></thead>
          <tbody>
            <tr><td>Toilet Logs</td><td>{workflows.toilets.length}</td></tr>
            <tr><td>Shower Logs</td><td>{workflows.showers.length}</td></tr>
            <tr><td>Transportation Logs</td><td>{workflows.transportation.length}</td></tr>
            <tr><td>Photo Uploads</td><td>{workflows.photos.length}</td></tr>
            <tr><td>Assessments</td><td>{workflows.assessments.length}</td></tr>
          </tbody>
        </table>
      </Card>
    </div>
  );
}

