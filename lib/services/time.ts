import type { AppRole } from "@/types/app";
import { getMockDb, getTimeReview } from "@/lib/mock-repo";
import { getCurrentPayPeriod, isDateInPayPeriod } from "@/lib/pay-period";
import { normalizeRoleKey } from "@/lib/permissions";
import { isMockMode } from "@/lib/runtime";
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

type SupabaseOverviewPunch = {
  id: string;
  punch_type: "in" | "out";
  punch_at: string;
  within_fence: boolean;
  distance_meters: number | null;
  note: string | null;
};

type SupabaseHistoryPunch = SupabaseOverviewPunch & {
  staff_user_id: string;
  staff_name: string;
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

function buildCanonicalPunchHistoryRows() {
  const db = getMockDb();
  const timePunchById = new Map(db.timePunches.map((row) => [row.id, row] as const));

  const linked = new Set<string>();
  const rows: CanonicalHistoryPunch[] = db.punches.map((row) => {
    const linkedTimePunchId = row.linked_time_punch_id ?? null;
    if (linkedTimePunchId) linked.add(linkedTimePunchId);
    const linkedTimePunch = linkedTimePunchId ? timePunchById.get(linkedTimePunchId) : null;

    return {
      id: row.id,
      staff_user_id: row.employee_id,
      staff_name: row.employee_name,
      punch_type: row.type,
      punch_at: row.timestamp,
      within_fence: linkedTimePunch?.within_fence ?? null,
      distance_meters: linkedTimePunch?.distance_meters ?? null,
      note: row.note ?? linkedTimePunch?.note ?? null,
      source: row.source,
      status: row.status,
      linked_time_punch_id: linkedTimePunchId
    };
  });

  // Keep backwards compatibility for any historical rows where employee punches
  // still exist only in `timePunches` and haven't been mirrored into `punches`.
  db.timePunches.forEach((row) => {
    if (linked.has(row.id)) return;
    rows.push({
      id: `legacy-time-punch-${row.id}`,
      staff_user_id: row.staff_user_id,
      staff_name: row.staff_name,
      punch_type: row.punch_type,
      punch_at: row.punch_at,
      within_fence: row.within_fence,
      distance_meters: row.distance_meters,
      note: row.note ?? null,
      source: "employee",
      status: "active",
      linked_time_punch_id: row.id
    });
  });

  return rows.sort((left, right) => (left.punch_at < right.punch_at ? 1 : -1));
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

function filterPeriodPunches(rows: CanonicalHistoryPunch[], period: PayPeriod) {
  return rows.filter((row) => isDateInPayPeriod(row.punch_at, period));
}

function buildMockOverview(staffUserId: string, period: PayPeriod) {
  const today = toEasternDate();
  const allPunches = buildCanonicalPunchHistoryRows().filter((row) => row.staff_user_id === staffUserId);
  const todaysPunches = allPunches.filter((row) => toEasternDate(row.punch_at) === today);
  const periodPunches = filterPeriodPunches(allPunches, period);
  const dailySummary = summarizePunchRows(todaysPunches);
  const periodSummary = summarizePunchRows(periodPunches);
  const latestActive = allPunches.find((row) => row.status === "active");

  return {
    periodStart: period.startAtIso,
    payPeriodLabel: period.label,
    currentStatus: latestActive?.punch_type === "in" ? "Clocked In" : "Clocked Out",
    punches: allPunches,
    exceptions: periodPunches
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

function buildMockManagerReview(period: PayPeriod) {
  const db = getMockDb();
  const historyRows = buildCanonicalPunchHistoryRows();

  return db.staff
    .map((staff) => {
      const punches = filterPeriodPunches(
        historyRows.filter((row) => row.staff_user_id === staff.id),
        period
      );
      const summary = summarizePunchRows(punches);
      const baseStatus = summary.missingClockOuts > 0 || summary.longShifts > 0 ? "Needs Follow-up" : "Reviewed";
      const baseNotes =
        summary.missingClockOuts > 0 || summary.longShifts > 0
          ? `Missing punches: ${summary.missingClockOuts}, long shifts: ${summary.longShifts}`
          : "-";
      const review = getTimeReview(staff.full_name, period.label);

      return {
        staff_name: staff.full_name,
        pay_period: period.label,
        total_hours_worked: summary.rawHours,
        meal_deduction_applied: summary.mealDeductionHours,
        adjusted_hours: summary.workedHours,
        exception_notes: review?.notes || baseNotes,
        approval_status: review?.status ?? baseStatus,
        reviewed_by: review?.reviewed_by ?? null,
        reviewed_at: review?.reviewed_at ?? null
      };
    })
    .sort((a, b) => (a.staff_name > b.staff_name ? 1 : -1));
}

function getMockPunchHistory(staffUserId: string, role: AppRole) {
  const normalizedRole = normalizeRoleKey(role);
  return buildCanonicalPunchHistoryRows().filter((row) =>
    normalizedRole === "admin" || normalizedRole === "manager" || normalizedRole === "director"
      ? true
      : row.staff_user_id === staffUserId
  );
}

function roleCanSeeAllPunches(role: AppRole) {
  const normalizedRole = normalizeRoleKey(role);
  return normalizedRole === "admin" || normalizedRole === "manager" || normalizedRole === "director";
}

function mapSupabaseHistoryRows(rows: SupabaseHistoryPunch[]) {
  return rows.map((row) => ({
    ...row,
    source: "employee" as const,
    status: "active" as const,
    linked_time_punch_id: row.id
  }));
}

function mapSupabaseOverviewRows(rows: SupabaseOverviewPunch[]) {
  return rows.map((row) => ({
    ...row,
    source: "employee" as const,
    status: "active" as const,
    linked_time_punch_id: row.id,
    staff_user_id: "",
    staff_name: ""
  }));
}

function summarizeSupabaseRows(rows: SupabaseOverviewPunch[]) {
  const canonicalRows = mapSupabaseOverviewRows(rows);
  return summarizePunchRows(canonicalRows);
}

function buildSupabaseOverview(
  period: PayPeriod,
  rows: SupabaseOverviewPunch[],
  exceptions: Array<{ id: string; exception_type: string; message: string; resolved: boolean }>
) {
  const today = toEasternDate();
  const todayRows = rows.filter((row) => toEasternDate(row.punch_at) === today);
  const periodRows = rows.filter((row) => isDateInPayPeriod(row.punch_at, period));
  const dailySummary = summarizeSupabaseRows(todayRows);
  const periodSummary = summarizeSupabaseRows(periodRows);

  return {
    periodStart: period.startAtIso,
    payPeriodLabel: period.label,
    currentStatus: rows[0]?.punch_type === "in" ? "Clocked In" : "Clocked Out",
    punches: mapSupabaseOverviewRows(rows),
    exceptions,
    dailyHours: dailySummary.rawHours,
    payPeriodHours: periodSummary.rawHours,
    mealDeductionHours: dailySummary.mealDeductionHours,
    adjustedPayPeriodHours: periodSummary.workedHours
  };
}

export async function getTimeCardOverview(userId: string) {
  const period = getCurrentPayPeriod();

  if (isMockMode()) {
    return buildMockOverview(userId, period);
  }

  const supabase = await createClient();

  const { data: punches } = await supabase
    .from("time_punches")
    .select("id, punch_type, punch_at, within_fence, distance_meters, note")
    .eq("staff_user_id", userId)
    .gte("punch_at", period.startAtIso)
    .lt("punch_at", period.endExclusiveIso)
    .order("punch_at", { ascending: false });

  const { data: exceptions } = await supabase
    .from("time_punch_exceptions")
    .select("id, exception_type, message, resolved")
    .eq("staff_user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);

  return buildSupabaseOverview(period, (punches ?? []) as SupabaseOverviewPunch[], exceptions ?? []);
}

export async function getManagerTimeReview() {
  const period = getCurrentPayPeriod();

  if (isMockMode()) {
    return buildMockManagerReview(period);
  }

  const supabase = await createClient();

  const { data } = await supabase
    .from("v_biweekly_totals")
    .select("staff_name, regular_hours, meal_deduct_hours, payable_hours, exception_count")
    .order("staff_name");

  return (data ?? []).map((row: any) => ({
    ...row,
    pay_period: period.label,
    total_hours_worked: row.regular_hours,
    meal_deduction_applied: row.meal_deduct_hours,
    adjusted_hours: row.payable_hours,
    exception_notes: row.exception_count > 0 ? "Review required" : "-",
    approval_status: "Pending"
  }));
}

export async function getPunchHistory(staffUserId: string, role: AppRole) {
  if (isMockMode()) {
    return getMockPunchHistory(staffUserId, role);
  }

  const supabase = await createClient();
  let query = supabase
    .from("time_punches")
    .select("id, staff_user_id, staff_name, punch_type, punch_at, within_fence, distance_meters, note")
    .order("punch_at", { ascending: false });

  if (!roleCanSeeAllPunches(role)) {
    query = query.eq("staff_user_id", staffUserId);
  }

  const { data } = await query.limit(1000);
  return mapSupabaseHistoryRows((data ?? []) as SupabaseHistoryPunch[]);
}
