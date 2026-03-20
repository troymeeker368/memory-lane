import type { ReportDateRange } from "@/lib/services/report-date-range";
import { loadExpectedAttendanceSupabaseContext } from "@/lib/services/expected-attendance-supabase";
import { calculateAttendanceRatePercent } from "@/lib/services/attendance-rate";
import {
  ATTENDANCE_SUMMARY_DEFAULT_CAPACITY,
  ON_DEMAND_REPORT_CATEGORIES,
  buildAttendanceFacts,
  countOpenCenterDays,
  normalizeDateOnly,
  resolveBillingModeForDate,
  resolveDailyRateForDate,
  toAmount,
  toCents,
  type AdminRevenueSummaryInput,
  type AdminRevenueSummaryResult,
  type AttendanceSummaryInput,
  type AttendanceSummaryResult,
  type AttendanceSummaryRevenueBasis,
  type AttendanceSummaryRow,
  type OnDemandReportCategory,
  type OnDemandReportResult,
  type ReportingAttendanceRow,
  type ReportingAttendanceBillingRateRow,
  type ReportingCenterBillingSettingRow,
  type ReportingClosureRow,
  type ReportingLocationRow,
  type ReportingMemberBillingSettingRow,
  type ReportingMemberRow
} from "@/lib/services/admin-reporting-core";
import { buildLeadStageOutcomeSummaryRows } from "@/lib/services/sales-workflows";
import { createClient } from "@/lib/supabase/server";
import { toEasternDate } from "@/lib/timezone";

export {
  ATTENDANCE_SUMMARY_BILLING_MODE_OPTIONS,
  ATTENDANCE_SUMMARY_MEMBER_STATUS_OPTIONS,
  ATTENDANCE_SUMMARY_REVENUE_BASIS_OPTIONS,
  ON_DEMAND_REPORT_CATEGORIES,
  buildAttendanceSummaryCsv,
  buildOnDemandReportCsv,
  formatOnDemandCellValue,
  resolveAttendanceSummaryInput,
  resolveOnDemandReportCategory
} from "@/lib/services/admin-reporting-core";
export type {
  AdminRevenueSummaryInput,
  AdminRevenueSummaryResult,
  AttendanceSummaryInput,
  AttendanceSummaryResult,
  AttendanceSummaryRevenueBasis,
  AttendanceSummaryRow,
  OnDemandColumnKind,
  OnDemandReportCategory,
  OnDemandReportResult,
  OnDemandValue
} from "@/lib/services/admin-reporting-core";

const MEMBER_DOCUMENTATION_REPORT_RPC = "rpc_get_member_documentation_summary";

function relationDisplayName(
  value: { display_name?: string | null } | Array<{ display_name?: string | null }> | null | undefined
) {
  if (Array.isArray(value)) return value[0]?.display_name ?? "Unknown Member";
  return value?.display_name ?? "Unknown Member";
}

type MemberDocumentationSummaryRow = {
  member_id: string;
  member_name: string | null;
  participation_count: number | null;
  toileting_count: number | null;
  shower_count: number | null;
  transportation_count: number | null;
};

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


async function loadBillingSettingsForMembers(memberIds: string[]) {
  const supabase = await createClient();
  const [memberSettingsResult, centerSettingsResult, attendanceSettingsResult] = await Promise.all([
    memberIds.length > 0
      ? supabase
          .from("member_billing_settings")
          .select("member_id, active, use_center_default_billing_mode, billing_mode, use_center_default_rate, custom_daily_rate, effective_start_date, effective_end_date")
          .in("member_id", memberIds)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("center_billing_settings")
      .select("active, default_daily_rate, default_extra_day_rate, default_billing_mode, effective_start_date, effective_end_date"),
    memberIds.length > 0
      ? supabase
          .from("member_attendance_schedules")
          .select("member_id, daily_rate, custom_daily_rate, default_daily_rate")
          .in("member_id", memberIds)
      : Promise.resolve({ data: [], error: null })
  ]);
  if (memberSettingsResult.error) throw new Error(memberSettingsResult.error.message);
  if (centerSettingsResult.error) throw new Error(centerSettingsResult.error.message);
  if (attendanceSettingsResult.error) throw new Error(attendanceSettingsResult.error.message);
  const memberSettingsByMember = new Map<string, ReportingMemberBillingSettingRow[]>();
  ((memberSettingsResult.data ?? []) as ReportingMemberBillingSettingRow[]).forEach((row) => {
    const existing = memberSettingsByMember.get(row.member_id) ?? [];
    existing.push(row);
    memberSettingsByMember.set(row.member_id, existing);
  });
  const attendanceSettingsByMember = new Map<string, ReportingAttendanceBillingRateRow>();
  ((attendanceSettingsResult.data ?? []) as ReportingAttendanceBillingRateRow[]).forEach((row) => {
    attendanceSettingsByMember.set(row.member_id, row);
  });
  return {
    memberSettingsByMember,
    attendanceSettingsByMember,
    centerSettings: (centerSettingsResult.data ?? []) as ReportingCenterBillingSettingRow[]
  };
}

async function loadMemberDocumentationSummary(range: ReportDateRange) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(MEMBER_DOCUMENTATION_REPORT_RPC, {
    p_start_date: range.from,
    p_end_date: range.to
  });
  if (error) {
    if (error.message.includes(MEMBER_DOCUMENTATION_REPORT_RPC)) {
      throw new Error(
        "Member documentation summary RPC is not available. Apply Supabase migration 0094_admin_reporting_and_mar_read_hardening.sql and refresh the PostgREST schema cache."
      );
    }
    throw new Error(error.message);
  }
  return (data ?? []) as MemberDocumentationSummaryRow[];
}

async function loadFinalizedRevenueByMember(input: {
  memberIds: string[];
  range: ReportDateRange;
  includeCustomInvoices: boolean;
}) {
  const revenueByMember = new Map<string, number>();
  if (input.memberIds.length === 0) {
    return revenueByMember;
  }

  const supabase = await createClient();
  let query = supabase
    .from("billing_invoices")
    .select("member_id, total_amount, invoice_status, invoice_source")
    .in("member_id", input.memberIds)
    .gte("invoice_date", input.range.from)
    .lte("invoice_date", input.range.to);

  if (!input.includeCustomInvoices) {
    query = query.neq("invoice_source", "Custom");
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  (data ?? []).forEach((row) => {
    const memberId = String(row.member_id ?? "");
    if (!memberId) return;
    const invoiceStatus = String(row.invoice_status ?? "");
    if (invoiceStatus === "Draft" || invoiceStatus === "Void") return;
    const amount = Number(row.total_amount ?? 0);
    revenueByMember.set(memberId, toAmount((revenueByMember.get(memberId) ?? 0) + amount));
  });

  return revenueByMember;
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

  const { memberSettingsByMember, attendanceSettingsByMember, centerSettings } = await loadBillingSettingsForMembers(
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
      attendanceSettingsByMember,
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
  (ancillaryRows ?? []).forEach((row) => {
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

  const attendanceRatePercent = calculateAttendanceRatePercent({
    presentMemberDays,
    scheduledMemberDays
  });
  const totalBilledRevenueCents = billedProgramRevenueCents + ancillaryTotalCents;
  const varianceToProjectedCents =
    totalBilledRevenueCents - (projectedProgramRevenueCents + ancillaryTotalCents);

  return {
    from: normalizedRange.from,
    to: normalizedRange.to,
    programRateSource: "Attendance schedule rate override, then member billing setting, then center default daily rate",
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
      rows: (data ?? []).map((row) => ({
        invoiceDate: row.invoice_date ?? "",
        invoiceNumber: row.invoice_number ?? "",
        memberName: relationDisplayName(row.member),
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
      rows: (data ?? []).map((row) => ({
        serviceDate: row.service_date ?? "",
        memberName: relationDisplayName(row.member),
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
      rows: buildLeadStageOutcomeSummaryRows(data ?? []).map((row) => ({
        stage: row.stage,
        total: row.total,
        won: row.won,
        lost: row.lost
      }))
    };
  }

  const rows = await loadMemberDocumentationSummary(normalizedRange);

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
    rows: rows.map((row) => ({
      memberName: row.member_name ?? "Unknown Member",
      participation: Number(row.participation_count ?? 0),
      toileting: Number(row.toileting_count ?? 0),
      showers: Number(row.shower_count ?? 0),
      transportation: Number(row.transportation_count ?? 0)
      }))
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
  const { memberSettingsByMember, attendanceSettingsByMember, centerSettings } = await loadBillingSettingsForMembers(
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

  const availableLocations = Array.from(
    new Set(
      eligibleMembers.map((member) => attendanceDataset.memberLocationById.get(member.id) ?? "Unassigned")
    )
  ).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));

  if (input.location) {
    eligibleMembers = eligibleMembers.filter(
      (member) => (attendanceDataset.memberLocationById.get(member.id) ?? "Unassigned") === input.location
    );
  }

  const selectedMemberIds = new Set(eligibleMembers.map((member) => member.id));

  const attendanceFacts = buildAttendanceFacts({
    range: normalizedRange,
    members: eligibleMembers,
    memberLocationById: attendanceDataset.memberLocationById,
    attendanceRecordByMemberDate: attendanceDataset.attendanceRecordByMemberDate,
    expectedContext: attendanceDataset.expectedContext
  });

  const projectedRevenueByMember = new Map<string, number>();
  attendanceFacts.forEach((fact) => {
    if (!fact.present) return;
    const rate = resolveDailyRateForDate({
      memberId: fact.memberId,
      dateOnly: fact.date,
      memberSettingsByMember,
      attendanceSettingsByMember,
      centerSettings
    });
    projectedRevenueByMember.set(
      fact.memberId,
      toAmount((projectedRevenueByMember.get(fact.memberId) ?? 0) + rate)
    );
  });

  const revenueModeApplied: AttendanceSummaryRevenueBasis = input.revenueBasis;
  const finalizedRevenueByMember =
    input.revenueBasis === "FinalizedRevenue"
      ? await loadFinalizedRevenueByMember({
          memberIds: Array.from(selectedMemberIds),
          range: normalizedRange,
          includeCustomInvoices: input.includeCustomInvoices
        })
      : new Map<string, number>();

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
    const existing = memberIdsByLocation.get(location) ?? new Set<string>();
    existing.add(member.id);
    memberIdsByLocation.set(location, existing);
  });

  const presentMemberDaysByLocation = new Map<string, number>();
  attendanceFacts.forEach((row) => {
    if (!row.present) return;
    presentMemberDaysByLocation.set(row.location, (presentMemberDaysByLocation.get(row.location) ?? 0) + 1);
  });

  const rows: AttendanceSummaryRow[] = Array.from(memberIdsByLocation.entries())
    .map(([location, memberIds]) => {
      const totalMemberDays = presentMemberDaysByLocation.get(location) ?? 0;
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
