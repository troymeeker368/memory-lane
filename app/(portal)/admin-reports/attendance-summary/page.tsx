import type { ReactNode } from "react";
import Link from "next/link";

import { Card } from "@/components/ui/card";
import {
  ATTENDANCE_REPORT_MONTH_OPTIONS,
  buildAttendanceAverageDailyCensusCsv,
  buildAttendanceDailyMatrixCsv,
  buildAttendanceMemberDaysCsv,
  getAttendanceSummaryReportData,
  resolveAttendanceSummaryReportInput
} from "@/lib/services/attendance-summary-report";

function firstString(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function formatDecimal(value: number) {
  return Number(value.toFixed(2)).toString();
}

function buildDownloadHref(csv: string) {
  return `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
}

function SectionCard({
  title,
  exportHref,
  exportName,
  children
}: {
  title: string;
  exportHref: string;
  exportName: string;
  children: ReactNode;
}) {
  return (
    <Card className="overflow-hidden border border-border bg-white p-0 shadow-[0_1px_4px_rgba(27,62,147,0.08)]">
      <div className="flex flex-col gap-3 bg-slate-100 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-[2rem] font-semibold tracking-tight text-brand">{title}</h2>
        <a
          href={exportHref}
          download={exportName}
          className="inline-flex h-10 items-center justify-center rounded-lg border border-border bg-white px-3 text-sm font-semibold text-brand"
        >
          Export CSV
        </a>
      </div>
      <div className="p-0">{children}</div>
    </Card>
  );
}

export default async function AttendanceSummaryReportPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const filters = resolveAttendanceSummaryReportInput({
    location: firstString(query.location),
    month: firstString(query.month),
    year: firstString(query.year)
  });
  const report = await getAttendanceSummaryReportData(filters);

  const matrixCsv = buildAttendanceDailyMatrixCsv(report);
  const memberDaysCsv = buildAttendanceMemberDaysCsv(report);
  const averageDailyCensusCsv = buildAttendanceAverageDailyCensusCsv(report);
  const locationOptions = Array.from(
    new Set([...(report.availableLocations ?? []), ...(filters.location ? [filters.location] : [])])
  ).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-2xl bg-brand shadow-[0_14px_36px_rgba(19,89,162,0.18)]">
        <form method="get" className="grid gap-4 px-5 py-5 md:grid-cols-4 md:items-end">
          <label className="space-y-2 text-sm text-white">
            <span className="block text-sm font-medium">Location</span>
            <select
              name="location"
              defaultValue={filters.location ?? ""}
              className="h-11 w-full rounded-lg border border-white/35 bg-white px-3 text-sm text-fg shadow-sm"
            >
              <option value="">All Centers</option>
              {locationOptions.map((location) => (
                <option key={location} value={location}>
                  {location}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-2 text-sm text-white">
            <span className="block text-sm font-medium">Month</span>
            <select
              name="month"
              defaultValue={String(filters.month)}
              className="h-11 w-full rounded-lg border border-white/35 bg-white px-3 text-sm text-fg shadow-sm"
            >
              {ATTENDANCE_REPORT_MONTH_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-2 text-sm text-white">
            <span className="block text-sm font-medium">Year</span>
            <select
              name="year"
              defaultValue={String(filters.year)}
              className="h-11 w-full rounded-lg border border-white/35 bg-white px-3 text-sm text-fg shadow-sm"
            >
              {report.yearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-2 md:justify-end">
            <button
              type="submit"
              className="inline-flex h-11 items-center justify-center rounded-lg bg-white px-4 text-sm font-semibold text-brand shadow-sm"
            >
              Run Report
            </button>
            <Link
              href="/admin-reports/attendance-summary"
              className="inline-flex h-11 items-center justify-center rounded-lg border border-white/35 px-4 text-sm font-semibold text-white"
            >
              Reset
            </Link>
          </div>
        </form>
      </div>

      <div className="flex justify-end">
        <h1 className="text-2xl font-semibold tracking-tight text-brand">Attendance Summary</h1>
      </div>

      <SectionCard
        title={report.matrix.title}
        exportHref={buildDownloadHref(matrixCsv)}
        exportName={`attendance-daily-matrix-${report.filters.year}-${String(report.filters.month).padStart(2, "0")}.csv`}
      >
        <div className="table-wrap">
          <table className="min-w-[1180px]">
            <thead>
              <tr>
                <th className="bg-white px-4 py-3 text-left text-sm font-semibold text-brand">Location</th>
                {report.matrix.dayHeaders.map((day) => (
                  <th key={day} className="bg-white px-4 py-3 text-center text-sm font-semibold text-brand">
                    {day}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.matrix.rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={report.matrix.dayHeaders.length + 1}
                    className="px-4 py-6 text-center text-sm text-muted"
                  >
                    No attendance rows are available for the selected month and location.
                  </td>
                </tr>
              ) : (
                report.matrix.rows.map((row) => (
                  <tr key={row.location}>
                    <td className="px-4 py-3 font-medium text-brand">{row.location}</td>
                    {row.dayCounts.map((value, index) => (
                      <td key={`${row.location}-${index}`} className="px-4 py-3 text-center text-fg">
                        {value}
                      </td>
                    ))}
                  </tr>
                ))
              )}
              <tr className="bg-brandSoft/40 font-semibold">
                <td className="px-4 py-3 text-brand">{report.matrix.totalsRow.location}</td>
                {report.matrix.totalsRow.dayCounts.map((value, index) => (
                  <td key={`totals-${index}`} className="px-4 py-3 text-center text-fg">
                    {value}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard
        title="Total Members Days"
        exportHref={buildDownloadHref(memberDaysCsv)}
        exportName={`attendance-member-days-${report.filters.year}.csv`}
      >
        <div className="table-wrap">
          <table className="min-w-[980px]">
            <thead>
              <tr>
                <th className="bg-white px-4 py-3 text-left text-sm font-semibold text-brand">Location</th>
                {report.totalMemberDays.monthHeaders.map((month) => (
                  <th key={month} className="bg-white px-4 py-3 text-center text-sm font-semibold text-brand">
                    {month}
                  </th>
                ))}
                <th className="bg-white px-4 py-3 text-center text-sm font-semibold text-brand">Year Total</th>
              </tr>
            </thead>
            <tbody>
              {report.totalMemberDays.rows.map((row) => (
                <tr key={row.location}>
                  <td className="px-4 py-3 font-medium text-brand">{row.location}</td>
                  {row.monthValues.map((value, index) => (
                    <td key={`${row.location}-member-days-${index}`} className="px-4 py-3 text-center text-fg">
                      {value}
                    </td>
                  ))}
                  <td className="px-4 py-3 text-center text-fg">{row.yearTotal}</td>
                </tr>
              ))}
              <tr className="bg-brandSoft/40 font-semibold">
                <td className="px-4 py-3 text-brand">{report.totalMemberDays.totalsRow.location}</td>
                {report.totalMemberDays.totalsRow.monthValues.map((value, index) => (
                  <td key={`member-days-total-${index}`} className="px-4 py-3 text-center text-fg">
                    {value}
                  </td>
                ))}
                <td className="px-4 py-3 text-center text-fg">{report.totalMemberDays.totalsRow.yearTotal}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard
        title="Average Daily Census"
        exportHref={buildDownloadHref(averageDailyCensusCsv)}
        exportName={`attendance-average-daily-census-${report.filters.year}.csv`}
      >
        <div className="table-wrap">
          <table className="min-w-[980px]">
            <thead>
              <tr>
                <th className="bg-white px-4 py-3 text-left text-sm font-semibold text-brand">Location</th>
                {report.averageDailyCensus.monthHeaders.map((month) => (
                  <th key={month} className="bg-white px-4 py-3 text-center text-sm font-semibold text-brand">
                    {month}
                  </th>
                ))}
                <th className="bg-white px-4 py-3 text-center text-sm font-semibold text-brand">Year Total</th>
              </tr>
            </thead>
            <tbody>
              {report.averageDailyCensus.rows.map((row) => (
                <tr key={row.location}>
                  <td className="px-4 py-3 font-medium text-brand">{row.location}</td>
                  {row.monthValues.map((value, index) => (
                    <td key={`${row.location}-average-daily-census-${index}`} className="px-4 py-3 text-center text-fg">
                      {formatDecimal(value)}
                    </td>
                  ))}
                  <td className="px-4 py-3 text-center text-fg">{formatDecimal(row.yearTotal)}</td>
                </tr>
              ))}
              <tr className="bg-brandSoft/40 font-semibold">
                <td className="px-4 py-3 text-brand">{report.averageDailyCensus.totalsRow.location}</td>
                {report.averageDailyCensus.totalsRow.monthValues.map((value, index) => (
                  <td key={`average-daily-census-total-${index}`} className="px-4 py-3 text-center text-fg">
                    {formatDecimal(value)}
                  </td>
                ))}
                <td className="px-4 py-3 text-center text-fg">
                  {formatDecimal(report.averageDailyCensus.totalsRow.yearTotal)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
