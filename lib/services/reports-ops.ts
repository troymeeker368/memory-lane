import { createClient } from "@/lib/supabase/server";
import { fetchSalesPipelineSummaryCountsSupabase } from "@/lib/services/sales-workflows";

export async function getOperationsReports() {
  const supabase = await createClient();
  const [
    { data: staffRows, error: staffError },
    { data: docEvents, error: docEventsError },
    { data: punchRows, error: punchRowsError },
    { data: ancillaryRows, error: ancillaryError },
    pipelineSummary
  ] = await Promise.all([
    supabase.from("profiles").select("id, full_name").eq("active", true),
    supabase
      .from("documentation_events")
      .select("staff_user_id, event_table")
      .not("staff_user_id", "is", null),
    supabase.from("time_punches").select("staff_user_id, within_fence"),
    supabase.from("v_monthly_ancillary_summary").select("month_label, total_amount_cents"),
    fetchSalesPipelineSummaryCountsSupabase(supabase)
  ]);
  if (staffError) throw new Error(`Unable to load active staff profiles: ${staffError.message}`);
  if (docEventsError) throw new Error(`Unable to load documentation_events: ${docEventsError.message}`);
  if (punchRowsError) throw new Error(`Unable to load time_punches: ${punchRowsError.message}`);
  if (ancillaryError) throw new Error(`Unable to load v_monthly_ancillary_summary: ${ancillaryError.message}`);

  const staffById = new Map((staffRows ?? []).map((row) => [row.id, row.full_name] as const));
  const staffProductivityMap = new Map<
    string,
    { staff_name: string; activity_logs: number; toilet_logs: number; shower_logs: number; transportation_logs: number }
  >();

  (staffRows ?? []).forEach((row) => {
    staffProductivityMap.set(row.id, {
      staff_name: row.full_name,
      activity_logs: 0,
      toilet_logs: 0,
      shower_logs: 0,
      transportation_logs: 0
    });
  });

  (docEvents ?? []).forEach((row) => {
    if (!row.staff_user_id) return;
    const current =
      staffProductivityMap.get(row.staff_user_id) ??
      {
        staff_name: staffById.get(row.staff_user_id) ?? "Unknown Staff",
        activity_logs: 0,
        toilet_logs: 0,
        shower_logs: 0,
        transportation_logs: 0
      };

    if (row.event_table === "daily_activity_logs") current.activity_logs += 1;
    if (row.event_table === "toilet_logs") current.toilet_logs += 1;
    if (row.event_table === "shower_logs") current.shower_logs += 1;
    if (row.event_table === "transportation_logs") current.transportation_logs += 1;
    staffProductivityMap.set(row.staff_user_id, current);
  });

  const timeSummaryMap = new Map<string, { staff_name: string; punches: number; outside_fence: number }>();
  (staffRows ?? []).forEach((row) => {
    timeSummaryMap.set(row.id, { staff_name: row.full_name, punches: 0, outside_fence: 0 });
  });
  (punchRows ?? []).forEach((row) => {
    const current =
      timeSummaryMap.get(row.staff_user_id) ??
      { staff_name: staffById.get(row.staff_user_id) ?? "Unknown Staff", punches: 0, outside_fence: 0 };
    current.punches += 1;
    if (row.within_fence === false) current.outside_fence += 1;
    timeSummaryMap.set(row.staff_user_id, current);
  });

  const pipeline = {
    open: pipelineSummary.openLeadCount,
    won: pipelineSummary.wonLeadCount,
    lost: pipelineSummary.lostLeadCount
  };

  const ancillaryByMonth = new Map<string, number>();
  (ancillaryRows ?? []).forEach((row) => {
    ancillaryByMonth.set(row.month_label, (ancillaryByMonth.get(row.month_label) ?? 0) + Number(row.total_amount_cents ?? 0));
  });
  const ancillaryMonthlyRows = Array.from(ancillaryByMonth.entries()).map(([month, total_cents]) => ({ month, total_cents }));

  return {
    staffProductivity: Array.from(staffProductivityMap.values()).sort((a, b) => a.staff_name.localeCompare(b.staff_name)),
    timeSummary: Array.from(timeSummaryMap.values()).sort((a, b) => a.staff_name.localeCompare(b.staff_name)),
    pipeline,
    ancillaryMonthlyRows
  };
}
