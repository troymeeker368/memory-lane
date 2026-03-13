import { createClient } from "@/lib/supabase/server";

export async function getReportingSnapshot() {
  const supabase = await createClient();

  const [
    { data: timelyDocs, error: timelyDocsError },
    { data: careTracker, error: careTrackerError },
    { data: toileted, error: toiletedError }
  ] = await Promise.all([
    supabase.from("v_timely_docs_summary").select("staff_name, on_time, late, total, on_time_percent").limit(50),
    supabase
      .from("documentation_tracker")
      .select("member_name, next_care_plan_due, care_plan_done, next_progress_note_due, note_done")
      .order("member_name")
      .limit(200),
    supabase.from("v_last_toileted").select("member_name, last_toileted_at, staff_name").limit(100)
  ]);
  if (timelyDocsError) throw new Error(`Unable to load v_timely_docs_summary: ${timelyDocsError.message}`);
  if (careTrackerError) throw new Error(`Unable to load documentation_tracker: ${careTrackerError.message}`);
  if (toiletedError) throw new Error(`Unable to load v_last_toileted: ${toiletedError.message}`);

  return {
    timelyDocs: timelyDocs ?? [],
    careTracker: careTracker ?? [],
    toileted: toileted ?? []
  };
}
