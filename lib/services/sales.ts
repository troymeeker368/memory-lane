import { createClient } from "@/lib/supabase/server";

export async function getLeadsSnapshot() {
  const supabase = await createClient();

  const [{ data: leads }, { data: stages }, { data: activities }] = await Promise.all([
    supabase
      .from("leads")
      .select("id, stage, status, member_name, caregiver_name, inquiry_date, next_follow_up_date, lead_source, likelihood, closed_date")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("v_lead_pipeline_stage_counts").select("stage, count").order("count", { ascending: false }),
    supabase
      .from("lead_activities")
      .select("id, lead_id, activity_at, activity_type, outcome, next_follow_up_date, completed_by_name")
      .order("activity_at", { ascending: false })
      .limit(30)
  ]);

  return {
    leads: leads ?? [],
    stages: stages ?? [],
    activities: activities ?? []
  };
}

export async function getReferralSources() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("referral_sources")
    .select("id, organization_name, contact_name, primary_phone, primary_email, active")
    .eq("active", true)
    .order("organization_name");
  return data ?? [];
}
