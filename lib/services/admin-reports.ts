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
  const supabase = await createClient();
  const lookups = await getAdminReportLookups();
  const staffRows = lookups.staff.filter((row) => !filters.staff || row.id === filters.staff);
  if (staffRows.length === 0) return [];

  const [dailyRows, toiletRows, showerRows, transportationRows, bloodSugarRows, photoRows, assessmentRows] =
    await Promise.all([
      supabase
        .from("daily_activity_logs")
        .select("staff_user_id")
        .gte("activity_date", filters.from)
        .lte("activity_date", filters.to),
      supabase
        .from("toilet_logs")
        .select("staff_user_id")
        .gte("event_at", `${filters.from}T00:00:00.000Z`)
        .lte("event_at", `${filters.to}T23:59:59.999Z`),
      supabase
        .from("shower_logs")
        .select("staff_user_id")
        .gte("event_at", `${filters.from}T00:00:00.000Z`)
        .lte("event_at", `${filters.to}T23:59:59.999Z`),
      supabase
        .from("transportation_logs")
        .select("staff_user_id")
        .gte("service_date", filters.from)
        .lte("service_date", filters.to),
      supabase
        .from("blood_sugar_logs")
        .select("nurse_user_id")
        .gte("checked_at", `${filters.from}T00:00:00.000Z`)
        .lte("checked_at", `${filters.to}T23:59:59.999Z`),
      supabase
        .from("member_photo_uploads")
        .select("uploaded_by")
        .gte("uploaded_at", `${filters.from}T00:00:00.000Z`)
        .lte("uploaded_at", `${filters.to}T23:59:59.999Z`),
      supabase
        .from("intake_assessments")
        .select("completed_by_user_id")
        .gte("assessment_date", filters.from)
        .lte("assessment_date", filters.to)
    ]);

  const responseErrors = [
    dailyRows.error,
    toiletRows.error,
    showerRows.error,
    transportationRows.error,
    bloodSugarRows.error,
    photoRows.error,
    assessmentRows.error
  ].filter(Boolean);
  if (responseErrors.length > 0) {
    throw new Error(String((responseErrors[0] as any).message ?? "Unable to load staff productivity."));
  }

  const toCountMap = (rows: any[], key: string) => {
    const out = new Map<string, number>();
    rows.forEach((row) => {
      const id = String(row?.[key] ?? "");
      if (!id) return;
      out.set(id, (out.get(id) ?? 0) + 1);
    });
    return out;
  };

  const dailyByStaff = toCountMap((dailyRows.data ?? []) as any[], "staff_user_id");
  const toiletByStaff = toCountMap((toiletRows.data ?? []) as any[], "staff_user_id");
  const showerByStaff = toCountMap((showerRows.data ?? []) as any[], "staff_user_id");
  const transportByStaff = toCountMap((transportationRows.data ?? []) as any[], "staff_user_id");
  const bloodSugarByStaff = toCountMap((bloodSugarRows.data ?? []) as any[], "nurse_user_id");
  const photosByStaff = toCountMap((photoRows.data ?? []) as any[], "uploaded_by");
  const assessmentsByStaff = toCountMap((assessmentRows.data ?? []) as any[], "completed_by_user_id");

  return staffRows
    .map((row) => {
      const daily = dailyByStaff.get(row.id) ?? 0;
      const toilet = toiletByStaff.get(row.id) ?? 0;
      const shower = showerByStaff.get(row.id) ?? 0;
      const transportation = transportByStaff.get(row.id) ?? 0;
      const blood_sugar = bloodSugarByStaff.get(row.id) ?? 0;
      const photos = photosByStaff.get(row.id) ?? 0;
      const assessments = assessmentsByStaff.get(row.id) ?? 0;
      return {
        staff_id: row.id,
        staff_name: row.name,
        daily,
        toilet,
        shower,
        transportation,
        blood_sugar,
        photos,
        assessments,
        total: daily + toilet + shower + transportation + blood_sugar + photos + assessments
      };
    })
    .sort((left, right) => right.total - left.total || left.staff_name.localeCompare(right.staff_name));
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
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_ancillary_charge_logs_detailed")
    .select("id, member_id, member_name, category_name, amount_cents, service_date, staff_user_id, staff_name, reconciliation_status, created_at")
    .gte("service_date", filters.from)
    .lte("service_date", filters.to)
    .order("service_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? [])
    .filter((row: any) => !filters.member || row.member_id === filters.member)
    .filter((row: any) => !filters.staff || row.staff_user_id === filters.staff);
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
  const supabase = await createClient();
  const [dailyRows, toiletRows, showerRows, transportationRows, bloodSugarRows] = await Promise.all([
    supabase
      .from("daily_activity_logs")
      .select("member_id, members!daily_activity_logs_member_id_fkey(display_name), activity_date")
      .gte("activity_date", filters.from)
      .lte("activity_date", filters.to),
    supabase
      .from("toilet_logs")
      .select("member_id, members!toilet_logs_member_id_fkey(display_name), event_at")
      .gte("event_at", `${filters.from}T00:00:00.000Z`)
      .lte("event_at", `${filters.to}T23:59:59.999Z`),
    supabase
      .from("shower_logs")
      .select("member_id, members!shower_logs_member_id_fkey(display_name), event_at")
      .gte("event_at", `${filters.from}T00:00:00.000Z`)
      .lte("event_at", `${filters.to}T23:59:59.999Z`),
    supabase
      .from("transportation_logs")
      .select("member_id, members!transportation_logs_member_id_fkey(display_name), service_date")
      .gte("service_date", filters.from)
      .lte("service_date", filters.to),
    supabase
      .from("blood_sugar_logs")
      .select("member_id, members!blood_sugar_logs_member_id_fkey(display_name), checked_at")
      .gte("checked_at", `${filters.from}T00:00:00.000Z`)
      .lte("checked_at", `${filters.to}T23:59:59.999Z`)
  ]);
  const responseErrors = [dailyRows.error, toiletRows.error, showerRows.error, transportationRows.error, bloodSugarRows.error].filter(Boolean);
  if (responseErrors.length > 0) {
    throw new Error(String((responseErrors[0] as any).message ?? "Unable to load member documentation."));
  }

  const totalsByMember = new Map<string, {
    member_id: string;
    member_name: string;
    participation_logs: number;
    toileting_logs: number;
    shower_logs: number;
    transportation_logs: number;
    blood_sugar_logs: number;
    total: number;
  }>();
  const touch = (memberId: string, memberName: string) => {
    const current = totalsByMember.get(memberId) ?? {
      member_id: memberId,
      member_name: memberName,
      participation_logs: 0,
      toileting_logs: 0,
      shower_logs: 0,
      transportation_logs: 0,
      blood_sugar_logs: 0,
      total: 0
    };
    totalsByMember.set(memberId, current);
    return current;
  };
  (dailyRows.data ?? []).forEach((row: any) => {
    const current = touch(String(row.member_id), String(row.members?.display_name ?? "Unknown Member"));
    current.participation_logs += 1;
    current.total += 1;
  });
  (toiletRows.data ?? []).forEach((row: any) => {
    const current = touch(String(row.member_id), String(row.members?.display_name ?? "Unknown Member"));
    current.toileting_logs += 1;
    current.total += 1;
  });
  (showerRows.data ?? []).forEach((row: any) => {
    const current = touch(String(row.member_id), String(row.members?.display_name ?? "Unknown Member"));
    current.shower_logs += 1;
    current.total += 1;
  });
  (transportationRows.data ?? []).forEach((row: any) => {
    const current = touch(String(row.member_id), String(row.members?.display_name ?? "Unknown Member"));
    current.transportation_logs += 1;
    current.total += 1;
  });
  (bloodSugarRows.data ?? []).forEach((row: any) => {
    const current = touch(String(row.member_id), String(row.members?.display_name ?? "Unknown Member"));
    current.blood_sugar_logs += 1;
    current.total += 1;
  });
  return Array.from(totalsByMember.values())
    .filter((row) => !filters.member || row.member_id === filters.member)
    .sort((left, right) => right.total - left.total || left.member_name.localeCompare(right.member_name));
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
  const supabase = await createClient();
  const [membersResult, toiletResult, showerResult] = await Promise.all([
    supabase.from("members").select("id, display_name, status").eq("status", "active"),
    supabase.from("toilet_logs").select("member_id, event_at, profiles(full_name)").order("event_at", { ascending: false }),
    supabase.from("shower_logs").select("member_id, event_at, profiles(full_name)").order("event_at", { ascending: false })
  ]);
  if (membersResult.error) throw new Error(membersResult.error.message);
  if (toiletResult.error) throw new Error(toiletResult.error.message);
  if (showerResult.error) throw new Error(showerResult.error.message);

  const latestToiletByMember = new Map<string, { event_at: string; staff_name: string | null }>();
  const latestShowerByMember = new Map<string, { event_at: string; staff_name: string | null }>();
  (toiletResult.data ?? []).forEach((row: any) => {
    const memberId = String(row.member_id ?? "");
    if (!memberId || latestToiletByMember.has(memberId)) return;
    latestToiletByMember.set(memberId, {
      event_at: String(row.event_at),
      staff_name: row.profiles?.full_name ?? null
    });
  });
  (showerResult.data ?? []).forEach((row: any) => {
    const memberId = String(row.member_id ?? "");
    if (!memberId || latestShowerByMember.has(memberId)) return;
    latestShowerByMember.set(memberId, {
      event_at: String(row.event_at),
      staff_name: row.profiles?.full_name ?? null
    });
  });

  const now = new Date();
  return (membersResult.data ?? []).map((member: any) => {
    const lastToilet = latestToiletByMember.get(String(member.id)) ?? null;
    const lastShower = latestShowerByMember.get(String(member.id)) ?? null;
    const hoursSinceLastToilet = lastToilet
      ? Math.max((now.getTime() - new Date(lastToilet.event_at).getTime()) / 3600000, 0)
      : null;
    return {
      member_id: member.id,
      member_name: member.display_name,
      last_toilet_event_at: lastToilet?.event_at ?? null,
      last_toilet_staff_name: lastToilet?.staff_name ?? null,
      last_shower_event_at: lastShower?.event_at ?? null,
      last_shower_staff_name: lastShower?.staff_name ?? null,
      hours_since_last_toilet: hoursSinceLastToilet == null ? null : Number(hoursSinceLastToilet.toFixed(2))
    };
  });
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
  const supabase = await createClient();
  const [partnersResult, activitiesResult, leadsResult] = await Promise.all([
    supabase
      .from("community_partner_organizations")
      .select("id, partner_id, organization_name")
      .eq("active", true),
    supabase
      .from("partner_activities")
      .select("partner_id, activity_at")
      .gte("activity_at", `${filters.from}T00:00:00.000Z`)
      .lte("activity_at", `${filters.to}T23:59:59.999Z`),
    supabase
      .from("leads")
      .select("partner_id, status, created_at")
      .gte("created_at", `${filters.from}T00:00:00.000Z`)
      .lte("created_at", `${filters.to}T23:59:59.999Z`)
  ]);
  if (partnersResult.error) throw new Error(partnersResult.error.message);
  if (activitiesResult.error) throw new Error(activitiesResult.error.message);
  if (leadsResult.error) throw new Error(leadsResult.error.message);

  const touchCountByPartner = new Map<string, number>();
  (activitiesResult.data ?? []).forEach((row: any) => {
    const partnerId = String(row.partner_id ?? "");
    if (!partnerId) return;
    touchCountByPartner.set(partnerId, (touchCountByPartner.get(partnerId) ?? 0) + 1);
  });
  const referralsByPartner = new Map<string, number>();
  const wonByPartner = new Map<string, number>();
  (leadsResult.data ?? []).forEach((row: any) => {
    const partnerId = String(row.partner_id ?? "");
    if (!partnerId) return;
    referralsByPartner.set(partnerId, (referralsByPartner.get(partnerId) ?? 0) + 1);
    if (String(row.status ?? "").toLowerCase() === "won") {
      wonByPartner.set(partnerId, (wonByPartner.get(partnerId) ?? 0) + 1);
    }
  });

  return (partnersResult.data ?? []).map((row: any) => {
    const partnerCode = String(row.partner_id ?? "");
    const touches = touchCountByPartner.get(String(row.id)) ?? 0;
    const referrals = referralsByPartner.get(partnerCode) ?? 0;
    const won = wonByPartner.get(partnerCode) ?? 0;
    return {
      partner_id: row.id,
      partner_code: partnerCode,
      organization_name: row.organization_name,
      touches,
      referrals,
      won,
      conversion_rate: referrals > 0 ? Number((won / referrals).toFixed(4)) : null
    };
  }).sort((left, right) => right.referrals - left.referrals || left.organization_name.localeCompare(right.organization_name));
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
  const days = buildDays(filters);
  const supabase = await createClient();
  const [dailyRows, toiletRows, showerRows, transportationRows, bloodSugarRows] = await Promise.all([
    supabase
      .from("daily_activity_logs")
      .select("member_id, activity_date")
      .gte("activity_date", filters.from)
      .lte("activity_date", filters.to),
    supabase
      .from("toilet_logs")
      .select("member_id, event_at")
      .gte("event_at", `${filters.from}T00:00:00.000Z`)
      .lte("event_at", `${filters.to}T23:59:59.999Z`),
    supabase
      .from("shower_logs")
      .select("member_id, event_at")
      .gte("event_at", `${filters.from}T00:00:00.000Z`)
      .lte("event_at", `${filters.to}T23:59:59.999Z`),
    supabase
      .from("transportation_logs")
      .select("member_id, service_date")
      .gte("service_date", filters.from)
      .lte("service_date", filters.to),
    supabase
      .from("blood_sugar_logs")
      .select("member_id, checked_at")
      .gte("checked_at", `${filters.from}T00:00:00.000Z`)
      .lte("checked_at", `${filters.to}T23:59:59.999Z`)
  ]);
  const responseErrors = [dailyRows.error, toiletRows.error, showerRows.error, transportationRows.error, bloodSugarRows.error].filter(Boolean);
  if (responseErrors.length > 0) {
    throw new Error(String((responseErrors[0] as any).message ?? "Unable to load service utilization."));
  }
  const usage = new Map<string, {
    members: Set<string>;
    participation_logs: number;
    toileting_logs: number;
    shower_logs: number;
    transportation_logs: number;
    blood_sugar_logs: number;
  }>();
  const ensureDay = (day: string) => {
    const current = usage.get(day) ?? {
      members: new Set<string>(),
      participation_logs: 0,
      toileting_logs: 0,
      shower_logs: 0,
      transportation_logs: 0,
      blood_sugar_logs: 0
    };
    usage.set(day, current);
    return current;
  };
  (dailyRows.data ?? []).forEach((row: any) => {
    const day = String(row.activity_date ?? "").slice(0, 10);
    if (!day) return;
    const current = ensureDay(day);
    current.members.add(String(row.member_id ?? ""));
    current.participation_logs += 1;
  });
  (toiletRows.data ?? []).forEach((row: any) => {
    const day = String(row.event_at ?? "").slice(0, 10);
    if (!day) return;
    const current = ensureDay(day);
    current.members.add(String(row.member_id ?? ""));
    current.toileting_logs += 1;
  });
  (showerRows.data ?? []).forEach((row: any) => {
    const day = String(row.event_at ?? "").slice(0, 10);
    if (!day) return;
    const current = ensureDay(day);
    current.members.add(String(row.member_id ?? ""));
    current.shower_logs += 1;
  });
  (transportationRows.data ?? []).forEach((row: any) => {
    const day = String(row.service_date ?? "").slice(0, 10);
    if (!day) return;
    const current = ensureDay(day);
    current.members.add(String(row.member_id ?? ""));
    current.transportation_logs += 1;
  });
  (bloodSugarRows.data ?? []).forEach((row: any) => {
    const day = String(row.checked_at ?? "").slice(0, 10);
    if (!day) return;
    const current = ensureDay(day);
    current.members.add(String(row.member_id ?? ""));
    current.blood_sugar_logs += 1;
  });

  return days.map((day) => {
    const current = usage.get(day);
    return {
      date: day,
      total_members: current?.members.size ?? 0,
      participation_logs: current?.participation_logs ?? 0,
      toileting_logs: current?.toileting_logs ?? 0,
      shower_logs: current?.shower_logs ?? 0,
      transportation_logs: current?.transportation_logs ?? 0,
      blood_sugar_logs: current?.blood_sugar_logs ?? 0
    };
  });
}

export async function getAdminReportGeneratedAt() {
  return toEasternISO();
}

export async function isDateInCurrentPayPeriod(dateOnly: string) {
  return isDateInPayPeriod(`${dateOnly}T12:00:00.000Z`, getCurrentPayPeriod());
}
