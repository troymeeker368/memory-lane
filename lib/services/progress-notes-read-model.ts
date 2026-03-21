import { createClient } from "@/lib/supabase/server";
import { resolveCanonicalMemberId } from "@/lib/services/canonical-person-ref";
import { buildSupabaseIlikePattern } from "@/lib/services/supabase-ilike";
import { toEasternDate } from "@/lib/timezone";
import {
  cleanText,
  computeNextProgressNoteDueDate,
  computeProgressNoteComplianceStatus,
  getProgressNoteSortRank,
  matchesProgressNoteTrackerFilter,
  normalizeProgressNoteStatus,
  type ProgressNoteComplianceStatus,
  type ProgressNoteTrackerFilter
} from "@/lib/services/progress-note-model";
import type {
  DbProgressNote,
  ProgressNote,
  ProgressNoteComplianceRow,
  ProgressNoteMemberOption,
  ProgressNoteTrackerResult,
  ProgressNoteTrackerSummary
} from "@/lib/services/progress-note-types";

type ProgressNoteMemberRow = {
  id: string;
  display_name: string;
  enrollment_date: string | null;
  status: string | null;
};

function toProgressNote(row: DbProgressNote, memberName?: string | null): ProgressNote {
  const signatureMetadata =
    row.signature_metadata && typeof row.signature_metadata === "object"
      ? ({ ...row.signature_metadata } as Record<string, unknown>)
      : null;
  return {
    id: row.id,
    memberId: row.member_id,
    memberName: memberName ?? null,
    noteDate: row.note_date,
    noteBody: row.note_body,
    status: normalizeProgressNoteStatus(row.status),
    signedAt: row.signed_at,
    signedByUserId: row.signed_by_user_id,
    signedByName: cleanText(row.signed_by_name),
    signatureAttested: Boolean(row.signature_attested),
    signatureBlob: cleanText(row.signature_blob),
    signatureMetadata,
    createdByUserId: row.created_by_user_id,
    createdByName: cleanText(row.created_by_name),
    updatedByUserId: row.updated_by_user_id,
    updatedByName: cleanText(row.updated_by_name),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function loadProgressNoteRows(input?: {
  memberIds?: string[];
  memberId?: string;
  noteId?: string;
  serviceRole?: boolean;
}) {
  const supabase = await createClient({ serviceRole: Boolean(input?.serviceRole) });
  let query = supabase
    .from("progress_notes")
    .select("*")
    .order("updated_at", { ascending: false });

  if (input?.noteId) query = query.eq("id", input.noteId);
  if (input?.memberId) query = query.eq("member_id", input.memberId);
  if (input?.memberIds && input.memberIds.length > 0) query = query.in("member_id", input.memberIds);

  const { data, error } = await query;
  if (error) {
    if (String(error.message).includes("progress_notes")) {
      throw new Error(
        "Progress notes schema is not available. Apply Supabase migration 0092_progress_notes_tracker.sql and refresh PostgREST schema cache."
      );
    }
    throw new Error(error.message);
  }

  return (data ?? []) as DbProgressNote[];
}

async function loadProgressNoteMembers(input?: {
  memberId?: string;
  memberIds?: string[];
  query?: string;
  serviceRole?: boolean;
}) {
  const supabase = await createClient({ serviceRole: Boolean(input?.serviceRole) });
  let query = supabase
    .from("members")
    .select("id, display_name, enrollment_date, status")
    .order("display_name", { ascending: true });

  if (input?.memberId) query = query.eq("id", input.memberId);
  if (input?.memberIds && input?.memberIds.length > 0) query = query.in("id", input.memberIds);
  if (input?.query) {
    query = query.ilike("display_name", buildSupabaseIlikePattern(input.query));
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as ProgressNoteMemberRow[];
}

export async function getProgressNoteMemberOptions(options?: { serviceRole?: boolean }) {
  const members = await loadProgressNoteMembers({ serviceRole: Boolean(options?.serviceRole) });
  return members.map((member) => ({
    id: member.id,
    displayName: member.display_name,
    enrollmentDate: member.enrollment_date,
    status: member.status
  })) satisfies ProgressNoteMemberOption[];
}

export async function findDraftProgressNoteRow(memberId: string, serviceRole = false) {
  const rows = await loadProgressNoteRows({ memberId, serviceRole });
  return rows.find((row) => normalizeProgressNoteStatus(row.status) === "draft") ?? null;
}

function buildProgressNoteTrackerRows(members: ProgressNoteMemberRow[], notes: DbProgressNote[]) {
  const notesByMemberId = new Map<string, DbProgressNote[]>();

  notes.forEach((row) => {
    const existing = notesByMemberId.get(row.member_id) ?? [];
    existing.push(row);
    notesByMemberId.set(row.member_id, existing);
  });

  return members.map((member) => {
    const memberNotes = notesByMemberId.get(member.id) ?? [];
    const signedNotes = memberNotes
      .filter((row) => normalizeProgressNoteStatus(row.status) === "signed" && Boolean(row.signed_at))
      .sort((left, right) => {
        const leftSignedAt = left.signed_at ?? "";
        const rightSignedAt = right.signed_at ?? "";
        if (leftSignedAt === rightSignedAt) return right.updated_at.localeCompare(left.updated_at);
        return rightSignedAt.localeCompare(leftSignedAt);
      });
    const draftNotes = memberNotes
      .filter((row) => normalizeProgressNoteStatus(row.status) === "draft")
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
    const latestSigned = signedNotes[0] ?? null;
    const latestDraft = draftNotes[0] ?? null;
    const lastSignedProgressNoteDate = latestSigned?.signed_at ? toEasternDate(latestSigned.signed_at) : null;
    const anchorDate = lastSignedProgressNoteDate ?? member.enrollment_date ?? null;
    const nextProgressNoteDueDate = anchorDate ? computeNextProgressNoteDueDate(anchorDate) : null;
    const complianceStatus = computeProgressNoteComplianceStatus(nextProgressNoteDueDate);
    const daysUntilDue =
      nextProgressNoteDueDate == null
        ? null
        : Math.floor(
            (new Date(`${nextProgressNoteDueDate}T00:00:00.000Z`).getTime() -
              new Date(`${toEasternDate()}T00:00:00.000Z`).getTime()) /
              86400000
          );

    return {
      memberId: member.id,
      memberName: member.display_name,
      memberStatus: member.status,
      enrollmentDate: member.enrollment_date,
      lastSignedProgressNoteDate,
      nextProgressNoteDueDate,
      daysUntilDue,
      complianceStatus,
      hasDraftInProgress: Boolean(latestDraft),
      latestDraftId: latestDraft?.id ?? null,
      latestSignedNoteId: latestSigned?.id ?? null,
      dataIssue: lastSignedProgressNoteDate ? null : member.enrollment_date ? null : "Enrollment date missing"
    } satisfies ProgressNoteComplianceRow;
  });
}

export function sortProgressNoteTrackerRows(rows: ProgressNoteComplianceRow[]) {
  return [...rows].sort((left, right) => {
    const statusRank = getProgressNoteSortRank(left.complianceStatus) - getProgressNoteSortRank(right.complianceStatus);
    if (statusRank !== 0) return statusRank;

    if (left.nextProgressNoteDueDate && right.nextProgressNoteDueDate && left.nextProgressNoteDueDate !== right.nextProgressNoteDueDate) {
      return left.nextProgressNoteDueDate.localeCompare(right.nextProgressNoteDueDate);
    }

    if (left.nextProgressNoteDueDate && !right.nextProgressNoteDueDate) return -1;
    if (!left.nextProgressNoteDueDate && right.nextProgressNoteDueDate) return 1;

    return left.memberName.localeCompare(right.memberName, undefined, { sensitivity: "base" });
  });
}

function summarizeProgressNoteTrackerRows(rows: ProgressNoteComplianceRow[]): ProgressNoteTrackerSummary {
  return {
    total: rows.length,
    overdue: rows.filter((row) => row.complianceStatus === "overdue").length,
    dueToday: rows.filter((row) => row.complianceStatus === "due").length,
    dueSoon: rows.filter((row) => row.complianceStatus === "due_soon").length,
    upcoming: rows.filter((row) => row.complianceStatus === "upcoming").length,
    dataIssues: rows.filter((row) => row.complianceStatus === "data_issue").length
  };
}

async function loadMemberNameMap(memberIds: string[], serviceRole = false) {
  if (memberIds.length === 0) return new Map<string, string>();
  const members = await loadProgressNoteMembers({ memberIds, serviceRole });
  return new Map(members.map((member) => [member.id, member.display_name] as const));
}

export async function getProgressNoteTracker(input?: {
  status?: ProgressNoteTrackerFilter;
  memberId?: string;
  query?: string;
  page?: number;
  pageSize?: number;
  serviceRole?: boolean;
}): Promise<ProgressNoteTrackerResult> {
  const page = Number.isFinite(input?.page) && Number(input?.page) > 0 ? Math.floor(Number(input?.page)) : 1;
  const pageSize = Number.isFinite(input?.pageSize) && Number(input?.pageSize) > 0 ? Math.floor(Number(input?.pageSize)) : 25;
  const filter = input?.status ?? "All";
  const canonicalMemberId = input?.memberId
    ? await resolveCanonicalMemberId(input.memberId, { actionLabel: "getProgressNoteTracker" })
    : null;
  const members = await loadProgressNoteMembers({
    memberId: canonicalMemberId ?? undefined,
    query: cleanText(input?.query) ?? undefined,
    serviceRole: Boolean(input?.serviceRole)
  });
  const memberIds = members.map((member) => member.id);
  const notes = memberIds.length ? await loadProgressNoteRows({ memberIds, serviceRole: Boolean(input?.serviceRole) }) : [];

  const allRows = buildProgressNoteTrackerRows(members, notes);
  const filteredRows = sortProgressNoteTrackerRows(allRows).filter((row) =>
    row.complianceStatus === "data_issue" ? filter === "All" : matchesProgressNoteTrackerFilter(row.complianceStatus, filter)
  );
  const summary = summarizeProgressNoteTrackerRows(allRows);
  const totalRows = filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const start = (page - 1) * pageSize;

  return {
    rows: filteredRows.slice(start, start + pageSize),
    summary,
    page,
    pageSize,
    totalRows,
    totalPages
  };
}

export async function getProgressNoteDashboard(input?: { page?: number; pageSize?: number; serviceRole?: boolean }) {
  const tracker = await getProgressNoteTracker({
    page: input?.page,
    pageSize: input?.pageSize ?? 25,
    serviceRole: Boolean(input?.serviceRole)
  });

  return {
    ...tracker,
    overdue: tracker.rows.filter((row) => row.complianceStatus === "overdue"),
    dueToday: tracker.rows.filter((row) => row.complianceStatus === "due"),
    dueSoon: tracker.rows.filter((row) => row.complianceStatus === "due_soon"),
    dataIssues: tracker.rows.filter((row) => row.complianceStatus === "data_issue")
  };
}

export async function getMemberProgressNoteSummary(memberId: string, options?: { serviceRole?: boolean }) {
  const canonicalMemberId = await resolveCanonicalMemberId(memberId, {
    actionLabel: "getMemberProgressNoteSummary"
  });
  const tracker = await getProgressNoteTracker({
    memberId: canonicalMemberId,
    page: 1,
    pageSize: 1,
    serviceRole: Boolean(options?.serviceRole)
  });
  return tracker.rows[0] ?? null;
}

export async function getProgressNotesForMember(memberId: string, options?: { serviceRole?: boolean }) {
  const canonicalMemberId = await resolveCanonicalMemberId(memberId, {
    actionLabel: "getProgressNotesForMember"
  });
  const [rows, memberMap] = await Promise.all([
    loadProgressNoteRows({ memberId: canonicalMemberId, serviceRole: Boolean(options?.serviceRole) }),
    loadMemberNameMap([canonicalMemberId], Boolean(options?.serviceRole))
  ]);
  const memberName = memberMap.get(canonicalMemberId) ?? null;
  return rows
    .map((row) => toProgressNote(row, memberName))
    .sort((left, right) => {
      const leftSignedAt = left.signedAt ?? "";
      const rightSignedAt = right.signedAt ?? "";
      if (leftSignedAt !== rightSignedAt) return rightSignedAt.localeCompare(leftSignedAt);
      return right.updatedAt.localeCompare(left.updatedAt);
    });
}

export async function getProgressNoteById(noteId: string, options?: { serviceRole?: boolean }) {
  const rows = await loadProgressNoteRows({ noteId, serviceRole: Boolean(options?.serviceRole) });
  const row = rows[0] ?? null;
  if (!row) return null;

  const [memberMap, summary] = await Promise.all([
    loadMemberNameMap([row.member_id], Boolean(options?.serviceRole)),
    getMemberProgressNoteSummary(row.member_id, { serviceRole: Boolean(options?.serviceRole) })
  ]);

  return {
    note: toProgressNote(row, memberMap.get(row.member_id) ?? null),
    summary
  };
}

export async function getExistingProgressNoteDraftForMember(memberId: string, options?: { serviceRole?: boolean }) {
  const canonicalMemberId = await resolveCanonicalMemberId(memberId, {
    actionLabel: "getExistingProgressNoteDraftForMember"
  });
  const row = await findDraftProgressNoteRow(canonicalMemberId, Boolean(options?.serviceRole));
  if (!row) return null;
  const memberMap = await loadMemberNameMap([canonicalMemberId], Boolean(options?.serviceRole));
  return toProgressNote(row, memberMap.get(canonicalMemberId) ?? null);
}

export async function getProgressNoteReminderRows(memberIds: string[], options?: { serviceRole?: boolean }) {
  const uniqueMemberIds = Array.from(new Set(memberIds.filter(Boolean)));
  if (uniqueMemberIds.length === 0) return [] as ProgressNoteComplianceRow[];
  const [members, notes] = await Promise.all([
    loadProgressNoteMembers({ memberIds: uniqueMemberIds, serviceRole: Boolean(options?.serviceRole) }),
    loadProgressNoteRows({ memberIds: uniqueMemberIds, serviceRole: Boolean(options?.serviceRole) })
  ]);
  return sortProgressNoteTrackerRows(buildProgressNoteTrackerRows(members, notes));
}

export function isProgressNoteActionableStatus(status: ProgressNoteComplianceStatus) {
  return status === "overdue" || status === "due" || status === "due_soon";
}
