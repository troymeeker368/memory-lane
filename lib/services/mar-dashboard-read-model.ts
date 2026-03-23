import type { MarTodayRow } from "@/lib/services/mar-shared";
import { mapMarTodayRow, throwMarSupabaseError } from "@/lib/services/mar-workflow-core";
import { createClient } from "@/lib/supabase/server";

// Dashboard needs only today's MAR timing and lightweight administered metadata.
// Keep this intentionally narrow so we do not over-fetch MAR workflow fields.
const MAR_DASHBOARD_TODAY_SELECT =
  "mar_schedule_id, member_id, member_name, pof_medication_id, medication_name, scheduled_time, status, administered_at, administered_by, administered_by_user_id";

export async function getHealthDashboardMarTodayRows(options?: { serviceRole?: boolean }) {
  const supabase = await createClient({ serviceRole: options?.serviceRole ?? true });
  const { data, error } = await supabase
    .from("v_mar_today")
    .select(MAR_DASHBOARD_TODAY_SELECT)
    .order("scheduled_time", { ascending: true });

  if (error) throwMarSupabaseError(error, "v_mar_today");

  return (data ?? [])
    .map((row: unknown) => mapMarTodayRow((row ?? {}) as Record<string, unknown>))
    .filter((row): row is MarTodayRow => Boolean(row));
}
