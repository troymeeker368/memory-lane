import Link from "next/link";

import { Card, CardTitle } from "@/components/ui/card";
import { resolveDateRange } from "@/lib/services/report-date-range";
import { getAdminRevenueSummary } from "@/lib/services/admin-reporting-foundation";

function firstString(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function formatCurrency(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function formatPercent(value: number | null) {
  if (value == null) return "-";
  return `${value.toFixed(1)}%`;
}

export default async function AdminRevenueSummaryPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const range = resolveDateRange(firstString(query.from), firstString(query.to), 30);
  const summary = await getAdminRevenueSummary({ from: range.from, to: range.to });

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Revenue Summary</CardTitle>
        <p className="mt-1 text-sm text-muted">
          Fast operational revenue view. Program revenue is attendance-based and ancillary totals are grouped for day-to-day billing oversight.
        </p>
        <form className="mt-3 grid gap-2 md:grid-cols-3" method="get">
          <label className="space-y-1 text-sm">
            <span className="text-xs font-semibold text-muted">From</span>
            <input type="date" name="from" defaultValue={range.from} className="h-10 w-full rounded-lg border border-border px-3" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-xs font-semibold text-muted">To</span>
            <input type="date" name="to" defaultValue={range.to} className="h-10 w-full rounded-lg border border-border px-3" />
          </label>
          <div className="flex items-end gap-2">
            <button type="submit" className="h-10 rounded-lg bg-brand px-3 text-sm font-semibold text-white">
              Apply
            </button>
            <Link href="/admin-reports/revenue" className="h-10 rounded-lg border border-border px-3 text-sm font-semibold leading-10">
              Reset
            </Link>
          </div>
        </form>
      </Card>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardTitle>Projected Program Revenue</CardTitle>
          <p className="mt-2 text-2xl font-bold text-brand">{formatCurrency(summary.projectedProgramRevenueCents)}</p>
          <p className="mt-1 text-xs text-muted">{summary.scheduledMemberDays} scheduled member-days</p>
        </Card>
        <Card>
          <CardTitle>Billed Program Revenue</CardTitle>
          <p className="mt-2 text-2xl font-bold text-brand">{formatCurrency(summary.billedProgramRevenueCents)}</p>
          <p className="mt-1 text-xs text-muted">{summary.presentMemberDays} present member-days</p>
        </Card>
        <Card>
          <CardTitle>Ancillary Charges</CardTitle>
          <p className="mt-2 text-2xl font-bold text-brand">{formatCurrency(summary.ancillaryTotalCents)}</p>
          <p className="mt-1 text-xs text-muted">Includes all non-void ancillary entries</p>
        </Card>
        <Card>
          <CardTitle>Transportation Totals</CardTitle>
          <p className="mt-2 text-2xl font-bold text-brand">{formatCurrency(summary.transportationAncillaryTotalCents)}</p>
          <p className="mt-1 text-xs text-muted">{summary.transportationAncillaryCount} transportation charge rows</p>
        </Card>
        <Card>
          <CardTitle>Late Pickup Totals</CardTitle>
          <p className="mt-2 text-2xl font-bold text-brand">{formatCurrency(summary.latePickupTotalCents)}</p>
          <p className="mt-1 text-xs text-muted">{summary.latePickupCount} late pickup charge rows</p>
        </Card>
        <Card>
          <CardTitle>Total Billed Revenue</CardTitle>
          <p className="mt-2 text-2xl font-bold text-brand">{formatCurrency(summary.totalBilledRevenueCents)}</p>
          <p className="mt-1 text-xs text-muted">
            Variance to projection:{" "}
            <span className={summary.varianceToProjectedCents < 0 ? "text-rose-600" : "text-emerald-700"}>
              {formatCurrency(summary.varianceToProjectedCents)}
            </span>
          </p>
        </Card>
      </div>

      <Card className="table-wrap">
        <CardTitle>Operational Context</CardTitle>
        <table>
          <thead>
            <tr>
              <th>Metric</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Active Members</td>
              <td>{summary.activeMemberCount}</td>
            </tr>
            <tr>
              <td>Scheduled Member-Days</td>
              <td>{summary.scheduledMemberDays}</td>
            </tr>
            <tr>
              <td>Present Member-Days</td>
              <td>{summary.presentMemberDays}</td>
            </tr>
            <tr>
              <td>Absent Member-Days</td>
              <td>{summary.absentMemberDays}</td>
            </tr>
            <tr>
              <td>Attendance Rate</td>
              <td>{formatPercent(summary.attendanceRatePercent)}</td>
            </tr>
            <tr>
              <td>Program Rate Source</td>
              <td>{summary.programRateSource}</td>
            </tr>
            <tr>
              <td>Period Covered</td>
              <td>
                {summary.from} to {summary.to}
              </td>
            </tr>
          </tbody>
        </table>
      </Card>

      <Card>
        <CardTitle>Next Step</CardTitle>
        <p className="mt-1 text-sm text-muted">
          Export this same period through On-Demand Reports for Excel-ready category views.
        </p>
        <div className="mt-3">
          <Link
            href={`/admin-reports/on-demand?category=billing-revenue&from=${summary.from}&to=${summary.to}`}
            className="rounded-lg border border-border bg-brandSoft px-3 py-2 text-sm font-semibold text-brand"
          >
            Open On-Demand Billing/Revenue Export
          </Link>
        </div>
      </Card>
    </div>
  );
}
