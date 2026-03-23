import type { MarTodayRow } from "@/lib/services/mar-shared";
import { mapMarTodayRow, throwMarSupabaseError } from "@/lib/services/mar-workflow-core";
import { createClient } from "@/lib/supabase/server";

const MAR_DASHBOARD_TODAY_SELECT =
  "mar_schedule_id, member_id, member_name, pof_medication_id, medication_name, dose, route, frequency, instructions, prn, scheduled_time, administration_id, status, not_given_reason, prn_reason, notes, administered_by, administered_by_user_id, administered_at, source";

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
