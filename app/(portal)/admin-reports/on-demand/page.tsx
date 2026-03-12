import { Card, CardTitle } from "@/components/ui/card";
import { resolveDateRange } from "@/lib/services/report-date-range";
import {
  buildOnDemandReportCsv,
  formatOnDemandCellValue,
  getOnDemandReportData,
  ON_DEMAND_REPORT_CATEGORIES,
  resolveOnDemandReportCategory
} from "@/lib/services/admin-reporting-foundation";

function firstString(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function toSlug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export default async function AdminOnDemandReportsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const range = resolveDateRange(firstString(query.from), firstString(query.to), 30);
  const category = resolveOnDemandReportCategory(firstString(query.category));

  const report = await getOnDemandReportData({ category, range });
  const csv = buildOnDemandReportCsv(report);
  const csvHref = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
  const exportName = `${toSlug(report.category)}-${range.from}-to-${range.to}.csv`;

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>On-Demand Reports</CardTitle>
        <p className="mt-1 text-sm text-muted">
          Phase-one reporting hub for admin users. Choose a category, apply filters, and export an Excel-compatible CSV.
        </p>
        <form className="mt-3 grid gap-2 md:grid-cols-4" method="get">
          <label className="space-y-1 text-sm">
            <span className="text-xs font-semibold text-muted">Category</span>
            <select name="category" defaultValue={category} className="h-10 w-full rounded-lg border border-border px-3">
              {ON_DEMAND_REPORT_CATEGORIES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
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
              Run Report
            </button>
            <a
              href={csvHref}
              download={exportName}
              className="h-10 rounded-lg border border-border px-3 text-sm font-semibold leading-10"
            >
              Export Excel (CSV)
            </a>
          </div>
        </form>
      </Card>

      <Card className="table-wrap">
        <CardTitle>{report.title}</CardTitle>
        <p className="mt-1 text-sm text-muted">{report.description}</p>
        <p className="mt-1 text-xs text-muted">
          Period: {range.from} to {range.to}
        </p>
        <table className="mt-3">
          <thead>
            <tr>
              {report.columns.map((column) => (
                <th key={column.key}>{column.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.rows.length === 0 ? (
              <tr>
                <td colSpan={Math.max(report.columns.length, 1)} className="text-center text-sm text-muted">
                  No rows available for selected filters.
                </td>
              </tr>
            ) : (
              report.rows.map((row, rowIdx) => (
                <tr key={`${report.category}-${rowIdx}`}>
                  {report.columns.map((column) => (
                    <td key={`${rowIdx}-${column.key}`}>{formatOnDemandCellValue(row[column.key] ?? null, column.kind)}</td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
