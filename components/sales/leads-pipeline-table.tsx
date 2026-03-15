"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import {
  LEAD_LIKELIHOOD_OPTIONS,
  LEAD_SOURCE_OPTIONS,
  LEAD_STAGE_OPTIONS,
  LEAD_STATUS_OPTIONS
} from "@/lib/canonical";
import { formatDate } from "@/lib/utils";

type LeadRow = {
  id: string;
  stage: string;
  status: string;
  inquiry_date: string | null;
  member_name: string | null;
  caregiver_name: string | null;
  caregiver_relationship: string | null;
  lead_source: string | null;
  referral_name: string | null;
  likelihood: string | null;
  next_follow_up_date: string | null;
  next_follow_up_type: string | null;
};

type SortColumn =
  | "member_name"
  | "stage"
  | "status"
  | "inquiry_date"
  | "caregiver_name"
  | "caregiver_relationship"
  | "lead_source"
  | "referral_name"
  | "likelihood"
  | "next_follow_up";

type SortDirection = "asc" | "desc";

type FilterState = {
  q: string;
  stage: string;
  status: string;
  lead_source: string;
  likelihood: string;
  sort: SortColumn;
  dir: SortDirection;
};

function getNextFollowUpLabel(lead: LeadRow) {
  return lead.next_follow_up_date ? `${formatDate(lead.next_follow_up_date)} (${lead.next_follow_up_type ?? "-"})` : "-";
}

function buildSearchParams(filters: FilterState, page: number) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.stage) params.set("stage", filters.stage);
  if (filters.status) params.set("status", filters.status);
  if (filters.lead_source) params.set("lead_source", filters.lead_source);
  if (filters.likelihood) params.set("likelihood", filters.likelihood);
  if (filters.sort !== "inquiry_date") params.set("sort", filters.sort);
  if (filters.dir !== "desc") params.set("dir", filters.dir);
  if (page > 1) params.set("page", String(page));
  return params.toString();
}

export function LeadsPipelineTable({
  leads,
  initialFilters,
  page,
  totalRows,
  totalPages
}: {
  leads: LeadRow[];
  initialFilters: FilterState;
  page: number;
  totalRows: number;
  totalPages: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [filters, setFilters] = useState<FilterState>(initialFilters);

  const navigate = (nextFilters: FilterState, nextPage = 1) => {
    const search = buildSearchParams(nextFilters, nextPage);
    router.push(search ? `${pathname}?${search}` : pathname);
  };

  const onApply = () => navigate(filters, 1);

  const onClear = () => {
    const cleared: FilterState = {
      q: "",
      stage: "",
      status: "",
      lead_source: "",
      likelihood: "",
      sort: "inquiry_date",
      dir: "desc"
    };
    setFilters(cleared);
    navigate(cleared, 1);
  };

  const toggleSort = (column: SortColumn) => {
    const nextDirection: SortDirection =
      filters.sort === column ? (filters.dir === "asc" ? "desc" : "asc") : "asc";
    const nextFilters = {
      ...filters,
      sort: column,
      dir: nextDirection
    };
    setFilters(nextFilters);
    navigate(nextFilters, 1);
  };

  const sortIndicator = (column: SortColumn) => {
    if (filters.sort !== column) return "";
    return filters.dir === "asc" ? " ^" : " v";
  };

  const pageHref = (targetPage: number) => {
    const search = buildSearchParams(filters, targetPage);
    return search ? `${pathname}?${search}` : pathname;
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-2 lg:grid-cols-[2fr_repeat(4,minmax(0,1fr))_auto_auto] lg:items-center">
        <input
          type="text"
          className="h-10 rounded-lg border border-border bg-white px-3 text-sm text-fg"
          value={filters.q}
          onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))}
          placeholder="Search lead or caregiver"
        />
        <select className="h-10 rounded-lg border border-border bg-white px-3 text-sm" value={filters.stage} onChange={(event) => setFilters((current) => ({ ...current, stage: event.target.value }))}>
          <option value="">All Stages</option>
          {LEAD_STAGE_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <select className="h-10 rounded-lg border border-border bg-white px-3 text-sm" value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
          <option value="">All Statuses</option>
          {LEAD_STATUS_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <select className="h-10 rounded-lg border border-border bg-white px-3 text-sm" value={filters.lead_source} onChange={(event) => setFilters((current) => ({ ...current, lead_source: event.target.value }))}>
          <option value="">All Sources</option>
          {LEAD_SOURCE_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <select className="h-10 rounded-lg border border-border bg-white px-3 text-sm" value={filters.likelihood} onChange={(event) => setFilters((current) => ({ ...current, likelihood: event.target.value }))}>
          <option value="">All Likelihoods</option>
          {LEAD_LIKELIHOOD_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <button type="button" className="h-10 rounded-lg bg-brand px-3 text-sm font-semibold text-white" onClick={onApply}>
          Apply
        </button>
        <button type="button" className="h-10 rounded-lg border border-border px-3 text-sm font-semibold" onClick={onClear}>
          Clear
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
        <span>Rows: {totalRows}</span>
        <span>Page {page} of {totalPages}</span>
      </div>

      <table>
        <thead>
          <tr>
            <th><button type="button" className="font-semibold" onClick={() => toggleSort("member_name")}>Lead Name{sortIndicator("member_name")}</button></th>
            <th><button type="button" className="font-semibold" onClick={() => toggleSort("stage")}>Stage{sortIndicator("stage")}</button></th>
            <th><button type="button" className="font-semibold" onClick={() => toggleSort("status")}>Status{sortIndicator("status")}</button></th>
            <th><button type="button" className="font-semibold" onClick={() => toggleSort("inquiry_date")}>Inquiry Date{sortIndicator("inquiry_date")}</button></th>
            <th><button type="button" className="font-semibold" onClick={() => toggleSort("caregiver_name")}>Caregiver Name{sortIndicator("caregiver_name")}</button></th>
            <th><button type="button" className="font-semibold" onClick={() => toggleSort("caregiver_relationship")}>Relationship{sortIndicator("caregiver_relationship")}</button></th>
            <th><button type="button" className="font-semibold" onClick={() => toggleSort("lead_source")}>Lead Source{sortIndicator("lead_source")}</button></th>
            <th><button type="button" className="font-semibold" onClick={() => toggleSort("referral_name")}>Referral Name{sortIndicator("referral_name")}</button></th>
            <th><button type="button" className="font-semibold" onClick={() => toggleSort("likelihood")}>Likelihood{sortIndicator("likelihood")}</button></th>
            <th><button type="button" className="font-semibold" onClick={() => toggleSort("next_follow_up")}>Next Follow-Up{sortIndicator("next_follow_up")}</button></th>
          </tr>
        </thead>
        <tbody>
          {leads.length === 0 ? (
            <tr>
              <td colSpan={10} className="text-center text-sm text-muted">No leads match the current filters.</td>
            </tr>
          ) : (
            leads.map((lead) => (
              <tr key={lead.id}>
                <td><Link className="font-semibold text-brand" href={`/sales/leads/${lead.id}`}>{lead.member_name ?? "-"}</Link></td>
                <td>{lead.stage}</td>
                <td>{lead.status}</td>
                <td>{lead.inquiry_date ? formatDate(lead.inquiry_date) : "-"}</td>
                <td>{lead.caregiver_name ?? "-"}</td>
                <td>{lead.caregiver_relationship ?? "-"}</td>
                <td>{lead.lead_source ?? "-"}</td>
                <td>{lead.referral_name ?? "-"}</td>
                <td>{lead.likelihood ?? "-"}</td>
                <td>{getNextFollowUpLabel(lead)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link
          href={page > 1 ? pageHref(page - 1) : "#"}
          className={`rounded border px-3 py-1 font-semibold ${page > 1 ? "border-border text-brand" : "cursor-not-allowed border-border text-muted"}`}
        >
          Previous
        </Link>
        {Array.from({ length: totalPages }, (_, index) => index + 1).map((pageNumber) => (
          <Link
            key={pageNumber}
            href={pageHref(pageNumber)}
            className={`rounded border px-3 py-1 ${pageNumber === page ? "border-brand bg-brand text-white" : "border-border text-brand"}`}
          >
            {pageNumber}
          </Link>
        ))}
        <Link
          href={page < totalPages ? pageHref(page + 1) : "#"}
          className={`rounded border px-3 py-1 font-semibold ${page < totalPages ? "border-border text-brand" : "cursor-not-allowed border-border text-muted"}`}
        >
          Next
        </Link>
      </div>
    </div>
  );
}
