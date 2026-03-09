import type { AppRole } from "@/types/app";
import { getMockTimeCardOverview } from "@/lib/mock-data";
import { getMockDb, getTimeReview } from "@/lib/mock-repo";
import { getCurrentPayPeriod, isDateInPayPeriod } from "@/lib/pay-period";
import { isMockMode } from "@/lib/runtime";
import { createClient } from "@/lib/supabase/server";
import { toEasternDate } from "@/lib/timezone";

function computeHoursFromPunches(punches: { punch_type: "in" | "out"; punch_at: string }[]) {
  const ordered = [...punches].sort((a, b) => (a.punch_at > b.punch_at ? 1 : -1));
  let hours = 0;

  for (let i = 0; i < ordered.length - 1; i += 1) {
    if (ordered[i].punch_type === "in" && ordered[i + 1].punch_type === "out") {
      const diff = (new Date(ordered[i + 1].punch_at).getTime() - new Date(ordered[i].punch_at).getTime()) / 3600000;
      if (diff > 0) {
        hours += diff;
      }
    }
  }

  return Number(hours.toFixed(2));
}

function countMissingClockOuts(punches: { punch_type: "in" | "out"; punch_at: string }[]) {
  const ordered = [...punches].sort((a, b) => (a.punch_at > b.punch_at ? 1 : -1));
  let missing = 0;

  for (let i = 0; i < ordered.length; i += 1) {
    const current = ordered[i];
    const next = ordered[i + 1];
    if (current.punch_type === "in" && (!next || next.punch_type !== "out")) {
      missing += 1;
    }
  }

  return missing;
}

function countLongShifts(punches: { punch_type: "in" | "out"; punch_at: string }[]) {
  const ordered = [...punches].sort((a, b) => (a.punch_at > b.punch_at ? 1 : -1));
  let count = 0;

  for (let i = 0; i < ordered.length - 1; i += 1) {
    if (ordered[i].punch_type === "in" && ordered[i + 1].punch_type === "out") {
      const diff = (new Date(ordered[i + 1].punch_at).getTime() - new Date(ordered[i].punch_at).getTime()) / 3600000;
      if (diff > 12) {
        count += 1;
      }
    }
  }

  return count;
}

export async function getTimeCardOverview(userId: string) {
  const period = getCurrentPayPeriod();

  if (isMockMode()) {
    // TODO(backend): Remove mock branch when time-card data is loaded from Supabase in local/dev.
    const data = getMockTimeCardOverview(userId);
    const today = toEasternDate();
    const todaysPunches = data.punches.filter((p) => p.punch_at.startsWith(today));
    const periodPunches = data.punches.filter((p) => isDateInPayPeriod(p.punch_at, period));
    const dailyHours = computeHoursFromPunches(todaysPunches);
    const payPeriodHours = computeHoursFromPunches(periodPunches);
    return {
      ...data,
      periodStart: period.startAtIso,
      payPeriodLabel: period.label,
      dailyHours,
      payPeriodHours,
      mealDeductionHours: dailyHours >= 6 ? 0.5 : 0,
      adjustedPayPeriodHours: Number((payPeriodHours - (payPeriodHours >= 6 ? 0.5 : 0)).toFixed(2))
    };
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

  const finalPunches = punches ?? [];
  const today = toEasternDate();
  const todaysPunches = finalPunches.filter((p) => p.punch_at.startsWith(today));
  const dailyHours = computeHoursFromPunches(todaysPunches);
  const payPeriodHours = computeHoursFromPunches(finalPunches);

  return {
    periodStart: period.startAtIso,
    payPeriodLabel: period.label,
    currentStatus: finalPunches[0]?.punch_type === "in" ? "Clocked In" : "Clocked Out",
    punches: finalPunches,
    exceptions: exceptions ?? [],
    dailyHours,
    payPeriodHours,
    mealDeductionHours: dailyHours >= 6 ? 0.5 : 0,
    adjustedPayPeriodHours: Number((payPeriodHours - (payPeriodHours >= 6 ? 0.5 : 0)).toFixed(2))
  };
}

export async function getManagerTimeReview() {
  const period = getCurrentPayPeriod();

  if (isMockMode()) {
    // TODO(backend): Remove mock branch when manager review data is loaded from Supabase in local/dev.
    const db = getMockDb();

    return db.staff
      .map((staff) => {
        const punches = db.timePunches
          .filter((p) => p.staff_user_id === staff.id)
          .filter((p) => isDateInPayPeriod(p.punch_at, period));

        const totalHoursWorked = computeHoursFromPunches(punches);
        const mealDeductionApplied = totalHoursWorked >= 6 ? 0.5 : 0;
        const adjustedHours = Number((totalHoursWorked - mealDeductionApplied).toFixed(2));
        const missingPunches = countMissingClockOuts(punches);
        const longShifts = countLongShifts(punches);
        const baseStatus = missingPunches > 0 || longShifts > 0 ? "Needs Follow-up" : "Reviewed";
        const baseNotes = missingPunches > 0 || longShifts > 0 ? `Missing punches: ${missingPunches}, long shifts: ${longShifts}` : "-";

        const review = getTimeReview(staff.full_name, period.label);

        return {
          staff_name: staff.full_name,
          pay_period: period.label,
          total_hours_worked: totalHoursWorked,
          meal_deduction_applied: mealDeductionApplied,
          adjusted_hours: adjustedHours,
          exception_notes: review?.notes || baseNotes,
          approval_status: review?.status ?? baseStatus,
          reviewed_by: review?.reviewed_by ?? null,
          reviewed_at: review?.reviewed_at ?? null
        };
      })
      .sort((a, b) => (a.staff_name > b.staff_name ? 1 : -1));
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
    const db = getMockDb();
    return db.timePunches
      .filter((row) => (role === "admin" || role === "manager" ? true : row.staff_user_id === staffUserId))
      .sort((a, b) => (a.punch_at < b.punch_at ? 1 : -1));
  }

  const supabase = await createClient();
  let query = supabase
    .from("time_punches")
    .select("id, staff_user_id, staff_name, punch_type, punch_at, within_fence, distance_meters, note")
    .order("punch_at", { ascending: false });

  if (role !== "admin" && role !== "manager") {
    query = query.eq("staff_user_id", staffUserId);
  }

  const { data } = await query.limit(1000);
  return data ?? [];
}
