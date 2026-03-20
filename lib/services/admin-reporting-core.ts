import type { ReportDateRange } from "@/lib/services/report-date-range";
import {
  resolveActiveEffectiveMemberRowForDate,
  resolveActiveEffectiveRowForDate,
  resolveEffectiveDailyRate,
  resolveEffectiveBillingMode
} from "@/lib/services/billing-effective";
import { resolveExpectedAttendanceFromSupabaseContext } from "@/lib/services/expected-attendance-supabase";
import { getWeekdayForDate } from "@/lib/services/operations-calendar";
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

export type ReportingMemberRow = {
  id: string;
  display_name: string;
  status: "active" | "inactive";
};

export type ReportingLocationRow = {
  member_id: string;
  location: string | null;
};

export type ReportingAttendanceRow = {
  member_id: string;
  attendance_date: string;
  status: "present" | "absent";
};

export type ReportingClosureRow = {
  closure_date: string;
  active: boolean | null;
  billable_override: boolean | null;
};

export type ReportingMemberBillingSettingRow = {
  member_id: string;
  active: boolean;
  use_center_default_billing_mode: boolean;
  billing_mode: "Membership" | "Monthly" | "Custom" | null;
  use_center_default_rate: boolean;
  custom_daily_rate: number | null;
  effective_start_date: string;
  effective_end_date: string | null;
};

export type ReportingCenterBillingSettingRow = {
  active: boolean;
  default_daily_rate: number;
  default_extra_day_rate?: number | null;
  default_billing_mode: "Membership" | "Monthly";
  effective_start_date: string;
  effective_end_date: string | null;
};

export type ReportingAttendanceBillingRateRow = {
  member_id: string;
  daily_rate: number | null;
  custom_daily_rate: number | null;
  default_daily_rate: number | null;
};

export type ReportingAttendanceFact = {
  memberId: string;
  location: string;
  date: string;
  scheduled: boolean;
  present: boolean;
  absent: boolean;
};

export const ATTENDANCE_SUMMARY_DEFAULT_CAPACITY = 45;

export function resolveOnDemandReportCategory(value: string | null | undefined): OnDemandReportCategory {
  const normalized = String(value ?? "").trim().toLowerCase();
  const match = ON_DEMAND_REPORT_CATEGORIES.find((option) => option.value === normalized);
  return match?.value ?? "billing-revenue";
}

export function normalizeDateOnly(value: string | null | undefined, fallback: string) {
  const dateOnly = String(value ?? "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(dateOnly) ? dateOnly : fallback;
}

export function toAmount(value: number) {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : 0;
}

export function toCents(value: number) {
  return Math.round(toAmount(value) * 100);
}

export function listDatesInRange(range: ReportDateRange) {
  const start = new Date(`${range.from}T00:00:00.000Z`);
  const end = new Date(`${range.to}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [] as string[];
  const out: string[] = [];
  const cursor = new Date(start.getTime());
  while (cursor <= end) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

export function resolveBillingModeForDate(input: {
  memberId: string;
  dateOnly: string;
  memberSettingsByMember: Map<string, ReportingMemberBillingSettingRow[]>;
  centerSettings: ReportingCenterBillingSettingRow[];
}) {
  const memberSetting = resolveActiveEffectiveMemberRowForDate(
    input.memberId,
    input.dateOnly,
    input.memberSettingsByMember.get(input.memberId) ?? []
  );
  const centerSetting = resolveActiveEffectiveRowForDate(input.dateOnly, input.centerSettings);
  return resolveEffectiveBillingMode({ memberSetting, centerSetting });
}

export function resolveDailyRateForDate(input: {
  memberId: string;
  dateOnly: string;
  memberSettingsByMember: Map<string, ReportingMemberBillingSettingRow[]>;
  centerSettings: ReportingCenterBillingSettingRow[];
  attendanceSettingsByMember: Map<string, ReportingAttendanceBillingRateRow>;
}) {
  const memberSetting = resolveActiveEffectiveMemberRowForDate(
    input.memberId,
    input.dateOnly,
    input.memberSettingsByMember.get(input.memberId) ?? []
  );
  const centerSetting = resolveActiveEffectiveRowForDate(input.dateOnly, input.centerSettings);
  const attendanceSetting = input.attendanceSettingsByMember.get(input.memberId) ?? null;
  return resolveEffectiveDailyRate({ attendanceSetting, memberSetting, centerSetting });
}

export function buildAttendanceFacts(input: {
  range: ReportDateRange;
  members: ReportingMemberRow[];
  memberLocationById: Map<string, string>;
  attendanceRecordByMemberDate: Map<string, "present" | "absent">;
  expectedContext: Awaited<ReturnType<typeof import("@/lib/services/expected-attendance-supabase").loadExpectedAttendanceSupabaseContext>>;
}) {
  const days = listDatesInRange(input.range);
  const facts: ReportingAttendanceFact[] = [];
  input.members.forEach((member) => {
    days.forEach((date) => {
      const status = input.attendanceRecordByMemberDate.get(`${member.id}:${date}`) ?? null;
      const resolution = resolveExpectedAttendanceFromSupabaseContext({
        context: input.expectedContext,
        memberId: member.id,
        date,
        hasUnscheduledAttendanceAddition: Boolean(status)
      });
      const scheduled = resolution.isScheduled;
      facts.push({
        memberId: member.id,
        location: input.memberLocationById.get(member.id) ?? "Unassigned",
        date,
        scheduled,
        present: scheduled && status === "present",
        absent: scheduled && status === "absent"
      });
    });
  });
  return facts;
}

export function countOpenCenterDays(input: {
  range: ReportDateRange;
  closureByDate: Map<string, ReportingClosureRow>;
  countBillableOverrideAsOpen: boolean;
}) {
  return listDatesInRange(input.range).filter((date) => {
    const weekday = getWeekdayForDate(date);
    if (weekday === "saturday" || weekday === "sunday") return false;
    const closure = input.closureByDate.get(date);
    if (!closure) return true;
    const active = closure.active == null ? true : Boolean(closure.active);
    if (!active) return true;
    if (input.countBillableOverrideAsOpen && Boolean(closure.billable_override)) return true;
    return false;
  }).length;
}

export function formatOnDemandCellValue(value: OnDemandValue, kind: OnDemandColumnKind) {
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
  (typeof ATTENDANCE_SUMMARY_REVENUE_BASIS_OPTIONS)[number]["value"];
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
  const from = normalizeDateOnly(raw.from, defaults.from);
  const to = normalizeDateOnly(raw.to, defaults.to);
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
