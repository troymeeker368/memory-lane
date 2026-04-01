import { buildMissingSchemaMessage, isMissingSchemaObjectError } from "@/lib/supabase/schema-errors";
import { createClient } from "@/lib/supabase/server";
import { toEasternDate, toEasternISO } from "@/lib/timezone";

export type DashboardAncillaryChargeRow = {
  service_date: string;
  amount: number | null;
  billing_status: string | null;
};

export async function getDashboardStats(userId: string) {
  const supabase = await createClient({ serviceRole: true });

  const today = new Date();
  const start = new Date(today);
  start.setHours(0, 0, 0, 0);
  const end = new Date(today);
  end.setHours(23, 59, 59, 999);

  const [
    { count: todaysLogs, error: todaysLogsError },
    { count: missingDocs, error: missingDocsError },
    { data: latestPunches, error: latestPunchesError }
  ] = await Promise.all([
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
  if (todaysLogsError) throw new Error(`Unable to load today's documentation event count: ${todaysLogsError.message}`);
  if (missingDocsError) throw new Error(`Unable to load missing documentation assignment count: ${missingDocsError.message}`);
  if (latestPunchesError) throw new Error(`Unable to load latest time punches: ${latestPunchesError.message}`);

  return {
    todaysLogs: todaysLogs ?? 0,
    missingDocs: missingDocs ?? 0,
    latestPunches: latestPunches ?? []
  };
}

export async function getDashboardAlerts() {
  const supabase = await createClient({ serviceRole: true });

  const { data: overdueCarePlan, error: overdueCarePlanError } = await supabase
    .from("documentation_tracker")
    .select("id")
    .lt("next_care_plan_due", toEasternDate())
    .eq("care_plan_done", false)
    .limit(1);

  const { data: clockIssues, error: clockIssuesError } = await supabase
    .from("time_punch_exceptions")
    .select("id")
    .eq("resolved", false)
    .limit(1);
  if (overdueCarePlanError) throw new Error(`Unable to load overdue care plan alerts: ${overdueCarePlanError.message}`);
  if (clockIssuesError) throw new Error(`Unable to load clock issue alerts: ${clockIssuesError.message}`);

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

export async function listDashboardAncillaryChargesForMonth(selectedDate: string): Promise<DashboardAncillaryChargeRow[]> {
  const normalizedDate = /^\d{4}-\d{2}-\d{2}$/.test(selectedDate) ? selectedDate : toEasternDate();
  const monthPrefix = normalizedDate.slice(0, 7);
  const monthStart = `${monthPrefix}-01`;
  const monthEnd = `${monthPrefix}-31`;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ancillary_charge_logs")
    .select("service_date, amount, billing_status")
    .gte("service_date", monthStart)
    .lte("service_date", monthEnd);

  if (error) {
    if (isMissingSchemaObjectError(error)) {
      throw new Error(
        buildMissingSchemaMessage({
          objectName: "ancillary_charge_logs",
          migration: "0001_initial_schema.sql"
        })
      );
    }
    throw new Error(`Unable to load dashboard ancillary charges: ${error.message}`);
  }

  return ((data ?? []) as DashboardAncillaryChargeRow[]).map((row) => ({
    service_date: String(row.service_date ?? ""),
    amount: typeof row.amount === "number" ? row.amount : row.amount == null ? null : Number(row.amount),
    billing_status: typeof row.billing_status === "string" ? row.billing_status : null
  }));
}

