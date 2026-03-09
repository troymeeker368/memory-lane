import Link from "next/link";

import { TimeReviewButtons } from "@/components/forms/record-actions";
import { Card, CardTitle } from "@/components/ui/card";
import { MobileList } from "@/components/ui/mobile-list";
import { PunchStatusBadge, PunchTypeBadge } from "@/components/ui/punch-type-badge";
import { TimePunchControls } from "@/components/forms/time-punch-controls";
import { getCurrentProfile, requireModuleAccess } from "@/lib/auth";
import { normalizeRoleKey, PTO_EXTERNAL_URL } from "@/lib/permissions";
import { getManagerTimeReview, getTimeCardOverview } from "@/lib/services/time";
import { formatDate, formatDateTime } from "@/lib/utils";

export default async function TimeCardPage() {
  await requireModuleAccess("time-card");
  const profile = await getCurrentProfile();
  const normalizedRole = normalizeRoleKey(profile.role);
  const canPunch = normalizedRole === "program-assistant";
  const canSeeAllEmployeeHistory = normalizedRole === "admin" || normalizedRole === "manager" || normalizedRole === "director";
  const { punches, exceptions, currentStatus, dailyHours, payPeriodHours, payPeriodLabel, mealDeductionHours, adjustedPayPeriodHours } = await getTimeCardOverview(profile.id);
  const managerRows = canSeeAllEmployeeHistory ? await getManagerTimeReview() : [];
  type TimePunchRow = (typeof punches)[number];
  type ManagerReviewRow = (typeof managerRows)[number];

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>{canPunch ? "Time Clock" : "Time & HR"}</CardTitle>
        <p className="mt-1 text-sm text-muted">
          {canPunch
            ? "Fast mobile punch screen with manager-ready payroll review fields."
            : "Salaried view: punch history and payroll review only."}
        </p>
        <div className="mt-2 flex flex-wrap gap-3 text-sm">
          <Link href="/time-card/punch-history" className="font-semibold text-brand">Open Punch History</Link>
          <a href={PTO_EXTERNAL_URL} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand">Open PTO Request</a>
          {normalizedRole === "admin" ? <Link href="/time-hr/user-management" className="font-semibold text-brand">Open User Management</Link> : null}
        </div>
        {canPunch ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Status</p><div className="mt-1"><PunchStatusBadge status={currentStatus} /></div></div>
            <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Daily Hours</p><p className="text-base font-semibold">{dailyHours}</p></div>
            <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Pay Period Hours</p><p className="text-base font-semibold">{payPeriodHours}</p></div>
            <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Adjusted Hours</p><p className="text-base font-semibold">{adjustedPayPeriodHours}</p></div>
          </div>
        ) : null}
        <p className="mt-2 text-xs text-muted">Current pay period: {payPeriodLabel}</p>
        <p className="mt-1 text-xs text-muted">Meal deduction applied: {mealDeductionHours} hrs when applicable.</p>
        {canPunch ? (
          <div className="mt-4">
            <TimePunchControls />
          </div>
        ) : null}
      </Card>

      <MobileList items={punches.map((p: TimePunchRow) => ({ id: p.id, title: `${p.punch_type === "in" ? "Clock In" : "Clock Out"} - ${formatDateTime(p.punch_at)}`, fields: [{ label: "Fence", value: p.within_fence ? "Yes" : "No" }, { label: "Distance", value: p.distance_meters ?? "-" }, { label: "Note", value: p.note ?? "-" }] }))} />

      <Card className="table-wrap hidden md:block">
        <CardTitle>Punch History</CardTitle>
        <table>
          <thead>
            <tr>
              <th>Date/Time</th>
              <th>Type</th>
              <th>Within Fence</th>
              <th>Distance (m)</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {punches.map((p) => (
              <tr key={p.id}>
                <td>{formatDateTime(p.punch_at)}</td>
                <td><PunchTypeBadge punchType={p.punch_type} /></td>
                <td>{p.within_fence ? "Yes" : "No"}</td>
                <td>{p.distance_meters ?? "-"}</td>
                <td>{p.note ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="table-wrap">
        <CardTitle>Exception Flags</CardTitle>
        <table>
          <thead><tr><th>Type</th><th>Message</th><th>Status</th></tr></thead>
          <tbody>
            {exceptions.length === 0 ? <tr><td colSpan={3}>No exceptions.</td></tr> : null}
            {exceptions.map((ex) => (
              <tr key={ex.id}>
                <td>{ex.exception_type}</td>
                <td>{ex.message}</td>
                <td>{ex.resolved ? "Resolved" : "Open"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {managerRows.length > 0 ? (
        <Card className="table-wrap">
          <CardTitle>Manager Biweekly Payroll Review</CardTitle>
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Pay Period</th>
                <th>Total Hours Worked</th>
                <th>Meal Deduction</th>
                <th>Adjusted Hours</th>
                <th>Exception Notes</th>
                <th>Approval</th>
                <th>Review</th>
              </tr>
            </thead>
            <tbody>
              {managerRows.map((row: ManagerReviewRow) => (
                <tr key={row.staff_name}>
                  <td>{row.staff_name}</td>
                  <td>{row.pay_period?.includes(" to ") ? `${formatDate(row.pay_period.split(" to ")[0])} to ${formatDate(row.pay_period.split(" to ")[1])}` : row.pay_period}</td>
                  <td>{row.total_hours_worked}</td>
                  <td>{row.meal_deduction_applied}</td>
                  <td>{row.adjusted_hours}</td>
                  <td>{row.exception_notes}</td>
                  <td>{row.approval_status}</td>
                  <td><TimeReviewButtons staffName={row.staff_name} payPeriod={row.pay_period} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}
    </div>
  );
}
