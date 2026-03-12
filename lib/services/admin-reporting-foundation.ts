import type { ReportDateRange } from "@/lib/services/admin-reports";
import { toEasternDate } from "@/lib/timezone";

export const ON_DEMAND_REPORT_CATEGORIES = [
  { value: "attendance", label: "Attendance" },
  { value: "billing-revenue", label: "Billing / Revenue" },
  { value: "transportation", label: "Transportation" },
  { value: "leads-sales", label: "Leads / Sales" },
  { value: "member-documentation", label: "Member Documentation" }
] as const;

export type OnDemandReportCategory = (typeof ON_DEMAND_REPORT_CATEGORIES)[number]["value"];
export type OnDemandValue = string | number | boolean | null;
export type OnDemandColumnKind = "text" | "integer" | "currency_cents" | "percent";

export interface OnDemandReportColumn {
  key: string;
  label: string;
  kind: OnDemandColumnKind;
}

export interface OnDemandReportResult {
  category: OnDemandReportCategory;
  title: string;
  description: string;
  columns: OnDemandReportColumn[];
  rows: Array<Record<string, OnDemandValue>>;
}

export type AdminRevenueSummaryInput = ReportDateRange;

export interface AdminRevenueSummaryResult {
  from: string;
  to: string;
  programRateSource: string;
  activeMemberCount: number;
  scheduledMemberDays: number;
  presentMemberDays: number;
  absentMemberDays: number;
  attendanceRatePercent: number | null;
  projectedProgramRevenueCents: number;
  billedProgramRevenueCents: number;
  ancillaryTotalCents: number;
  transportationAncillaryTotalCents: number;
  transportationAncillaryCount: number;
  latePickupTotalCents: number;
  latePickupCount: number;
  totalBilledRevenueCents: number;
  varianceToProjectedCents: number;
}

export function resolveOnDemandReportCategory(value: string | null | undefined): OnDemandReportCategory {
  const normalized = String(value ?? "").trim().toLowerCase();
  const match = ON_DEMAND_REPORT_CATEGORIES.find((option) => option.value === normalized);
  return match?.value ?? "billing-revenue";
}

export async function getAdminRevenueSummary(input: AdminRevenueSummaryInput): Promise<AdminRevenueSummaryResult> {
  // TODO(schema): Replace with SQL-backed aggregates (member_attendance_schedules, attendance_records, ancillary_charge_logs).
  const programRateSource = "Supabase aggregate pending (requires reporting views)";
  return {
    from: input.from,
    to: input.to,
    programRateSource,
    activeMemberCount: 0,
    scheduledMemberDays: 0,
    presentMemberDays: 0,
    absentMemberDays: 0,
    attendanceRatePercent: null,
    projectedProgramRevenueCents: 0,
    billedProgramRevenueCents: 0,
    ancillaryTotalCents: 0,
    transportationAncillaryTotalCents: 0,
    transportationAncillaryCount: 0,
    latePickupTotalCents: 0,
    latePickupCount: 0,
    totalBilledRevenueCents: 0,
    varianceToProjectedCents: 0
  };
}

export async function getOnDemandReportData(input: {
  category: OnDemandReportCategory;
  range: ReportDateRange;
}): Promise<OnDemandReportResult> {
  // TODO(schema): Add a materialized reporting view per category and wire this selector to those views.
  return {
    category: input.category,
    title: `On-Demand ${ON_DEMAND_REPORT_CATEGORIES.find((c) => c.value === input.category)?.label ?? "Report"}`,
    description: `No rows available for ${input.range.from} to ${input.range.to}.`,
    columns: [],
    rows: []
  };
}

export function formatOnDemandCellValue(
  value: OnDemandValue,
  kind: OnDemandColumnKind
) {
  if (value == null) return "-";
  if (kind === "currency_cents") return `$${(Number(value) / 100).toFixed(2)}`;
  if (kind === "percent") return `${Number(value).toFixed(1)}%`;
  if (kind === "integer") return `${Math.round(Number(value))}`;
  return String(value);
}

function escapeCsv(value: string | number | null | undefined) {
  const stringValue = String(value ?? "");
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

export function buildOnDemandReportCsv(report: OnDemandReportResult) {
  const lines: string[] = [];
  lines.push(report.columns.map((column) => escapeCsv(column.label)).join(","));
  report.rows.forEach((row) => {
    lines.push(
      report.columns
        .map((column) => escapeCsv(formatOnDemandCellValue(row[column.key] ?? null, column.kind)))
        .join(",")
    );
  });
  return lines.join("\n");
}

export const ATTENDANCE_SUMMARY_BILLING_MODE_OPTIONS = [
  { value: "All", label: "All" },
  { value: "Membership", label: "Membership" },
  { value: "Monthly", label: "Monthly" },
  { value: "Custom", label: "Custom" }
] as const;

export const ATTENDANCE_SUMMARY_MEMBER_STATUS_OPTIONS = [
  { value: "ActiveOnly", label: "Active only" },
  { value: "InactiveOnly", label: "Inactive only" },
  { value: "All", label: "All" }
] as const;

export const ATTENDANCE_SUMMARY_REVENUE_BASIS_OPTIONS = [
  { value: "FinalizedRevenue", label: "Finalized Revenue" },
  { value: "ProjectedRevenue", label: "Projected Revenue" }
] as const;

export type AttendanceSummaryBillingModeFilter =
  (typeof ATTENDANCE_SUMMARY_BILLING_MODE_OPTIONS)[number]["value"];
export type AttendanceSummaryMemberStatusFilter =
  (typeof ATTENDANCE_SUMMARY_MEMBER_STATUS_OPTIONS)[number]["value"];
export type AttendanceSummaryRevenueBasis =
  (typeof ATTENDANCE_SUMMARY_REVENUE_BASIS_OPTIONS)[number]["value"] | "ProjectedRevenueFallback";
export type AttendanceSummaryAttendanceBasis = "ActualAttendance";

export interface AttendanceSummaryInput extends ReportDateRange {
  location: string | null;
  billingMode: AttendanceSummaryBillingModeFilter;
  memberStatus: AttendanceSummaryMemberStatusFilter;
  attendanceBasis: AttendanceSummaryAttendanceBasis;
  revenueBasis: AttendanceSummaryRevenueBasis;
  includeCustomInvoices: boolean;
  countBillableOverrideAsOpen: boolean;
}

export interface AttendanceSummaryRow {
  location: string;
  capacity: number;
  percentCapacity: number | null;
  totalEnrolled: number;
  avgDailyAttendance: number;
  avgDailyAttendancePerParticipant: number;
  totalMemberDays: number;
  averageRevenuePerMember: number;
  totalRevenue: number;
}

export interface AttendanceSummaryResult {
  filters: AttendanceSummaryInput;
  availableLocations: string[];
  openCenterDayCount: number;
  rows: AttendanceSummaryRow[];
  totals: AttendanceSummaryRow;
  revenueModeApplied: AttendanceSummaryRevenueBasis;
  summaryCards: {
    totalEnrolled: number;
    avgDailyAttendance: number;
    totalMemberDays: number;
    avgRevenuePerMember: number;
    percentCapacity: number | null;
  };
}

const ATTENDANCE_SUMMARY_DEFAULT_CAPACITY = 45;

function normalizeDateOnlyForAttendanceSummary(value: string | null | undefined, fallback: string) {
  const dateOnly = String(value ?? "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(dateOnly) ? dateOnly : fallback;
}

function parseBooleanFilter(value: string | null | undefined, fallback: boolean) {
  if (value == null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes") return true;
  if (normalized === "0" || normalized === "false" || normalized === "no") return false;
  return fallback;
}

function getDefaultAttendanceSummaryRange(): ReportDateRange {
  const today = toEasternDate();
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

export function resolveAttendanceSummaryInput(
  raw: Partial<Record<string, string | null | undefined>>
): AttendanceSummaryInput {
  const defaults = getDefaultAttendanceSummaryRange();
  const from = normalizeDateOnlyForAttendanceSummary(raw.from, defaults.from);
  const to = normalizeDateOnlyForAttendanceSummary(raw.to, defaults.to);
  const normalizedRange = from <= to ? { from, to } : { from: to, to: from };
  const billingMode = ATTENDANCE_SUMMARY_BILLING_MODE_OPTIONS.some((option) => option.value === raw.billingMode)
    ? (raw.billingMode as AttendanceSummaryBillingModeFilter)
    : "All";
  const memberStatus = ATTENDANCE_SUMMARY_MEMBER_STATUS_OPTIONS.some((option) => option.value === raw.memberStatus)
    ? (raw.memberStatus as AttendanceSummaryMemberStatusFilter)
    : "ActiveOnly";
  const revenueBasis = ATTENDANCE_SUMMARY_REVENUE_BASIS_OPTIONS.some((option) => option.value === raw.revenueBasis)
    ? (raw.revenueBasis as AttendanceSummaryRevenueBasis)
    : "FinalizedRevenue";
  return {
    from: normalizedRange.from,
    to: normalizedRange.to,
    location: raw.location ? String(raw.location).trim() || null : null,
    billingMode,
    memberStatus,
    attendanceBasis: "ActualAttendance",
    revenueBasis,
    includeCustomInvoices: parseBooleanFilter(raw.includeCustomInvoices, true),
    countBillableOverrideAsOpen: parseBooleanFilter(raw.countBillableOverrideAsOpen, true)
  };
}

export async function getAttendanceSummaryReport(input: AttendanceSummaryInput): Promise<AttendanceSummaryResult> {
  // TODO(schema): Requires finalized reporting views for attendance, member census, and invoice revenue.
  const emptyRow: AttendanceSummaryRow = {
    location: "Totals",
    capacity: ATTENDANCE_SUMMARY_DEFAULT_CAPACITY,
    percentCapacity: null,
    totalEnrolled: 0,
    avgDailyAttendance: 0,
    avgDailyAttendancePerParticipant: 0,
    totalMemberDays: 0,
    averageRevenuePerMember: 0,
    totalRevenue: 0
  };

  return {
    filters: input,
    availableLocations: [],
    openCenterDayCount: 0,
    rows: [],
    totals: emptyRow,
    revenueModeApplied: input.revenueBasis,
    summaryCards: {
      totalEnrolled: 0,
      avgDailyAttendance: 0,
      totalMemberDays: 0,
      avgRevenuePerMember: 0,
      percentCapacity: null
    }
  };
}

function formatAttendanceSummaryPercent(value: number | null) {
  return value == null ? "-" : `${value.toFixed(1)}%`;
}

function formatAttendanceSummaryCurrency(value: number) {
  return `$${value.toFixed(2)}`;
}

export function buildAttendanceSummaryCsv(report: AttendanceSummaryResult) {
  const lines: string[] = [];
  lines.push(
    [
      "Location",
      "Capacity",
      "PercentCapacity",
      "TotalEnrolled",
      "AvgDailyAttendance",
      "AvgDailyAttendancePerParticipant",
      "TotalMemberDays",
      "AverageRevenuePerMember"
    ].join(",")
  );

  const serializeRow = (row: AttendanceSummaryRow) =>
    [
      escapeCsv(row.location),
      String(row.capacity),
      escapeCsv(formatAttendanceSummaryPercent(row.percentCapacity)),
      String(row.totalEnrolled),
      row.avgDailyAttendance.toFixed(2),
      row.avgDailyAttendancePerParticipant.toFixed(2),
      String(row.totalMemberDays),
      escapeCsv(formatAttendanceSummaryCurrency(row.averageRevenuePerMember))
    ].join(",");

  report.rows.forEach((row) => lines.push(serializeRow(row)));
  lines.push(serializeRow(report.totals));
  return lines.join("\n");
}
