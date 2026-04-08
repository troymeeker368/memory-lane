import type { MarTodayRow } from "@/lib/services/mar-shared";
import { mapMarTodayRow, throwMarSupabaseError } from "@/lib/services/mar-workflow-core";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

// Dashboard needs only today's MAR timing and lightweight administered metadata.
// Keep this intentionally narrow so we do not over-fetch MAR workflow fields.
const MAR_DASHBOARD_TODAY_SELECT =
  "mar_schedule_id, member_id, member_name, pof_medication_id, medication_name, scheduled_time, status, administered_at, administered_by, administered_by_user_id";

function getDashboardTimeHorizon(hoursAhead: number) {
  const safeHoursAhead = Number.isFinite(hoursAhead) && hoursAhead > 0 ? Math.floor(hoursAhead) : 12;
  return new Date(Date.now() + safeHoursAhead * 60 * 60 * 1000).toISOString();
}

async function getMarDashboardClient(options?: { serviceRole?: boolean }) {
  return options?.serviceRole === true ? createServiceRoleClient("dashboard_mar_read") : createClient();
}

async function loadHealthDashboardMarTodayRows(options?: { serviceRole?: boolean }) {
  const supabase = await getMarDashboardClient(options);
  const { data, error } = await supabase
    .from("v_mar_today")
    .select(MAR_DASHBOARD_TODAY_SELECT)
    .order("scheduled_time", { ascending: true });

  if (error) throwMarSupabaseError(error, "v_mar_today");

  return (data ?? [])
    .map((row: unknown) => mapMarTodayRow((row ?? {}) as Record<string, unknown>))
    .filter((row): row is MarTodayRow => Boolean(row));
}

export async function getHealthDashboardMarSnapshot(options?: { serviceRole?: boolean }) {
  const todayRows = await loadHealthDashboardMarTodayRows(options);
  return {
    todayRows,
    actionRows: todayRows.filter((row) => row.status !== "Given"),
    recentRows: [...todayRows]
      .filter((row) => row.status === "Given" && row.administeredAt !== null)
      .sort((left, right) => {
        const leftTime = Date.parse(left.administeredAt ?? "");
        const rightTime = Date.parse(right.administeredAt ?? "");
        return rightTime - leftTime;
      })
  } as const;
}

export async function getHealthDashboardMarTodayRows(options?: { serviceRole?: boolean }) {
  return (await getHealthDashboardMarSnapshot(options)).todayRows;
}

export async function getHealthDashboardMarActionRows(options?: {
  serviceRole?: boolean;
  hoursAhead?: number;
}) {
  const dashboard = await getHealthDashboardMarSnapshot(options);
  return dashboard.actionRows.filter((row) => {
    const scheduledTime = Date.parse(row.scheduledTime ?? "");
    return Number.isFinite(scheduledTime) && scheduledTime <= Date.parse(getDashboardTimeHorizon(options?.hoursAhead ?? 12));
  });
}

export async function getHealthDashboardMarRecentRows(options?: {
  serviceRole?: boolean;
  limit?: number;
}) {
  const safeLimit = Number.isFinite(options?.limit) && Number(options?.limit) > 0 ? Math.floor(Number(options?.limit)) : 8;
  return (await getHealthDashboardMarSnapshot(options)).recentRows.slice(0, safeLimit);
}
