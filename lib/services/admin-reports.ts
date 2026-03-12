import { createClient } from "@/lib/supabase/server";
import { staffNameToSlug } from "@/lib/services/activity-snapshots";
import { getCurrentPayPeriod, isDateInPayPeriod } from "@/lib/pay-period";
import { toEasternDate, toEasternISO } from "@/lib/timezone";

type StatusFilter = "On Time" | "Late" | "Missing";

export interface ReportDateRange {
  from: string;
  to: string;
}

export interface BaseReportFilters extends ReportDateRange {
  member?: string;
  staff?: string;
  status?: StatusFilter | "All";
  documentationType?: string;
}

function asDate(value?: string | null) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isoDay(date: Date) {
  return toEasternDate(date);
}

export function resolveDateRange(rawFrom?: string, rawTo?: string, fallbackDays = 30): ReportDateRange {
  const today = new Date();
  const end = rawTo ? new Date(rawTo) : today;
  if (Number.isNaN(end.getTime())) {
    return resolveDateRange(undefined, undefined, fallbackDays);
  }

  const start = rawFrom ? new Date(rawFrom) : new Date(end.getTime() - fallbackDays * 24 * 60 * 60 * 1000);
  if (Number.isNaN(start.getTime())) {
    return resolveDateRange(undefined, rawTo, fallbackDays);
  }

  return {
    from: isoDay(start),
    to: isoDay(end)
  };
}

function inDateRange(value: string | null | undefined, range: ReportDateRange) {
  if (!value) return false;
  const d = asDate(value);
  if (!d) return false;
  const from = asDate(`${range.from}T00:00:00.000Z`);
  const to = asDate(`${range.to}T23:59:59.999Z`);
  if (!from || !to) return false;
  return d >= from && d <= to;
}

function hoursBetween(start: string, end: string) {
  const s = asDate(start);
  const e = asDate(end);
  if (!s || !e) return 0;
  return (e.getTime() - s.getTime()) / 3600000;
}

function realTimeStatus(occurrenceAt: string, enteredAt: string | null): { status: StatusFilter; lateHours: number } {
  if (!enteredAt) {
    return { status: "Missing", lateHours: 0 };
  }
  const diff = hoursBetween(occurrenceAt, enteredAt);
  if (diff > 1) return { status: "Late", lateHours: diff };
  return { status: "On Time", lateHours: Math.max(diff, 0) };
}

function dailyStatus(occurrenceAt: string, enteredAt: string | null): { status: StatusFilter; lateHours: number } {
  if (!enteredAt) {
    return { status: "Missing", lateHours: 0 };
  }
  const diff = hoursBetween(occurrenceAt, enteredAt);
  if (diff > 48) return { status: "Late", lateHours: diff - 48 };
  return { status: "On Time", lateHours: Math.max(diff, 0) };
}

function statusPass(value: StatusFilter, requested?: string) {
  if (!requested || requested === "All") return true;
  return value === requested;
}

function normalizeDocTypeFilter(value?: string) {
  if (!value || value === "All") return undefined;
  return value;
}

function staffReportHref(staffName: string) {
  return `/reports/staff/${staffNameToSlug(staffName)}`;
}

function buildDays(range: ReportDateRange) {
  const out: string[] = [];
  let d = asDate(`${range.from}T00:00:00.000Z`);
  const end = asDate(`${range.to}T00:00:00.000Z`);
  if (!d || !end) return out;
  while (d <= end) {
    out.push(isoDay(d));
    d = new Date(d.getTime() + 86400000);
  }
  return out;
}

export async function getAdminReportLookups() {
  const supabase = await createClient();
  const [{ data: staffRows }, { data: memberRows }] = await Promise.all([
    supabase.from("profiles").select("id, full_name").eq("active", true).order("full_name"),
    supabase.from("members").select("id, display_name").order("display_name")
  ]);

  return {
    staff: (staffRows ?? []).map((s: any) => ({ id: s.id, name: s.full_name })),
    members: (memberRows ?? []).map((m: any) => ({ id: m.id, name: m.display_name })),
    documentationTypes: ["Participation Log", "Toilet", "Shower", "Transportation", "Blood Sugar", "Photo Upload", "Assessment"]
  };
}

export async function getAdminStaffProductivity(filters: BaseReportFilters) {
  // TODO(schema): Replace with SQL aggregate view for staff productivity.
  const lookups = await getAdminReportLookups();
  return lookups.staff
    .filter((row) => !filters.staff || row.id === filters.staff)
    .map((row) => ({
      staff_id: row.id,
      staff_name: row.name,
      daily: 0,
      toilet: 0,
      shower: 0,
      transportation: 0,
      blood_sugar: 0,
      photos: 0,
      assessments: 0,
      total: 0
    }));
}

export async function getAdminTimelyDocumentation(filters: BaseReportFilters) {
  const supabase = await createClient();
  const docTypeFilter = normalizeDocTypeFilter(filters.documentationType);
  const rows: Array<{
    id: string;
    member_id: string;
    member_name: string;
    documentation_type: string;
    occurrence_at: string;
    entered_at: string | null;
    staff_id: string | null;
    staff_name: string | null;
    status: StatusFilter;
    late_hours: number;
    drill_href: string;
  }> = [];

  const [{ data: dailyRows }, { data: toiletRows }, { data: showerRows }, { data: transportationRows }] = await Promise.all([
    supabase
      .from("daily_activity_logs")
      .select("id, member_id, members(display_name), activity_date, created_at, staff_user_id, profiles(full_name)")
      .gte("activity_date", filters.from)
      .lte("activity_date", filters.to),
    supabase
      .from("toilet_logs")
      .select("id, member_id, members(display_name), event_at, staff_user_id, profiles(full_name)")
      .gte("event_at", `${filters.from}T00:00:00.000Z`)
      .lte("event_at", `${filters.to}T23:59:59.999Z`),
    supabase
      .from("shower_logs")
      .select("id, member_id, members(display_name), event_at, created_at, staff_user_id, profiles(full_name)")
      .gte("event_at", `${filters.from}T00:00:00.000Z`)
      .lte("event_at", `${filters.to}T23:59:59.999Z`),
    supabase
      .from("transportation_logs")
      .select("id, member_id, members(display_name), service_date, created_at, staff_user_id, profiles(full_name), period")
      .gte("service_date", filters.from)
      .lte("service_date", filters.to)
  ]);

  (dailyRows ?? []).forEach((row: any) => {
    const occurrenceAt = `${row.activity_date}T12:00:00.000Z`;
    const enteredAt = row.created_at ?? null;
    const result = dailyStatus(occurrenceAt, enteredAt);
    rows.push({
      id: `daily-${row.id}`,
      member_id: row.member_id,
      member_name: row.members?.display_name ?? "Unknown Member",
      documentation_type: "Participation Log",
      occurrence_at: occurrenceAt,
      entered_at: enteredAt,
      staff_id: row.staff_user_id ?? null,
      staff_name: row.profiles?.full_name ?? null,
      status: result.status,
      late_hours: Number(result.lateHours.toFixed(2)),
      drill_href: "/documentation/activity"
    });
  });

  (toiletRows ?? []).forEach((row: any) => {
    const result = realTimeStatus(row.event_at, row.event_at ?? null);
    rows.push({
      id: `toilet-${row.id}`,
      member_id: row.member_id,
      member_name: row.members?.display_name ?? "Unknown Member",
      documentation_type: "Toilet",
      occurrence_at: row.event_at,
      entered_at: row.event_at,
      staff_id: row.staff_user_id ?? null,
      staff_name: row.profiles?.full_name ?? null,
      status: result.status,
      late_hours: Number(result.lateHours.toFixed(2)),
      drill_href: "/documentation/toilet"
    });
  });

  (showerRows ?? []).forEach((row: any) => {
    const enteredAt = row.created_at ?? row.event_at ?? null;
    const result = realTimeStatus(row.event_at, enteredAt);
    rows.push({
      id: `shower-${row.id}`,
      member_id: row.member_id,
      member_name: row.members?.display_name ?? "Unknown Member",
      documentation_type: "Shower",
      occurrence_at: row.event_at,
      entered_at: enteredAt,
      staff_id: row.staff_user_id ?? null,
      staff_name: row.profiles?.full_name ?? null,
      status: result.status,
      late_hours: Number(result.lateHours.toFixed(2)),
      drill_href: "/documentation/shower"
    });
  });

  (transportationRows ?? []).forEach((row: any) => {
    const occurrenceAt = `${row.service_date}T${row.period === "AM" ? "08" : "16"}:00:00.000Z`;
    const enteredAt = row.created_at ?? null;
    const result = realTimeStatus(occurrenceAt, enteredAt);
    rows.push({
      id: `transport-${row.id}`,
      member_id: row.member_id,
      member_name: row.members?.display_name ?? "Unknown Member",
      documentation_type: "Transportation",
      occurrence_at: occurrenceAt,
      entered_at: enteredAt,
      staff_id: row.staff_user_id ?? null,
      staff_name: row.profiles?.full_name ?? null,
      status: result.status,
      late_hours: Number(result.lateHours.toFixed(2)),
      drill_href: "/documentation/transportation"
    });
  });

  return rows
    .filter((row) => inDateRange(row.occurrence_at, filters))
    .filter((row) => (!filters.member || row.member_id === filters.member) && (!filters.staff || row.staff_id === filters.staff))
    .filter((row) => statusPass(row.status, filters.status))
    .filter((row) => (!docTypeFilter || row.documentation_type === docTypeFilter))
    .sort((a, b) => (a.occurrence_at < b.occurrence_at ? 1 : -1));
}

export async function getAdminAncillaryAudit(filters: BaseReportFilters) {
  // TODO(schema): Migrate to dedicated ancillary reconciliation reporting view.
  return [] as Array<Record<string, unknown>>;
}

export async function getAdminPayPeriodReview() {
  const period = getCurrentPayPeriod();
  const supabase = await createClient();
  const { data } = await supabase
    .from("daily_timecards")
    .select("employee_name, worked_hours, meal_deduction_hours, status")
    .gte("work_date", period.startDate)
    .lte("work_date", period.endDate);

  const grouped = new Map<string, { total_hours_worked: number; meal_deduction_applied: number; statuses: Set<string> }>();
  (data ?? []).forEach((row: any) => {
    const key = row.employee_name ?? "Unknown";
    const current = grouped.get(key) ?? { total_hours_worked: 0, meal_deduction_applied: 0, statuses: new Set<string>() };
    current.total_hours_worked += Number(row.worked_hours ?? 0);
    current.meal_deduction_applied += Number(row.meal_deduction_hours ?? 0);
    current.statuses.add(String(row.status ?? "pending"));
    grouped.set(key, current);
  });

  return [...grouped.entries()].map(([staff_name, value]) => ({
    staff_name,
    pay_period: period.label,
    total_hours_worked: Number(value.total_hours_worked.toFixed(2)),
    meal_deduction_applied: Number(value.meal_deduction_applied.toFixed(2)),
    adjusted_hours: Number((value.total_hours_worked - value.meal_deduction_applied).toFixed(2)),
    exception_notes: "-",
    approval_status: value.statuses.has("pending") || value.statuses.has("needs_review") ? "Needs Follow-up" : "Reviewed",
    reviewed_by: null,
    reviewed_at: null
  }));
}

export async function getAdminPunchExceptions(filters: ReportDateRange & { staff?: string }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("time_punches")
    .select("id, staff_user_id, profiles(full_name), punch_at, punch_type, within_fence, distance_meters, note")
    .eq("within_fence", false)
    .gte("punch_at", `${filters.from}T00:00:00.000Z`)
    .lte("punch_at", `${filters.to}T23:59:59.999Z`);

  return (data ?? [])
    .filter((row: any) => !filters.staff || row.staff_user_id === filters.staff)
    .map((row: any) => ({
      id: row.id,
      staff_id: row.staff_user_id,
      staff_name: row.profiles?.full_name ?? "Unknown",
      occurred_at: row.punch_at,
      punch_type: row.punch_type,
      within_fence: row.within_fence,
      distance_meters: row.distance_meters,
      note: row.note ?? null
    }))
    .sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1));
}

export async function getAdminDocumentationByMember(filters: BaseReportFilters) {
  // TODO(schema): Replace with member-documentation aggregate materialized view.
  return [] as Array<Record<string, unknown>>;
}

export async function getAdminLastToileted() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("toilet_logs")
    .select("member_id, members(display_name), event_at, staff_user_id, profiles(full_name)")
    .order("event_at", { ascending: false });

  const seen = new Set<string>();
  const rows: Array<Record<string, unknown>> = [];
  (data ?? []).forEach((row: any) => {
    if (seen.has(row.member_id)) return;
    seen.add(row.member_id);
    rows.push({
      member_id: row.member_id,
      member_name: row.members?.display_name ?? "Unknown Member",
      last_toileted_at: row.event_at,
      staff_name: row.profiles?.full_name ?? null
    });
  });
  return rows;
}

export async function getAdminCareTracker() {
  // TODO(schema): Add public.v_admin_care_tracker with toileting windows and care gaps.
  return [] as Array<Record<string, unknown>>;
}

export async function getAdminSalesPipelineSummary(filters: ReportDateRange) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("leads")
    .select("id, stage, status, created_at")
    .gte("created_at", `${filters.from}T00:00:00.000Z`)
    .lte("created_at", `${filters.to}T23:59:59.999Z`);

  const byStage = new Map<string, number>();
  (data ?? []).forEach((row: any) => {
    const key = String(row.stage ?? "Unknown");
    byStage.set(key, (byStage.get(key) ?? 0) + 1);
  });

  return {
    totalLeads: (data ?? []).length,
    byStage: [...byStage.entries()].map(([stage, count]) => ({ stage, count }))
  };
}

export async function getAdminCommunityPartnerPerformance(filters: ReportDateRange) {
  // TODO(schema): Add aggregate for partner touches, referrals, and won conversions by range.
  return [] as Array<Record<string, unknown>>;
}

export async function getAdminLeadActivityReport(filters: ReportDateRange & { staff?: string; partner?: string; lead?: string }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("lead_activities")
    .select("id, lead_id, member_name, activity_at, activity_type, outcome, completed_by_user_id, completed_by_name, partner_id")
    .gte("activity_at", `${filters.from}T00:00:00.000Z`)
    .lte("activity_at", `${filters.to}T23:59:59.999Z`)
    .order("activity_at", { ascending: false });

  return (data ?? []).filter((row: any) => {
    if (filters.staff && row.completed_by_user_id !== filters.staff) return false;
    if (filters.partner && row.partner_id !== filters.partner) return false;
    if (filters.lead && row.lead_id !== filters.lead) return false;
    return true;
  });
}

export async function getAdminAssessmentStatus(filters: BaseReportFilters) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("intake_assessments")
    .select("id, member_id, members!intake_assessments_member_id_fkey(display_name), assessment_date, total_score, completed_by, created_at")
    .gte("assessment_date", filters.from)
    .lte("assessment_date", filters.to)
    .order("assessment_date", { ascending: false });

  return (data ?? [])
    .filter((row: any) => !filters.member || row.member_id === filters.member)
    .map((row: any) => ({
      id: row.id,
      member_id: row.member_id,
      member_name: row.members?.display_name ?? "Unknown Member",
      assessment_date: row.assessment_date ?? row.created_at?.slice(0, 10) ?? null,
      total_score: row.total_score,
      completed_by: row.completed_by ?? null
    }));
}

export async function getAdminMemberServiceUtilization(filters: BaseReportFilters) {
  // TODO(schema): Build service utilization view keyed by member/date/documentation types.
  const days = buildDays(filters);
  return days.map((day) => ({
    date: day,
    total_members: 0,
    participation_logs: 0,
    toileting_logs: 0,
    shower_logs: 0,
    transportation_logs: 0,
    blood_sugar_logs: 0
  }));
}

export async function getAdminReportGeneratedAt() {
  return toEasternISO();
}

export async function isDateInCurrentPayPeriod(dateOnly: string) {
  return isDateInPayPeriod(`${dateOnly}T12:00:00.000Z`, getCurrentPayPeriod());
}
