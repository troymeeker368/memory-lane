import type { AppRole } from "@/types/app";
import { getCurrentPayPeriod, isDateInPayPeriod } from "@/lib/pay-period";
import { normalizeRoleKey } from "@/lib/permissions";
import { calculateDailyTimecard, type TimecardPunch } from "@/lib/services/timecard-workflow";
import { createClient } from "@/lib/supabase/server";
import { toEasternDate } from "@/lib/timezone";

type PunchSource = "employee" | "director_correction" | "approved_forgotten_punch";
type PunchStatus = "active" | "voided";
type PayPeriod = ReturnType<typeof getCurrentPayPeriod>;

type CanonicalHistoryPunch = {
  id: string;
  staff_user_id: string;
  staff_name: string;
  punch_type: "in" | "out";
  punch_at: string;
  within_fence: boolean | null;
  distance_meters: number | null;
  note: string | null;
  source: PunchSource;
  status: PunchStatus;
  linked_time_punch_id: string | null;
};

type SupabasePunchRow = {
  id: string;
  employee_id: string;
  employee_name: string;
  timestamp: string;
  type: "in" | "out";
  source: PunchSource;
  status: PunchStatus;
  note: string | null;
  linked_time_punch_id: string | null;
};

function roundHours(value: number) {
  return Number(value.toFixed(2));
}

function toWorkflowPunch(row: CanonicalHistoryPunch): TimecardPunch {
  return {
    id: row.id,
    timestamp: row.punch_at,
    type: row.punch_type,
    source: row.source,
    status: row.status
  };
}

function summarizePunchRows(punches: CanonicalHistoryPunch[]) {
  const grouped = new Map<string, CanonicalHistoryPunch[]>();
  punches.forEach((row) => {
    if (row.status !== "active") return;
    const workDate = toEasternDate(row.punch_at);
    const existing = grouped.get(workDate) ?? [];
    existing.push(row);
    grouped.set(workDate, existing);
  });

  let rawHours = 0;
  let mealDeductionHours = 0;
  let workedHours = 0;
  let missingClockOuts = 0;
  let longShifts = 0;

  grouped.forEach((rows) => {
    const calculation = calculateDailyTimecard({
      punches: rows.map((row) => toWorkflowPunch(row)),
      ptoHours: 0
    });
    rawHours += calculation.rawHours;
    mealDeductionHours += calculation.mealDeductionHours;
    workedHours += calculation.workedHours;
    if (calculation.exceptionReasons.includes("missing_in_or_out")) missingClockOuts += 1;
    if (calculation.rawHours > 12) longShifts += 1;
  });

  return {
    rawHours: roundHours(rawHours),
    mealDeductionHours: roundHours(mealDeductionHours),
    workedHours: roundHours(workedHours),
    missingClockOuts,
    longShifts
  };
}

function roleCanSeeAllPunches(role: AppRole) {
  const normalizedRole = normalizeRoleKey(role);
  return normalizedRole === "admin" || normalizedRole === "manager" || normalizedRole === "director";
}

function isStackDepthLimitError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const message = "message" in error ? String((error as { message?: unknown }).message ?? "") : "";
  return /stack depth limit exceeded/i.test(message);
}

function buildPunchesQuery(
  supabase: Awaited<ReturnType<typeof createClient>>,
  input: {
    staffUserId?: string | null;
    role?: AppRole;
    period?: PayPeriod;
    limit?: number;
  }
) {
  let query = supabase
    .from("punches")
    .select("id, employee_id, employee_name, timestamp, type, source, status, note, linked_time_punch_id")
    .order("timestamp", { ascending: false });

  if (input.staffUserId && input.role && !roleCanSeeAllPunches(input.role)) {
    query = query.eq("employee_id", input.staffUserId);
  }
  if (input.staffUserId && !input.role) {
    query = query.eq("employee_id", input.staffUserId);
  }
  if (input.period) {
    query = query
      .gte("timestamp", input.period.startAtIso)
      .lt("timestamp", input.period.endExclusiveIso);
  }
  if (input.limit) {
    query = query.limit(input.limit);
  }

  return query;
}

async function loadSupabaseCanonicalPunchRows(input: {
  staffUserId?: string | null;
  role?: AppRole;
  period?: PayPeriod;
  limit?: number;
}) {
  let supabase = await createClient();
  let { data: punchesData, error: punchesError } = await buildPunchesQuery(supabase, input);
  if (punchesError && isStackDepthLimitError(punchesError)) {
    supabase = await createClient({ serviceRole: true });
    const retry = await buildPunchesQuery(supabase, input);
    punchesData = retry.data;
    punchesError = retry.error;
  }
  if (punchesError) throw new Error(punchesError.message);
  const punchRows = (punchesData ?? []) as SupabasePunchRow[];

  const linkedIds = punchRows
    .map((row) => row.linked_time_punch_id)
    .filter((value): value is string => Boolean(value));
  const geofenceByLinkedId = new Map<string, { within_fence: boolean; distance_meters: number | null; note: string | null }>();
  if (linkedIds.length > 0) {
    let { data: geofenceRows, error: geofenceError } = await supabase
      .from("time_punches")
      .select("id, within_fence, distance_meters, note")
      .in("id", linkedIds);
    if (geofenceError && isStackDepthLimitError(geofenceError)) {
      const serviceSupabase = await createClient({ serviceRole: true });
      const retry = await serviceSupabase
        .from("time_punches")
        .select("id, within_fence, distance_meters, note")
        .in("id", linkedIds);
      geofenceRows = retry.data;
      geofenceError = retry.error;
    }
    if (geofenceError) throw new Error(geofenceError.message);
    (geofenceRows ?? []).forEach((row: any) => {
      geofenceByLinkedId.set(String(row.id), {
        within_fence: Boolean(row.within_fence),
        distance_meters: row.distance_meters == null ? null : Number(row.distance_meters),
        note: (row.note as string | null) ?? null
      });
    });
  }

  return punchRows.map<CanonicalHistoryPunch>((row) => {
    const linked = row.linked_time_punch_id ? geofenceByLinkedId.get(row.linked_time_punch_id) : null;
    return {
      id: row.id,
      staff_user_id: row.employee_id,
      staff_name: row.employee_name,
      punch_type: row.type,
      punch_at: row.timestamp,
      within_fence: linked?.within_fence ?? null,
      distance_meters: linked?.distance_meters ?? null,
      note: row.note ?? linked?.note ?? null,
      source: row.source,
      status: row.status,
      linked_time_punch_id: row.linked_time_punch_id
    };
  });
}

function buildSupabaseOverview(period: PayPeriod, rows: CanonicalHistoryPunch[]) {
  const today = toEasternDate();
  const todayRows = rows.filter((row) => toEasternDate(row.punch_at) === today);
  const periodRows = rows.filter((row) => isDateInPayPeriod(row.punch_at, period));
  const dailySummary = summarizePunchRows(todayRows);
  const periodSummary = summarizePunchRows(periodRows);
  const latestActive = rows.find((row) => row.status === "active");

  return {
    periodStart: period.startAtIso,
    payPeriodLabel: period.label,
    currentStatus: latestActive?.punch_type === "in" ? "Clocked In" : "Clocked Out",
    punches: rows,
    exceptions: periodRows
      .filter((row) => row.within_fence === false)
      .map((row) => ({
        id: `ex-${row.id}`,
        exception_type: "geofence",
        message: `Outside fence at ${row.distance_meters ?? "?"}m`,
        resolved: false
      }))
      .slice(0, 20),
    dailyHours: dailySummary.rawHours,
    payPeriodHours: periodSummary.rawHours,
    mealDeductionHours: dailySummary.mealDeductionHours,
    adjustedPayPeriodHours: periodSummary.workedHours
  };
}

export async function getTimeCardOverview(userId: string) {
  const period = getCurrentPayPeriod();
  const punches = await loadSupabaseCanonicalPunchRows({ staffUserId: userId, period });
  return buildSupabaseOverview(period, punches);
}

export async function getManagerTimeReview() {
  const period = getCurrentPayPeriod();
  const supabase = await createClient();
  const { data: payPeriodsData, error: payPeriodsError } = await supabase
    .from("pay_periods")
    .select("id, start_date, end_date")
    .order("start_date", { ascending: false });
  if (payPeriodsError) throw new Error(payPeriodsError.message);

  const selectedPayPeriod =
    (payPeriodsData ?? []).find((row: any) => row.start_date === period.startDate && row.end_date === period.endDate) ??
    (payPeriodsData ?? [])[0];
  if (!selectedPayPeriod) return [];

  const { data: timecardsData, error: timecardsError } = await supabase
    .from("daily_timecards")
    .select("employee_id, employee_name, raw_hours, meal_deduction_hours, worked_hours, has_exception, status")
    .eq("pay_period_id", selectedPayPeriod.id);
  if (timecardsError) throw new Error(timecardsError.message);

  const byEmployee = new Map<string, {
    staff_name: string;
    total_hours_worked: number;
    meal_deduction_applied: number;
    adjusted_hours: number;
    exception_count: number;
    statuses: Set<string>;
  }>();
  (timecardsData ?? []).forEach((row: any) => {
    const key = String(row.employee_id);
    const existing = byEmployee.get(key) ?? {
      staff_name: String(row.employee_name),
      total_hours_worked: 0,
      meal_deduction_applied: 0,
      adjusted_hours: 0,
      exception_count: 0,
      statuses: new Set<string>()
    };
    existing.total_hours_worked = roundHours(existing.total_hours_worked + Number(row.raw_hours ?? 0));
    existing.meal_deduction_applied = roundHours(existing.meal_deduction_applied + Number(row.meal_deduction_hours ?? 0));
    existing.adjusted_hours = roundHours(existing.adjusted_hours + Number(row.worked_hours ?? 0));
    existing.exception_count += row.has_exception ? 1 : 0;
    existing.statuses.add(String(row.status ?? "pending"));
    byEmployee.set(key, existing);
  });

  return [...byEmployee.values()]
    .map((row) => ({
      staff_name: row.staff_name,
      pay_period: period.label,
      total_hours_worked: row.total_hours_worked,
      meal_deduction_applied: row.meal_deduction_applied,
      adjusted_hours: row.adjusted_hours,
      exception_notes: row.exception_count > 0 ? `Exceptions: ${row.exception_count}` : "-",
      approval_status: row.statuses.has("pending") || row.statuses.has("needs_review") ? "Needs Follow-up" : "Reviewed",
      reviewed_by: null,
      reviewed_at: null
    }))
    .sort((a, b) => (a.staff_name > b.staff_name ? 1 : -1));
}

export async function getPunchHistory(staffUserId: string, role: AppRole) {
  return loadSupabaseCanonicalPunchRows({
    staffUserId,
    role,
    limit: 1000
  });
}
