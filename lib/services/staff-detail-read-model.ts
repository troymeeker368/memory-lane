import "server-only";

import {
  STAFF_DETAIL_ANCILLARY_SELECT,
  STAFF_DETAIL_ASSESSMENT_SELECT,
  STAFF_DETAIL_DAILY_ACTIVITY_SELECT,
  STAFF_DETAIL_LEAD_ACTIVITY_SELECT,
  STAFF_DETAIL_PUNCH_SELECT,
  STAFF_DETAIL_SHOWER_SELECT,
  STAFF_DETAIL_TOILET_SELECT,
  STAFF_DETAIL_TRANSPORTATION_SELECT
} from "@/lib/services/activity-detail-selects";
import { getCurrentPayPeriod } from "@/lib/pay-period";
import { createClient } from "@/lib/supabase/server";

const STAFF_DETAIL_HISTORY_LIMIT = 250;
const STAFF_DETAIL_PROFILE_SELECT =
  "id, auth_user_id, full_name, email, phone, role, role_id, title, department, status, active, is_active, has_custom_permissions, default_landing, staff_id, credentials, invited_at, password_set_at, last_sign_in_at, disabled_at, created_at, updated_at";

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
  const { data: staff, error: staffError } = await supabase
    .from("profiles")
    .select(STAFF_DETAIL_PROFILE_SELECT)
    .eq("id", staffId)
    .maybeSingle();
  if (staffError) throw new Error(staffError.message);
  if (!staff) return null;

  const [punchesResult, dailyActivitiesResult, toiletsResult, showersResult, transportationResult, ancillaryResult, leadActivitiesResult, assessmentsResult] =
    await Promise.all([
      supabase.from("time_punches").select(STAFF_DETAIL_PUNCH_SELECT).eq("staff_user_id", staffId).order("punch_at", { ascending: false }).limit(STAFF_DETAIL_HISTORY_LIMIT),
      supabase
        .from("daily_activity_logs")
        .select(STAFF_DETAIL_DAILY_ACTIVITY_SELECT)
        .eq("staff_user_id", staffId)
        .order("created_at", { ascending: false })
        .limit(STAFF_DETAIL_HISTORY_LIMIT),
      supabase.from("toilet_logs").select(STAFF_DETAIL_TOILET_SELECT).eq("staff_user_id", staffId).order("event_at", { ascending: false }).limit(STAFF_DETAIL_HISTORY_LIMIT),
      supabase.from("shower_logs").select(STAFF_DETAIL_SHOWER_SELECT).eq("staff_user_id", staffId).order("event_at", { ascending: false }).limit(STAFF_DETAIL_HISTORY_LIMIT),
      supabase
        .from("transportation_logs")
        .select(STAFF_DETAIL_TRANSPORTATION_SELECT)
        .eq("staff_user_id", staffId)
        .order("service_date", { ascending: false })
        .limit(STAFF_DETAIL_HISTORY_LIMIT),
      supabase
        .from("ancillary_charge_logs")
        .select(STAFF_DETAIL_ANCILLARY_SELECT)
        .eq("staff_user_id", staffId)
        .order("created_at", { ascending: false })
        .limit(STAFF_DETAIL_HISTORY_LIMIT),
      supabase
        .from("lead_activities")
        .select(STAFF_DETAIL_LEAD_ACTIVITY_SELECT)
        .eq("completed_by_user_id", staffId)
        .order("activity_at", { ascending: false })
        .limit(STAFF_DETAIL_HISTORY_LIMIT),
      supabase
        .from("intake_assessments")
        .select(STAFF_DETAIL_ASSESSMENT_SELECT)
        .eq("completed_by_user_id", staffId)
        .order("created_at", { ascending: false })
        .limit(STAFF_DETAIL_HISTORY_LIMIT)
    ]);

  if (punchesResult.error) throw new Error(punchesResult.error.message);
  if (dailyActivitiesResult.error) throw new Error(dailyActivitiesResult.error.message);
  if (toiletsResult.error) throw new Error(toiletsResult.error.message);
  if (showersResult.error) throw new Error(showersResult.error.message);
  if (transportationResult.error) throw new Error(transportationResult.error.message);
  if (ancillaryResult.error) throw new Error(ancillaryResult.error.message);
  if (leadActivitiesResult.error) throw new Error(leadActivitiesResult.error.message);
  if (assessmentsResult.error) throw new Error(assessmentsResult.error.message);

  const punches = (punchesResult.data ?? []) as Array<{ punch_type: "in" | "out"; punch_at: string }>;

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
      punches.map((row) => ({
        punch_type: row.punch_type,
        punch_at: row.punch_at
      }))
    )
  };
}

export async function getTimeReviewDetail(staffId: string) {
  const supabase = await createClient();
  const { data: staff, error: staffError } = await supabase
    .from("profiles")
    .select(STAFF_DETAIL_PROFILE_SELECT)
    .eq("id", staffId)
    .maybeSingle();
  if (staffError) throw new Error(staffError.message);
  if (!staff) return null;

  const period = getCurrentPayPeriod();
  const { data: punches, error: punchesError } = await supabase
    .from("time_punches")
    .select("punch_type, punch_at")
    .eq("staff_user_id", staffId)
    .gte("punch_at", period.startAtIso)
    .lt("punch_at", period.endExclusiveIso)
    .order("punch_at", { ascending: false });
  if (punchesError) throw new Error(punchesError.message);

  const periodPunches = (punches ?? []) as Array<{ punch_type: "in" | "out"; punch_at: string }>;
  const summary = summarizePunches(periodPunches as Array<{ punch_type: "in" | "out"; punch_at: string }>);

  return {
    staff,
    punches: periodPunches,
    payPeriod: period.label,
    ...summary
  };
}
