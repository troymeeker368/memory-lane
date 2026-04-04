import { createClient } from "@/lib/supabase/server";
import { computeProgressNoteComplianceStatus } from "@/lib/services/progress-note-model";

async function loadDraftProgressNoteMemberIds(memberIds: string[]) {
  const uniqueMemberIds = Array.from(new Set(memberIds.filter(Boolean)));
  if (uniqueMemberIds.length === 0) {
    return new Set<string>();
  }

  const supabase = await createClient({ serviceRole: true });
  const { data, error } = await supabase
    .from("progress_notes")
    .select("member_id")
    .in("member_id", uniqueMemberIds)
    .eq("status", "draft");

  if (error) {
    if (String(error.message).includes("progress_notes")) {
      throw new Error(
        "Progress notes schema is not available. Apply Supabase migration 0092_progress_notes_tracker.sql and refresh PostgREST schema cache."
      );
    }
    throw new Error(error.message);
  }

  return new Set(
    ((data ?? []) as Array<{ member_id: string | null }>)
      .map((row) => row.member_id)
      .filter((value): value is string => Boolean(value))
  );
}

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
      .select("member_id, member_name, next_care_plan_due, care_plan_done, next_progress_note_due, note_done")
      .order("member_name")
      .limit(200),
    supabase.from("v_last_toileted").select("member_name, last_toileted_at, staff_name").limit(100)
  ]);
  if (timelyDocsError) throw new Error(`Unable to load v_timely_docs_summary: ${timelyDocsError.message}`);
  if (careTrackerError) throw new Error(`Unable to load documentation_tracker: ${careTrackerError.message}`);
  if (toiletedError) throw new Error(`Unable to load v_last_toileted: ${toiletedError.message}`);

  const trackerRows = (careTracker ?? []) as Array<{
    member_id: string | null;
    member_name: string;
    next_care_plan_due: string | null;
    care_plan_done: boolean | null;
    next_progress_note_due: string | null;
    note_done: boolean | null;
  }>;
  const memberIds = trackerRows.map((row) => row.member_id).filter((value): value is string => Boolean(value));
  const draftMemberIds = await loadDraftProgressNoteMemberIds(memberIds);

  return {
    timelyDocs: timelyDocs ?? [],
    careTracker: trackerRows.map((row) => {
      return {
        ...row,
        next_progress_note_due: row.next_progress_note_due ?? null,
        progress_note_status: computeProgressNoteComplianceStatus(row.next_progress_note_due ?? null),
        has_progress_note_draft: row.member_id ? draftMemberIds.has(row.member_id) : false
      };
    }),
    toileted: toileted ?? []
  };
}
