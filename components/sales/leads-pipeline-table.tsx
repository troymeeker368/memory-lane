"use client";

import Link from "next/link";
import { type CSSProperties, useMemo, useState } from "react";

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
  inquiry_date: string;
  member_name: string;
  caregiver_name: string;
  caregiver_relationship: string | null;
  lead_source: string;
  referral_name: string | null;
  likelihood: string | null;
  next_follow_up_date: string | null;
  next_follow_up_type: string | null;
};

type SortDirection = "asc" | "desc" | null;

type ColumnKey =
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

type FilterState = {
  stage: string;
  status: string;
  lead_source: string;
  likelihood: string;
};

function asText(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function getNextFollowUpLabel(lead: LeadRow) {
  return lead.next_follow_up_date ? `${formatDate(lead.next_follow_up_date)} (${lead.next_follow_up_type ?? "-"})` : "-";
}

function parseDateSortValue(value: string | null | undefined) {
  if (!value) return null;
  const cleaned = value.trim();
  if (!cleaned) return null;

  // Keep date-only fields timezone-safe when sorting.
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
    return Number(cleaned.replaceAll("-", ""));
  }

  const parsed = Date.parse(cleaned);
  if (Number.isNaN(parsed)) return null;
  return parsed;
}

function compareNullableDate(a: string | null | undefined, b: string | null | undefined, direction: Exclude<SortDirection, null>) {
  const av = parseDateSortValue(a);
  const bv = parseDateSortValue(b);

  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;

  const diff = av - bv;
  return direction === "asc" ? diff : -diff;
}

function compareText(a: unknown, b: unknown, direction: Exclude<SortDirection, null>) {
  const comparison = String(a ?? "").trim().localeCompare(String(b ?? "").trim(), undefined, {
    sensitivity: "base",
    numeric: true
  });
  return direction === "asc" ? comparison : -comparison;
}

function compareByRank(
  a: string | null | undefined,
  b: string | null | undefined,
  rankMap: Record<string, number>,
  direction: Exclude<SortDirection, null>
) {
  const aText = String(a ?? "").trim();
  const bText = String(b ?? "").trim();
  const aRank = rankMap[aText];
  const bRank = rankMap[bText];
  const aKnown = Number.isFinite(aRank);
  const bKnown = Number.isFinite(bRank);

  if (aKnown && bKnown && aRank !== bRank) {
    return direction === "asc" ? aRank - bRank : bRank - aRank;
  }

  if (aKnown && !bKnown) return -1;
  if (!aKnown && bKnown) return 1;
  return compareText(aText, bText, direction);
}

const filterInputClass = "h-8 w-full rounded border border-border bg-white px-2 text-xs text-fg";
const stickyTopHeaderStyle: CSSProperties = { position: "sticky", top: 0, zIndex: 30 };
const stickyFilterHeaderStyle: CSSProperties = {
  position: "sticky",
  top: 44,
  zIndex: 25,
  backgroundColor: "#d4eefc",
  color: "#4e4e4e"
};

export function LeadsPipelineTable({
  leads,
  initialFilters
}: {
  leads: LeadRow[];
  initialFilters?: Partial<Record<ColumnKey, string>>;
}) {
  const [query, setQuery] = useState(initialFilters?.member_name ?? initialFilters?.caregiver_name ?? "");
  const [filters, setFilters] = useState<FilterState>({
    stage: initialFilters?.stage ?? "",
    status: initialFilters?.status ?? "",
    lead_source: initialFilters?.lead_source ?? "",
    likelihood: initialFilters?.likelihood ?? ""
  });

  const [sortColumn, setSortColumn] = useState<ColumnKey>("inquiry_date");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const filteredAndSorted = useMemo(() => {
    const stageRank = Object.fromEntries(LEAD_STAGE_OPTIONS.map((value, index) => [value, index])) as Record<string, number>;
    const statusRank = Object.fromEntries(LEAD_STATUS_OPTIONS.map((value, index) => [value, index])) as Record<string, number>;
    const likelihoodRank = Object.fromEntries(LEAD_LIKELIHOOD_OPTIONS.map((value, index) => [value, index])) as Record<string, number>;
    const search = query.trim().toLowerCase();

    const filtered = leads.filter((lead) => {
      if (search) {
        const leadName = asText(lead.member_name);
        const caregiverName = asText(lead.caregiver_name);
        if (!leadName.includes(search) && !caregiverName.includes(search)) {
          return false;
        }
      }

      if (filters.stage && asText(lead.stage) !== asText(filters.stage)) return false;
      if (filters.status && asText(lead.status) !== asText(filters.status)) return false;
      if (filters.lead_source && asText(lead.lead_source) !== asText(filters.lead_source)) return false;
      if (filters.likelihood && asText(lead.likelihood ?? "") !== asText(filters.likelihood)) return false;

      return true;
    });

    if (!sortColumn || !sortDirection) {
      return filtered;
    }

    return [...filtered].sort((a, b) => {
      let comparison = 0;

      if (sortColumn === "inquiry_date") {
        comparison = compareNullableDate(a.inquiry_date, b.inquiry_date, sortDirection);
      } else if (sortColumn === "next_follow_up") {
        comparison = compareNullableDate(a.next_follow_up_date, b.next_follow_up_date, sortDirection);
      } else if (sortColumn === "stage") {
        comparison = compareByRank(a.stage, b.stage, stageRank, sortDirection);
      } else if (sortColumn === "status") {
        comparison = compareByRank(a.status, b.status, statusRank, sortDirection);
      } else if (sortColumn === "likelihood") {
        comparison = compareByRank(a.likelihood, b.likelihood, likelihoodRank, sortDirection);
      } else if (sortColumn === "caregiver_relationship") {
        comparison = compareText(a.caregiver_relationship ?? "", b.caregiver_relationship ?? "", sortDirection);
      } else if (sortColumn === "referral_name") {
        comparison = compareText(a.referral_name ?? "", b.referral_name ?? "", sortDirection);
      } else {
        comparison = compareText(a[sortColumn] ?? "", b[sortColumn] ?? "", sortDirection);
      }

      if (comparison !== 0) return comparison;

      // Deterministic tie-breakers to avoid unstable row ordering.
      const byLeadName = a.member_name.localeCompare(b.member_name, undefined, { sensitivity: "base", numeric: true });
      if (byLeadName !== 0) return byLeadName;
      return a.id.localeCompare(b.id);
    });
  }, [query, filters, leads, sortColumn, sortDirection]);

  const toggleSort = (column: ColumnKey) => {
    if (sortColumn !== column) {
      setSortColumn(column);
      setSortDirection("asc");
      return;
    }

    if (sortDirection === "asc") {
      setSortDirection("desc");
      return;
    }

    if (sortDirection === "desc") {
      setSortDirection(null);
      return;
    }

    setSortDirection("asc");
  };

  const sortIndicator = (column: ColumnKey) => {
    if (sortColumn !== column || !sortDirection) return "";
    return sortDirection === "asc" ? " ^" : " v";
  };

  const clearFilters = () => {
    setQuery("");
    setFilters({ stage: "", status: "", lead_source: "", likelihood: "" });
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-2 md:grid-cols-[1fr_auto] md:items-center">
        <input
          type="text"
          className="h-10 rounded-lg border border-border bg-white px-3 text-sm text-fg"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search lead or caregiver"
        />
        <div className="flex items-center justify-between gap-3 text-xs text-muted md:justify-end">
          <span>Rows: {filteredAndSorted.length}</span>
          <button type="button" className="font-semibold text-brand" onClick={clearFilters}>
            Clear Filters
          </button>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th style={stickyTopHeaderStyle}><button type="button" className="font-semibold" onClick={() => toggleSort("member_name")}>Lead Name{sortIndicator("member_name")}</button></th>
            <th style={stickyTopHeaderStyle}><button type="button" className="font-semibold" onClick={() => toggleSort("stage")}>Stage{sortIndicator("stage")}</button></th>
            <th style={stickyTopHeaderStyle}><button type="button" className="font-semibold" onClick={() => toggleSort("status")}>Status{sortIndicator("status")}</button></th>
            <th style={stickyTopHeaderStyle}><button type="button" className="font-semibold" onClick={() => toggleSort("inquiry_date")}>Inquiry Date{sortIndicator("inquiry_date")}</button></th>
            <th style={stickyTopHeaderStyle}><button type="button" className="font-semibold" onClick={() => toggleSort("caregiver_name")}>Caregiver Name{sortIndicator("caregiver_name")}</button></th>
            <th style={stickyTopHeaderStyle}><button type="button" className="font-semibold" onClick={() => toggleSort("caregiver_relationship")}>Relationship{sortIndicator("caregiver_relationship")}</button></th>
            <th style={stickyTopHeaderStyle}><button type="button" className="font-semibold" onClick={() => toggleSort("lead_source")}>Lead Source{sortIndicator("lead_source")}</button></th>
            <th style={stickyTopHeaderStyle}><button type="button" className="font-semibold" onClick={() => toggleSort("referral_name")}>Referral Name{sortIndicator("referral_name")}</button></th>
            <th style={stickyTopHeaderStyle}><button type="button" className="font-semibold" onClick={() => toggleSort("likelihood")}>Likelihood{sortIndicator("likelihood")}</button></th>
            <th style={stickyTopHeaderStyle}><button type="button" className="font-semibold" onClick={() => toggleSort("next_follow_up")}>Next Follow-Up{sortIndicator("next_follow_up")}</button></th>
          </tr>
          <tr>
            <th style={stickyFilterHeaderStyle}></th>
            <th style={stickyFilterHeaderStyle}>
              <select className={filterInputClass} value={filters.stage} onChange={(event) => setFilters((current) => ({ ...current, stage: event.target.value }))}>
                <option value="">All</option>
                {LEAD_STAGE_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </th>
            <th style={stickyFilterHeaderStyle}>
              <select className={filterInputClass} value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
                <option value="">All</option>
                {LEAD_STATUS_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </th>
            <th style={stickyFilterHeaderStyle}></th>
            <th style={stickyFilterHeaderStyle}></th>
            <th style={stickyFilterHeaderStyle}></th>
            <th style={stickyFilterHeaderStyle}>
              <select className={filterInputClass} value={filters.lead_source} onChange={(event) => setFilters((current) => ({ ...current, lead_source: event.target.value }))}>
                <option value="">All</option>
                {LEAD_SOURCE_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </th>
            <th style={stickyFilterHeaderStyle}></th>
            <th style={stickyFilterHeaderStyle}>
              <select className={filterInputClass} value={filters.likelihood} onChange={(event) => setFilters((current) => ({ ...current, likelihood: event.target.value }))}>
                <option value="">All</option>
                {LEAD_LIKELIHOOD_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </th>
            <th style={stickyFilterHeaderStyle}></th>
          </tr>
        </thead>
        <tbody>
          {filteredAndSorted.map((lead) => (
            <tr key={lead.id}>
              <td><Link className="font-semibold text-brand" href={`/sales/leads/${lead.id}`}>{lead.member_name}</Link></td>
              <td>{lead.stage}</td>
              <td>{lead.status}</td>
              <td>{formatDate(lead.inquiry_date)}</td>
              <td>{lead.caregiver_name}</td>
              <td>{lead.caregiver_relationship ?? "-"}</td>
              <td>{lead.lead_source}</td>
              <td>{lead.referral_name ?? "-"}</td>
              <td>{lead.likelihood ?? "-"}</td>
              <td>{getNextFollowUpLabel(lead)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
