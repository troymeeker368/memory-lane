import "server-only";

import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";
import { createClient } from "@/lib/supabase/server";
import { toEasternDate } from "@/lib/timezone";

type SummarySalesMetricsRow = {
  location: string;
  osa: number;
  inquiries: number;
  osaInquiryRate: number;
  tours: number;
  inquiryTourRate: number;
  enrollments: number;
  tourEnrollmentRate: number;
  discharges: number;
  netGrowth: number;
};

type TotalLeadsStatusRow = {
  location: string;
  eip: number;
  hot: number;
  warm: number;
  cold: number;
  enrolled: number;
  avgSalesCycle: number | null;
};

type ClosedLeadDispositionRow = {
  location: string;
  cost: number;
  deceased: number;
  declinedEnrollment: number;
  didNotRespond: number;
  distanceToCenter: number;
  highAcuity: number;
  optedForHomeCare: number;
  placed: number;
  transportationIssues: number;
  spam: number;
  totalClosedLeads: number;
};

type SalesSummaryReportRpcRow = {
  available_locations: unknown;
  summary_sales_metrics_rows: unknown;
  summary_sales_metrics_totals: unknown;
  total_leads_status_rows: unknown;
  total_leads_status_totals: unknown;
  closed_lead_disposition_rows: unknown;
  closed_lead_disposition_totals: unknown;
};

export type SalesSummaryReportInput = {
  location: string | null;
  startDate: string;
  endDate: string;
  usedDefaultRange: boolean;
};

export interface SalesSummaryReportResult {
  filters: SalesSummaryReportInput & {
    snapshotAsOfDate: string;
    osaDefinition: string;
  };
  availableLocations: string[];
  summarySalesMetrics: {
    rows: SummarySalesMetricsRow[];
    totalsRow: SummarySalesMetricsRow;
  };
  totalLeadsStatus: {
    rows: TotalLeadsStatusRow[];
    totalsRow: TotalLeadsStatusRow;
  };
  closedLeadDisposition: {
    rows: ClosedLeadDispositionRow[];
    totalsRow: ClosedLeadDispositionRow;
  };
}

const SALES_SUMMARY_REPORT_RPC = "rpc_get_sales_summary_report";
const SALES_SUMMARY_REPORT_MIGRATION = "0144_sales_summary_report_rpc.sql";

function clean(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeDateOnly(value: string | null | undefined) {
  const normalized = clean(value);
  if (!normalized) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : normalized.slice(0, 10);
}

function getDefaultRange() {
  const today = toEasternDate();
  return {
    startDate: `${today.slice(0, 7)}-01`,
    endDate: today
  };
}

function normalizeStartAndEnd(rawStartDate: string | null | undefined, rawEndDate: string | null | undefined) {
  const defaults = getDefaultRange();
  const usedDefaultRange = !clean(rawStartDate) && !clean(rawEndDate);
  const startDate = normalizeDateOnly(rawStartDate) ?? defaults.startDate;
  const endDate = normalizeDateOnly(rawEndDate) ?? defaults.endDate;
  return startDate <= endDate
    ? { startDate, endDate, usedDefaultRange }
    : { startDate: endDate, endDate: startDate, usedDefaultRange };
}

function escapeCsv(value: string | number | null | undefined) {
  const normalized = String(value ?? "");
  if (/[",\n]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
}

function buildCsv(lines: Array<Array<string | number | null | undefined>>) {
  return lines.map((line) => line.map((cell) => escapeCsv(cell)).join(",")).join("\n");
}

function sortLocations(left: string, right: string) {
  if (left === "Unassigned" && right !== "Unassigned") return 1;
  if (right === "Unassigned" && left !== "Unassigned") return -1;
  return left.localeCompare(right, undefined, { sensitivity: "base" });
}

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function toNullableNumber(value: unknown) {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function parseLocationList(payload: unknown) {
  const rows = Array.isArray(payload) ? payload : [];
  return rows.map((value) => clean(String(value ?? ""))).filter((value): value is string => Boolean(value));
}

function parseSummarySalesMetricsRow(payload: unknown, fallbackLocation = "Unknown"): SummarySalesMetricsRow {
  const row = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
  return {
    location: clean(typeof row.location === "string" ? row.location : null) ?? fallbackLocation,
    osa: toNumber(row.osa),
    inquiries: toNumber(row.inquiries),
    osaInquiryRate: toNumber(row.osa_inquiry_rate ?? row.osaInquiryRate),
    tours: toNumber(row.tours),
    inquiryTourRate: toNumber(row.inquiry_tour_rate ?? row.inquiryTourRate),
    enrollments: toNumber(row.enrollments),
    tourEnrollmentRate: toNumber(row.tour_enrollment_rate ?? row.tourEnrollmentRate),
    discharges: toNumber(row.discharges),
    netGrowth: toNumber(row.net_growth ?? row.netGrowth)
  };
}

function parseSummarySalesMetricsRows(payload: unknown) {
  const rows = Array.isArray(payload) ? payload : [];
  return rows.map((row) => parseSummarySalesMetricsRow(row));
}

function parseTotalLeadsStatusRow(payload: unknown, fallbackLocation = "Unknown"): TotalLeadsStatusRow {
  const row = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
  return {
    location: clean(typeof row.location === "string" ? row.location : null) ?? fallbackLocation,
    eip: toNumber(row.eip),
    hot: toNumber(row.hot),
    warm: toNumber(row.warm),
    cold: toNumber(row.cold),
    enrolled: toNumber(row.enrolled),
    avgSalesCycle: toNullableNumber(row.avg_sales_cycle ?? row.avgSalesCycle)
  };
}

function parseTotalLeadsStatusRows(payload: unknown) {
  const rows = Array.isArray(payload) ? payload : [];
  return rows.map((row) => parseTotalLeadsStatusRow(row));
}

function parseClosedLeadDispositionRow(payload: unknown, fallbackLocation = "Unknown"): ClosedLeadDispositionRow {
  const row = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
  return {
    location: clean(typeof row.location === "string" ? row.location : null) ?? fallbackLocation,
    cost: toNumber(row.cost),
    deceased: toNumber(row.deceased),
    declinedEnrollment: toNumber(row.declined_enrollment ?? row.declinedEnrollment),
    didNotRespond: toNumber(row.did_not_respond ?? row.didNotRespond),
    distanceToCenter: toNumber(row.distance_to_center ?? row.distanceToCenter),
    highAcuity: toNumber(row.high_acuity ?? row.highAcuity),
    optedForHomeCare: toNumber(row.opted_for_home_care ?? row.optedForHomeCare),
    placed: toNumber(row.placed),
    transportationIssues: toNumber(row.transportation_issues ?? row.transportationIssues),
    spam: toNumber(row.spam),
    totalClosedLeads: toNumber(row.total_closed_leads ?? row.totalClosedLeads)
  };
}

function parseClosedLeadDispositionRows(payload: unknown) {
  const rows = Array.isArray(payload) ? payload : [];
  return rows.map((row) => parseClosedLeadDispositionRow(row));
}

export function resolveSalesSummaryReportInput(raw: Partial<Record<string, string | null | undefined>>) {
  const { startDate, endDate, usedDefaultRange } = normalizeStartAndEnd(raw.startDate, raw.endDate);
  return {
    location: raw.location ? String(raw.location).trim() || null : null,
    startDate,
    endDate,
    usedDefaultRange
  } satisfies SalesSummaryReportInput;
}

export async function getSalesSummaryReportData(input: SalesSummaryReportInput): Promise<SalesSummaryReportResult> {
  const supabase = await createClient();
  let rpcRows: SalesSummaryReportRpcRow[];
  try {
    rpcRows = await invokeSupabaseRpcOrThrow<SalesSummaryReportRpcRow[]>(supabase, SALES_SUMMARY_REPORT_RPC, {
      p_start_date: input.startDate,
      p_end_date: input.endDate,
      p_location: input.location
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load sales summary report.";
    if (message.includes(SALES_SUMMARY_REPORT_RPC)) {
      throw new Error(
        `Sales summary report RPC is not available. Apply Supabase migration ${SALES_SUMMARY_REPORT_MIGRATION} and refresh PostgREST schema cache.`
      );
    }
    throw error;
  }

  const row = rpcRows?.[0];
  if (!row) {
    throw new Error("Sales summary report RPC returned no rows.");
  }

  const availableLocations = Array.from(
    new Set([...(parseLocationList(row.available_locations) ?? []), ...(input.location ? [input.location] : [])])
  ).sort(sortLocations);

  return {
    filters: {
      ...input,
      snapshotAsOfDate: input.endDate,
      osaDefinition: "OSA is derived from the lead discovery date because the canonical schema does not expose a dedicated OSA field."
    },
    availableLocations,
    summarySalesMetrics: {
      rows: parseSummarySalesMetricsRows(row.summary_sales_metrics_rows),
      totalsRow: parseSummarySalesMetricsRow(row.summary_sales_metrics_totals, "Totals")
    },
    totalLeadsStatus: {
      rows: parseTotalLeadsStatusRows(row.total_leads_status_rows),
      totalsRow: parseTotalLeadsStatusRow(row.total_leads_status_totals, "Totals")
    },
    closedLeadDisposition: {
      rows: parseClosedLeadDispositionRows(row.closed_lead_disposition_rows),
      totalsRow: parseClosedLeadDispositionRow(row.closed_lead_disposition_totals, "Totals")
    }
  };
}

export function buildSalesSummaryMetricsCsv(report: SalesSummaryReportResult) {
  return buildCsv([
    ["Location", "OSA", "Inquiries", "OSA/I %", "Tours", "I/T %", "Enrollments", "T/E %", "Discharges", "Net Growth"],
    ...report.summarySalesMetrics.rows.map((row) => [
      row.location,
      row.osa,
      row.inquiries,
      row.osaInquiryRate,
      row.tours,
      row.inquiryTourRate,
      row.enrollments,
      row.tourEnrollmentRate,
      row.discharges,
      row.netGrowth
    ]),
    [
      report.summarySalesMetrics.totalsRow.location,
      report.summarySalesMetrics.totalsRow.osa,
      report.summarySalesMetrics.totalsRow.inquiries,
      report.summarySalesMetrics.totalsRow.osaInquiryRate,
      report.summarySalesMetrics.totalsRow.tours,
      report.summarySalesMetrics.totalsRow.inquiryTourRate,
      report.summarySalesMetrics.totalsRow.enrollments,
      report.summarySalesMetrics.totalsRow.tourEnrollmentRate,
      report.summarySalesMetrics.totalsRow.discharges,
      report.summarySalesMetrics.totalsRow.netGrowth
    ]
  ]);
}

export function buildSalesLeadStatusCsv(report: SalesSummaryReportResult) {
  return buildCsv([
    ["Location", "EIP", "Hot", "Warm", "Cold", "Enrolled", "Avg. Sales Cycle"],
    ...report.totalLeadsStatus.rows.map((row) => [
      row.location,
      row.eip,
      row.hot,
      row.warm,
      row.cold,
      row.enrolled,
      row.avgSalesCycle
    ]),
    [
      report.totalLeadsStatus.totalsRow.location,
      report.totalLeadsStatus.totalsRow.eip,
      report.totalLeadsStatus.totalsRow.hot,
      report.totalLeadsStatus.totalsRow.warm,
      report.totalLeadsStatus.totalsRow.cold,
      report.totalLeadsStatus.totalsRow.enrolled,
      report.totalLeadsStatus.totalsRow.avgSalesCycle
    ]
  ]);
}

export function buildSalesClosedDispositionCsv(report: SalesSummaryReportResult) {
  return buildCsv([
    [
      "Location",
      "Cost",
      "Deceased",
      "Declined Enrollment",
      "Did not Respond",
      "Distance to Center",
      "High Acuity",
      "Opted for Home Care",
      "Placed",
      "Transportation Issues",
      "SPAM",
      "Total Closed Leads"
    ],
    ...report.closedLeadDisposition.rows.map((row) => [
      row.location,
      row.cost,
      row.deceased,
      row.declinedEnrollment,
      row.didNotRespond,
      row.distanceToCenter,
      row.highAcuity,
      row.optedForHomeCare,
      row.placed,
      row.transportationIssues,
      row.spam,
      row.totalClosedLeads
    ]),
    [
      report.closedLeadDisposition.totalsRow.location,
      report.closedLeadDisposition.totalsRow.cost,
      report.closedLeadDisposition.totalsRow.deceased,
      report.closedLeadDisposition.totalsRow.declinedEnrollment,
      report.closedLeadDisposition.totalsRow.didNotRespond,
      report.closedLeadDisposition.totalsRow.distanceToCenter,
      report.closedLeadDisposition.totalsRow.highAcuity,
      report.closedLeadDisposition.totalsRow.optedForHomeCare,
      report.closedLeadDisposition.totalsRow.placed,
      report.closedLeadDisposition.totalsRow.transportationIssues,
      report.closedLeadDisposition.totalsRow.spam,
      report.closedLeadDisposition.totalsRow.totalClosedLeads
    ]
  ]);
}
