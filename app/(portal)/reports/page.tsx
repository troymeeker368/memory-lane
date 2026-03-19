import Link from "next/link";

import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import { getAncillaryEntryCountLastDays } from "@/lib/services/ancillary";
import { getProgressNoteComplianceLabel } from "@/lib/services/progress-note-model";
import { staffNameToSlug } from "@/lib/services/activity-snapshots";
import { getOperationsReports } from "@/lib/services/reports-ops";
import { getReportingSnapshot } from "@/lib/services/reports";
import { formatDate, formatOptionalDateTime, formatPercent } from "@/lib/utils";

function StaffLink({ staffName }: { staffName: string }) {
  return (
    <Link href={`/reports/staff/${staffNameToSlug(staffName)}`} className="font-semibold text-brand">
      {staffName}
    </Link>
  );
}

export default async function ReportsPage() {
  await requireModuleAccess("reports");
  const { timelyDocs, careTracker, toileted } = await getReportingSnapshot();
  const [ops, ancillaryLast30Count] = await Promise.all([getOperationsReports(), getAncillaryEntryCountLastDays(30)]);

  return (
    <div className="space-y-4">
      <Card className="table-wrap">
        <CardTitle>Documentation Dashboard</CardTitle>
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
            {timelyDocs.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center text-sm text-muted">No documentation timeliness rows are available for the current reporting dataset.</td>
              </tr>
            ) : (
              timelyDocs.map((row: any) => (
                <tr key={row.staff_name}>
                  <td><StaffLink staffName={row.staff_name} /></td>
                  <td>{row.on_time}</td>
                  <td>{row.late}</td>
                  <td>{row.total}</td>
                  <td>{formatPercent(row.on_time_percent || 0)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      <Card className="table-wrap">
        <CardTitle>Staff Productivity</CardTitle>
        <table>
          <thead>
            <tr>
              <th>Staff</th>
              <th>Activity</th>
              <th>Toilet</th>
              <th>Shower</th>
              <th>Transportation</th>
              <th>Total Count</th>
            </tr>
          </thead>
          <tbody>
            {ops.staffProductivity.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center text-sm text-muted">No staff productivity rows are available for the current reporting dataset.</td>
              </tr>
            ) : (
              ops.staffProductivity.map((row: any) => (
                <tr key={row.staff_name}>
                  <td><StaffLink staffName={row.staff_name} /></td>
                  <td>{row.activity_logs}</td>
                  <td>{row.toilet_logs}</td>
                  <td>{row.shower_logs}</td>
                  <td>{row.transportation_logs}</td>
                  <td>{Number(row.activity_logs ?? 0) + Number(row.toilet_logs ?? 0) + Number(row.shower_logs ?? 0) + Number(row.transportation_logs ?? 0)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      <Card className="table-wrap">
        <CardTitle>Time Clock Summary</CardTitle>
        <table>
          <thead>
            <tr>
              <th>Staff</th>
              <th>Punches</th>
              <th>Outside Fence</th>
            </tr>
          </thead>
          <tbody>
            {ops.timeSummary.length === 0 ? (
              <tr>
                <td colSpan={3} className="text-center text-sm text-muted">No time clock summary rows are available for the current reporting dataset.</td>
              </tr>
            ) : (
              ops.timeSummary.map((row: any) => (
                <tr key={row.staff_name}>
                  <td><StaffLink staffName={row.staff_name} /></td>
                  <td>{row.punches}</td>
                  <td>{row.outside_fence}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      <Card>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Ancillary Charges Summary (Previous 30 Days)</CardTitle>
          <Link href="/reports/monthly-ancillary" className="text-sm font-semibold text-brand">Open Full Breakdown</Link>
        </div>
        <p className="mt-2 text-sm text-muted">Count of ancillary charge entries across all members in the previous 30 days.</p>
        <p className="mt-2 text-2xl font-bold text-brand">{ancillaryLast30Count}</p>
      </Card>

      <Card>
        <CardTitle>Pipeline Summary</CardTitle>
        <div className="mt-2 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted">Open</p>
            <p className="text-lg font-semibold">{ops.pipeline.open}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted">Won</p>
            <p className="text-lg font-semibold">{ops.pipeline.won}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted">Lost</p>
            <p className="text-lg font-semibold">{ops.pipeline.lost}</p>
          </div>
        </div>
      </Card>

      <Card className="table-wrap">
        <CardTitle>Care Tracker Dashboard</CardTitle>
        <table>
          <thead>
            <tr>
              <th>Member</th>
              <th>Care Plan Due</th>
              <th>Care Plan Done</th>
              <th>Progress Note Due</th>
              <th>Progress Note Status</th>
            </tr>
          </thead>
          <tbody>
            {careTracker.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center text-sm text-muted">No care tracker rows are available for the current reporting dataset.</td>
              </tr>
            ) : (
              careTracker.map((row: any, idx: number) => (
                <tr key={`${row.member_name}-${idx}`}>
                  <td>{row.member_name}</td>
                  <td>{formatDate(row.next_care_plan_due)}</td>
                  <td>{row.care_plan_done ? "Yes" : "No"}</td>
                  <td>{formatDate(row.next_progress_note_due)}</td>
                  <td>
                    {getProgressNoteComplianceLabel(row.progress_note_status)}
                    {row.has_progress_note_draft ? " | Draft" : ""}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      <Card className="table-wrap">
        <CardTitle>Last Toileted Dashboard</CardTitle>
        <table>
          <thead>
            <tr>
              <th>Member</th>
              <th>Last Toileted At</th>
              <th>Staff</th>
            </tr>
          </thead>
          <tbody>
            {toileted.length === 0 ? (
              <tr>
                <td colSpan={3} className="text-center text-sm text-muted">No toileting rows are available for the current reporting dataset.</td>
              </tr>
            ) : (
              toileted.map((row: any, idx: number) => (
                <tr key={`${row.member_name}-${idx}`}>
                  <td>{row.member_name}</td>
                  <td>{formatOptionalDateTime(row.last_toileted_at)}</td>
                  <td>{row.staff_name}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
