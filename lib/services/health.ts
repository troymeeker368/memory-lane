import { createClient } from "@/lib/supabase/server";
import { getMarWorkflowSnapshot } from "@/lib/services/mar-workflow";

export async function getClinicalOverview() {
  const supabase = await createClient();

  const [marSnapshot, { data: bloodSugar, error: bloodSugarError }] = await Promise.all([
    getMarWorkflowSnapshot({ historyLimit: 150, prnLimit: 150, serviceRole: true }),
    supabase
      .from("v_blood_sugar_logs_detailed")
      .select("id, checked_at, member_name, reading_mg_dl, nurse_name, notes")
      .order("checked_at", { ascending: false })
      .limit(100)
  ]);
  if (bloodSugarError) throw new Error(`Unable to load v_blood_sugar_logs_detailed: ${bloodSugarError.message}`);

  const mar = marSnapshot.today.map((row) => ({
    id: row.marScheduleId,
    member_name: row.memberName,
    medication_name: row.medicationName,
    due_at: row.scheduledTime,
    administered_at: row.administeredAt,
    nurse_name: row.administeredBy,
    status: row.status === "Given" ? "administered" : row.status === "Not Given" ? "not_given" : "scheduled"
  }));

  return {
    mar,
    bloodSugar: bloodSugar ?? []
  };
}
