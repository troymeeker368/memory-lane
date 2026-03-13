import { createClient } from "@/lib/supabase/server";

export async function getClinicalOverview() {
  const supabase = await createClient();

  const [{ data: mar, error: marError }, { data: bloodSugar, error: bloodSugarError }] = await Promise.all([
    supabase
      .from("v_mar_entries_detailed")
      .select("id, member_name, medication_name, due_at, administered_at, nurse_name, status")
      .order("due_at", { ascending: true })
      .limit(100),
    supabase
      .from("v_blood_sugar_logs_detailed")
      .select("id, checked_at, member_name, reading_mg_dl, nurse_name, notes")
      .order("checked_at", { ascending: false })
      .limit(100)
  ]);
  if (marError) throw new Error(`Unable to load v_mar_entries_detailed: ${marError.message}`);
  if (bloodSugarError) throw new Error(`Unable to load v_blood_sugar_logs_detailed: ${bloodSugarError.message}`);

  return {
    mar: mar ?? [],
    bloodSugar: bloodSugar ?? []
  };
}
