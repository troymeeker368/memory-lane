import "server-only";

import { resolveCanonicalLeadState } from "@/lib/canonical";
import { listCanonicalMemberLinksForLeadIds } from "@/lib/services/canonical-person-ref";
import { createClient } from "@/lib/supabase/server";
import { toEasternDate } from "@/lib/timezone";

type SalesSummaryLeadRow = {
  id: string;
  stage: string;
  status: string;
  created_at: string;
  inquiry_date: string | null;
  discovery_date: string | null;
  tour_date: string | null;
  tour_completed: boolean | null;
  member_start_date: string | null;
  lost_reason: string | null;
  closed_date: string | null;
  likelihood: string | null;
};

type MemberLocationRow = {
  member_id: string;
  location: string | null;
};

type MemberDischargeRow = {
  id: string;
  source_lead_id: string | null;
  discharge_date: string | null;
};

type NormalizedLeadRow = {
  id: string;
  location: string;
  createdAtDate: string;
  inquiryDate: string | null;
  discoveryDate: string | null;
  tourDate: string | null;
  tourCompleted: boolean | null;
  memberStartDate: string | null;
  lostReason: string | null;
  closedDate: string | null;
  likelihood: string | null;
  canonicalStage: string;
  canonicalStatus: "Open" | "Won" | "Lost" | "Nurture";
};

type DischargeRecord = {
  location: string;
  dischargeDate: string;
};

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

function matchesDateRange(value: string | null, startDate: string, endDate: string) {
  if (!value) return false;
  return value >= startDate && value <= endDate;
}

function matchesAsOfDate(value: string, asOfDate: string) {
  return value <= asOfDate;
}

function percent(part: number, total: number) {
  if (!total) return 0;
  return Number(((part / total) * 100).toFixed(2));
}

function parseDateOnly(value: string) {
  const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10));
  return Date.UTC(year, (month ?? 1) - 1, day ?? 1);
}

function daysBetween(startDate: string, endDate: string) {
  return Math.max(0, Math.round((parseDateOnly(endDate) - parseDateOnly(startDate)) / 86_400_000));
}

function averageDays(rows: Array<{ inquiryDate: string | null; memberStartDate: string | null }>) {
  const eligible = rows.filter((row) => row.inquiryDate && row.memberStartDate);
  if (eligible.length === 0) return null;
  const totalDays = eligible.reduce(
    (sum, row) => sum + daysBetween(row.inquiryDate as string, row.memberStartDate as string),
    0
  );
  return Number((totalDays / eligible.length).toFixed(0));
}

function createDispositionSeed(location: string): ClosedLeadDispositionRow {
  return {
    location,
    cost: 0,
    deceased: 0,
    declinedEnrollment: 0,
    didNotRespond: 0,
    distanceToCenter: 0,
    highAcuity: 0,
    optedForHomeCare: 0,
    placed: 0,
    transportationIssues: 0,
    spam: 0,
    totalClosedLeads: 0
  };
}

function normalizeLostReasonBucket(rawLostReason: string | null | undefined): keyof Omit<ClosedLeadDispositionRow, "location" | "totalClosedLeads"> {
  const value = clean(rawLostReason)?.toLowerCase() ?? "";
  if (!value) return "declinedEnrollment";
  if (value.includes("spam") || value.includes("wrong number") || value.includes("test")) return "spam";
  if (value.includes("deceas") || value.includes("passed")) return "deceased";
  if (value.includes("price") || value.includes("cost") || value.includes("financial") || value.includes("afford")) return "cost";
  if (value.includes("respond") || value.includes("reach") || value.includes("voicemail") || value.includes("ghost")) return "didNotRespond";
  if (value.includes("distance") || value.includes("too far") || value.includes("service area") || value.includes("out of area")) return "distanceToCenter";
  if (
    value.includes("high acuity") ||
    value.includes("acuity") ||
    value.includes("not eligible") ||
    value.includes("care needs") ||
    value.includes("medical")
  ) {
    return "highAcuity";
  }
  if (value.includes("home care") || value.includes("home health")) return "optedForHomeCare";
  if (
    value.includes("placed") ||
    value.includes("assisted living") ||
    value.includes("memory care") ||
    value.includes("skilled nursing") ||
    value.includes("facility") ||
    value.includes("hospice")
  ) {
    return "placed";
  }
  if (value.includes("transport")) return "transportationIssues";
  return "declinedEnrollment";
}

function sortLocations(left: string, right: string) {
  if (left === "Unassigned" && right !== "Unassigned") return 1;
  if (right === "Unassigned" && left !== "Unassigned") return -1;
  return left.localeCompare(right, undefined, { sensitivity: "base" });
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

async function loadSalesSummaryDataset() {
  const supabase = await createClient();
  const [{ data: leadData, error: leadError }, { data: dischargeMembers, error: dischargeMembersError }] = await Promise.all([
    supabase
      .from("leads")
      .select("id, stage, status, created_at, inquiry_date, discovery_date, tour_date, tour_completed, member_start_date, lost_reason, closed_date, likelihood")
      .order("created_at", { ascending: false }),
    supabase
      .from("members")
      .select("id, source_lead_id, discharge_date")
      .not("source_lead_id", "is", null)
      .not("discharge_date", "is", null)
  ]);

  if (leadError) throw new Error(`Unable to load leads for sales summary: ${leadError.message}`);
  if (dischargeMembersError) throw new Error(`Unable to load discharges for sales summary: ${dischargeMembersError.message}`);

  const leadRows = (leadData ?? []) as SalesSummaryLeadRow[];
  const leadIds = leadRows.map((row) => row.id);
  const canonicalLinks = await listCanonicalMemberLinksForLeadIds(leadIds, {
    actionLabel: "sales summary report"
  });

  const dischargeRows = (dischargeMembers ?? []) as MemberDischargeRow[];
  const memberIds = Array.from(
    new Set([
      ...Array.from(canonicalLinks.values()).map((link) => link.memberId),
      ...dischargeRows.map((row) => row.id)
    ])
  );

  let memberLocations = [] as MemberLocationRow[];
  if (memberIds.length > 0) {
    const { data, error } = await supabase
      .from("member_command_centers")
      .select("member_id, location")
      .in("member_id", memberIds);
    if (error) throw new Error(`Unable to load member locations for sales summary: ${error.message}`);
    memberLocations = (data ?? []) as MemberLocationRow[];
  }

  const locationByMemberId = new Map(
    memberLocations.map((row) => [row.member_id, clean(row.location) ?? "Unassigned"] as const)
  );

  const normalizedLeads = leadRows.map((row) => {
    const canonical = resolveCanonicalLeadState({
      requestedStage: row.stage ?? "Inquiry",
      requestedStatus: row.status ?? "open"
    });
    const linkedMember = canonicalLinks.get(row.id) ?? null;
    const location = linkedMember ? locationByMemberId.get(linkedMember.memberId) ?? "Unassigned" : "Unassigned";
    return {
      id: row.id,
      location,
      createdAtDate: normalizeDateOnly(row.created_at) ?? toEasternDate(),
      inquiryDate: normalizeDateOnly(row.inquiry_date),
      discoveryDate: normalizeDateOnly(row.discovery_date),
      tourDate: normalizeDateOnly(row.tour_date),
      tourCompleted: row.tour_completed,
      memberStartDate: normalizeDateOnly(row.member_start_date),
      lostReason: clean(row.lost_reason),
      closedDate: normalizeDateOnly(row.closed_date),
      likelihood: clean(row.likelihood),
      canonicalStage: canonical.stage,
      canonicalStatus: canonical.status
    } satisfies NormalizedLeadRow;
  });

  const dischargeRecords = dischargeRows
    .map((row) => ({
      location: locationByMemberId.get(row.id) ?? "Unassigned",
      dischargeDate: normalizeDateOnly(row.discharge_date)
    }))
    .filter((row): row is DischargeRecord => Boolean(row.dischargeDate));

  return {
    leads: normalizedLeads,
    discharges: dischargeRecords
  };
}

export async function getSalesSummaryReportData(input: SalesSummaryReportInput): Promise<SalesSummaryReportResult> {
  const dataset = await loadSalesSummaryDataset();
  const availableLocations = Array.from(
    new Set([
      ...dataset.leads.map((row) => row.location),
      ...dataset.discharges.map((row) => row.location),
      ...(input.location ? [input.location] : [])
    ])
  ).sort(sortLocations);
  const visibleLocations = input.location ? [input.location] : availableLocations;

  const summaryRows = visibleLocations.map((location) => {
    const leads = dataset.leads.filter((row) => row.location === location);
    const inquiries = leads.filter((row) => matchesDateRange(row.inquiryDate ?? row.createdAtDate, input.startDate, input.endDate)).length;
    const osa = leads.filter((row) => matchesDateRange(row.discoveryDate, input.startDate, input.endDate)).length;
    const tours = leads.filter(
      (row) =>
        matchesDateRange(row.tourDate, input.startDate, input.endDate) &&
        row.tourCompleted !== false
    ).length;
    const enrollments = leads.filter((row) => matchesDateRange(row.memberStartDate, input.startDate, input.endDate)).length;
    const discharges = dataset.discharges.filter(
      (row) => row.location === location && matchesDateRange(row.dischargeDate, input.startDate, input.endDate)
    ).length;
    return {
      location,
      osa,
      inquiries,
      osaInquiryRate: percent(osa, inquiries),
      tours,
      inquiryTourRate: percent(tours, inquiries),
      enrollments,
      tourEnrollmentRate: percent(enrollments, tours),
      discharges,
      netGrowth: enrollments - discharges
    } satisfies SummarySalesMetricsRow;
  });

  const summaryTotals = {
    location: "Totals",
    osa: summaryRows.reduce((sum, row) => sum + row.osa, 0),
    inquiries: summaryRows.reduce((sum, row) => sum + row.inquiries, 0),
    osaInquiryRate: 0,
    tours: summaryRows.reduce((sum, row) => sum + row.tours, 0),
    inquiryTourRate: 0,
    enrollments: summaryRows.reduce((sum, row) => sum + row.enrollments, 0),
    tourEnrollmentRate: 0,
    discharges: summaryRows.reduce((sum, row) => sum + row.discharges, 0),
    netGrowth: summaryRows.reduce((sum, row) => sum + row.netGrowth, 0)
  } satisfies SummarySalesMetricsRow;
  summaryTotals.osaInquiryRate = percent(summaryTotals.osa, summaryTotals.inquiries);
  summaryTotals.inquiryTourRate = percent(summaryTotals.tours, summaryTotals.inquiries);
  summaryTotals.tourEnrollmentRate = percent(summaryTotals.enrollments, summaryTotals.tours);

  const statusRows = visibleLocations.map((location) => {
    const leads = dataset.leads.filter(
      (row) =>
        row.location === location &&
        matchesAsOfDate(row.inquiryDate ?? row.createdAtDate, input.endDate)
    );
    const openLeads = leads.filter((row) => row.canonicalStatus === "Open" || row.canonicalStatus === "Nurture");
    const enrolledRows = leads.filter(
      (row) =>
        (row.memberStartDate && matchesAsOfDate(row.memberStartDate, input.endDate)) ||
        row.canonicalStatus === "Won"
    );
    return {
      location,
      eip: openLeads.filter((row) => row.canonicalStage === "Enrollment in Progress").length,
      hot: openLeads.filter((row) => (row.likelihood ?? "").toLowerCase() === "hot").length,
      warm: openLeads.filter((row) => (row.likelihood ?? "").toLowerCase() === "warm").length,
      cold: openLeads.filter((row) => (row.likelihood ?? "").toLowerCase() === "cold").length,
      enrolled: enrolledRows.length,
      avgSalesCycle: averageDays(
        enrolledRows.map((row) => ({
          inquiryDate: row.inquiryDate ?? row.createdAtDate,
          memberStartDate: row.memberStartDate
        }))
      )
    } satisfies TotalLeadsStatusRow;
  });

  const totalStatusSnapshotRows = dataset.leads.filter((row) => matchesAsOfDate(row.inquiryDate ?? row.createdAtDate, input.endDate));
  const totalStatusOpenRows = totalStatusSnapshotRows.filter(
    (row) =>
      visibleLocations.includes(row.location) &&
      (row.canonicalStatus === "Open" || row.canonicalStatus === "Nurture")
  );
  const totalStatusEnrolledRows = totalStatusSnapshotRows.filter(
    (row) =>
      visibleLocations.includes(row.location) &&
      ((row.memberStartDate && matchesAsOfDate(row.memberStartDate, input.endDate)) || row.canonicalStatus === "Won")
  );
  const statusTotals = {
    location: "Totals",
    eip: statusRows.reduce((sum, row) => sum + row.eip, 0),
    hot: statusRows.reduce((sum, row) => sum + row.hot, 0),
    warm: statusRows.reduce((sum, row) => sum + row.warm, 0),
    cold: statusRows.reduce((sum, row) => sum + row.cold, 0),
    enrolled: statusRows.reduce((sum, row) => sum + row.enrolled, 0),
    avgSalesCycle: averageDays(
      totalStatusEnrolledRows.map((row) => ({
        inquiryDate: row.inquiryDate ?? row.createdAtDate,
        memberStartDate: row.memberStartDate
      }))
    )
  } satisfies TotalLeadsStatusRow;
  void totalStatusOpenRows;

  const closedDispositionRows = visibleLocations.map((location) => {
    const row = createDispositionSeed(location);
    const leads = dataset.leads.filter(
      (lead) =>
        lead.location === location &&
        lead.canonicalStatus === "Lost" &&
        matchesDateRange(lead.closedDate, input.startDate, input.endDate)
    );
    leads.forEach((lead) => {
      row.totalClosedLeads += 1;
      row[normalizeLostReasonBucket(lead.lostReason)] += 1;
    });
    return row;
  });

  const closedDispositionTotals = createDispositionSeed("Totals");
  closedDispositionRows.forEach((row) => {
    closedDispositionTotals.cost += row.cost;
    closedDispositionTotals.deceased += row.deceased;
    closedDispositionTotals.declinedEnrollment += row.declinedEnrollment;
    closedDispositionTotals.didNotRespond += row.didNotRespond;
    closedDispositionTotals.distanceToCenter += row.distanceToCenter;
    closedDispositionTotals.highAcuity += row.highAcuity;
    closedDispositionTotals.optedForHomeCare += row.optedForHomeCare;
    closedDispositionTotals.placed += row.placed;
    closedDispositionTotals.transportationIssues += row.transportationIssues;
    closedDispositionTotals.spam += row.spam;
    closedDispositionTotals.totalClosedLeads += row.totalClosedLeads;
  });

  return {
    filters: {
      ...input,
      snapshotAsOfDate: input.endDate,
      osaDefinition: "OSA is derived from the lead discovery date because the canonical schema does not expose a dedicated OSA field."
    },
    availableLocations,
    summarySalesMetrics: {
      rows: summaryRows,
      totalsRow: summaryTotals
    },
    totalLeadsStatus: {
      rows: statusRows,
      totalsRow: statusTotals
    },
    closedLeadDisposition: {
      rows: closedDispositionRows,
      totalsRow: closedDispositionTotals
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
