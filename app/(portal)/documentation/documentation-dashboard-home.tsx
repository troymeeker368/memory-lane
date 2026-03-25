import Link from "next/link";

import { DailyActivityFormShell } from "@/components/forms/daily-activity-form-shell";
import { Card, CardTitle } from "@/components/ui/card";
import { MobileList } from "@/components/ui/mobile-list";
import { canAccessIncidentReportsForRole } from "@/lib/permissions/core";
import {
  getDocumentationSummary,
  getDocumentationTracker,
  getMembers,
  getRecentDocumentationWorkflowCounts
} from "@/lib/services/documentation";
import { getProgressNoteComplianceLabel } from "@/lib/services/progress-note-model";
import { formatDate, formatPercent } from "@/lib/utils";
import type { CanonicalAppRole } from "@/types/app";

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

type DocumentationDashboardHomeProps = {
  normalizedRole: CanonicalAppRole;
};

type DocumentationSummary = Awaited<ReturnType<typeof getDocumentationSummary>>;
type DocumentationTrackerRow = Awaited<ReturnType<typeof getDocumentationTracker>>[number];
type DocumentationWorkflowCounts = Awaited<ReturnType<typeof getRecentDocumentationWorkflowCounts>>;

function DocumentationTodayMobileList({ today }: { today: DocumentationSummary["today"] }) {
  return (
    <MobileList
      items={today.map((row) => ({
        id: row.staff_name,
        title: row.staff_name,
        fields: [
          { label: "Total", value: row.total_count },
          { label: "Uploaded", value: row.uploaded_today ? "Yes" : "No" },
          { label: "Toilet", value: row.toilet_count },
          { label: "Shower", value: row.shower_count }
        ]
      }))}
    />
  );
}

function DocumentationDashboardTable({ today }: { today: DocumentationSummary["today"] }) {
  return (
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
          {today.map((row, idx) => (
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
  );
}

function TimelyDocumentationTable({ timely }: { timely: DocumentationSummary["timely"] }) {
  return (
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
          {timely.map((row) => (
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
  );
}

function CareTrackerTable({ tracker }: { tracker: DocumentationTrackerRow[] }) {
  return (
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
          {tracker.map((row) => (
            <tr key={row.id}>
              <td>{row.member_name}</td>
              <td>{row.assigned_staff_name}</td>
              <td>{row.next_care_plan_due ? formatDate(row.next_care_plan_due) : "-"}</td>
              <td>{row.care_plan_done ? "Yes" : "No"}</td>
              <td>{row.next_progress_note_due ? formatDate(row.next_progress_note_due) : "-"}</td>
              <td>
                {getProgressNoteComplianceLabel(row.progress_note_status)}
                {row.has_progress_note_draft ? " | Draft" : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function RecentWorkflowCountsTable({ counts }: { counts: DocumentationWorkflowCounts }) {
  return (
    <Card className="table-wrap">
      <CardTitle>Recent Workflow Entries</CardTitle>
      <table>
        <thead>
          <tr>
            <th>Type</th>
            <th>Recent Count</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Toilet Logs</td>
            <td>{counts.toilets}</td>
          </tr>
          <tr>
            <td>Shower Logs</td>
            <td>{counts.showers}</td>
          </tr>
          <tr>
            <td>Transportation Logs</td>
            <td>{counts.transportation}</td>
          </tr>
          <tr>
            <td>Photo Uploads</td>
            <td>{counts.photos}</td>
          </tr>
          <tr>
            <td>Assessments</td>
            <td>{counts.assessments}</td>
          </tr>
        </tbody>
      </table>
    </Card>
  );
}

export async function DocumentationDashboardHome({ normalizedRole }: DocumentationDashboardHomeProps) {
  const documentationEntryLinks = DOCUMENTATION_ENTRY_LINKS.filter((item) =>
    item.href === "/documentation/incidents" ? canAccessIncidentReportsForRole(normalizedRole) : true
  );

  const [members, summary, tracker, workflowCounts] = await Promise.all([
    getMembers(),
    getDocumentationSummary(),
    getDocumentationTracker(),
    getRecentDocumentationWorkflowCounts()
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
          <DailyActivityFormShell members={members} />
        </div>
      </Card>

      <DocumentationTodayMobileList today={summary.today} />
      <DocumentationDashboardTable today={summary.today} />
      <TimelyDocumentationTable timely={summary.timely} />
      <CareTrackerTable tracker={tracker} />
      <RecentWorkflowCountsTable counts={workflowCounts} />
    </div>
  );
}
