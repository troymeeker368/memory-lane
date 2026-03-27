import Link from "next/link";
import type { ReactNode } from "react";

import { Card, CardTitle } from "@/components/ui/card";

type PipelineLeadRow = {
  id: string;
  member_name: string | null;
};

export const SALES_PIPELINE_PAGE_SIZE = 50;

export function firstQueryValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export function parsePageNumber(value: string | string[] | undefined) {
  const normalized = firstQueryValue(value).trim();
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export function buildSalesPipelinePageHref(
  pathname: string,
  searchParams: Record<string, string | string[] | undefined>,
  page: number
) {
  const params = new URLSearchParams();

  Object.entries(searchParams).forEach(([key, value]) => {
    const normalized = firstQueryValue(value).trim();
    if (!normalized || key === "page") return;
    params.set(key, normalized);
  });

  if (page > 1) params.set("page", String(page));

  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function renderSalesPipelineStagePage<TLead extends PipelineLeadRow>(input: {
  title: string;
  rows: TLead[];
  page: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
  searchParams: Record<string, string | string[] | undefined>;
  pathname: string;
  emptyMessage: string;
  emptyColSpan: number;
  headerRow: ReactNode;
  renderRow: (lead: TLead) => ReactNode;
}) {
  const {
    title,
    rows,
    page,
    pageSize,
    totalRows,
    totalPages,
    searchParams,
    pathname,
    emptyMessage,
    emptyColSpan,
    headerRow,
    renderRow
  } = input;

  const hasPreviousPage = page > 1;
  const hasNextPage = page < totalPages;
  const rangeStart = rows.length === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = rows.length === 0 ? 0 : rangeStart + rows.length - 1;

  return (
    <Card className="table-wrap">
      <CardTitle>{title}</CardTitle>
      <p className="mt-2 text-xs text-muted">
        Showing {rangeStart}-{rangeEnd} of {totalRows} leads
      </p>
      <table>
        <thead>{headerRow}</thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={emptyColSpan} className="text-center text-sm text-muted">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((lead) => <tr key={lead.id}>{renderRow(lead)}</tr>)
          )}
        </tbody>
      </table>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
        <span>
          Page {page} of {totalPages}
        </span>
        <div className="flex items-center gap-2">
          {hasPreviousPage ? (
            <Link
              href={buildSalesPipelinePageHref(pathname, searchParams, page - 1)}
              className="rounded-lg border border-border px-3 py-2 font-semibold text-primary-text"
            >
              Previous Page
            </Link>
          ) : null}
          {hasNextPage ? (
            <Link
              href={buildSalesPipelinePageHref(pathname, searchParams, page + 1)}
              className="rounded-lg border border-border px-3 py-2 font-semibold text-primary-text"
            >
              Next Page
            </Link>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
