import type { MarTodayRow } from "@/lib/services/mar-shared";
import { mapMarTodayRow, throwMarSupabaseError } from "@/lib/services/mar-workflow-core";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

// Dashboard needs only today's MAR timing and lightweight administered metadata.
// Keep this intentionally narrow so we do not over-fetch MAR workflow fields.
const MAR_DASHBOARD_TODAY_SELECT =
  "mar_schedule_id, member_id, member_name, pof_medication_id, medication_name, scheduled_time, status, administered_at, administered_by, administered_by_user_id";
const MAR_DASHBOARD_ACTION_WINDOW_HOURS = 12;
const MAR_DASHBOARD_RECENT_LIMIT = 8;

function getDashboardTimeHorizon(hoursAhead: number) {
  const safeHoursAhead = Number.isFinite(hoursAhead) && hoursAhead > 0 ? Math.floor(hoursAhead) : 12;
  return new Date(Date.now() + safeHoursAhead * 60 * 60 * 1000).toISOString();
}

function getDashboardRecentLimit(limit: number | undefined) {
  const normalizedLimit = Number.isFinite(limit) ? Math.floor(Number(limit)) : MAR_DASHBOARD_RECENT_LIMIT;
  return Math.max(1, Math.min(normalizedLimit, 50));
}

async function getMarDashboardClient(options?: { serviceRole?: boolean }) {
  return options?.serviceRole === true ? createServiceRoleClient("dashboard_mar_read") : createClient();
}

async function loadHealthDashboardMarActionRows(options?: {
  serviceRole?: boolean;
  hoursAhead?: number;
}) {
  const supabase = await getMarDashboardClient(options);
  const { data, error } = await supabase
    .from("v_mar_today")
    .select(MAR_DASHBOARD_TODAY_SELECT)
    .neq("status", "Given")
    .lte("scheduled_time", getDashboardTimeHorizon(options?.hoursAhead ?? MAR_DASHBOARD_ACTION_WINDOW_HOURS))
    .order("scheduled_time", { ascending: true });

  if (error) throwMarSupabaseError(error, "v_mar_today");

  return (data ?? [])
    .map((row: unknown) => mapMarTodayRow((row ?? {}) as Record<string, unknown>))
    .filter((row): row is MarTodayRow => Boolean(row));
}

async function loadHealthDashboardMarRecentRows(options?: {
  serviceRole?: boolean;
  limit?: number;
}) {
  const supabase = await getMarDashboardClient(options);
  const { data, error } = await supabase
    .from("v_mar_today")
    .select(MAR_DASHBOARD_TODAY_SELECT)
    .eq("status", "Given")
    .not("administered_at", "is", null)
    .order("administered_at", { ascending: false })
    .limit(getDashboardRecentLimit(options?.limit));

  if (error) throwMarSupabaseError(error, "v_mar_today");

  return (data ?? [])
    .map((row: unknown) => mapMarTodayRow((row ?? {}) as Record<string, unknown>))
    .filter((row): row is MarTodayRow => Boolean(row));
}

export async function getHealthDashboardMarSnapshot(options?: {
  serviceRole?: boolean;
  hoursAhead?: number;
  recentLimit?: number;
}) {
  const [actionRows, recentRows] = await Promise.all([
    loadHealthDashboardMarActionRows({
      serviceRole: options?.serviceRole,
      hoursAhead: options?.hoursAhead
    }),
    loadHealthDashboardMarRecentRows({
      serviceRole: options?.serviceRole,
      limit: options?.recentLimit
    })
  ]);
  return {
    actionRows,
    recentRows
  } as const;
}

export async function getHealthDashboardMarActionRows(options?: {
  serviceRole?: boolean;
  hoursAhead?: number;
}) {
  return (
    await getHealthDashboardMarSnapshot({
      serviceRole: options?.serviceRole,
      hoursAhead: options?.hoursAhead
    })
  ).actionRows;
}

export async function getHealthDashboardMarRecentRows(options?: {
  serviceRole?: boolean;
  limit?: number;
}) {
  return (
    await getHealthDashboardMarSnapshot({
      serviceRole: options?.serviceRole,
      recentLimit: options?.limit
    })
  ).recentRows;
}
