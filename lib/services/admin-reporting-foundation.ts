import { canonicalLeadStatus } from "@/lib/canonical";
import { getMockDb } from "@/lib/mock-repo";
import { isMockMode } from "@/lib/runtime";
import type { ReportDateRange } from "@/lib/services/admin-reports";
import {
  getActiveCenterBillingSetting,
  getActiveMemberBillingSetting,
  getMemberAttendanceBillingSetting
} from "@/lib/services/billing";
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

interface BaseReportingContext {
  businessDays: string[];
  activeMembers: ReturnType<typeof getMockDb>["members"];
  scheduleByMemberId: Map<string, ReturnType<typeof getMockDb>["memberAttendanceSchedules"][number]>;
  attendanceByMemberId: Map<string, { present: number; absent: number }>;
  ancillaryByMemberId: Map<string, { totalCents: number; transportationCents: number; latePickupCents: number }>;
}

function normalizeDateOnly(value: string | null | undefined) {
  const dateOnly = String(value ?? "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(dateOnly) ? dateOnly : null;
}

function isDateWithinRange(dateOnly: string | null | undefined, range: ReportDateRange) {
  const normalized = normalizeDateOnly(dateOnly);
  if (!normalized) return false;
  return normalized >= range.from && normalized <= range.to;
}

function toDateOnlyFromTimestamp(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function buildBusinessDays(range: ReportDateRange) {
  const dates: string[] = [];
  let cursor = new Date(`${range.from}T00:00:00.000Z`);
  const end = new Date(`${range.to}T00:00:00.000Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime())) return dates;

  while (cursor <= end) {
    const weekday = cursor.getUTCDay();
    if (weekday >= 1 && weekday <= 5) {
      dates.push(cursor.toISOString().slice(0, 10));
    }
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  return dates;
}

function isScheduledOnDate(
  schedule: ReturnType<typeof getMockDb>["memberAttendanceSchedules"][number] | undefined,
  dateOnly: string
) {
  if (!schedule) return false;
  const day = new Date(`${dateOnly}T00:00:00.000Z`).getUTCDay();
  if (day === 1) return schedule.monday;
  if (day === 2) return schedule.tuesday;
  if (day === 3) return schedule.wednesday;
  if (day === 4) return schedule.thursday;
  if (day === 5) return schedule.friday;
  return false;
}

function isTransportationCategory(categoryName: string | null | undefined) {
  return String(categoryName ?? "").trim().toLowerCase().startsWith("transport -");
}

function isLatePickupCategory(categoryName: string | null | undefined, latePickupTime: string | null | undefined) {
  const name = String(categoryName ?? "").trim().toLowerCase();
  return name.startsWith("late pick-up") || Boolean(String(latePickupTime ?? "").trim());
}

function buildBaseReportingContext(range: ReportDateRange): BaseReportingContext {
  const db = getMockDb();
  const businessDays = buildBusinessDays(range);
  const activeMembers = db.members.filter((member) => member.status === "active");

  const scheduleByMemberId = new Map(
    db.memberAttendanceSchedules.map((schedule) => [schedule.member_id, schedule] as const)
  );

  const attendanceByMemberId = new Map<string, { present: number; absent: number }>();
  db.attendanceRecords
    .filter((record) => isDateWithinRange(record.attendance_date, range))
    .forEach((record) => {
      const current = attendanceByMemberId.get(record.member_id) ?? { present: 0, absent: 0 };
      if (record.status === "present") current.present += 1;
      if (record.status === "absent") current.absent += 1;
      attendanceByMemberId.set(record.member_id, current);
    });

  const ancillaryByMemberId = new Map<string, { totalCents: number; transportationCents: number; latePickupCents: number }>();
  db.ancillaryLogs
    .filter((row) => row.reconciliation_status !== "void")
    .filter((row) => isDateWithinRange(row.service_date, range))
    .forEach((row) => {
      const current = ancillaryByMemberId.get(row.member_id) ?? {
        totalCents: 0,
        transportationCents: 0,
        latePickupCents: 0
      };
      current.totalCents += row.amount_cents;
      if (isTransportationCategory(row.category_name)) current.transportationCents += row.amount_cents;
      if (isLatePickupCategory(row.category_name, row.late_pickup_time)) current.latePickupCents += row.amount_cents;
      ancillaryByMemberId.set(row.member_id, current);
    });

  return {
    businessDays,
    activeMembers,
    scheduleByMemberId,
    attendanceByMemberId,
    ancillaryByMemberId
  };
}

function toCentsFromDollars(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * 100);
}

export function resolveOnDemandReportCategory(value: string | null | undefined): OnDemandReportCategory {
  const normalized = String(value ?? "").trim().toLowerCase();
  const match = ON_DEMAND_REPORT_CATEGORIES.find((option) => option.value === normalized);
  return match?.value ?? "billing-revenue";
}

export async function getAdminRevenueSummary(input: AdminRevenueSummaryInput): Promise<AdminRevenueSummaryResult> {
  const programRateSource = "Member DailyRate from MCC Attendance (with active billing-setting fallback)";
  if (!isMockMode()) {
    // TODO(quickbooks): Replace derived values with ledger-backed values once QuickBooks sync is added.
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

  const db = getMockDb();
  const context = buildBaseReportingContext(input);
  const activeMemberIds = new Set(context.activeMembers.map((member) => member.id));

  let scheduledMemberDays = 0;
  let projectedProgramRevenueCents = 0;
  context.activeMembers.forEach((member) => {
    const schedule = context.scheduleByMemberId.get(member.id);
    if (!schedule) return;
    context.businessDays.forEach((dateOnly) => {
      if (!isScheduledOnDate(schedule, dateOnly)) return;
      scheduledMemberDays += 1;
      projectedProgramRevenueCents += toCentsFromDollars(resolveProjectedDailyRateForMember(member.id, dateOnly));
    });
  });

  let presentMemberDays = 0;
  let absentMemberDays = 0;
  context.attendanceByMemberId.forEach((row) => {
    presentMemberDays += row.present;
    absentMemberDays += row.absent;
  });
  const billedProgramRevenueCents = db.attendanceRecords
    .filter((row) => activeMemberIds.has(row.member_id))
    .filter((row) => row.status === "present")
    .filter((row) => isDateWithinRange(row.attendance_date, input))
    .reduce((sum, row) => {
      const dateOnly = normalizeDateOnly(row.attendance_date);
      if (!dateOnly) return sum;
      return sum + toCentsFromDollars(resolveProjectedDailyRateForMember(row.member_id, dateOnly));
    }, 0);

  const ancillaryRows = db.ancillaryLogs
    .filter((row) => row.reconciliation_status !== "void")
    .filter((row) => isDateWithinRange(row.service_date, input));
  const ancillaryTotalCents = ancillaryRows.reduce((sum, row) => sum + row.amount_cents, 0);
  const transportationAncillaryRows = ancillaryRows.filter((row) => isTransportationCategory(row.category_name));
  const latePickupRows = ancillaryRows.filter((row) => isLatePickupCategory(row.category_name, row.late_pickup_time));

  const totalBilledRevenueCents = billedProgramRevenueCents + ancillaryTotalCents;

  return {
    from: input.from,
    to: input.to,
    programRateSource,
    activeMemberCount: context.activeMembers.length,
    scheduledMemberDays,
    presentMemberDays,
    absentMemberDays,
    attendanceRatePercent:
      scheduledMemberDays > 0 ? Number(((presentMemberDays / scheduledMemberDays) * 100).toFixed(1)) : null,
    projectedProgramRevenueCents,
    billedProgramRevenueCents,
    ancillaryTotalCents,
    transportationAncillaryTotalCents: transportationAncillaryRows.reduce((sum, row) => sum + row.amount_cents, 0),
    transportationAncillaryCount: transportationAncillaryRows.length,
    latePickupTotalCents: latePickupRows.reduce((sum, row) => sum + row.amount_cents, 0),
    latePickupCount: latePickupRows.length,
    totalBilledRevenueCents,
    varianceToProjectedCents: totalBilledRevenueCents - projectedProgramRevenueCents
  };
}

function buildAttendanceReportRows(context: BaseReportingContext) {
  const rows = context.activeMembers
    .map((member) => {
      const schedule = context.scheduleByMemberId.get(member.id);
      const attendance = context.attendanceByMemberId.get(member.id) ?? { present: 0, absent: 0 };
      const scheduledDays = context.businessDays.reduce(
        (sum, dateOnly) => sum + (isScheduledOnDate(schedule, dateOnly) ? 1 : 0),
        0
      );
      const attendanceRate = scheduledDays > 0 ? Number(((attendance.present / scheduledDays) * 100).toFixed(1)) : null;
      return {
        member_name: member.display_name,
        scheduled_days: scheduledDays,
        present_days: attendance.present,
        absent_days: attendance.absent,
        attendance_rate_percent: attendanceRate,
        transportation_required: schedule?.transportation_required === true ? "Yes" : "No"
      };
    })
    .filter((row) => row.scheduled_days > 0 || row.present_days > 0 || row.absent_days > 0)
    .sort((left, right) => left.member_name.localeCompare(right.member_name, undefined, { sensitivity: "base" }));

  const columns: OnDemandReportColumn[] = [
    { key: "member_name", label: "Member", kind: "text" },
    { key: "scheduled_days", label: "Scheduled Days", kind: "integer" },
    { key: "present_days", label: "Present Days", kind: "integer" },
    { key: "absent_days", label: "Absent Days", kind: "integer" },
    { key: "attendance_rate_percent", label: "Attendance %", kind: "percent" },
    { key: "transportation_required", label: "Transportation Required", kind: "text" }
  ];

  return {
    category: "attendance" as const,
    title: "Attendance On-Demand",
    description: "Member-level scheduled, present, absent, and attendance-rate context.",
    columns,
    rows
  };
}

function buildBillingRevenueReportRows(
  context: BaseReportingContext,
  range: ReportDateRange
) {
  const db = getMockDb();
  const activeMemberIds = new Set(context.activeMembers.map((member) => member.id));
  const billedProgramCentsByMember = new Map<string, number>();
  db.attendanceRecords
    .filter((row) => activeMemberIds.has(row.member_id))
    .filter((row) => row.status === "present")
    .filter((row) => isDateWithinRange(row.attendance_date, range))
    .forEach((row) => {
      const dateOnly = normalizeDateOnly(row.attendance_date);
      if (!dateOnly) return;
      const current = billedProgramCentsByMember.get(row.member_id) ?? 0;
      billedProgramCentsByMember.set(
        row.member_id,
        current + toCentsFromDollars(resolveProjectedDailyRateForMember(row.member_id, dateOnly))
      );
    });

  const rows = context.activeMembers
    .map((member) => {
      const schedule = context.scheduleByMemberId.get(member.id);
      const attendance = context.attendanceByMemberId.get(member.id) ?? { present: 0, absent: 0 };
      const ancillary = context.ancillaryByMemberId.get(member.id) ?? {
        totalCents: 0,
        transportationCents: 0,
        latePickupCents: 0
      };
      const scheduledDays = context.businessDays.reduce(
        (sum, dateOnly) => sum + (isScheduledOnDate(schedule, dateOnly) ? 1 : 0),
        0
      );
      const projectedProgramCents = context.businessDays.reduce((sum, dateOnly) => {
        if (!isScheduledOnDate(schedule, dateOnly)) return sum;
        return sum + toCentsFromDollars(resolveProjectedDailyRateForMember(member.id, dateOnly));
      }, 0);
      const billedProgramCents = billedProgramCentsByMember.get(member.id) ?? 0;
      const totalBilledCents = billedProgramCents + ancillary.totalCents;

      return {
        member_name: member.display_name,
        scheduled_days: scheduledDays,
        present_days: attendance.present,
        projected_program_cents: projectedProgramCents,
        billed_program_cents: billedProgramCents,
        ancillary_total_cents: ancillary.totalCents,
        transportation_ancillary_cents: ancillary.transportationCents,
        late_pickup_cents: ancillary.latePickupCents,
        total_billed_cents: totalBilledCents
      };
    })
    .filter(
      (row) =>
        row.scheduled_days > 0 ||
        row.present_days > 0 ||
        row.ancillary_total_cents > 0 ||
        row.total_billed_cents > 0
    )
    .sort((left, right) => (left.total_billed_cents < right.total_billed_cents ? 1 : -1));

  const columns: OnDemandReportColumn[] = [
    { key: "member_name", label: "Member", kind: "text" },
    { key: "scheduled_days", label: "Scheduled Days", kind: "integer" },
    { key: "present_days", label: "Present Days", kind: "integer" },
    { key: "projected_program_cents", label: "Projected Program Revenue", kind: "currency_cents" },
    { key: "billed_program_cents", label: "Billed Program Revenue", kind: "currency_cents" },
    { key: "ancillary_total_cents", label: "Ancillary Total", kind: "currency_cents" },
    { key: "transportation_ancillary_cents", label: "Transportation Charges", kind: "currency_cents" },
    { key: "late_pickup_cents", label: "Late Pickup Charges", kind: "currency_cents" },
    { key: "total_billed_cents", label: "Total Billed Revenue", kind: "currency_cents" }
  ];

  return {
    category: "billing-revenue" as const,
    title: "Billing / Revenue On-Demand",
    description: "Program revenue uses each member's MCC Attendance DailyRate (with active billing-setting fallback).",
    columns,
    rows
  };
}

function buildTransportationReportRows(context: BaseReportingContext, range: ReportDateRange) {
  const db = getMockDb();
  const transportByMember = new Map<
    string,
    { ridesAm: number; ridesPm: number; noShowRefused: number; transportChargeCents: number }
  >();

  db.transportationLogs
    .filter((row) => isDateWithinRange(row.service_date, range))
    .forEach((row) => {
      const current = transportByMember.get(row.member_id) ?? {
        ridesAm: 0,
        ridesPm: 0,
        noShowRefused: 0,
        transportChargeCents: 0
      };
      if (row.period === "AM") current.ridesAm += 1;
      if (row.period === "PM") current.ridesPm += 1;
      if (String(row.transport_type).toLowerCase().includes("refused")) current.noShowRefused += 1;
      transportByMember.set(row.member_id, current);
    });

  context.ancillaryByMemberId.forEach((value, memberId) => {
    const current = transportByMember.get(memberId) ?? {
      ridesAm: 0,
      ridesPm: 0,
      noShowRefused: 0,
      transportChargeCents: 0
    };
    current.transportChargeCents = value.transportationCents;
    transportByMember.set(memberId, current);
  });

  const memberNameById = new Map(context.activeMembers.map((member) => [member.id, member.display_name] as const));

  const rows = Array.from(transportByMember.entries())
    .map(([memberId, details]) => ({
      member_name: memberNameById.get(memberId) ?? "Unknown Member",
      rides_am: details.ridesAm,
      rides_pm: details.ridesPm,
      total_rides: details.ridesAm + details.ridesPm,
      refused_no_show_rides: details.noShowRefused,
      transportation_charge_cents: details.transportChargeCents
    }))
    .filter((row) => row.total_rides > 0 || row.transportation_charge_cents > 0)
    .sort((left, right) => (left.total_rides < right.total_rides ? 1 : -1));

  const columns: OnDemandReportColumn[] = [
    { key: "member_name", label: "Member", kind: "text" },
    { key: "rides_am", label: "AM Rides", kind: "integer" },
    { key: "rides_pm", label: "PM Rides", kind: "integer" },
    { key: "total_rides", label: "Total Rides", kind: "integer" },
    { key: "refused_no_show_rides", label: "Refused/No-Show Rides", kind: "integer" },
    { key: "transportation_charge_cents", label: "Transportation Charges", kind: "currency_cents" }
  ];

  return {
    category: "transportation" as const,
    title: "Transportation On-Demand",
    description: "Ride volume and transport-related ancillary billing by member.",
    columns,
    rows
  };
}

function buildLeadsSalesReportRows(range: ReportDateRange) {
  const db = getMockDb();
  const rows = db.leads
    .filter((lead) => isDateWithinRange(lead.inquiry_date, range))
    .map((lead) => {
      const resolvedStatus = canonicalLeadStatus(lead.status, lead.stage);
      const convertedOrEnrolled =
        resolvedStatus === "Won" || Boolean(normalizeDateOnly(lead.member_start_date));
      return {
        lead_id: lead.lead_id,
        prospect_name: lead.member_name,
        stage: lead.stage,
        status: resolvedStatus,
        inquiry_date: lead.inquiry_date,
        lead_source: lead.lead_source,
        next_follow_up_date: normalizeDateOnly(lead.next_follow_up_date),
        converted_or_enrolled: convertedOrEnrolled ? "Yes" : "No"
      };
    })
    .sort((left, right) => (left.inquiry_date < right.inquiry_date ? 1 : -1));

  const columns: OnDemandReportColumn[] = [
    { key: "lead_id", label: "Lead ID", kind: "text" },
    { key: "prospect_name", label: "Prospect", kind: "text" },
    { key: "stage", label: "Stage", kind: "text" },
    { key: "status", label: "Status", kind: "text" },
    { key: "inquiry_date", label: "Inquiry Date", kind: "text" },
    { key: "lead_source", label: "Lead Source", kind: "text" },
    { key: "next_follow_up_date", label: "Next Follow-Up", kind: "text" },
    { key: "converted_or_enrolled", label: "Converted/Enrolled", kind: "text" }
  ];

  return {
    category: "leads-sales" as const,
    title: "Leads / Sales On-Demand",
    description: "Lead pipeline detail filtered by inquiry date range.",
    columns,
    rows
  };
}

function buildMemberDocumentationReportRows(range: ReportDateRange) {
  const db = getMockDb();
  const activeMembers = db.members.filter((member) => member.status === "active");

  const rows = activeMembers
    .map((member) => {
      const participationLogs = db.dailyActivities.filter(
        (row) =>
          row.member_id === member.id && isDateWithinRange(toDateOnlyFromTimestamp(row.created_at), range)
      ).length;
      const toiletLogs = db.toiletLogs.filter(
        (row) => row.member_id === member.id && isDateWithinRange(toDateOnlyFromTimestamp(row.event_at), range)
      ).length;
      const showerLogs = db.showerLogs.filter(
        (row) => row.member_id === member.id && isDateWithinRange(toDateOnlyFromTimestamp(row.event_at), range)
      ).length;
      const transportationLogs = db.transportationLogs.filter(
        (row) => row.member_id === member.id && isDateWithinRange(row.service_date, range)
      ).length;
      const bloodSugarLogs = db.bloodSugarLogs.filter(
        (row) => row.member_id === member.id && isDateWithinRange(toDateOnlyFromTimestamp(row.checked_at), range)
      ).length;
      const photoUploads = db.photoUploads.filter(
        (row) => row.member_id === member.id && isDateWithinRange(toDateOnlyFromTimestamp(row.uploaded_at), range)
      ).length;
      const assessments = db.assessments.filter(
        (row) => row.member_id === member.id && isDateWithinRange(row.assessment_date, range)
      ).length;

      const totalDocumentation =
        participationLogs +
        toiletLogs +
        showerLogs +
        transportationLogs +
        bloodSugarLogs +
        photoUploads +
        assessments;

      return {
        member_name: member.display_name,
        participation_logs: participationLogs,
        toilet_logs: toiletLogs,
        shower_logs: showerLogs,
        transportation_logs: transportationLogs,
        blood_sugar_logs: bloodSugarLogs,
        photo_uploads: photoUploads,
        assessments,
        total_documentation: totalDocumentation
      };
    })
    .filter((row) => row.total_documentation > 0)
    .sort((left, right) => (left.total_documentation < right.total_documentation ? 1 : -1));

  const columns: OnDemandReportColumn[] = [
    { key: "member_name", label: "Member", kind: "text" },
    { key: "participation_logs", label: "Participation Logs", kind: "integer" },
    { key: "toilet_logs", label: "Toilet Logs", kind: "integer" },
    { key: "shower_logs", label: "Shower Logs", kind: "integer" },
    { key: "transportation_logs", label: "Transportation Logs", kind: "integer" },
    { key: "blood_sugar_logs", label: "Blood Sugar Logs", kind: "integer" },
    { key: "photo_uploads", label: "Photo Uploads", kind: "integer" },
    { key: "assessments", label: "Assessments", kind: "integer" },
    { key: "total_documentation", label: "Total Documentation", kind: "integer" }
  ];

  return {
    category: "member-documentation" as const,
    title: "Member Documentation On-Demand",
    description: "Export-friendly member-level documentation volume by module.",
    columns,
    rows
  };
}

export async function getOnDemandReportData(input: {
  category: OnDemandReportCategory;
  range: ReportDateRange;
}): Promise<OnDemandReportResult> {
  if (!isMockMode()) {
    // TODO(quickbooks): Wire report views to accounting and operations warehouse tables.
    const label = ON_DEMAND_REPORT_CATEGORIES.find((option) => option.value === input.category)?.label ?? "On-Demand";
    return {
      category: input.category,
      title: `${label} On-Demand`,
      description: "Placeholder state: this on-demand category is not yet connected to live warehouse-backed reporting tables.",
      columns: [
        { key: "status", label: "Status", kind: "text" },
        { key: "details", label: "Details", kind: "text" }
      ],
      rows: [
        {
          status: "Placeholder",
          details: `No live ${label.toLowerCase()} dataset is wired for ${input.range.from} to ${input.range.to}.`
        }
      ]
    };
  }

  const context = buildBaseReportingContext(input.range);

  if (input.category === "attendance") {
    return buildAttendanceReportRows(context);
  }
  if (input.category === "billing-revenue") {
    return buildBillingRevenueReportRows(context, input.range);
  }
  if (input.category === "transportation") {
    return buildTransportationReportRows(context, input.range);
  }
  if (input.category === "leads-sales") {
    return buildLeadsSalesReportRows(input.range);
  }
  return buildMemberDocumentationReportRows(input.range);
}

function escapeCsv(value: string) {
  if (!/[",\n]/.test(value)) return value;
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function formatDollars(cents: number) {
  return (cents / 100).toFixed(2);
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

export function formatOnDemandCellValue(
  value: OnDemandValue,
  kind: OnDemandColumnKind,
  mode: "ui" | "export" = "ui"
) {
  if (value == null || value === "") return "-";
  if (kind === "currency_cents" && typeof value === "number") {
    if (mode === "export") return formatDollars(value);
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value / 100);
  }
  if (kind === "percent" && typeof value === "number") {
    return formatPercent(value);
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  return String(value);
}

export function buildOnDemandReportCsv(report: OnDemandReportResult) {
  if (report.columns.length === 0) return "";

  const lines: string[] = [];
  lines.push(report.columns.map((column) => escapeCsv(column.label)).join(","));

  report.rows.forEach((row) => {
    const serialized = report.columns.map((column) =>
      escapeCsv(formatOnDemandCellValue(row[column.key] ?? null, column.kind, "export"))
    );
    lines.push(serialized.join(","));
  });

  return lines.join("\n");
}

export const ATTENDANCE_SUMMARY_BILLING_MODE_OPTIONS = [
  { value: "All", label: "All Billing Modes" },
  { value: "Membership", label: "Membership" },
  { value: "Monthly", label: "Monthly" },
  { value: "Custom", label: "Custom" }
] as const;

export const ATTENDANCE_SUMMARY_MEMBER_STATUS_OPTIONS = [
  { value: "ActiveOnly", label: "Active Members" },
  { value: "InactiveOnly", label: "Inactive Members" },
  { value: "All", label: "Active + Inactive" }
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
  revenueModeApplied: "FinalizedRevenue" | "ProjectedRevenue" | "ProjectedRevenueFallback";
  summaryCards: {
    totalEnrolled: number;
    avgDailyAttendance: number;
    totalMemberDays: number;
    avgRevenuePerMember: number;
    percentCapacity: number | null;
  };
}

const ATTENDANCE_SUMMARY_DEFAULT_LOCATION = "Fort Mill Center";
const ATTENDANCE_SUMMARY_DEFAULT_CAPACITY = 89;

const ATTENDANCE_SUMMARY_LOCATION_CAPACITY: Record<string, number> = {
  "Fort Mill Center": 89,
  "Rock Hill Center": 89
};

function normalizeDateOnlyForAttendanceSummary(value: string | null | undefined, fallback: string) {
  const dateOnly = String(value ?? "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(dateOnly) ? dateOnly : fallback;
}

function parseBooleanFilter(value: string | null | undefined, fallback: boolean) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "true" || normalized === "yes" || normalized === "1") return true;
  if (normalized === "false" || normalized === "no" || normalized === "0") return false;
  return fallback;
}

function addDaysDateOnly(dateOnly: string, days: number) {
  const parsed = new Date(`${dateOnly}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function isWeekday(dateOnly: string) {
  const day = new Date(`${dateOnly}T00:00:00.000Z`).getUTCDay();
  return day >= 1 && day <= 5;
}

function dateInRange(dateOnly: string | null | undefined, range: ReportDateRange) {
  const normalized = String(dateOnly ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return false;
  return normalized >= range.from && normalized <= range.to;
}

function rangesOverlap(range: ReportDateRange, startDate: string, endDate: string) {
  return startDate <= range.to && range.from <= endDate;
}

function toMoney(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(2));
}

function toPercentRatio(numerator: number, denominator: number) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}

function normalizeLocation(value: string | null | undefined) {
  const cleaned = String(value ?? "").trim();
  return cleaned.length > 0 ? cleaned : ATTENDANCE_SUMMARY_DEFAULT_LOCATION;
}

function resolveLocationCapacity(location: string) {
  const direct = ATTENDANCE_SUMMARY_LOCATION_CAPACITY[location];
  if (Number.isFinite(direct) && direct > 0) return direct;

  const normalized = location.toLowerCase();
  if (normalized.includes("fort mill")) return 89;
  if (normalized.includes("rock hill")) return 89;
  return ATTENDANCE_SUMMARY_DEFAULT_CAPACITY;
}

function resolveEffectiveBillingModeForMember(memberId: string, dateOnly: string): "Membership" | "Monthly" | "Custom" {
  const memberSetting = getActiveMemberBillingSetting(memberId, dateOnly);
  const centerSetting = getActiveCenterBillingSetting(dateOnly);
  if (memberSetting && !memberSetting.use_center_default_billing_mode && memberSetting.billing_mode) {
    return memberSetting.billing_mode;
  }
  return centerSetting?.default_billing_mode ?? "Membership";
}

function resolveProjectedDailyRateForMember(memberId: string, attendanceDate: string): number {
  const attendanceSetting = getMemberAttendanceBillingSetting(memberId);
  if (attendanceSetting?.dailyRate != null && Number.isFinite(attendanceSetting.dailyRate) && attendanceSetting.dailyRate > 0) {
    return toMoney(attendanceSetting.dailyRate);
  }

  const memberSetting = getActiveMemberBillingSetting(memberId, attendanceDate);
  if (
    memberSetting &&
    !memberSetting.use_center_default_rate &&
    memberSetting.custom_daily_rate != null &&
    Number.isFinite(memberSetting.custom_daily_rate) &&
    memberSetting.custom_daily_rate > 0
  ) {
    return toMoney(memberSetting.custom_daily_rate);
  }

  const centerSetting = getActiveCenterBillingSetting(attendanceDate);
  return toMoney(centerSetting?.default_daily_rate ?? 0);
}

function getDefaultAttendanceSummaryRange() {
  const today = toEasternDate();
  return {
    from: `${today.slice(0, 7)}-01`,
    to: today
  };
}

function getOpenCenterDays(input: {
  range: ReportDateRange;
  countBillableOverrideAsOpen: boolean;
}) {
  const db = getMockDb();
  const closureByDate = new Map<string, Array<(typeof db.centerClosures)[number]>>();
  db.centerClosures
    .filter((row) => row.active)
    .filter((row) => dateInRange(row.closure_date, input.range))
    .forEach((row) => {
      const dateOnly = String(row.closure_date).slice(0, 10);
      const current = closureByDate.get(dateOnly) ?? [];
      current.push(row);
      closureByDate.set(dateOnly, current);
    });

  const openDays: string[] = [];
  let cursor = input.range.from;
  while (cursor <= input.range.to) {
    if (!isWeekday(cursor)) {
      cursor = addDaysDateOnly(cursor, 1);
      continue;
    }

    const closures = closureByDate.get(cursor) ?? [];
    const isClosed = closures.some((row) => !row.billable_override || !input.countBillableOverrideAsOpen);
    if (!isClosed) {
      openDays.push(cursor);
    }
    cursor = addDaysDateOnly(cursor, 1);
  }
  return openDays;
}

function getLocationByMemberId() {
  const db = getMockDb();
  const map = new Map<string, string>();
  db.memberCommandCenters.forEach((row) => {
    map.set(row.member_id, normalizeLocation(row.location));
  });
  return map;
}

function formatAttendanceSummaryCurrency(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function formatAttendanceSummaryPercent(value: number | null) {
  if (value == null) return "-";
  return `${(value * 100).toFixed(2)}%`;
}

function getCustomCoverageChecker(input: {
  includeCustomInvoices: boolean;
  range: ReportDateRange;
}) {
  const db = getMockDb();
  if (input.includeCustomInvoices) {
    return () => false;
  }

  const customFinalizedInvoiceIds = new Set(
    db.billingInvoices
      .filter((invoice) => invoice.invoice_source === "Custom")
      .filter((invoice) => invoice.invoice_status !== "Draft" && invoice.invoice_status !== "Void")
      .map((invoice) => invoice.id)
  );

  const coverageByMember = new Map<string, Array<{ start: string; end: string }>>();
  db.billingCoverages
    .filter((coverage) => coverage.coverage_type === "BaseProgram")
    .filter((coverage) => customFinalizedInvoiceIds.has(coverage.source_invoice_id))
    .forEach((coverage) => {
      const start = String(coverage.coverage_start_date).slice(0, 10);
      const end = String(coverage.coverage_end_date).slice(0, 10);
      if (!rangesOverlap(input.range, start, end)) return;
      const current = coverageByMember.get(coverage.member_id) ?? [];
      current.push({ start, end });
      coverageByMember.set(coverage.member_id, current);
    });

  return (memberId: string, dateOnly: string) => {
    const ranges = coverageByMember.get(memberId) ?? [];
    return ranges.some((range) => dateOnly >= range.start && dateOnly <= range.end);
  };
}

function getFinalizedRevenueByMember(input: {
  memberIds: Set<string>;
  range: ReportDateRange;
  includeCustomInvoices: boolean;
}) {
  const db = getMockDb();
  const allowedStatus = new Set(["Finalized", "Sent", "Paid", "PartiallyPaid"]);
  const invoiceById = new Map(
    db.billingInvoices
      .filter((invoice) => input.memberIds.has(invoice.member_id))
      .filter((invoice) => allowedStatus.has(invoice.invoice_status))
      .filter((invoice) => (input.includeCustomInvoices ? true : invoice.invoice_source !== "Custom"))
      .map((invoice) => [invoice.id, invoice] as const)
  );

  const dedupe = new Set<string>();
  const revenueByMember = new Map<string, number>();
  let lineCount = 0;

  db.billingInvoiceLines.forEach((line) => {
    const invoice = invoiceById.get(line.invoice_id);
    if (!invoice) return;
    const dateOnly = line.service_date ? String(line.service_date).slice(0, 10) : null;
    const periodStart = line.service_period_start ? String(line.service_period_start).slice(0, 10) : null;
    const periodEnd = line.service_period_end ? String(line.service_period_end).slice(0, 10) : null;
    const overlaps =
      (dateOnly != null && dateInRange(dateOnly, input.range)) ||
      (periodStart != null &&
        periodEnd != null &&
        rangesOverlap(input.range, periodStart, periodEnd));
    if (!overlaps) return;

    const dedupeKey = [
      invoice.member_id,
      line.line_type,
      dateOnly ?? "",
      periodStart ?? "",
      periodEnd ?? "",
      line.source_table ?? "",
      line.source_record_id ?? "",
      toMoney(Number(line.amount)).toFixed(2)
    ].join("|");
    if (dedupe.has(dedupeKey)) return;
    dedupe.add(dedupeKey);
    lineCount += 1;

    const current = revenueByMember.get(invoice.member_id) ?? 0;
    revenueByMember.set(invoice.member_id, toMoney(current + Number(line.amount)));
  });

  return {
    lineCount,
    revenueByMember
  };
}

function getProjectedRevenueByMember(input: {
  memberIds: Set<string>;
  range: ReportDateRange;
  includeCustomInvoices: boolean;
}) {
  const db = getMockDb();
  const rateCache = new Map<string, number>();
  const isCoveredByCustomInvoice = getCustomCoverageChecker({
    includeCustomInvoices: input.includeCustomInvoices,
    range: input.range
  });
  const revenueByMember = new Map<string, number>();

  db.attendanceRecords
    .filter((row) => input.memberIds.has(row.member_id))
    .filter((row) => row.status === "present")
    .filter((row) => dateInRange(row.attendance_date, input.range))
    .forEach((row) => {
      const dateOnly = String(row.attendance_date).slice(0, 10);
      if (isCoveredByCustomInvoice(row.member_id, dateOnly)) return;
      const cacheKey = `${row.member_id}|${dateOnly}`;
      const dailyRate = rateCache.get(cacheKey) ?? resolveProjectedDailyRateForMember(row.member_id, dateOnly);
      rateCache.set(cacheKey, dailyRate);
      const current = revenueByMember.get(row.member_id) ?? 0;
      revenueByMember.set(row.member_id, toMoney(current + dailyRate));
    });

  return revenueByMember;
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
  if (!isMockMode()) {
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

  const db = getMockDb();
  const locationByMemberId = getLocationByMemberId();
  const openCenterDays = getOpenCenterDays({
    range: input,
    countBillableOverrideAsOpen: input.countBillableOverrideAsOpen
  });
  const openCenterDayCount = openCenterDays.length;

  const availableLocations = Array.from(
    new Set(
      db.members.map((member) => normalizeLocation(locationByMemberId.get(member.id)))
    )
  ).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));

  const filteredMembers = db.members.filter((member) => {
    const location = normalizeLocation(locationByMemberId.get(member.id));
    if (input.location && location !== input.location) return false;
    if (input.memberStatus === "ActiveOnly" && member.status !== "active") return false;
    if (input.memberStatus === "InactiveOnly" && member.status !== "inactive") return false;
    const enrollmentDate = String(member.enrollment_date ?? "1900-01-01").slice(0, 10);
    const dischargeDate = String(member.discharge_date ?? "9999-12-31").slice(0, 10);
    if (!rangesOverlap(input, enrollmentDate, dischargeDate)) return false;
    const effectiveBillingMode = resolveEffectiveBillingModeForMember(member.id, input.to);
    if (input.billingMode !== "All" && effectiveBillingMode !== input.billingMode) return false;
    return true;
  });

  const memberIds = new Set(filteredMembers.map((member) => member.id));
  const memberIdsByLocation = new Map<string, Set<string>>();
  filteredMembers.forEach((member) => {
    const location = normalizeLocation(locationByMemberId.get(member.id));
    const current = memberIdsByLocation.get(location) ?? new Set<string>();
    current.add(member.id);
    memberIdsByLocation.set(location, current);
  });

  const totalMemberDaysByMember = new Map<string, number>();
  db.attendanceRecords
    .filter((row) => memberIds.has(row.member_id))
    .filter((row) => row.status === "present")
    .filter((row) => dateInRange(row.attendance_date, input))
    .forEach((row) => {
      const current = totalMemberDaysByMember.get(row.member_id) ?? 0;
      totalMemberDaysByMember.set(row.member_id, current + 1);
    });

  let revenueModeApplied: AttendanceSummaryResult["revenueModeApplied"] = input.revenueBasis;
  let revenueByMember = new Map<string, number>();
  if (input.revenueBasis === "FinalizedRevenue") {
    const finalized = getFinalizedRevenueByMember({
      memberIds,
      range: input,
      includeCustomInvoices: input.includeCustomInvoices
    });
    if (finalized.lineCount > 0) {
      revenueByMember = finalized.revenueByMember;
      revenueModeApplied = "FinalizedRevenue";
    } else {
      revenueByMember = getProjectedRevenueByMember({
        memberIds,
        range: input,
        includeCustomInvoices: input.includeCustomInvoices
      });
      revenueModeApplied = "ProjectedRevenueFallback";
    }
  } else {
    revenueByMember = getProjectedRevenueByMember({
      memberIds,
      range: input,
      includeCustomInvoices: input.includeCustomInvoices
    });
    revenueModeApplied = "ProjectedRevenue";
  }

  const locationsToRender = input.location ? [input.location] : availableLocations;
  const rows: AttendanceSummaryRow[] = locationsToRender.map((location) => {
    const locationMemberIds = memberIdsByLocation.get(location) ?? new Set<string>();
    const totalEnrolled = locationMemberIds.size;
    const totalMemberDays = Array.from(locationMemberIds).reduce(
      (sum, memberId) => sum + (totalMemberDaysByMember.get(memberId) ?? 0),
      0
    );
    const totalRevenue = toMoney(
      Array.from(locationMemberIds).reduce((sum, memberId) => sum + (revenueByMember.get(memberId) ?? 0), 0)
    );
    const avgDailyAttendance = openCenterDayCount > 0 ? totalMemberDays / openCenterDayCount : 0;
    const avgDailyAttendancePerParticipant = totalEnrolled > 0 ? avgDailyAttendance / totalEnrolled : 0;
    const averageRevenuePerMember = totalEnrolled > 0 ? totalRevenue / totalEnrolled : 0;
    const capacity = resolveLocationCapacity(location);
    return {
      location,
      capacity,
      percentCapacity: toPercentRatio(avgDailyAttendance, capacity),
      totalEnrolled,
      avgDailyAttendance: toMoney(avgDailyAttendance),
      avgDailyAttendancePerParticipant: toMoney(avgDailyAttendancePerParticipant),
      totalMemberDays,
      averageRevenuePerMember: toMoney(averageRevenuePerMember),
      totalRevenue
    };
  });

  const totalsCapacity = rows.reduce((sum, row) => sum + row.capacity, 0);
  const totalsMemberDays = rows.reduce((sum, row) => sum + row.totalMemberDays, 0);
  const totalsEnrolled = rows.reduce((sum, row) => sum + row.totalEnrolled, 0);
  const totalsRevenue = toMoney(rows.reduce((sum, row) => sum + row.totalRevenue, 0));
  const totalsAvgDailyAttendance = openCenterDayCount > 0 ? totalsMemberDays / openCenterDayCount : 0;
  const totals: AttendanceSummaryRow = {
    location: "Totals",
    capacity: totalsCapacity,
    percentCapacity: toPercentRatio(totalsAvgDailyAttendance, totalsCapacity),
    totalEnrolled: totalsEnrolled,
    avgDailyAttendance: toMoney(totalsAvgDailyAttendance),
    avgDailyAttendancePerParticipant: toMoney(
      totalsEnrolled > 0 ? totalsAvgDailyAttendance / totalsEnrolled : 0
    ),
    totalMemberDays: totalsMemberDays,
    averageRevenuePerMember: toMoney(totalsEnrolled > 0 ? totalsRevenue / totalsEnrolled : 0),
    totalRevenue: totalsRevenue
  };

  return {
    filters: input,
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
