import { canonicalLeadStatus } from "@/lib/canonical";
import { getMockDb } from "@/lib/mock-repo";
import { isMockMode } from "@/lib/runtime";

export async function getOperationsReports() {
  const db = getMockDb();

  if (isMockMode()) {
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

  return {
    staffProductivity: [],
    timeSummary: [],
    pipeline: { open: 0, won: 0, lost: 0 },
    ancillaryMonthlyRows: []
  };
}
