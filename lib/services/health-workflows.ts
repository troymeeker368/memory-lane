import { createClient } from "@/lib/supabase/server";
import { getMarWorkflowSnapshot } from "@/lib/services/mar-workflow";
import { toEasternDate, toEasternISO } from "@/lib/timezone";

export async function getHealthSnapshot() {
  const supabase = await createClient();
  const [marSnapshot, { data: bloodSugarHistory, error: bloodError }, { data: members, error: membersError }] = await Promise.all([
    getMarWorkflowSnapshot({ historyLimit: 150, prnLimit: 150 }),
    supabase
      .from("v_blood_sugar_logs_detailed")
      .select("id, member_id, member_name, checked_at, reading_mg_dl, nurse_name, notes")
      .order("checked_at", { ascending: false })
      .limit(100),
    supabase
      .from("members")
      .select("id, display_name")
      .eq("status", "active")
      .order("display_name", { ascending: true })
  ]);

  if (bloodError) throw new Error(bloodError.message);
  if (membersError) throw new Error(membersError.message);

  const marToday = marSnapshot.today.map((row) => ({
    id: row.marScheduleId,
    member_id: row.memberId,
    member_name: row.memberName,
    medication_name: row.medicationName,
    due_at: row.scheduledTime,
    administered_at: row.administeredAt,
    nurse_name: row.administeredBy,
    status: row.status === "Given" ? "administered" : row.status === "Not Given" ? "not_given" : "scheduled"
  }));

  return {
    marToday,
    bloodSugarHistory: bloodSugarHistory ?? [],
    memberActions: (members ?? []).map((member: any) => ({
      member_id: member.id,
      member_name: member.display_name,
      action: "Review meds and glucose trends",
      generated_at: toEasternISO()
    }))
  };
}
