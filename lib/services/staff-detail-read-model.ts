import "server-only";

import { getCurrentPayPeriod, isDateInPayPeriod } from "@/lib/pay-period";
import { createClient } from "@/lib/supabase/server";

function sortDesc<T>(rows: T[], getValue: (row: T) => string) {
  return [...rows].sort((a, b) => (getValue(a) < getValue(b) ? 1 : -1));
}

function summarizePunches(punches: { punch_type: "in" | "out"; punch_at: string }[]) {
  const ordered = [...punches].sort((a, b) => (a.punch_at > b.punch_at ? 1 : -1));
  let total = 0;
  const exceptions: string[] = [];

  for (let i = 0; i < ordered.length; i += 1) {
    const current = ordered[i];
    const next = ordered[i + 1];

    if (current.punch_type === "in") {
      if (!next || next.punch_type !== "out") {
        exceptions.push(`Missing clock-out after ${current.punch_at}`);
        continue;
      }

      const hours = (new Date(next.punch_at).getTime() - new Date(current.punch_at).getTime()) / 3600000;
      if (hours > 12) {
        exceptions.push(`Long shift (${hours.toFixed(2)}h) on ${current.punch_at.slice(0, 10)}`);
      }
      if (hours > 0) total += hours;
    }
  }

  const mealDeduction = total >= 6 ? 0.5 : 0;
  return {
    totalHours: Number(total.toFixed(2)),
    mealDeduction,
    adjustedHours: Number((total - mealDeduction).toFixed(2)),
    exceptions
  };
}

export async function getStaffDetail(staffId: string) {
  const supabase = await createClient();
  const { data: staff, error: staffError } = await supabase.from("profiles").select("*").eq("id", staffId).maybeSingle();
  if (staffError) throw new Error(staffError.message);
  if (!staff) return null;

  const [punchesResult, dailyActivitiesResult, toiletsResult, showersResult, transportationResult, ancillaryResult, leadActivitiesResult, assessmentsResult] =
    await Promise.all([
      supabase.from("time_punches").select("*").eq("staff_user_id", staffId).order("punch_at", { ascending: false }),
      supabase.from("daily_activity_logs").select("*").eq("staff_user_id", staffId).order("created_at", { ascending: false }),
      supabase.from("toilet_logs").select("*").eq("staff_user_id", staffId).order("event_at", { ascending: false }),
      supabase.from("shower_logs").select("*").eq("staff_user_id", staffId).order("event_at", { ascending: false }),
      supabase.from("transportation_logs").select("*").eq("staff_user_id", staffId).order("service_date", { ascending: false }),
      supabase.from("ancillary_charge_logs").select("*").eq("staff_user_id", staffId).order("created_at", { ascending: false }),
      supabase.from("lead_activities").select("*").eq("completed_by_user_id", staffId).order("activity_at", { ascending: false }),
      supabase.from("intake_assessments").select("*").eq("created_by_user_id", staffId).order("created_at", { ascending: false })
    ]);

  if (punchesResult.error) throw new Error(punchesResult.error.message);
  if (dailyActivitiesResult.error) throw new Error(dailyActivitiesResult.error.message);
  if (toiletsResult.error) throw new Error(toiletsResult.error.message);
  if (showersResult.error) throw new Error(showersResult.error.message);
  if (transportationResult.error) throw new Error(transportationResult.error.message);
  if (ancillaryResult.error) throw new Error(ancillaryResult.error.message);
  if (leadActivitiesResult.error) throw new Error(leadActivitiesResult.error.message);
  if (assessmentsResult.error) throw new Error(assessmentsResult.error.message);

  const punches = sortDesc((punchesResult.data ?? []) as Array<{ punch_at: string }>, (r) => r.punch_at);

  return {
    staff,
    punches,
    dailyActivities: dailyActivitiesResult.data ?? [],
    toilets: toiletsResult.data ?? [],
    showers: showersResult.data ?? [],
    transportation: transportationResult.data ?? [],
    ancillary: ancillaryResult.data ?? [],
    leadActivities: leadActivitiesResult.data ?? [],
    assessments: assessmentsResult.data ?? [],
    punchSummary: summarizePunches(
      punches.map((row: any) => ({
        punch_type: row.punch_type,
        punch_at: row.punch_at
      }))
    )
  };
}

export async function getTimeReviewDetail(staffId: string) {
  const supabase = await createClient();
  const { data: staff, error: staffError } = await supabase.from("profiles").select("*").eq("id", staffId).maybeSingle();
  if (staffError) throw new Error(staffError.message);
  if (!staff) return null;

  const period = getCurrentPayPeriod();
  const { data: punches, error: punchesError } = await supabase
    .from("time_punches")
    .select("punch_type, punch_at")
    .eq("staff_user_id", staffId)
    .order("punch_at", { ascending: false });
  if (punchesError) throw new Error(punchesError.message);

  const periodPunches = (punches ?? []).filter((p: any) => isDateInPayPeriod(p.punch_at, period));
  const summary = summarizePunches(periodPunches as Array<{ punch_type: "in" | "out"; punch_at: string }>);

  return {
    staff,
    punches: periodPunches,
    payPeriod: period.label,
    ...summary
  };
}
