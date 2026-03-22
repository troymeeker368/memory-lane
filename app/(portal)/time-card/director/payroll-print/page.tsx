import { Card, CardTitle } from "@/components/ui/card";
import { requireRoles } from "@/lib/auth";
import { getDirectorPayrollExportWorkspace } from "@/lib/payroll/payroll-export";
import { toEasternDateTimeLocal } from "@/lib/timezone";
import { formatDate } from "@/lib/utils";

function firstString(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function DirectorPayrollPrintPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRoles(["admin", "director", "manager"]);
  const query = await searchParams;
  const employeeId = firstString(query.employeeId) ?? null;
  const overridePayPeriodStart = firstString(query.overridePayPeriodStart) ?? null;
  const workspace = await getDirectorPayrollExportWorkspace({
    employeeId,
    overridePayPeriodStart
  });

  const backParams = new URLSearchParams();
  backParams.set("tab", "export");
  if (employeeId) backParams.set("employeeId", employeeId);
  if (workspace.payPeriod.startDate) backParams.set("overridePayPeriodStart", workspace.payPeriod.startDate);

  return (
    <div className="space-y-4">
      <Card className="print-hide">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Payroll Printable View</CardTitle>
            <p className="mt-1 text-sm text-muted">
              Pay period: {workspace.payPeriod.label}
            </p>
          </div>
          <a href={`/time-card/director?${backParams.toString()}`} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-brand">
            Back to Payroll Export
          </a>
        </div>
      </Card>

      {workspace.timesheets.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">No payroll timesheets for the selected pay period.</p>
        </Card>
      ) : (
        workspace.timesheets.map((timesheet) => (
          <Card key={timesheet.employeeId} className="table-wrap">
            <div className="space-y-1">
              <CardTitle>{timesheet.employeeName}</CardTitle>
              <p className="text-sm text-muted">{timesheet.payPeriod.label}</p>
              <p className="text-sm text-muted">Town Square Fort Mill</p>
              <p className="text-sm text-muted">368 Fort Mill Parkway, Suite 106, Fort Mill, SC 29715</p>
            </div>
            <table className="mt-3">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Day</th>
                  <th>Time In</th>
                  <th>Time Out</th>
                  <th>Regular Hours</th>
                  <th>Overtime Hours</th>
                  <th>Paid Time Off (PTO)</th>
                </tr>
              </thead>
              <tbody>
                {timesheet.rows.map((row) => (
                  <tr key={row.workDate}>
                    <td>{formatDate(row.workDate)}</td>
                    <td>{row.dayLabel}</td>
                    <td>{row.timeInIso ? toEasternDateTimeLocal(row.timeInIso).split("T")[1] : "-"}</td>
                    <td>{row.timeOutIso ? toEasternDateTimeLocal(row.timeOutIso).split("T")[1] : "-"}</td>
                    <td>{row.regularHours.toFixed(2)}</td>
                    <td>{row.overtimeHours.toFixed(2)}</td>
                    <td>{row.ptoHours.toFixed(2)}</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td>Week 1 Subtotal</td>
                  <td colSpan={3} />
                  <td>{timesheet.week1Totals.regularHours.toFixed(2)}</td>
                  <td>{timesheet.week1Totals.overtimeHours.toFixed(2)}</td>
                  <td>{timesheet.week1Totals.ptoHours.toFixed(2)}</td>
                </tr>
                <tr className="font-semibold">
                  <td>Week 2 Subtotal</td>
                  <td colSpan={3} />
                  <td>{timesheet.week2Totals.regularHours.toFixed(2)}</td>
                  <td>{timesheet.week2Totals.overtimeHours.toFixed(2)}</td>
                  <td>{timesheet.week2Totals.ptoHours.toFixed(2)}</td>
                </tr>
                <tr className="font-semibold">
                  <td>Pay Period Total</td>
                  <td colSpan={3} />
                  <td>{timesheet.totals.regularHours.toFixed(2)}</td>
                  <td>{timesheet.totals.overtimeHours.toFixed(2)}</td>
                  <td>{timesheet.totals.ptoHours.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
            <p className="mt-4 text-sm">
              I certify that the hours shown above are true and accurate, including all regular hours, overtime hours, and paid time off reported for this pay period.
            </p>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <p className="border-t border-border pt-2 text-sm">Employee Signature</p>
              <p className="border-t border-border pt-2 text-sm">Date</p>
              <p className="border-t border-border pt-2 text-sm">Supervisor Signature</p>
              <p className="border-t border-border pt-2 text-sm">Date</p>
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
