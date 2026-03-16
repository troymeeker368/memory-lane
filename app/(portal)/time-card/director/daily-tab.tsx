import { Card, CardTitle } from "@/components/ui/card";
import { formatDate, formatDateTime } from "@/lib/utils";

import type { DirectorTimecardsWorkspace } from "@/app/(portal)/time-card/director/director-timecards-shared";
import { statusBadge } from "@/app/(portal)/time-card/director/director-timecards-shared";

export function DailyTab({ workspace }: { workspace: DirectorTimecardsWorkspace }) {
  return (
    <Card className="table-wrap">
      <CardTitle>Daily Timecards</CardTitle>
      <table className="mt-3">
        <thead>
          <tr>
            <th>Employee</th>
            <th>Work Date</th>
            <th>First In</th>
            <th>Last Out</th>
            <th>Raw</th>
            <th>Meal</th>
            <th>Worked</th>
            <th>PTO</th>
            <th>OT</th>
            <th>Total Paid</th>
            <th>Status</th>
            <th>Approved By</th>
            <th>Approved At</th>
          </tr>
        </thead>
        <tbody>
          {workspace.dailyTimecards.length === 0 ? (
            <tr>
              <td colSpan={13} className="text-sm text-muted">No daily timecards for selected filters.</td>
            </tr>
          ) : (
            workspace.dailyTimecards.map((row) => (
              <tr key={row.id} className={row.has_exception ? "bg-amber-50" : undefined}>
                <td>{row.employee_name}</td>
                <td>{formatDate(row.work_date)}</td>
                <td>{row.first_in ? formatDateTime(row.first_in) : "-"}</td>
                <td>{row.last_out ? formatDateTime(row.last_out) : "-"}</td>
                <td>{row.raw_hours.toFixed(2)}</td>
                <td>{row.meal_deduction_hours.toFixed(2)}</td>
                <td>{row.worked_hours.toFixed(2)}</td>
                <td>{row.pto_hours.toFixed(2)}</td>
                <td>{row.overtime_hours.toFixed(2)}</td>
                <td>{row.total_paid_hours.toFixed(2)}</td>
                <td><span className={statusBadge(row.status)}>{row.status}</span></td>
                <td>{row.approved_by ?? "-"}</td>
                <td>{row.approved_at ? formatDateTime(row.approved_at) : "-"}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </Card>
  );
}
