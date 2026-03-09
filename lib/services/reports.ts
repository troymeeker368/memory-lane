import { getMockReportingSnapshot } from "@/lib/mock-data";
import { isMockMode } from "@/lib/runtime";
import { createClient } from "@/lib/supabase/server";

export async function getReportingSnapshot() {
  if (isMockMode()) {
    // TODO(backend): Remove mock branch when reports are loaded from Supabase in local/dev.
    return getMockReportingSnapshot();
  }

  const supabase = await createClient();

  const [{ data: timelyDocs }, { data: careTracker }, { data: toileted }] = await Promise.all([
    supabase.from("v_timely_docs_summary").select("staff_name, on_time, late, total, on_time_percent").limit(50),
    supabase
      .from("documentation_tracker")
      .select("member_name, next_care_plan_due, care_plan_done, next_progress_note_due, note_done")
      .order("member_name")
      .limit(200),
    supabase.from("v_last_toileted").select("member_name, last_toileted_at, staff_name").limit(100)
  ]);

  return {
    timelyDocs: timelyDocs ?? [],
    careTracker: careTracker ?? [],
    toileted: toileted ?? []
  };
}
