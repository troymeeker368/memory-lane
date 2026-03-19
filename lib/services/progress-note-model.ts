import { toEasternDate } from "@/lib/timezone";

export const PROGRESS_NOTE_RECORD_STATUS_VALUES = ["draft", "signed"] as const;
export type ProgressNoteRecordStatus = (typeof PROGRESS_NOTE_RECORD_STATUS_VALUES)[number];

export const PROGRESS_NOTE_COMPLIANCE_WINDOW_DAYS = 90;
export const PROGRESS_NOTE_DUE_SOON_DAYS = 14;

export type ProgressNoteComplianceStatus = "data_issue" | "overdue" | "due" | "due_soon" | "upcoming";

export type ProgressNoteTrackerFilter = "All" | "Overdue" | "Due Today" | "Due Soon" | "Completed/Upcoming";

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function daysUntil(date: string) {
  const today = new Date(`${toEasternDate()}T00:00:00.000Z`);
  const target = new Date(`${date}T00:00:00.000Z`);
  return Math.floor((target.getTime() - today.getTime()) / 86400000);
}

export function cleanText(value: string | null | undefined) {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

export function normalizeProgressNoteStatus(value: string | null | undefined): ProgressNoteRecordStatus {
  return value === "signed" ? "signed" : "draft";
}

export function computeNextProgressNoteDueDate(anchorDate: string) {
  return addDays(anchorDate, PROGRESS_NOTE_COMPLIANCE_WINDOW_DAYS);
}

export function computeProgressNoteComplianceStatus(nextDueDate: string | null | undefined): ProgressNoteComplianceStatus {
  if (!nextDueDate) return "data_issue";
  const delta = daysUntil(nextDueDate);
  if (delta < 0) return "overdue";
  if (delta === 0) return "due";
  if (delta <= PROGRESS_NOTE_DUE_SOON_DAYS) return "due_soon";
  return "upcoming";
}

export function getProgressNoteComplianceLabel(status: ProgressNoteComplianceStatus) {
  if (status === "overdue") return "Overdue";
  if (status === "due") return "Due Today";
  if (status === "due_soon") return "Due Soon";
  if (status === "upcoming") return "Upcoming";
  return "Data Issue";
}

export function matchesProgressNoteTrackerFilter(status: ProgressNoteComplianceStatus, filter: ProgressNoteTrackerFilter) {
  if (filter === "All") return true;
  if (filter === "Overdue") return status === "overdue";
  if (filter === "Due Today") return status === "due";
  if (filter === "Due Soon") return status === "due_soon";
  return status === "upcoming";
}

export function getProgressNoteSortRank(status: ProgressNoteComplianceStatus) {
  if (status === "data_issue") return 0;
  if (status === "overdue") return 1;
  if (status === "due") return 2;
  if (status === "due_soon") return 3;
  return 4;
}
