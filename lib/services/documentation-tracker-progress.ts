import { computeProgressNoteComplianceStatus } from "@/lib/services/progress-note-model";
import { getProgressNoteReminderRows } from "@/lib/services/notes-read";

type DocumentationTrackerProgressBase = {
  member_id: string | null;
  next_progress_note_due: string | null;
};

export async function enrichDocumentationTrackerProgressRows<T extends DocumentationTrackerProgressBase>(
  trackerRows: T[],
  options?: { serviceRole?: boolean }
) {
  const memberIds = trackerRows.map((row) => row.member_id).filter((value): value is string => Boolean(value));
  const reminderRows = await getProgressNoteReminderRows(memberIds, { serviceRole: Boolean(options?.serviceRole) });
  const reminderRowsByMemberId = new Map(reminderRows.map((row) => [row.memberId, row] as const));

  return trackerRows.map((row) => ({
    ...row,
    next_progress_note_due: row.next_progress_note_due ?? null,
    progress_note_status: computeProgressNoteComplianceStatus(row.next_progress_note_due ?? null),
    has_progress_note_draft: row.member_id ? Boolean(reminderRowsByMemberId.get(row.member_id)?.hasDraftInProgress) : false
  }));
}
