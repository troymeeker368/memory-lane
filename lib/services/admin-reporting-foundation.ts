import type { ReportDateRange } from "@/lib/services/report-date-range";
import { canonicalLeadStage, canonicalLeadStatus } from "@/lib/canonical";
import {
  loadExpectedAttendanceSupabaseContext,
  resolveExpectedAttendanceFromSupabaseContext
} from "@/lib/services/expected-attendance-supabase";
import { getWeekdayForDate } from "@/lib/services/operations-calendar";
import { createClient } from "@/lib/supabase/server";
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

type ReportingMemberRow = {
  id: string;
  display_name: string;
  status: "active" | "inactive";
};

type ReportingLocationRow = {
  member_id: string;
  location: string | null;
};

type ReportingAttendanceRow = {
  member_id: string;
  attendance_date: string;
  status: "present" | "absent";
};

type ReportingClosureRow = {
  closure_date: string;
  active: boolean | null;
  billable_override: boolean | null;
};

type ReportingMemberBillingSettingRow = {
  member_id: string;
  active: boolean;
  use_center_default_billing_mode: boolean;
  billing_mode: "Membership" | "Monthly" | "Custom" | null;
  use_center_default_rate: boolean;
  custom_daily_rate: number | null;
  effective_start_date: string;
  effective_end_date: string | null;
};

type ReportingCenterBillingSettingRow = {
  active: boolean;
  default_daily_rate: number;
  default_billing_mode: "Membership" | "Monthly";
  effective_start_date: string;
  effective_end_date: string | null;
};

type ReportingAttendanceFact = {
  memberId: string;
  location: string;
  date: string;
  scheduled: boolean;
  present: boolean;
  absent: boolean;
};

const ATTENDANCE_SUMMARY_DEFAULT_CAPACITY = 45;

function normalizeDateOnly(value: string | null | undefined, fallback: string) {
  const dateOnly = String(value ?? "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(dateOnly) ? dateOnly : fallback;
}

function toAmount(value: number) {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : 0;
}

function toCents(value: number) {
  return Math.round(toAmount(value) * 100);
}

function listDatesInRange(range: ReportDateRange) {
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

function isDateWithinRange(date: string, start: string, end: string | null) {
  if (date < start) return false;
  if (end && date > end) return false;
  return true;
}

function resolveApplicableCenterSetting(
  dateOnly: string,
  centerSettings: ReportingCenterBillingSettingRow[]
) {
  const sorted = [...centerSettings].sort((left, right) =>
    left.effective_start_date < right.effective_start_date ? 1 : -1
  );
  return (
    sorted.find((row) =>
      row.active &&
      isDateWithinRange(dateOnly, row.effective_start_date, row.effective_end_date)
    ) ?? null
  );
}

function resolveApplicableMemberSetting(
  memberId: string,
  dateOnly: string,
  memberSettingsByMember: Map<string, ReportingMemberBillingSettingRow[]>
) {
  const settings = memberSettingsByMember.get(memberId) ?? [];
  const sorted = [...settings].sort((left, right) =>
    left.effective_start_date < right.effective_start_date ? 1 : -1
  );
  return (
    sorted.find((row) =>
      row.active &&
      isDateWithinRange(dateOnly, row.effective_start_date, row.effective_end_date)
    ) ?? null
  );
}

function resolveBillingModeForDate(input: {
  memberId: string;
  dateOnly: string;
  memberSettingsByMember: Map<string, ReportingMemberBillingSettingRow[]>;
  centerSettings: ReportingCenterBillingSettingRow[];
}) {
  const memberSetting = resolveApplicableMemberSetting(
    input.memberId,
    input.dateOnly,
    input.memberSettingsByMember
  );
  if (memberSetting && !memberSetting.use_center_default_billing_mode && memberSetting.billing_mode) {
    return memberSetting.billing_mode;
  }
  const centerSetting = resolveApplicableCenterSetting(input.dateOnly, input.centerSettings);
  return centerSetting?.default_billing_mode ?? "Membership";
}

function resolveDailyRateForDate(input: {
  memberId: string;
  dateOnly: string;
  memberSettingsByMember: Map<string, ReportingMemberBillingSettingRow[]>;
  centerSettings: ReportingCenterBillingSettingRow[];
}) {
  const memberSetting = resolveApplicableMemberSetting(
    input.memberId,
    input.dateOnly,
    input.memberSettingsByMember
  );
  const centerSetting = resolveApplicableCenterSetting(input.dateOnly, input.centerSettings);
  const centerRate = Number(centerSetting?.default_daily_rate ?? 0);
  if (memberSetting && !memberSetting.use_center_default_rate && Number(memberSetting.custom_daily_rate ?? 0) > 0) {
    return Number(memberSetting.custom_daily_rate ?? 0);
  }
  return centerRate;
}

async function loadAttendanceDataset(input: {
  range: ReportDateRange;
  memberStatus: "active" | "inactive" | "all";
}) {
  const supabase = await createClient();
  let memberQuery = supabase
    .from("members")
    .select("id, display_name, status")
    .order("display_name", { ascending: true });
  if (input.memberStatus !== "all") {
    memberQuery = memberQuery.eq("status", input.memberStatus);
  }
  const { data: membersData, error: membersError } = await memberQuery;
  if (membersError) throw new Error(membersError.message);
  const members = (membersData ?? []) as ReportingMemberRow[];
  const memberIds = members.map((row) => row.id);
  if (memberIds.length === 0) {
    return {
      members,
      memberLocationById: new Map<string, string>(),
      attendanceRecordByMemberDate: new Map<string, "present" | "absent">(),
      closureByDate: new Map<string, ReportingClosureRow>(),
      expectedContext: await loadExpectedAttendanceSupabaseContext({
        memberIds: [],
        startDate: input.range.from,
        endDate: input.range.to,
        includeAttendanceRecords: false
      })
    };
  }

  const [locationsResult, attendanceResult, closureResult, expectedContext] = await Promise.all([
    supabase.from("member_command_centers").select("member_id, location").in("member_id", memberIds),
    supabase
      .from("attendance_records")
      .select("member_id, attendance_date, status")
      .in("member_id", memberIds)
      .gte("attendance_date", input.range.from)
      .lte("attendance_date", input.range.to),
    supabase
      .from("center_closures")
      .select("closure_date, active, billable_override")
      .gte("closure_date", input.range.from)
      .lte("closure_date", input.range.to),
    loadExpectedAttendanceSupabaseContext({
      memberIds,
      startDate: input.range.from,
      endDate: input.range.to,
      includeAttendanceRecords: false
    })
  ]);
  if (locationsResult.error) throw new Error(locationsResult.error.message);
  if (attendanceResult.error) throw new Error(attendanceResult.error.message);
  if (closureResult.error) throw new Error(closureResult.error.message);

  const memberLocationById = new Map<string, string>();
  ((locationsResult.data ?? []) as ReportingLocationRow[]).forEach((row) => {
    memberLocationById.set(
      row.member_id,
      String(row.location ?? "").trim() || "Unassigned"
    );
  });
  members.forEach((member) => {
    if (!memberLocationById.has(member.id)) {
      memberLocationById.set(member.id, "Unassigned");
    }
  });

  const attendanceRecordByMemberDate = new Map<string, "present" | "absent">();
  ((attendanceResult.data ?? []) as ReportingAttendanceRow[]).forEach((row) => {
    attendanceRecordByMemberDate.set(
      `${row.member_id}:${row.attendance_date}`,
      row.status
    );
  });

  const closureByDate = new Map<string, ReportingClosureRow>();
  ((closureResult.data ?? []) as ReportingClosureRow[]).forEach((row) => {
    closureByDate.set(row.closure_date, row);
  });

  return {
    members,
    memberLocationById,
    attendanceRecordByMemberDate,
    closureByDate,
    expectedContext
  };
}

function buildAttendanceFacts(input: {
  range: ReportDateRange;
  members: ReportingMemberRow[];
  memberLocationById: Map<string, string>;
  attendanceRecordByMemberDate: Map<string, "present" | "absent">;
  expectedContext: Awaited<ReturnType<typeof loadExpectedAttendanceSupabaseContext>>;
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

function countOpenCenterDays(input: {
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

async function loadBillingSettingsForMembers(memberIds: string[]) {
  const supabase = await createClient();
  const [memberSettingsResult, centerSettingsResult] = await Promise.all([
    memberIds.length > 0
      ? supabase
          .from("member_billing_settings")
          .select("member_id, active, use_center_default_billing_mode, billing_mode, use_center_default_rate, custom_daily_rate, effective_start_date, effective_end_date")
          .in("member_id", memberIds)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("center_billing_settings")
      .select("active, default_daily_rate, default_billing_mode, effective_start_date, effective_end_date")
  ]);
  if (memberSettingsResult.error) throw new Error(memberSettingsResult.error.message);
  if (centerSettingsResult.error) throw new Error(centerSettingsResult.error.message);
  const memberSettingsByMember = new Map<string, ReportingMemberBillingSettingRow[]>();
  ((memberSettingsResult.data ?? []) as ReportingMemberBillingSettingRow[]).forEach((row) => {
    const existing = memberSettingsByMember.get(row.member_id) ?? [];
    existing.push(row);
    memberSettingsByMember.set(row.member_id, existing);
  });
  return {
    memberSettingsByMember,
    centerSettings: (centerSettingsResult.data ?? []) as ReportingCenterBillingSettingRow[]
  };
}

export async function getAdminRevenueSummary(input: AdminRevenueSummaryInput): Promise<AdminRevenueSummaryResult> {
  const range = {
    from: normalizeDateOnly(input.from, toEasternDate()),
    to: normalizeDateOnly(input.to, toEasternDate())
  };
  const normalizedRange = range.from <= range.to ? range : { from: range.to, to: range.from };
  const attendanceDataset = await loadAttendanceDataset({
    range: normalizedRange,
    memberStatus: "active"
  });
  const attendanceFacts = buildAttendanceFacts({
    range: normalizedRange,
    members: attendanceDataset.members,
    memberLocationById: attendanceDataset.memberLocationById,
    attendanceRecordByMemberDate: attendanceDataset.attendanceRecordByMemberDate,
    expectedContext: attendanceDataset.expectedContext
  });
  const scheduledMemberDays = attendanceFacts.filter((row) => row.scheduled).length;
  const presentMemberDays = attendanceFacts.filter((row) => row.present).length;
  const absentMemberDays = Math.max(scheduledMemberDays - presentMemberDays, 0);

  const { memberSettingsByMember, centerSettings } = await loadBillingSettingsForMembers(
    attendanceDataset.members.map((row) => row.id)
  );
  let projectedProgramRevenueCents = 0;
  let billedProgramRevenueCents = 0;
  attendanceFacts.forEach((fact) => {
    if (!fact.scheduled) return;
    const rate = resolveDailyRateForDate({
      memberId: fact.memberId,
      dateOnly: fact.date,
      memberSettingsByMember,
      centerSettings
    });
    projectedProgramRevenueCents += toCents(rate);
    if (fact.present) {
      billedProgramRevenueCents += toCents(rate);
    }
  });

  const supabase = await createClient();
  const { data: ancillaryRows, error: ancillaryError } = await supabase
    .from("v_ancillary_charge_logs_detailed")
    .select("amount_cents, category_name, reconciliation_status, service_date")
    .gte("service_date", normalizedRange.from)
    .lte("service_date", normalizedRange.to);
  if (ancillaryError) throw new Error(ancillaryError.message);

  let ancillaryTotalCents = 0;
  let transportationAncillaryTotalCents = 0;
  let transportationAncillaryCount = 0;
  let latePickupTotalCents = 0;
  let latePickupCount = 0;
  (ancillaryRows ?? []).forEach((row: any) => {
    const reconciliationStatus = String(row.reconciliation_status ?? "open").toLowerCase();
    if (reconciliationStatus === "void") return;
    const amountCents = Number(row.amount_cents ?? 0);
    ancillaryTotalCents += amountCents;
    const category = String(row.category_name ?? "").toLowerCase();
    if (category.includes("transport")) {
      transportationAncillaryTotalCents += amountCents;
      transportationAncillaryCount += 1;
    }
    if (category.includes("late pick")) {
      latePickupTotalCents += amountCents;
      latePickupCount += 1;
    }
  });

  const attendanceRatePercent =
    scheduledMemberDays > 0
      ? Number(((presentMemberDays / scheduledMemberDays) * 100).toFixed(1))
      : null;
  const totalBilledRevenueCents = billedProgramRevenueCents + ancillaryTotalCents;
  const varianceToProjectedCents =
    totalBilledRevenueCents - (projectedProgramRevenueCents + ancillaryTotalCents);

  return {
    from: normalizedRange.from,
    to: normalizedRange.to,
    programRateSource: "Member billing settings with center default daily rate fallback",
    activeMemberCount: attendanceDataset.members.length,
    scheduledMemberDays,
    presentMemberDays,
    absentMemberDays,
    attendanceRatePercent,
    projectedProgramRevenueCents,
    billedProgramRevenueCents,
    ancillaryTotalCents,
    transportationAncillaryTotalCents,
    transportationAncillaryCount,
    latePickupTotalCents,
    latePickupCount,
    totalBilledRevenueCents,
    varianceToProjectedCents
  };
}

export async function getOnDemandReportData(input: {
  category: OnDemandReportCategory;
  range: ReportDateRange;
}): Promise<OnDemandReportResult> {
  const range = {
    from: normalizeDateOnly(input.range.from, toEasternDate()),
    to: normalizeDateOnly(input.range.to, toEasternDate())
  };
  const normalizedRange = range.from <= range.to ? range : { from: range.to, to: range.from };
  const title = `On-Demand ${ON_DEMAND_REPORT_CATEGORIES.find((c) => c.value === input.category)?.label ?? "Report"}`;
  const supabase = await createClient();

  if (input.category === "attendance") {
    const report = await getAttendanceSummaryReport({
      from: normalizedRange.from,
      to: normalizedRange.to,
      location: null,
      billingMode: "All",
      memberStatus: "All",
      attendanceBasis: "ActualAttendance",
      revenueBasis: "ProjectedRevenue",
      includeCustomInvoices: true,
      countBillableOverrideAsOpen: true
    });
    return {
      category: input.category,
      title,
      description: `Attendance utilization by location for ${normalizedRange.from} to ${normalizedRange.to}.`,
      columns: [
        { key: "location", label: "Location", kind: "text" },
        { key: "totalEnrolled", label: "Total Enrolled", kind: "integer" },
        { key: "avgDailyAttendance", label: "Avg Daily Attendance", kind: "integer" },
        { key: "totalMemberDays", label: "Total Member Days", kind: "integer" },
        { key: "averageRevenuePerMember", label: "Avg Revenue / Member", kind: "currency_cents" }
      ],
      rows: report.rows.map((row) => ({
        location: row.location,
        totalEnrolled: row.totalEnrolled,
        avgDailyAttendance: row.avgDailyAttendance,
        totalMemberDays: row.totalMemberDays,
        averageRevenuePerMember: toCents(row.averageRevenuePerMember)
      }))
    };
  }

  if (input.category === "billing-revenue") {
    const { data, error } = await supabase
      .from("billing_invoices")
      .select("invoice_number, member_id, invoice_date, invoice_status, invoice_source, total_amount, member:members!billing_invoices_member_id_fkey(display_name)")
      .gte("invoice_date", normalizedRange.from)
      .lte("invoice_date", normalizedRange.to)
      .order("invoice_date", { ascending: false });
    if (error) throw new Error(error.message);
    return {
      category: input.category,
      title,
      description: `Invoice-level revenue rows for ${normalizedRange.from} to ${normalizedRange.to}.`,
      columns: [
        { key: "invoiceDate", label: "Invoice Date", kind: "text" },
        { key: "invoiceNumber", label: "Invoice #", kind: "text" },
        { key: "memberName", label: "Member", kind: "text" },
        { key: "status", label: "Status", kind: "text" },
        { key: "source", label: "Source", kind: "text" },
        { key: "totalAmount", label: "Total Amount", kind: "currency_cents" }
      ],
      rows: (data ?? []).map((row: any) => ({
        invoiceDate: row.invoice_date ?? "",
        invoiceNumber: row.invoice_number ?? "",
        memberName: row.member?.display_name ?? "Unknown Member",
        status: row.invoice_status ?? "",
        source: row.invoice_source ?? "",
        totalAmount: toCents(Number(row.total_amount ?? 0))
      }))
    };
  }

  if (input.category === "transportation") {
    const { data, error } = await supabase
      .from("transportation_logs")
      .select("service_date, period, transport_type, member:members!transportation_logs_member_id_fkey(display_name), billing_status")
      .gte("service_date", normalizedRange.from)
      .lte("service_date", normalizedRange.to)
      .order("service_date", { ascending: false });
    if (error) throw new Error(error.message);
    return {
      category: input.category,
      title,
      description: `Transportation service log rows for ${normalizedRange.from} to ${normalizedRange.to}.`,
      columns: [
        { key: "serviceDate", label: "Service Date", kind: "text" },
        { key: "memberName", label: "Member", kind: "text" },
        { key: "period", label: "Period", kind: "text" },
        { key: "transportType", label: "Transport Type", kind: "text" },
        { key: "billingStatus", label: "Billing Status", kind: "text" }
      ],
      rows: (data ?? []).map((row: any) => ({
        serviceDate: row.service_date ?? "",
        memberName: row.member?.display_name ?? "Unknown Member",
        period: row.period ?? "",
        transportType: row.transport_type ?? "",
        billingStatus: row.billing_status ?? ""
      }))
    };
  }

  if (input.category === "leads-sales") {
    const { data, error } = await supabase
      .from("leads")
      .select("stage, status, created_at")
      .gte("created_at", `${normalizedRange.from}T00:00:00.000Z`)
      .lte("created_at", `${normalizedRange.to}T23:59:59.999Z`);
    if (error) throw new Error(error.message);
    const stageCounts = new Map<string, { total: number; won: number; lost: number }>();
    (data ?? []).forEach((row: any) => {
      const stage = canonicalLeadStage(String(row.stage ?? "Inquiry"));
      const status = canonicalLeadStatus(String(row.status ?? "Open"), stage).toLowerCase();
      const current = stageCounts.get(stage) ?? { total: 0, won: 0, lost: 0 };
      current.total += 1;
      if (status === "won") current.won += 1;
      if (status === "lost") current.lost += 1;
      stageCounts.set(stage, current);
    });
    return {
      category: input.category,
      title,
      description: `Lead stage funnel rows for ${normalizedRange.from} to ${normalizedRange.to}.`,
      columns: [
        { key: "stage", label: "Stage", kind: "text" },
        { key: "total", label: "Lead Count", kind: "integer" },
        { key: "won", label: "Won", kind: "integer" },
        { key: "lost", label: "Lost", kind: "integer" }
      ],
      rows: Array.from(stageCounts.entries())
        .map(([stage, counts]) => ({
          stage,
          total: counts.total,
          won: counts.won,
          lost: counts.lost
        }))
        .sort((left, right) => String(left.stage).localeCompare(String(right.stage)))
    };
  }

  const [dailyLogs, toiletLogs, showerLogs, transportLogs] = await Promise.all([
    supabase
      .from("daily_activity_logs")
      .select("member_id, members!daily_activity_logs_member_id_fkey(display_name), activity_date")
      .gte("activity_date", normalizedRange.from)
      .lte("activity_date", normalizedRange.to),
    supabase
      .from("toilet_logs")
      .select("member_id, members!toilet_logs_member_id_fkey(display_name), event_at")
      .gte("event_at", `${normalizedRange.from}T00:00:00.000Z`)
      .lte("event_at", `${normalizedRange.to}T23:59:59.999Z`),
    supabase
      .from("shower_logs")
      .select("member_id, members!shower_logs_member_id_fkey(display_name), event_at")
      .gte("event_at", `${normalizedRange.from}T00:00:00.000Z`)
      .lte("event_at", `${normalizedRange.to}T23:59:59.999Z`),
    supabase
      .from("transportation_logs")
      .select("member_id, members!transportation_logs_member_id_fkey(display_name), service_date")
      .gte("service_date", normalizedRange.from)
      .lte("service_date", normalizedRange.to)
  ]);
  if (dailyLogs.error) throw new Error(dailyLogs.error.message);
  if (toiletLogs.error) throw new Error(toiletLogs.error.message);
  if (showerLogs.error) throw new Error(showerLogs.error.message);
  if (transportLogs.error) throw new Error(transportLogs.error.message);

  const byMember = new Map<string, {
    memberName: string;
    participation: number;
    toileting: number;
    showers: number;
    transportation: number;
  }>();
  const seedMember = (memberId: string, memberName: string) => {
    const existing = byMember.get(memberId) ?? {
      memberName,
      participation: 0,
      toileting: 0,
      showers: 0,
      transportation: 0
    };
    byMember.set(memberId, existing);
    return existing;
  };
  (dailyLogs.data ?? []).forEach((row: any) => {
    seedMember(String(row.member_id), String(row.members?.display_name ?? "Unknown Member")).participation += 1;
  });
  (toiletLogs.data ?? []).forEach((row: any) => {
    seedMember(String(row.member_id), String(row.members?.display_name ?? "Unknown Member")).toileting += 1;
  });
  (showerLogs.data ?? []).forEach((row: any) => {
    seedMember(String(row.member_id), String(row.members?.display_name ?? "Unknown Member")).showers += 1;
  });
  (transportLogs.data ?? []).forEach((row: any) => {
    seedMember(String(row.member_id), String(row.members?.display_name ?? "Unknown Member")).transportation += 1;
  });

  return {
    category: input.category,
    title,
    description: `Documentation utilization rows for ${normalizedRange.from} to ${normalizedRange.to}.`,
    columns: [
      { key: "memberName", label: "Member", kind: "text" },
      { key: "participation", label: "Participation Logs", kind: "integer" },
      { key: "toileting", label: "Toilet Logs", kind: "integer" },
      { key: "showers", label: "Shower Logs", kind: "integer" },
      { key: "transportation", label: "Transportation Logs", kind: "integer" }
    ],
    rows: Array.from(byMember.values())
      .sort((left, right) => left.memberName.localeCompare(right.memberName))
      .map((row) => ({
        memberName: row.memberName,
        participation: row.participation,
        toileting: row.toileting,
        showers: row.showers,
        transportation: row.transportation
      }))
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

export async function getAttendanceSummaryReport(input: AttendanceSummaryInput): Promise<AttendanceSummaryResult> {
  const normalizedRange = input.from <= input.to
    ? { from: normalizeDateOnly(input.from, toEasternDate()), to: normalizeDateOnly(input.to, toEasternDate()) }
    : { from: normalizeDateOnly(input.to, toEasternDate()), to: normalizeDateOnly(input.from, toEasternDate()) };
  const memberStatusFilter =
    input.memberStatus === "ActiveOnly"
      ? "active"
      : input.memberStatus === "InactiveOnly"
        ? "inactive"
        : "all";

  const attendanceDataset = await loadAttendanceDataset({
    range: normalizedRange,
    memberStatus: memberStatusFilter
  });
  const { memberSettingsByMember, centerSettings } = await loadBillingSettingsForMembers(
    attendanceDataset.members.map((row) => row.id)
  );

  let eligibleMembers = [...attendanceDataset.members];
  if (input.billingMode !== "All") {
    eligibleMembers = eligibleMembers.filter((member) => {
      const mode = resolveBillingModeForDate({
        memberId: member.id,
        dateOnly: normalizedRange.to,
        memberSettingsByMember,
        centerSettings
      });
      return mode === input.billingMode;
    });
  }

  const selectedMemberIds = new Set(eligibleMembers.map((member) => member.id));
  const availableLocations = Array.from(
    new Set(
      eligibleMembers.map((member) => attendanceDataset.memberLocationById.get(member.id) ?? "Unassigned")
    )
  ).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));

  const attendanceFacts = buildAttendanceFacts({
    range: normalizedRange,
    members: eligibleMembers,
    memberLocationById: attendanceDataset.memberLocationById,
    attendanceRecordByMemberDate: attendanceDataset.attendanceRecordByMemberDate,
    expectedContext: attendanceDataset.expectedContext
  }).filter((row) => (input.location ? row.location === input.location : true));

  const projectedRevenueByMember = new Map<string, number>();
  attendanceFacts.forEach((fact) => {
    if (!fact.present) return;
    const rate = resolveDailyRateForDate({
      memberId: fact.memberId,
      dateOnly: fact.date,
      memberSettingsByMember,
      centerSettings
    });
    projectedRevenueByMember.set(
      fact.memberId,
      toAmount((projectedRevenueByMember.get(fact.memberId) ?? 0) + rate)
    );
  });

  let revenueModeApplied: AttendanceSummaryRevenueBasis = input.revenueBasis;
  const finalizedRevenueByMember = new Map<string, number>();
  if (input.revenueBasis === "FinalizedRevenue") {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("billing_invoices")
      .select("member_id, total_amount, invoice_status, invoice_source, invoice_date")
      .gte("invoice_date", normalizedRange.from)
      .lte("invoice_date", normalizedRange.to);
    if (error) throw new Error(error.message);
    (data ?? []).forEach((row: any) => {
      const memberId = String(row.member_id ?? "");
      if (!selectedMemberIds.has(memberId)) return;
      const invoiceStatus = String(row.invoice_status ?? "");
      if (invoiceStatus === "Draft" || invoiceStatus === "Void") return;
      if (!input.includeCustomInvoices && String(row.invoice_source ?? "") === "Custom") return;
      const amount = Number(row.total_amount ?? 0);
      finalizedRevenueByMember.set(
        memberId,
        toAmount((finalizedRevenueByMember.get(memberId) ?? 0) + amount)
      );
    });
  }

  const revenueByMember =
    revenueModeApplied === "FinalizedRevenue"
      ? finalizedRevenueByMember
      : projectedRevenueByMember;

  const openCenterDayCount = countOpenCenterDays({
    range: normalizedRange,
    closureByDate: attendanceDataset.closureByDate,
    countBillableOverrideAsOpen: input.countBillableOverrideAsOpen
  });

  const memberIdsByLocation = new Map<string, Set<string>>();
  eligibleMembers.forEach((member) => {
    const location = attendanceDataset.memberLocationById.get(member.id) ?? "Unassigned";
    if (input.location && location !== input.location) return;
    const existing = memberIdsByLocation.get(location) ?? new Set<string>();
    existing.add(member.id);
    memberIdsByLocation.set(location, existing);
  });

  const rows: AttendanceSummaryRow[] = Array.from(memberIdsByLocation.entries())
    .map(([location, memberIds]) => {
      const locationFacts = attendanceFacts.filter((row) => row.location === location);
      const totalMemberDays = locationFacts.filter((row) => row.present).length;
      const totalEnrolled = memberIds.size;
      const totalRevenue = toAmount(
        Array.from(memberIds).reduce((sum, memberId) => sum + (revenueByMember.get(memberId) ?? 0), 0)
      );
      const avgDailyAttendance = openCenterDayCount > 0 ? toAmount(totalMemberDays / openCenterDayCount) : 0;
      const avgDailyAttendancePerParticipant =
        totalEnrolled > 0 ? toAmount(totalMemberDays / totalEnrolled) : 0;
      const averageRevenuePerMember = totalEnrolled > 0 ? toAmount(totalRevenue / totalEnrolled) : 0;
      const capacity = ATTENDANCE_SUMMARY_DEFAULT_CAPACITY;
      return {
        location,
        capacity,
        percentCapacity: capacity > 0 && openCenterDayCount > 0 ? avgDailyAttendance / capacity : null,
        totalEnrolled,
        avgDailyAttendance,
        avgDailyAttendancePerParticipant,
        totalMemberDays,
        averageRevenuePerMember,
        totalRevenue
      } satisfies AttendanceSummaryRow;
    })
    .sort((left, right) => left.location.localeCompare(right.location, undefined, { sensitivity: "base" }));

  const totalsEnrolled = rows.reduce((sum, row) => sum + row.totalEnrolled, 0);
  const totalsMemberDays = rows.reduce((sum, row) => sum + row.totalMemberDays, 0);
  const totalsRevenue = toAmount(rows.reduce((sum, row) => sum + row.totalRevenue, 0));
  const totalCapacity = rows.length > 0
    ? rows.reduce((sum, row) => sum + row.capacity, 0)
    : ATTENDANCE_SUMMARY_DEFAULT_CAPACITY;
  const totalsAvgDailyAttendance = openCenterDayCount > 0 ? toAmount(totalsMemberDays / openCenterDayCount) : 0;
  const totals: AttendanceSummaryRow = {
    location: "Totals",
    capacity: totalCapacity,
    percentCapacity: totalCapacity > 0 && openCenterDayCount > 0 ? totalsAvgDailyAttendance / totalCapacity : null,
    totalEnrolled: totalsEnrolled,
    avgDailyAttendance: totalsAvgDailyAttendance,
    avgDailyAttendancePerParticipant: totalsEnrolled > 0 ? toAmount(totalsMemberDays / totalsEnrolled) : 0,
    totalMemberDays: totalsMemberDays,
    averageRevenuePerMember: totalsEnrolled > 0 ? toAmount(totalsRevenue / totalsEnrolled) : 0,
    totalRevenue: totalsRevenue
  };

  return {
    filters: {
      ...input,
      from: normalizedRange.from,
      to: normalizedRange.to
    },
    availableLocations,
    openCenterDayCount,
    rows,
    totals,
    revenueModeApplied,
    summaryCards: {
      totalEnrolled: totals.totalEnrolled,
      avgDailyAttendance: totals.avgDailyAttendance,
      totalMemberDays: totals.totalMemberDays,
      avgRevenuePerMember: totals.averageRevenuePerMember,
      percentCapacity: totals.percentCapacity
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
