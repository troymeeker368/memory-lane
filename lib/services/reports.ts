import { createClient } from "@/lib/supabase/server";
import { getDocumentationTracker } from "@/lib/services/documentation";

export async function getReportingSnapshot() {
  const supabase = await createClient();

  const [
    { data: timelyDocs, error: timelyDocsError },
    documentationTracker,
    { data: toileted, error: toiletedError }
  ] = await Promise.all([
    supabase.from("v_timely_docs_summary").select("staff_name, on_time, late, total, on_time_percent").limit(50),
    getDocumentationTracker({ page: 1, pageSize: 50 }),
    supabase.from("v_last_toileted").select("member_name, last_toileted_at, staff_name").limit(100)
  ]);
  if (timelyDocsError) throw new Error(`Unable to load v_timely_docs_summary: ${timelyDocsError.message}`);
  if (toiletedError) throw new Error(`Unable to load v_last_toileted: ${toiletedError.message}`);

  return {
    timelyDocs: timelyDocs ?? [],
    careTracker: documentationTracker.rows,
    toileted: toileted ?? []
  };
}
