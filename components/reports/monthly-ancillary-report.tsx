"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import type { AncillaryCategoryColumn, AncillarySummary, MonthlyAncillaryMemberRow } from "@/lib/services/ancillary";

type WorkbookRow = MonthlyAncillaryMemberRow;

function normalizeMonthKey(value: string | null | undefined) {
  const raw = String(value ?? "").trim();
  if (/^\d{4}-\d{2}$/.test(raw)) {
    return raw;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw.slice(0, 7);
  }
  return "";
}

function monthLabel(monthKey: string) {
  const normalized = normalizeMonthKey(monthKey);
  if (!normalized) return monthKey;

  const [yearPart, monthPart] = normalized.split("-");
  const year = Number(yearPart);
  const monthIndex = Number(monthPart) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex)) {
    return monthKey;
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  });
  return formatter.format(new Date(Date.UTC(year, monthIndex, 1)));
}

function money(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format((Number(cents) || 0) / 100);
}

function csvEscape(value: string | number | null | undefined) {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes("\n") || text.includes('"')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function amountText(cents: number) {
  return (Number(cents) || 0) / 100;
}

function monthKeyFromDate(date: string | null | undefined) {
  return normalizeMonthKey(date);
}

function buildWorkbookState(summary: AncillarySummary, selectedMonth: string) {
  const month = normalizeMonthKey(selectedMonth) || summary.selectedMonth;
  const categories = summary.categoryColumns.filter((category) => !category.isSynthetic);
  const categoryLookupById = new Map(categories.map((category) => [category.id, category]));
  const categoryLookupByName = new Map(categories.map((category) => [String(category.name ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " "), category]));

  const rowsByMember = new Map<string, WorkbookRow>();
  const categoryTotals = new Map<string, { id: string; name: string; amountCents: number; count: number; isSynthetic?: boolean }>();
  let uncategorizedPresent = false;

  for (const category of categories) {
    categoryTotals.set(category.id, {
      id: category.id,
      name: category.name,
      amountCents: 0,
      count: 0
    });
  }

  const monthlyLogs = summary.logs.filter((row) => monthKeyFromDate(row.service_date) === month);
  let grandTotalCents = 0;
  let entryCount = 0;

  for (const log of monthlyLogs) {
    const amountCents = Number.isFinite(Number(log.amount_cents)) ? Math.round(Number(log.amount_cents)) : 0;
    const categoryMatch =
      (log.category_id ? categoryLookupById.get(log.category_id) : null) ||
      categoryLookupByName.get(String(log.category_name ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ")) ||
      null;
    const categoryId = categoryMatch?.id ?? "__uncategorized__";
    const categoryName = categoryMatch?.name ?? "Uncategorized";

    if (!categoryMatch) {
      uncategorizedPresent = true;
    }

    grandTotalCents += amountCents;
    entryCount += 1;

    const memberKey = log.member_id ?? log.member_name ?? "unknown-member";
    const memberName = log.member_name ?? "Unknown Member";
    const row = rowsByMember.get(memberKey) ?? {
      memberId: log.member_id ?? null,
      memberName,
      entryCount: 0,
      subtotalCents: 0,
      categoryAmounts: {},
      categoryCounts: {},
      uncategorizedAmountCents: 0,
      uncategorizedEntryCount: 0
    };

    row.entryCount += 1;
    row.subtotalCents += amountCents;
    if (categoryId === "__uncategorized__") {
      row.uncategorizedAmountCents += amountCents;
      row.uncategorizedEntryCount += 1;
    } else {
      row.categoryAmounts[categoryId] = (row.categoryAmounts[categoryId] ?? 0) + amountCents;
      row.categoryCounts[categoryId] = (row.categoryCounts[categoryId] ?? 0) + 1;
    }
    rowsByMember.set(memberKey, row);

    const currentCategoryTotal = categoryTotals.get(categoryId);
    if (currentCategoryTotal) {
      currentCategoryTotal.amountCents += amountCents;
      currentCategoryTotal.count += 1;
    } else {
      categoryTotals.set(categoryId, {
        id: categoryId,
        name: categoryName,
        amountCents,
        count: 1,
        isSynthetic: true
      });
    }
  }

  const categoryColumns: AncillaryCategoryColumn[] = categories.map((category) => ({
    id: category.id,
    name: category.name
  }));
  if (uncategorizedPresent) {
    categoryColumns.push({
      id: "__uncategorized__",
      name: "Uncategorized",
      isSynthetic: true
    });
    if (!categoryTotals.has("__uncategorized__")) {
      categoryTotals.set("__uncategorized__", {
        id: "__uncategorized__",
        name: "Uncategorized",
        amountCents: 0,
        count: 0,
        isSynthetic: true
      });
    }
  }

  const rows = Array.from(rowsByMember.values()).sort((a, b) => {
    const compare = a.memberName.localeCompare(b.memberName);
    if (compare !== 0) return compare;
    return b.subtotalCents - a.subtotalCents;
  });

  const totals = categoryColumns.map((category) => {
    const total = categoryTotals.get(category.id);
    return total ?? { id: category.id, name: category.name, amountCents: 0, count: 0, isSynthetic: category.isSynthetic };
  });

  return {
    month,
    rows,
    categoryColumns,
    totals,
    grandTotalCents,
    entryCount
  };
}

function downloadSummaryCsv(month: string, rows: WorkbookRow[], categoryColumns: AncillaryCategoryColumn[], totals: Array<{ id: string; name: string; amountCents: number; count: number }>, grandTotalCents: number, entryCount: number) {
  const header = ["Member", "Entry Count", ...categoryColumns.map((category) => category.name), "Total"];
  const lines = [header.map(csvEscape).join(",")];

  for (const row of rows) {
    const values = [
      row.memberName,
      String(row.entryCount),
      ...categoryColumns.map((category) => amountText(row.categoryAmounts[category.id] ?? 0).toFixed(2)),
      amountText(row.subtotalCents).toFixed(2)
    ];
    lines.push(values.map((value) => csvEscape(value)).join(","));
  }

  lines.push([
    csvEscape("Monthly Total"),
    csvEscape(entryCount),
    ...categoryColumns.map((category) => csvEscape(amountText(totals.find((total) => total.id === category.id)?.amountCents ?? 0).toFixed(2))),
    csvEscape(amountText(grandTotalCents).toFixed(2))
  ].join(","));

  const blob = new Blob([`\uFEFF${lines.join("\n")}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `monthly-ancillary-summary-${month}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function downloadSummaryExcelXml(month: string, rows: WorkbookRow[], categoryColumns: AncillaryCategoryColumn[], totals: Array<{ id: string; name: string; amountCents: number; count: number }>, grandTotalCents: number, entryCount: number) {
  const escapeXml = (value: string | number) =>
    String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");

  const headers = ["Member", "Entry Count", ...categoryColumns.map((category) => category.name), "Total"];
  const bodyRows = rows.map((row) => [
    { type: "String", value: row.memberName },
    { type: "Number", value: row.entryCount },
    ...categoryColumns.map((category) => ({ type: "Number", value: amountText(row.categoryAmounts[category.id] ?? 0) })),
    { type: "Number", value: amountText(row.subtotalCents) }
  ]);
  bodyRows.push([
    { type: "String", value: "Monthly Total" },
    { type: "Number", value: entryCount },
    ...categoryColumns.map((category) => ({ type: "Number", value: amountText(totals.find((total) => total.id === category.id)?.amountCents ?? 0) })),
    { type: "Number", value: amountText(grandTotalCents) }
  ]);

  const xmlHeader = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Worksheet ss:Name="MonthlyAncillary">
<Table>`;
  const xmlFooter = `</Table></Worksheet></Workbook>`;

  const headerRow = `<Row>${headers.map((header) => `<Cell><Data ss:Type="String">${escapeXml(header)}</Data></Cell>`).join("")}</Row>`;
  const dataRows = bodyRows
    .map(
      (row) =>
        `<Row>${row
          .map((cell) => `<Cell><Data ss:Type="${cell.type}">${cell.type === "Number" ? escapeXml(cell.value) : escapeXml(cell.value)}</Data></Cell>`)
          .join("")}</Row>`
    )
    .join("");

  const xml = `${xmlHeader}${headerRow}${dataRows}${xmlFooter}`;
  const blob = new Blob([xml], { type: "application/vnd.ms-excel;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `monthly-ancillary-summary-${month}.xls`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function MonthlyAncillaryReport({ summary }: { summary: AncillarySummary }) {
  const [selectedMonth, setSelectedMonth] = useState(summary.selectedMonth);

  useEffect(() => {
    setSelectedMonth(summary.selectedMonth);
  }, [summary.selectedMonth]);

  const workbookState = useMemo(() => buildWorkbookState(summary, selectedMonth), [selectedMonth, summary]);
  const monthOptions = useMemo(() => {
    const base = Array.from(new Set([summary.selectedMonth, ...summary.availableMonths])).filter(Boolean);
    return base.sort((a, b) => b.localeCompare(a));
  }, [summary.availableMonths, summary.selectedMonth]);
  const selectedLabel = monthLabel(workbookState.month);
  const categoryCount = workbookState.categoryColumns.length;
  const memberCount = workbookState.rows.length;
  const nonZeroCategories = workbookState.totals.filter((category) => category.amountCents > 0).length;

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <div className="border-b border-border/60 px-4 py-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted">Operational workbook</p>
              <CardTitle className="text-2xl">Monthly Ancillary Charges</CardTitle>
              <p className="max-w-2xl text-sm text-muted">
                Table-first monthly summary grouped by member and ancillary category, built from canonical ancillary log data.
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-lg border border-border bg-muted/20 px-3 py-2">
                <p className="text-xs text-muted">Selected month</p>
                <p className="text-sm font-semibold">{selectedLabel}</p>
              </div>
              <div className="rounded-lg border border-border bg-muted/20 px-3 py-2">
                <p className="text-xs text-muted">Members</p>
                <p className="text-sm font-semibold">{memberCount}</p>
              </div>
              <div className="rounded-lg border border-border bg-muted/20 px-3 py-2">
                <p className="text-xs text-muted">Entries</p>
                <p className="text-sm font-semibold">{workbookState.entryCount}</p>
              </div>
              <div className="rounded-lg border border-border bg-muted/20 px-3 py-2">
                <p className="text-xs text-muted">Total</p>
                <p className="text-sm font-semibold">{money(workbookState.grandTotalCents)}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-4 px-4 py-4 lg:grid-cols-[280px_1fr] lg:items-end">
          <label className="space-y-2 text-sm">
            <span className="font-semibold">Month</span>
            <select
              className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm"
              value={selectedMonth}
              onChange={(event) => setSelectedMonth(event.target.value)}
            >
              {monthOptions.map((month) => (
                <option key={month} value={month}>
                  {monthLabel(month)}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-col gap-3 lg:items-end">
            <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-5">
              <div className="rounded-lg border border-border px-3 py-2">
                <p className="text-xs text-muted">Category columns</p>
                <p className="text-sm font-semibold">{categoryCount}</p>
              </div>
              <div className="rounded-lg border border-border px-3 py-2">
                <p className="text-xs text-muted">Columns with activity</p>
                <p className="text-sm font-semibold">{nonZeroCategories}</p>
              </div>
              <div className="rounded-lg border border-border px-3 py-2">
                <p className="text-xs text-muted">Available months</p>
                <p className="text-sm font-semibold">{summary.availableMonths.length}</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() =>
                  downloadSummaryCsv(
                    workbookState.month,
                    workbookState.rows,
                    workbookState.categoryColumns,
                    workbookState.totals,
                    workbookState.grandTotalCents,
                    workbookState.entryCount
                  )
                }
              >
                Export CSV
              </Button>
              <Button
                type="button"
                onClick={() =>
                  downloadSummaryExcelXml(
                    workbookState.month,
                    workbookState.rows,
                    workbookState.categoryColumns,
                    workbookState.totals,
                    workbookState.grandTotalCents,
                    workbookState.entryCount
                  )
                }
              >
                Export Excel (.xls)
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-border/60 px-4 py-3">
          <CardTitle className="text-lg">{selectedLabel} summary</CardTitle>
          <p className="text-sm text-muted">
            Nonzero cells are highlighted so coordinators can scan member activity and category totals quickly.
          </p>
        </div>

        {workbookState.rows.length === 0 ? (
          <div className="px-4 py-10 text-sm text-muted">No ancillary charges were logged for {selectedLabel}.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr className="text-left">
                  <th className="sticky left-0 z-20 border-b border-border bg-background px-4 py-3 font-semibold">Member</th>
                  <th className="border-b border-border px-3 py-3 text-right font-semibold">Entries</th>
                  {workbookState.categoryColumns.map((category) => (
                    <th key={category.id} className="border-b border-border px-3 py-3 text-right font-semibold">
                      <span className="block max-w-[140px] text-pretty">{category.name}</span>
                    </th>
                  ))}
                  <th className="border-b border-border px-4 py-3 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody>
                {workbookState.rows.map((row) => (
                  <tr key={row.memberId ?? row.memberName} className="align-top">
                    <td className="sticky left-0 z-10 border-b border-border bg-background px-4 py-3">
                      <div className="font-semibold text-fg">{row.memberName}</div>
                      <div className="text-xs text-muted">{row.memberId ? `Member ID ${row.memberId}` : "Member summary"}</div>
                    </td>
                    <td className="border-b border-border px-3 py-3 text-right tabular-nums text-muted">{row.entryCount}</td>
                    {workbookState.categoryColumns.map((category) => {
                      const value = row.categoryAmounts[category.id] ?? 0;
                      const isActive = value > 0;
                      return (
                        <td
                          key={category.id}
                          className={[
                            "border-b border-border px-3 py-3 text-right tabular-nums",
                            isActive ? "bg-emerald-50 font-semibold text-emerald-900" : "text-muted/80"
                          ].join(" ")}
                        >
                          {isActive ? money(value) : "—"}
                        </td>
                      );
                    })}
                    <td className="border-b border-border px-4 py-3 text-right tabular-nums font-semibold text-fg">
                      {money(row.subtotalCents)}
                    </td>
                  </tr>
                ))}
                <tr className="bg-muted/30 align-top font-semibold">
                  <td className="sticky left-0 z-10 border-t border-border bg-muted/30 px-4 py-3">Monthly Total</td>
                  <td className="border-t border-border px-3 py-3 text-right tabular-nums">{workbookState.entryCount}</td>
                  {workbookState.categoryColumns.map((category) => {
                    const total = workbookState.totals.find((item) => item.id === category.id)?.amountCents ?? 0;
                    return (
                      <td key={category.id} className="border-t border-border px-3 py-3 text-right tabular-nums">
                        {total > 0 ? money(total) : "—"}
                      </td>
                    );
                  })}
                  <td className="border-t border-border px-4 py-3 text-right tabular-nums">{money(workbookState.grandTotalCents)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <CardTitle className="text-base">Workbook notes</CardTitle>
          <p className="mt-2 text-sm text-muted">
            This view is intentionally summary-first. It keeps the operational month snapshot readable for center staff and exports the
            same summary structure to CSV or Excel.
          </p>
        </Card>
        <Card>
          <CardTitle className="text-base">Date basis</CardTitle>
          <p className="mt-2 text-sm text-muted">
            Rows are grouped by the ancillary service date so the month selection stays aligned with the canonical ancillary log data.
          </p>
        </Card>
        <Card>
          <CardTitle className="text-base">Detail access</CardTitle>
          <p className="mt-2 text-sm text-muted">
            Use the member ancillary screen for entry-level detail. This report is the high-level monthly workbook view.
          </p>
        </Card>
      </div>
    </div>
  );
}
