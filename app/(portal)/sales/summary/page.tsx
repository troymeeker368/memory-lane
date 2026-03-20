import type { ReactNode } from "react";
import Link from "next/link";

import { Card } from "@/components/ui/card";
import { requireRoles } from "@/lib/auth";
import {
  buildSalesClosedDispositionCsv,
  buildSalesLeadStatusCsv,
  buildSalesSummaryMetricsCsv,
  getSalesSummaryReportData,
  resolveSalesSummaryReportInput
} from "@/lib/services/sales-summary-report";

function firstString(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function formatPercent(value: number) {
  return value % 1 === 0 ? `${value.toFixed(0)}%` : `${value.toFixed(2)}%`;
}

function buildDownloadHref(csv: string) {
  return `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
}

function SectionCard({
  title,
  subtitle,
  exportHref,
  exportName,
  children
}: {
  title: string;
  subtitle?: string;
  exportHref: string;
  exportName: string;
  children: ReactNode;
}) {
  return (
    <Card className="overflow-hidden border border-border bg-white p-0 shadow-[0_1px_4px_rgba(27,62,147,0.08)]">
      <div className="flex flex-col gap-3 bg-slate-100 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-[2rem] font-semibold tracking-tight text-brand">{title}</h2>
          {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
        </div>
        <a
          href={exportHref}
          download={exportName}
          className="inline-flex h-10 items-center justify-center rounded-lg border border-border bg-white px-3 text-sm font-semibold text-brand"
        >
          Export CSV
        </a>
      </div>
      <div>{children}</div>
    </Card>
  );
}

export default async function SalesSummaryPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRoles(["admin"]);

  const query = await searchParams;
  const filters = resolveSalesSummaryReportInput({
    location: firstString(query.location),
    startDate: firstString(query.startDate),
    endDate: firstString(query.endDate)
  });
  const report = await getSalesSummaryReportData(filters);
  const metricsCsv = buildSalesSummaryMetricsCsv(report);
  const leadStatusCsv = buildSalesLeadStatusCsv(report);
  const dispositionCsv = buildSalesClosedDispositionCsv(report);
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
            <span className="block text-sm font-medium">Start Date</span>
            <input
              type="date"
              name="startDate"
              defaultValue={report.filters.startDate}
              className="h-11 w-full rounded-lg border border-white/35 bg-white px-3 text-sm text-fg shadow-sm"
            />
          </label>
          <label className="space-y-2 text-sm text-white">
            <span className="block text-sm font-medium">End Date</span>
            <input
              type="date"
              name="endDate"
              defaultValue={report.filters.endDate}
              className="h-11 w-full rounded-lg border border-white/35 bg-white px-3 text-sm text-fg shadow-sm"
            />
          </label>
          <div className="flex flex-wrap gap-2 md:justify-end">
            <button
              type="submit"
              className="inline-flex h-11 items-center justify-center rounded-lg bg-white px-4 text-sm font-semibold text-brand shadow-sm"
            >
              Run Report
            </button>
            <Link
              href="/sales/summary"
              className="inline-flex h-11 items-center justify-center rounded-lg border border-white/35 px-4 text-sm font-semibold text-white"
            >
              Reset
            </Link>
          </div>
        </form>
      </div>

      <div className="flex justify-end">
        <h1 className="text-2xl font-semibold tracking-tight text-brand">Sales Summary</h1>
      </div>

      <div className="space-y-1 text-sm text-muted">
        <p>Default data is current month to date when no start or end date is selected.</p>
        <p>{report.filters.osaDefinition}</p>
      </div>

      <SectionCard
        title="Summary Sales Metrics"
        exportHref={buildDownloadHref(metricsCsv)}
        exportName={`sales-summary-metrics-${report.filters.startDate}-to-${report.filters.endDate}.csv`}
      >
        <div className="table-wrap">
          <table className="min-w-[1080px]">
            <thead>
              <tr>
                <th className="bg-white px-4 py-3 text-left text-sm font-semibold text-brand">Location</th>
                <th className="bg-white px-4 py-3 text-center text-sm font-semibold text-brand">OSA</th>
                <th className="bg-white px-4 py-3 text-center text-sm font-semibold text-brand">Inquiries</th>
                <th className="bg-white px-4 py-3 text-center text-sm font-semibold text-brand">OSA/I %</th>
                <th className="bg-white px-4 py-3 text-center text-sm font-semibold text-brand">Tours</th>
                <th className="bg-white px-4 py-3 text-center text-sm font-semibold text-brand">I/T %</th>
                <th className="bg-white px-4 py-3 text-center text-sm font-semibold text-brand">Enrollments</th>
                <th className="bg-white px-4 py-3 text-center text-sm font-semibold text-brand">T/E %</th>
                <th className="bg-white px-4 py-3 text-center text-sm font-semibold text-brand">Discharges</th>
                <th className="bg-white px-4 py-3 text-center text-sm font-semibold text-brand">Net Growth</th>
              </tr>
            </thead>
            <tbody>
              {report.summarySalesMetrics.rows.map((row) => (
                <tr key={row.location}>
                  <td className="px-4 py-3 font-medium text-brand">{row.location}</td>
                  <td className="px-4 py-3 text-center text-fg">{row.osa}</td>
                  <td className="px-4 py-3 text-center text-fg">{row.inquiries}</td>
                  <td className="px-4 py-3 text-center text-fg">{formatPercent(row.osaInquiryRate)}</td>
                  <td className="px-4 py-3 text-center text-fg">{row.tours}</td>
                  <td className="px-4 py-3 text-center text-fg">{formatPercent(row.inquiryTourRate)}</td>
                  <td className="px-4 py-3 text-center text-fg">{row.enrollments}</td>
                  <td className="px-4 py-3 text-center text-fg">{formatPercent(row.tourEnrollmentRate)}</td>
                  <td className="px-4 py-3 text-center text-fg">{row.discharges}</td>
                  <td className="px-4 py-3 text-center text-fg">{row.netGrowth}</td>
                </tr>
              ))}
              <tr className="bg-brandSoft/40 font-semibold">
                <td className="px-4 py-3 text-brand">{report.summarySalesMetrics.totalsRow.location}</td>
                <td className="px-4 py-3 text-center text-fg">{report.summarySalesMetrics.totalsRow.osa}</td>
                <td className="px-4 py-3 text-center text-fg">{report.summarySalesMetrics.totalsRow.inquiries}</td>
                <td className="px-4 py-3 text-center text-fg">
                  {formatPercent(report.summarySalesMetrics.totalsRow.osaInquiryRate)}
                </td>
                <td className="px-4 py-3 text-center text-fg">{report.summarySalesMetrics.totalsRow.tours}</td>
                <td className="px-4 py-3 text-center text-fg">
                  {formatPercent(report.summarySalesMetrics.totalsRow.inquiryTourRate)}
                </td>
                <td className="px-4 py-3 text-center text-fg">{report.summarySalesMetrics.totalsRow.enrollments}</td>
                <td className="px-4 py-3 text-center text-fg">
                  {formatPercent(report.summarySalesMetrics.totalsRow.tourEnrollmentRate)}
                </td>
                <td className="px-4 py-3 text-center text-fg">{report.summarySalesMetrics.totalsRow.discharges}</td>
                <td className="px-4 py-3 text-center text-fg">{report.summarySalesMetrics.totalsRow.netGrowth}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard
        title="Total Leads Status"
        subtitle={`Snapshot as of ${report.filters.snapshotAsOfDate}`}
        exportHref={buildDownloadHref(leadStatusCsv)}
        exportName={`sales-lead-status-${report.filters.snapshotAsOfDate}.csv`}
      >
        <div className="table-wrap">
          <table className="min-w-[920px]">
            <thead>
              <tr>
                <th className="bg-white px-4 py-3 text-left text-sm font-semibold text-brand">Location</th>
                <th className="bg-white px-4 py-3 text-center text-sm font-semibold text-brand">EIP</th>
                <th className="bg-white px-4 py-3 text-center text-sm font-semibold text-brand">Hot</th>
                <th className="bg-white px-4 py-3 text-center text-sm font-semibold text-brand">Warm</th>
                <th className="bg-white px-4 py-3 text-center text-sm font-semibold text-brand">Cold</th>
                <th className="bg-white px-4 py-3 text-center text-sm font-semibold text-brand">Enrolled</th>
                <th className="bg-white px-4 py-3 text-center text-sm font-semibold text-brand">Avg. Sales Cycle</th>
              </tr>
            </thead>
            <tbody>
              {report.totalLeadsStatus.rows.map((row) => (
                <tr key={row.location}>
                  <td className="px-4 py-3 font-medium text-brand">{row.location}</td>
                  <td className="px-4 py-3 text-center text-fg">{row.eip}</td>
                  <td className="px-4 py-3 text-center text-fg">{row.hot}</td>
                  <td className="px-4 py-3 text-center text-fg">{row.warm}</td>
                  <td className="px-4 py-3 text-center text-fg">{row.cold}</td>
                  <td className="px-4 py-3 text-center text-fg">{row.enrolled}</td>
                  <td className="px-4 py-3 text-center text-fg">{row.avgSalesCycle ?? "-"}</td>
                </tr>
              ))}
              <tr className="bg-brandSoft/40 font-semibold">
                <td className="px-4 py-3 text-brand">{report.totalLeadsStatus.totalsRow.location}</td>
                <td className="px-4 py-3 text-center text-fg">{report.totalLeadsStatus.totalsRow.eip}</td>
                <td className="px-4 py-3 text-center text-fg">{report.totalLeadsStatus.totalsRow.hot}</td>
                <td className="px-4 py-3 text-center text-fg">{report.totalLeadsStatus.totalsRow.warm}</td>
                <td className="px-4 py-3 text-center text-fg">{report.totalLeadsStatus.totalsRow.cold}</td>
                <td className="px-4 py-3 text-center text-fg">{report.totalLeadsStatus.totalsRow.enrolled}</td>
                <td className="px-4 py-3 text-center text-fg">{report.totalLeadsStatus.totalsRow.avgSalesCycle ?? "-"}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard
        title="Closed Lead Disposition"
        exportHref={buildDownloadHref(dispositionCsv)}
        exportName={`sales-closed-disposition-${report.filters.startDate}-to-${report.filters.endDate}.csv`}
      >
        <div className="table-wrap">
          <table className="min-w-[1320px]">
            <thead>
              <tr>
                <th className="bg-white px-4 py-3 text-left text-sm font-semibold text-brand">Location</th>
                <th className="bg-white px-4 py-3 text-center text-sm font-semibold text-brand">Cost</th>
                <th className="bg-white px-4 py-3 text-center text-sm font-semibold text-brand">Deceased</th>
                <th className="bg-white px-4 py-3 text-center text-sm font-semibold text-brand">Declined Enrollment</th>
                <th className="bg-white px-4 py-3 text-center text-sm font-semibold text-brand">Did not Respond</th>
                <th className="bg-white px-4 py-3 text-center text-sm font-semibold text-brand">Distance to Center</th>
                <th className="bg-white px-4 py-3 text-center text-sm font-semibold text-brand">High Acuity</th>
                <th className="bg-white px-4 py-3 text-center text-sm font-semibold text-brand">Opted for Home Care</th>
                <th className="bg-white px-4 py-3 text-center text-sm font-semibold text-brand">Placed</th>
                <th className="bg-white px-4 py-3 text-center text-sm font-semibold text-brand">Transportation Issues</th>
                <th className="bg-white px-4 py-3 text-center text-sm font-semibold text-brand">SPAM</th>
                <th className="bg-white px-4 py-3 text-center text-sm font-semibold text-brand">Total Closed Leads</th>
              </tr>
            </thead>
            <tbody>
              {report.closedLeadDisposition.rows.map((row) => (
                <tr key={row.location}>
                  <td className="px-4 py-3 font-medium text-brand">{row.location}</td>
                  <td className="px-4 py-3 text-center text-fg">{row.cost}</td>
                  <td className="px-4 py-3 text-center text-fg">{row.deceased}</td>
                  <td className="px-4 py-3 text-center text-fg">{row.declinedEnrollment}</td>
                  <td className="px-4 py-3 text-center text-fg">{row.didNotRespond}</td>
                  <td className="px-4 py-3 text-center text-fg">{row.distanceToCenter}</td>
                  <td className="px-4 py-3 text-center text-fg">{row.highAcuity}</td>
                  <td className="px-4 py-3 text-center text-fg">{row.optedForHomeCare}</td>
                  <td className="px-4 py-3 text-center text-fg">{row.placed}</td>
                  <td className="px-4 py-3 text-center text-fg">{row.transportationIssues}</td>
                  <td className="px-4 py-3 text-center text-fg">{row.spam}</td>
                  <td className="px-4 py-3 text-center text-fg">{row.totalClosedLeads}</td>
                </tr>
              ))}
              <tr className="bg-brandSoft/40 font-semibold">
                <td className="px-4 py-3 text-brand">{report.closedLeadDisposition.totalsRow.location}</td>
                <td className="px-4 py-3 text-center text-fg">{report.closedLeadDisposition.totalsRow.cost}</td>
                <td className="px-4 py-3 text-center text-fg">{report.closedLeadDisposition.totalsRow.deceased}</td>
                <td className="px-4 py-3 text-center text-fg">
                  {report.closedLeadDisposition.totalsRow.declinedEnrollment}
                </td>
                <td className="px-4 py-3 text-center text-fg">{report.closedLeadDisposition.totalsRow.didNotRespond}</td>
                <td className="px-4 py-3 text-center text-fg">
                  {report.closedLeadDisposition.totalsRow.distanceToCenter}
                </td>
                <td className="px-4 py-3 text-center text-fg">{report.closedLeadDisposition.totalsRow.highAcuity}</td>
                <td className="px-4 py-3 text-center text-fg">
                  {report.closedLeadDisposition.totalsRow.optedForHomeCare}
                </td>
                <td className="px-4 py-3 text-center text-fg">{report.closedLeadDisposition.totalsRow.placed}</td>
                <td className="px-4 py-3 text-center text-fg">
                  {report.closedLeadDisposition.totalsRow.transportationIssues}
                </td>
                <td className="px-4 py-3 text-center text-fg">{report.closedLeadDisposition.totalsRow.spam}</td>
                <td className="px-4 py-3 text-center text-fg">{report.closedLeadDisposition.totalsRow.totalClosedLeads}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
