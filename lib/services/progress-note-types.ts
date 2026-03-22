import type { Database } from "@/types/supabase-types";

import type { ProgressNoteComplianceStatus, ProgressNoteRecordStatus } from "@/lib/services/progress-note-model";

export type DbProgressNote = Database["public"]["Tables"]["progress_notes"]["Row"];

export type ProgressNote = {
  id: string;
  memberId: string;
  memberName: string | null;
  noteDate: string;
  noteBody: string;
  status: ProgressNoteRecordStatus;
  signedAt: string | null;
  signedByUserId: string | null;
  signedByName: string | null;
  signatureAttested: boolean;
  signatureBlob: string | null;
  signatureMetadata: Record<string, unknown> | null;
  createdByUserId: string | null;
  createdByName: string | null;
  updatedByUserId: string | null;
  updatedByName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProgressNoteMemberOption = {
  id: string;
  displayName: string;
  enrollmentDate: string | null;
  status: string | null;
};

export type ProgressNoteComplianceRow = {
  memberId: string;
  memberName: string;
  memberStatus: string | null;
  enrollmentDate: string | null;
  lastSignedProgressNoteDate: string | null;
  nextProgressNoteDueDate: string | null;
  daysUntilDue: number | null;
  complianceStatus: ProgressNoteComplianceStatus;
  hasDraftInProgress: boolean;
  latestDraftId: string | null;
  latestSignedNoteId: string | null;
  dataIssue: string | null;
};

export type ProgressNoteTrackerSummary = {
  total: number;
  overdue: number;
  dueToday: number;
  dueSoon: number;
  upcoming: number;
  dataIssues: number;
};

export type ProgressNoteTrackerResult = {
  rows: ProgressNoteComplianceRow[];
  summary: ProgressNoteTrackerSummary;
  page: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
};
