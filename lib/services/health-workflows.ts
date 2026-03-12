import { createClient } from "@/lib/supabase/server";
import { toEasternDate, toEasternISO } from "@/lib/timezone";

const MISSING_MAR_VIEW_ERROR =
  "Missing Supabase view public.v_mar_entries_detailed (expected columns: id, member_id, member_name, medication_name, due_at, administered_at, nurse_name, status).";

export async function getHealthSnapshot() {
  const supabase = await createClient();
  const today = toEasternDate();
  const startIso = `${today}T00:00:00.000Z`;
  const endIso = `${today}T23:59:59.999Z`;

  const [{ data: marRows, error: marError }, { data: bloodSugarHistory, error: bloodError }, { data: members, error: membersError }] =
    await Promise.all([
      supabase
        .from("v_mar_entries_detailed")
        .select("id, member_id, member_name, medication_name, due_at, administered_at, nurse_name, status")
        .gte("due_at", startIso)
        .lte("due_at", endIso)
        .order("due_at", { ascending: true }),
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

  if (marError) {
    if ((marError as { code?: string }).code === "42P01") {
      throw new Error(MISSING_MAR_VIEW_ERROR);
    }
    throw new Error(marError.message);
  }
  if (bloodError) throw new Error(bloodError.message);
  if (membersError) throw new Error(membersError.message);

  return {
    marToday: marRows ?? [],
    bloodSugarHistory: bloodSugarHistory ?? [],
    memberActions: (members ?? []).map((member: any) => ({
      member_id: member.id,
      member_name: member.display_name,
      action: "Review meds and glucose trends",
      generated_at: toEasternISO()
    }))
  };
}
