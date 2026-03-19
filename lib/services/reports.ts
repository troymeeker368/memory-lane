import { createClient } from "@/lib/supabase/server";
import { getProgressNoteReminderRows } from "@/lib/services/progress-notes";

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
  const progressNotes = await getProgressNoteReminderRows(memberIds, { serviceRole: true });
  const progressByMemberId = new Map(progressNotes.map((row) => [row.memberId, row] as const));

  return {
    timelyDocs: timelyDocs ?? [],
    careTracker: trackerRows.map((row) => {
      const progress = row.member_id ? progressByMemberId.get(row.member_id) ?? null : null;
      return {
        ...row,
        next_progress_note_due: progress?.nextProgressNoteDueDate ?? row.next_progress_note_due ?? null,
        progress_note_status: progress?.complianceStatus ?? "data_issue",
        has_progress_note_draft: progress?.hasDraftInProgress ?? false
      };
    }),
    toileted: toileted ?? []
  };
}
