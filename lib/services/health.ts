import { createClient } from "@/lib/supabase/server";

export async function getClinicalOverview() {
  const supabase = await createClient();

  const [{ data: mar }, { data: bloodSugar }] = await Promise.all([
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

  return {
    mar: mar ?? [],
    bloodSugar: bloodSugar ?? []
  };
}
