import Link from "next/link";

import { Card, CardTitle } from "@/components/ui/card";
import { formatDate, formatDateTime } from "@/lib/utils";

import { submitDirectorTimecardAction } from "@/app/(portal)/time-card/director/actions";
import type { DirectorTimecardsWorkspace } from "@/app/(portal)/time-card/director/director-timecards-shared";
import { statusBadge } from "@/app/(portal)/time-card/director/director-timecards-shared";

export function ExportTab({
  workspace,
  exportHref,
  employeeId,
  canLockPayPeriod
}: {
  workspace: DirectorTimecardsWorkspace;
  exportHref: string;
  employeeId: string | null;
  canLockPayPeriod: boolean;
}) {
  return (
    <>
      <Card>
        <CardTitle>Payroll Export</CardTitle>
        <p className="mt-1 text-sm text-muted">
          Export includes employee, pay period, daily punches, hours, status, and director approval data.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {workspace.payrollExport.csvDataUrl ? (
            <a href={workspace.payrollExport.csvDataUrl} download={workspace.payrollExport.fileName} className="rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white">
              Download CSV
            </a>
          ) : (
            <span className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
              {workspace.payrollExport.error ?? "Export unavailable."}
            </span>
          )}
          <Link
            href={`/time-card/director/payroll-print?payPeriodId=${encodeURIComponent(workspace.selectedPayPeriod.id)}${employeeId ? `&employeeId=${encodeURIComponent(employeeId)}` : ""}`}
            className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-brand"
          >
            Open Printable View
          </Link>
          {canLockPayPeriod ? (
            <form action={submitDirectorTimecardAction}>
              <input type="hidden" name="intent" value="setPayPeriodClosed" />
              <input type="hidden" name="returnPath" value={exportHref} />
              <input type="hidden" name="payPeriodId" value={workspace.selectedPayPeriod.id} />
              <input type="hidden" name="isClosed" value={workspace.selectedPayPeriod.is_closed ? "false" : "true"} />
              <button type="submit" className="rounded-lg border border-border px-3 py-2 text-xs font-semibold">
                {workspace.selectedPayPeriod.is_closed ? "Reopen Pay Period" : "Close Pay Period"}
              </button>
            </form>
          ) : null}
        </div>
      </Card>
      <Card className="table-wrap">
        <CardTitle>Export Preview</CardTitle>
        <table className="mt-3">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Pay Period</th>
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
              <th>Approval</th>
            </tr>
          </thead>
          <tbody>
            {workspace.payrollExport.rows.length === 0 ? (
              <tr>
                <td colSpan={13} className="text-sm text-muted">No export rows for selected filters.</td>
              </tr>
            ) : (
              workspace.payrollExport.rows.map((row, index) => (
                <tr key={`${row.employee_name}-${row.work_date}-${index}`}>
                  <td>{row.employee_name}</td>
                  <td>{row.pay_period_label}</td>
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
                  <td>{row.approved_by ? `${row.approved_by}${row.approved_at ? ` (${formatDateTime(row.approved_at)})` : ""}` : "-"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </>
  );
}
