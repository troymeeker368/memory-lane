import Link from "next/link";

import { Card, CardTitle } from "@/components/ui/card";
import {
  ATTENDANCE_SUMMARY_BILLING_MODE_OPTIONS,
  ATTENDANCE_SUMMARY_MEMBER_STATUS_OPTIONS,
  ATTENDANCE_SUMMARY_REVENUE_BASIS_OPTIONS,
  buildAttendanceSummaryCsv,
  getAttendanceSummaryReport,
  resolveAttendanceSummaryInput
} from "@/lib/services/admin-reporting-foundation";

function firstString(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function asPercent(value: number | null) {
  if (value == null) return "-";
  return `${(value * 100).toFixed(2)}%`;
}

function asCurrency(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function asNumber(value: number) {
  return Number(value.toFixed(2));
}

export default async function AttendanceSummaryReportPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const filters = resolveAttendanceSummaryInput({
    from: firstString(query.from),
    to: firstString(query.to),
    location: firstString(query.location),
    billingMode: firstString(query.billingMode),
    memberStatus: firstString(query.memberStatus),
    revenueBasis: firstString(query.revenueBasis),
    includeCustomInvoices: firstString(query.includeCustomInvoices),
    countBillableOverrideAsOpen: firstString(query.countBillableOverrideAsOpen)
  });
  const report = await getAttendanceSummaryReport(filters);
  const csv = buildAttendanceSummaryCsv(report);
  const csvHref = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
  const csvFileName = `attendance-summary-${filters.from}-to-${filters.to}.csv`;

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Attendance Summary</CardTitle>
        <p className="mt-1 text-sm text-muted">
          Operational utilization and revenue summary by location for the selected reporting period.
        </p>
        <form method="get" className="mt-3 grid gap-2 md:grid-cols-4 xl:grid-cols-8">
          <label className="space-y-1 text-xs">
            <span className="font-semibold text-muted">Date Range Start</span>
            <input
              type="date"
              name="from"
              defaultValue={filters.from}
              className="h-10 w-full rounded-lg border border-border px-3"
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-semibold text-muted">Date Range End</span>
            <input
              type="date"
              name="to"
              defaultValue={filters.to}
              className="h-10 w-full rounded-lg border border-border px-3"
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-semibold text-muted">Location</span>
            <select
              name="location"
              defaultValue={filters.location ?? ""}
              className="h-10 w-full rounded-lg border border-border px-3"
            >
              <option value="">All Locations</option>
              {report.availableLocations.map((location) => (
                <option key={location} value={location}>
                  {location}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-semibold text-muted">Billing Mode</span>
            <select
              name="billingMode"
              defaultValue={filters.billingMode}
              className="h-10 w-full rounded-lg border border-border px-3"
            >
              {ATTENDANCE_SUMMARY_BILLING_MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-semibold text-muted">Member Status</span>
            <select
              name="memberStatus"
              defaultValue={filters.memberStatus}
              className="h-10 w-full rounded-lg border border-border px-3"
            >
              {ATTENDANCE_SUMMARY_MEMBER_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-semibold text-muted">Attendance Basis</span>
            <input
              value="Actual Attendance"
              readOnly
              className="h-10 w-full rounded-lg border border-border bg-muted px-3"
            />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-semibold text-muted">Revenue Basis</span>
            <select
              name="revenueBasis"
              defaultValue={filters.revenueBasis}
              className="h-10 w-full rounded-lg border border-border px-3"
            >
              {ATTENDANCE_SUMMARY_REVENUE_BASIS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1 text-xs">
              <span className="font-semibold text-muted">Include Custom Invoices</span>
              <select
                name="includeCustomInvoices"
                defaultValue={filters.includeCustomInvoices ? "true" : "false"}
                className="h-10 w-full rounded-lg border border-border px-3"
              >
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-semibold text-muted">Billable Closure as Open</span>
              <select
                name="countBillableOverrideAsOpen"
                defaultValue={filters.countBillableOverrideAsOpen ? "true" : "false"}
                className="h-10 w-full rounded-lg border border-border px-3"
              >
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </label>
          </div>
          <div className="flex items-end gap-2 xl:col-span-8">
            <button type="submit" className="h-10 rounded-lg bg-brand px-3 text-sm font-semibold text-white">
              Run Report
            </button>
            <Link
              href="/admin-reports/attendance-summary"
              className="h-10 rounded-lg border border-border px-3 text-sm font-semibold leading-10"
            >
              Reset
            </Link>
            <a
              href={csvHref}
              download={csvFileName}
              className="h-10 rounded-lg border border-border px-3 text-sm font-semibold leading-10"
            >
              Export CSV
            </a>
          </div>
        </form>
        <p className="mt-2 text-xs text-muted">
          Open center days in denominator: {report.openCenterDayCount}. Revenue mode used: {report.revenueModeApplied}.
        </p>
      </Card>

      <div className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <p className="text-muted">Total Enrolled</p>
          <p className="mt-1 text-2xl font-semibold text-fg">{report.summaryCards.totalEnrolled}</p>
        </Card>
        <Card>
          <p className="text-muted">Avg Daily Attendance</p>
          <p className="mt-1 text-2xl font-semibold text-fg">{asNumber(report.summaryCards.avgDailyAttendance)}</p>
        </Card>
        <Card>
          <p className="text-muted">Total Member Days</p>
          <p className="mt-1 text-2xl font-semibold text-fg">{report.summaryCards.totalMemberDays}</p>
        </Card>
        <Card>
          <p className="text-muted">Percent Capacity</p>
          <p className="mt-1 text-2xl font-semibold text-fg">{asPercent(report.summaryCards.percentCapacity)}</p>
        </Card>
        <Card>
          <p className="text-muted">Avg Revenue Per Member</p>
          <p className="mt-1 text-2xl font-semibold text-fg">{asCurrency(report.summaryCards.avgRevenuePerMember)}</p>
        </Card>
      </div>

      <Card className="table-wrap">
        <CardTitle>Attendance Summary Table</CardTitle>
        <table className="mt-3">
          <thead>
            <tr>
              <th>Location</th>
              <th>Capacity</th>
              <th>PercentCapacity</th>
              <th>TotalEnrolled</th>
              <th>AvgDailyAttendance</th>
              <th>AvgDailyAttendancePerParticipant</th>
              <th>TotalMemberDays</th>
              <th>AverageRevenuePerMember</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-sm text-muted">
                  No attendance summary rows for the selected filters.
                </td>
              </tr>
            ) : (
              report.rows.map((row) => (
                <tr key={row.location}>
                  <td>{row.location}</td>
                  <td>{row.capacity}</td>
                  <td>{asPercent(row.percentCapacity)}</td>
                  <td>{row.totalEnrolled}</td>
                  <td>{asNumber(row.avgDailyAttendance)}</td>
                  <td>{asNumber(row.avgDailyAttendancePerParticipant)}</td>
                  <td>{row.totalMemberDays}</td>
                  <td>{asCurrency(row.averageRevenuePerMember)}</td>
                </tr>
              ))
            )}
            <tr className="bg-brandSoft/40 font-semibold">
              <td>{report.totals.location}</td>
              <td>{report.totals.capacity}</td>
              <td>{asPercent(report.totals.percentCapacity)}</td>
              <td>{report.totals.totalEnrolled}</td>
              <td>{asNumber(report.totals.avgDailyAttendance)}</td>
              <td>{asNumber(report.totals.avgDailyAttendancePerParticipant)}</td>
              <td>{report.totals.totalMemberDays}</td>
              <td>{asCurrency(report.totals.averageRevenuePerMember)}</td>
            </tr>
          </tbody>
        </table>
      </Card>
    </div>
  );
}

