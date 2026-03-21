import {
  getExistingProgressNoteDraftForMember as getExistingProgressNoteDraftForMemberModel,
  getMemberProgressNoteSummary as getMemberProgressNoteSummaryModel,
  getProgressNoteById as getProgressNoteByIdModel,
  getProgressNoteDashboard as getProgressNoteDashboardModel,
  getProgressNoteMemberOptions as getProgressNoteMemberOptionsModel,
  getProgressNoteReminderRows as getProgressNoteReminderRowsModel,
  getProgressNoteTracker as getProgressNoteTrackerModel,
  getProgressNotesForMember as getProgressNotesForMemberModel
} from "@/lib/services/progress-notes-supabase";

export async function getProgressNoteTracker(...args: Parameters<typeof getProgressNoteTrackerModel>) {
  return getProgressNoteTrackerModel(...args);
}

export async function getProgressNoteMemberOptions(...args: Parameters<typeof getProgressNoteMemberOptionsModel>) {
  return getProgressNoteMemberOptionsModel(...args);
}

export async function getProgressNoteById(...args: Parameters<typeof getProgressNoteByIdModel>) {
  return getProgressNoteByIdModel(...args);
}

export async function getExistingProgressNoteDraftForMember(
  ...args: Parameters<typeof getExistingProgressNoteDraftForMemberModel>
) {
  return getExistingProgressNoteDraftForMemberModel(...args);
}

export async function getProgressNotesForMember(...args: Parameters<typeof getProgressNotesForMemberModel>) {
  return getProgressNotesForMemberModel(...args);
}

export async function getMemberProgressNoteSummary(...args: Parameters<typeof getMemberProgressNoteSummaryModel>) {
  return getMemberProgressNoteSummaryModel(...args);
}

export async function getProgressNoteDashboard(...args: Parameters<typeof getProgressNoteDashboardModel>) {
  return getProgressNoteDashboardModel(...args);
}

export async function getProgressNoteReminderRows(...args: Parameters<typeof getProgressNoteReminderRowsModel>) {
  return getProgressNoteReminderRowsModel(...args);
}

export async function getProgressNoteDraftContext(memberId: string, options?: { serviceRole?: boolean }) {
  const tracker = await getProgressNoteTrackerModel({
    memberId,
    page: 1,
    pageSize: 1,
    serviceRole: Boolean(options?.serviceRole)
  });
  return tracker.rows[0] ?? null;
}

export async function getNoteById(...args: Parameters<typeof getProgressNoteByIdModel>) {
  return getProgressNoteByIdModel(...args);
}

export async function getNotesForMember(...args: Parameters<typeof getProgressNotesForMemberModel>) {
  return getProgressNotesForMemberModel(...args);
}
