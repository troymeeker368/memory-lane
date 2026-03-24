import { createClient } from "@/lib/supabase/server";

export async function getBloodSugarSnapshot() {
  const supabase = await createClient();
  const { data: bloodSugarHistory, error: bloodError } = await supabase
    .from("v_blood_sugar_logs_detailed")
    .select("id, member_id, member_name, checked_at, reading_mg_dl, nurse_name, notes")
    .order("checked_at", { ascending: false })
    .limit(100);

  if (bloodError) throw new Error(bloodError.message);

  return {
    bloodSugarHistory: bloodSugarHistory ?? []
  };
}
