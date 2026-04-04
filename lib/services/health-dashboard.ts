import { getCarePlanDashboard } from "@/lib/services/care-plans";
import { listIncidentDashboard } from "@/lib/services/incidents";
import {
  getHealthDashboardMarActionRows,
  getHealthDashboardMarRecentRows
} from "@/lib/services/mar-dashboard-read-model";
import { getProgressNoteDashboard } from "@/lib/services/progress-notes";
import { createClient } from "@/lib/supabase/server";
import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";

type DashboardMarRow = {
  id: string;
  member_id: string;
  member_name: string;
  medication_name: string;
  due_at: string;
  administered_at: string | null;
  nurse_name: string | null;
  status: string;
};

type DashboardBloodSugarRow = {
  id: string;
  checked_at: string;
  member_id: string | null;
  member_name: string;
  reading_mg_dl: number | string;
  nurse_name: string | null;
  notes: string | null;
};

type HealthDashboardCareAlertRpcRow = {
  member_id: string;
  member_name: string;
  flags: string[] | null;
  summary: string | null;
};

type CareAlertRiskLevel = "high" | "standard";

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeDashboardMarRow(
  row: Awaited<ReturnType<typeof getHealthDashboardMarActionRows>>[number] | Awaited<ReturnType<typeof getHealthDashboardMarRecentRows>>[number]
) {
  return {
    id: row.marScheduleId,
    member_id: row.memberId,
    member_name: row.memberName,
    medication_name: row.medicationName,
    due_at: row.scheduledTime,
    administered_at: row.administeredAt,
    nurse_name: row.administeredBy,
    status: row.status === "Given" ? "administered" : row.status === "Not Given" ? "not_given" : "scheduled"
  } satisfies DashboardMarRow;
}

function getCareAlertRiskLevel(flags: string[], summary: string | null | undefined): CareAlertRiskLevel {
  const normalized = [...flags, summary ?? ""].join(" ").toLowerCase();
  if (
    normalized.includes("allerg") ||
    normalized.includes("dnr") ||
    normalized.includes("code status") ||
    normalized.includes("fall risk") ||
    normalized.includes("elopement") ||
    normalized.includes("seizure") ||
    normalized.includes("diabet") ||
    normalized.includes("blood sugar")
  ) {
    return "high";
  }
  return "standard";
}

export async function getHealthDashboardData(options?: {
  includeCarePlans?: boolean;
  includeIncidents?: boolean;
  includeProgressNotes?: boolean;
}) {
  const supabase = await createClient();
  const emptyCarePlanDashboard = {
    summary: { total: 0, dueSoon: 0, dueNow: 0, overdue: 0, completedRecently: 0 },
    dueSoon: [],
    dueNow: [],
    overdue: [],
    recentlyCompleted: [],
    plans: [],
    page: 1,
    pageSize: 12,
    totalRows: 0,
    totalPages: 1
  };
  const emptyIncidentDashboard: Awaited<ReturnType<typeof listIncidentDashboard>> = {
    counts: { total: 0, submitted: 0, returned: 0, approved: 0, reportableOpen: 0 },
    recent: []
  };
  const emptyProgressNoteDashboard = {
    summary: { total: 0, overdue: 0, dueToday: 0, dueSoon: 0, upcoming: 0, dataIssues: 0 },
    rows: [],
    overdue: [],
    dueToday: [],
    dueSoon: [],
    dataIssues: [],
    page: 1,
    pageSize: 12,
    totalRows: 0,
    totalPages: 1
  };

  const [marActionRows, marRecentRows, bloodSugarResult, activeMemberCountResult, carePlans, incidents, progressNotes, careAlertRows] =
    await Promise.all([
      getHealthDashboardMarActionRows({ hoursAhead: 12 }),
      getHealthDashboardMarRecentRows({ limit: 8 }),
      supabase
        .from("v_blood_sugar_logs_detailed")
        .select("id, checked_at, member_id, member_name, reading_mg_dl, nurse_name, notes")
        .order("checked_at", { ascending: false })
        .limit(16),
      supabase.from("members").select("id", { count: "exact", head: true }).eq("status", "active"),
      options?.includeCarePlans ? getCarePlanDashboard({ page: 1, pageSize: 12 }) : Promise.resolve(emptyCarePlanDashboard),
      options?.includeIncidents ? listIncidentDashboard({ limit: 12 }) : Promise.resolve(emptyIncidentDashboard),
      options?.includeProgressNotes
        ? getProgressNoteDashboard({ page: 1, pageSize: 12, serviceRole: true })
        : Promise.resolve(emptyProgressNoteDashboard),
      invokeSupabaseRpcOrThrow<HealthDashboardCareAlertRpcRow[]>(supabase, "rpc_get_health_dashboard_care_alerts", {
        p_limit: 12
      })
    ]);

  if (bloodSugarResult.error) throw new Error(`Unable to load v_blood_sugar_logs_detailed: ${bloodSugarResult.error.message}`);
  if (activeMemberCountResult.error) throw new Error(`Unable to count active members: ${activeMemberCountResult.error.message}`);

  const marRows = marActionRows.map(normalizeDashboardMarRow);
  const recentMarRows = marRecentRows.map(normalizeDashboardMarRow);
  const bloodSugarRows = (bloodSugarResult.data ?? []) as DashboardBloodSugarRow[];

  const now = new Date();
  const ninetyMinutesAhead = new Date(now.getTime() + 90 * 60 * 1000);
  const fourHoursAhead = new Date(now.getTime() + 4 * 60 * 60 * 1000);

  const overdueMedicationRows = marRows.filter((row) => {
    const dueAt = parseDate(row.due_at);
    return Boolean(dueAt && dueAt < now);
  });
  const dueMedicationRows = marRows.filter((row) => {
    const dueAt = parseDate(row.due_at);
    return Boolean(dueAt && dueAt <= fourHoursAhead);
  });
  const dueNowMedicationRows = marRows.filter((row) => {
    const dueAt = parseDate(row.due_at);
    return Boolean(dueAt && dueAt >= now && dueAt <= ninetyMinutesAhead);
  });
  const dueSoonMedicationRows = marRows.filter((row) => {
    const dueAt = parseDate(row.due_at);
    return Boolean(dueAt && dueAt > ninetyMinutesAhead && dueAt <= fourHoursAhead);
  });

  const recentHealthDocs = [
    ...bloodSugarRows.slice(0, 8).map((row) => ({
      id: `bg-${row.id}`,
      when: row.checked_at,
      memberId: row.member_id,
      memberName: row.member_name,
      source: "Blood Sugar",
      detail: `${row.reading_mg_dl} mg/dL`
    })),
    ...recentMarRows.map((row) => ({
      id: `mar-${row.id}`,
      when: row.administered_at as string,
      memberId: row.member_id,
      memberName: row.member_name,
      source: "MAR",
      detail: row.medication_name
    }))
  ].sort((left, right) => (left.when < right.when ? 1 : -1));

  const careAlerts = (careAlertRows ?? []).map((row) => {
    const flags = Array.isArray(row.flags)
      ? row.flags.filter((flag): flag is string => typeof flag === "string" && flag.length > 0)
      : [];
    return {
      memberId: row.member_id,
      memberName: row.member_name,
      flags,
      summary: row.summary ?? "-",
      riskLevel: getCareAlertRiskLevel(flags, row.summary)
    };
  });

  const actionableIncidents = incidents.recent.filter((row) => row.status !== "closed");

  return {
    marRows,
    dueMedicationRows,
    dueNowMedicationRows,
    dueSoonMedicationRows,
    overdueMedicationRows,
    bloodSugarRows,
    recentHealthDocs,
    careAlerts,
    activeMemberCount: activeMemberCountResult.count ?? 0,
    carePlans,
    incidents: {
      ...incidents,
      actionable: actionableIncidents
    },
    progressNotes
  };
}
