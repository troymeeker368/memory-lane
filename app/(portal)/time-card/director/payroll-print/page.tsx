import Link from "next/link";

import { Card, CardTitle } from "@/components/ui/card";
import { requireRoles } from "@/lib/auth";
import { getDirectorTimecardsWorkspace } from "@/lib/services/director-timecards";
import { formatDate, formatDateTime } from "@/lib/utils";

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
  const payPeriodId = firstString(query.payPeriodId) ?? null;
  const employeeId = firstString(query.employeeId) ?? null;
  const workspace = await getDirectorTimecardsWorkspace({
    payPeriodId,
    employeeId,
    status: "all",
    exceptionOnly: false
  });

  return (
    <div className="space-y-4">
      <Card className="print-hide">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Payroll Printable View</CardTitle>
            <p className="mt-1 text-sm text-muted">
              Pay period: {workspace.selectedPayPeriod.label}
            </p>
          </div>
          <Link href={`/time-card/director?tab=export&payPeriodId=${encodeURIComponent(workspace.selectedPayPeriod.id)}${employeeId ? `&employeeId=${encodeURIComponent(employeeId)}` : ""}`} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-brand">
            Back to Payroll Export
          </Link>
        </div>
      </Card>

      <Card className="table-wrap">
        <table>
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
                <td colSpan={13} className="text-sm text-muted">No rows for selected filters.</td>
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
                  <td>{row.status}</td>
                  <td>{row.approved_by ? `${row.approved_by}${row.approved_at ? ` (${formatDateTime(row.approved_at)})` : ""}` : "-"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
