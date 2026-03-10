import { canonicalLeadStatus } from "@/lib/canonical";
import { getMockDb } from "@/lib/mock-repo";
import { isMockMode } from "@/lib/runtime";
import { createClient } from "@/lib/supabase/server";

export async function getOperationsReports() {
  if (isMockMode()) {
    const db = getMockDb();
    // TODO(backend): move these summaries to SQL/materialized views.
    const staffProductivity = db.staff.map((s) => ({
      staff_name: s.full_name,
      activity_logs: db.dailyActivities.filter((d) => d.staff_user_id === s.id).length,
      toilet_logs: db.toiletLogs.filter((d) => d.staff_user_id === s.id).length,
      shower_logs: db.showerLogs.filter((d) => d.staff_user_id === s.id).length,
      transportation_logs: db.transportationLogs.filter((d) => d.staff_user_id === s.id).length
    }));

    const timeSummary = db.staff.map((s) => ({
      staff_name: s.full_name,
      punches: db.timePunches.filter((p) => p.staff_user_id === s.id).length,
      outside_fence: db.timePunches.filter((p) => p.staff_user_id === s.id && p.within_fence === false).length
    }));

    const normalizedLeads = db.leads.map((lead) => canonicalLeadStatus(lead.status, lead.stage));
    const pipeline = {
      open: normalizedLeads.filter((status) => status === "Open" || status === "Nurture").length,
      won: normalizedLeads.filter((status) => status === "Won").length,
      lost: normalizedLeads.filter((status) => status === "Lost").length
    };

    const ancillaryMonthly = db.ancillaryLogs.reduce<Record<string, number>>((acc, row) => {
      const month = new Date(row.service_date).toLocaleString("en-US", { month: "short", year: "numeric" });
      acc[month] = (acc[month] ?? 0) + row.amount_cents;
      return acc;
    }, {});

    const ancillaryMonthlyRows = Object.entries(ancillaryMonthly).map(([month, total_cents]) => ({ month, total_cents }));

    return {
      staffProductivity,
      timeSummary,
      pipeline,
      ancillaryMonthlyRows
    };
  }

  const supabase = await createClient();
  const [{ data: staffRows }, { data: docEvents }, { data: punchRows }, { data: leads }, { data: ancillaryRows }] = await Promise.all([
    supabase.from("profiles").select("id, full_name").eq("active", true),
    supabase
      .from("documentation_events")
      .select("staff_user_id, event_table")
      .not("staff_user_id", "is", null),
    supabase.from("time_punches").select("staff_user_id, within_fence"),
    supabase.from("leads").select("status, stage"),
    supabase.from("v_monthly_ancillary_summary").select("month_label, total_amount_cents")
  ]);

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

  const normalizedLeads = (leads ?? []).map((lead) => canonicalLeadStatus(lead.status, lead.stage));
  const pipeline = {
    open: normalizedLeads.filter((status) => status === "Open" || status === "Nurture").length,
    won: normalizedLeads.filter((status) => status === "Won").length,
    lost: normalizedLeads.filter((status) => status === "Lost").length
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
