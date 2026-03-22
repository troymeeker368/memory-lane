import { Card, CardTitle } from "@/components/ui/card";
import type { getDirectorPayrollExportWorkspace } from "@/lib/payroll/payroll-export";

export function ExportTab({
  workspace,
  printHref,
  downloadHref,
  employeeId,
  overridePayPeriodStart
}: {
  workspace: Awaited<ReturnType<typeof getDirectorPayrollExportWorkspace>>;
  printHref: string;
  downloadHref: string;
  employeeId: string | null;
  overridePayPeriodStart: string | null;
}) {
  return (
    <>
      <Card>
        <CardTitle>Payroll Export</CardTitle>
        <p className="mt-1 text-sm text-muted">
          Generate payroll-ready Excel timesheets from canonical punches and approved PTO using the anchored biweekly payroll schedule.
        </p>
        <form className="mt-3 grid gap-2 md:grid-cols-[minmax(0,240px)_auto]" method="get">
          <input type="hidden" name="tab" value="export" />
          {employeeId ? <input type="hidden" name="employeeId" value={employeeId} /> : null}
          <select
            name="overridePayPeriodStart"
            defaultValue={overridePayPeriodStart ?? workspace.payPeriod.startDate}
            className="h-10 rounded-lg border border-border px-3 text-sm"
          >
            {workspace.availablePayrollPeriods.map((period) => (
              <option key={period.startDate} value={period.startDate}>
                {period.label}
              </option>
            ))}
          </select>
          <button type="submit" className="h-10 rounded-lg bg-brand px-3 text-sm font-semibold text-white">
            Load Payroll Period
          </button>
        </form>
        <div className="mt-3 flex flex-wrap gap-2">
          <a href={downloadHref} className="rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white">
            Download Payroll Timesheets
          </a>
          <a href={printHref} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-brand">
            Open Printable View
          </a>
        </div>
        {workspace.warnings.map((warning) => (
          <p key={warning} className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
            {warning}
          </p>
        ))}
      </Card>
      <Card className="table-wrap">
        <CardTitle>Timesheet Preview</CardTitle>
        <table className="mt-3">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Pay Period</th>
              <th>Week 1 Regular</th>
              <th>Week 1 OT</th>
              <th>Week 1 PTO</th>
              <th>Week 2 Regular</th>
              <th>Week 2 OT</th>
              <th>Week 2 PTO</th>
              <th>Regular Total</th>
              <th>OT Total</th>
              <th>PTO Total</th>
              <th>File Name</th>
              <th>Issues</th>
            </tr>
          </thead>
          <tbody>
            {workspace.timesheets.length === 0 ? (
              <tr>
                <td colSpan={13} className="text-sm text-muted">No payroll timesheets for selected filters.</td>
              </tr>
            ) : (
              workspace.timesheets.map((timesheet) => (
                <tr key={timesheet.employeeId}>
                  <td>{timesheet.employeeName}</td>
                  <td>{timesheet.payPeriod.label}</td>
                  <td>{timesheet.week1Totals.regularHours.toFixed(2)}</td>
                  <td>{timesheet.week1Totals.overtimeHours.toFixed(2)}</td>
                  <td>{timesheet.week1Totals.ptoHours.toFixed(2)}</td>
                  <td>{timesheet.week2Totals.regularHours.toFixed(2)}</td>
                  <td>{timesheet.week2Totals.overtimeHours.toFixed(2)}</td>
                  <td>{timesheet.week2Totals.ptoHours.toFixed(2)}</td>
                  <td>{timesheet.totals.regularHours.toFixed(2)}</td>
                  <td>{timesheet.totals.overtimeHours.toFixed(2)}</td>
                  <td>{timesheet.totals.ptoHours.toFixed(2)}</td>
                  <td>{timesheet.fileName}</td>
                  <td>{timesheet.issues.length > 0 ? timesheet.issues.join(" ") : "-"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </>
  );
}
