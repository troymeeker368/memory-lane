import { getMockDashboardAlerts, getMockDashboardStats } from "@/lib/mock-data";
import { isMockMode } from "@/lib/runtime";
import { getIncompleteAttendanceSummary } from "@/lib/services/attendance";
import { getOperationsTodayDate } from "@/lib/services/operations-calendar";
import { createClient } from "@/lib/supabase/server";
import { toEasternDate, toEasternISO } from "@/lib/timezone";

export async function getDashboardStats(userId: string) {
  if (isMockMode()) {
    // TODO(backend): Remove mock branch when dashboard stats come from Supabase in local/dev.
    return {
      ...getMockDashboardStats(userId),
      incompleteAttendance: getIncompleteAttendanceSummary({ selectedDate: getOperationsTodayDate() })
    };
  }

  const supabase = await createClient();

  const today = new Date();
  const start = new Date(today);
  start.setHours(0, 0, 0, 0);
  const end = new Date(today);
  end.setHours(23, 59, 59, 999);

  const [{ count: todaysLogs }, { count: missingDocs }, { data: latestPunches }] = await Promise.all([
    supabase
      .from("documentation_events")
      .select("id", { count: "exact", head: true })
      .gte("event_at", toEasternISO(start))
      .lte("event_at", toEasternISO(end)),
    supabase
      .from("documentation_assignments")
      .select("id", { count: "exact", head: true })
      .lt("due_at", toEasternISO())
      .eq("completed", false),
    supabase
      .from("time_punches")
      .select("id, punch_type, punch_at")
      .eq("staff_user_id", userId)
      .order("punch_at", { ascending: false })
      .limit(5)
  ]);

  return {
    todaysLogs: todaysLogs ?? 0,
    missingDocs: missingDocs ?? 0,
    latestPunches: latestPunches ?? [],
    incompleteAttendance: {
      selectedDate: getOperationsTodayDate(),
      pendingWithoutStatus: 0,
      checkInMissingCheckOut: 0,
      checkOutMissingCheckIn: 0,
      totalIncomplete: 0
    }
  };
}

export async function getDashboardAlerts() {
  if (isMockMode()) {
    // TODO(backend): Remove mock branch when dashboard alerts come from Supabase in local/dev.
    return getMockDashboardAlerts();
  }

  const supabase = await createClient();

  const { data: overdueCarePlan } = await supabase
    .from("documentation_tracker")
    .select("id")
    .lt("next_care_plan_due", toEasternDate())
    .eq("care_plan_done", false)
    .limit(1);

  const { data: clockIssues } = await supabase
    .from("time_punch_exceptions")
    .select("id")
    .eq("resolved", false)
    .limit(1);

  const alerts: { id: string; severity: "warning" | "critical"; message: string; actionLabel: string; actionHref: string }[] = [];

  if (overdueCarePlan && overdueCarePlan.length > 0) {
    alerts.push({
      id: "careplan-overdue",
      severity: "critical",
      message: "One or more care plans are overdue.",
      actionLabel: "Open Documentation Tracker",
      actionHref: "/documentation"
    });
  }

  if (clockIssues && clockIssues.length > 0) {
    alerts.push({
      id: "clock-issues",
      severity: "warning",
      message: "Manager review needed for unresolved time exceptions.",
      actionLabel: "Review Time Card",
      actionHref: "/time-card"
    });
  }

  return alerts;
}


