import { Card, CardTitle } from "@/components/ui/card";

import type { DirectorTimecardsWorkspace } from "@/app/(portal)/time-card/director/director-timecards-shared";
import { statusBadge } from "@/app/(portal)/time-card/director/director-timecards-shared";

export function SummaryTab({ workspace }: { workspace: DirectorTimecardsWorkspace }) {
  return (
    <Card className="table-wrap">
      <CardTitle>Pay Period Summary</CardTitle>
      <table className="mt-3">
        <thead>
          <tr>
            <th>Employee</th>
            <th>Regular Hours</th>
            <th>Overtime Hours</th>
            <th>PTO Hours</th>
            <th>Total Paid Hours</th>
            <th>Exception Count</th>
            <th>Approval State</th>
          </tr>
        </thead>
        <tbody>
          {workspace.payPeriodSummary.length === 0 ? (
            <tr>
              <td colSpan={7} className="text-sm text-muted">No summary data for this period.</td>
            </tr>
          ) : (
            workspace.payPeriodSummary.map((row) => (
              <tr key={row.employee_name}>
                <td>{row.employee_name}</td>
                <td>{row.regular_hours.toFixed(2)}</td>
                <td>{row.overtime_hours.toFixed(2)}</td>
                <td>{row.pto_hours.toFixed(2)}</td>
                <td>{row.total_paid_hours.toFixed(2)}</td>
                <td>{row.exception_count}</td>
                <td><span className={statusBadge(row.approval_state)}>{row.approval_state}</span></td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </Card>
  );
}
