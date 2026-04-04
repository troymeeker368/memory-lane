import { createClient } from "@/lib/supabase/server";
import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";
import { getRequiredMemberAttendanceScheduleSupabase } from "@/lib/services/member-command-center-write";
import { normalizeOperationalDateOnly } from "@/lib/services/operations-calendar";
import { listCanonicalMemberLinksForLeadIds, resolveCanonicalMemberId } from "@/lib/services/canonical-person-ref";
import {
  normalizeScheduleWeekdays,
  SCHEDULE_CHANGE_STATUSES,
  SCHEDULE_CHANGE_TYPES,
  SCHEDULE_WEEKDAY_KEYS,
  type ScheduleChangeRow,
  type ScheduleChangeStatus,
  type ScheduleChangeType,
  type ScheduleWeekdayKey
} from "@/lib/services/schedule-changes-shared";
import { toEasternISO } from "@/lib/timezone";

export {
  SCHEDULE_CHANGE_STATUSES,
  SCHEDULE_CHANGE_TYPES,
  SCHEDULE_WEEKDAY_KEYS
} from "@/lib/services/schedule-changes-shared";
export type {
  ScheduleChangeRow,
  ScheduleChangeStatus,
  ScheduleChangeType,
  ScheduleWeekdayKey
} from "@/lib/services/schedule-changes-shared";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAVE_SCHEDULE_CHANGE_WITH_ATTENDANCE_SYNC_RPC = "rpc_save_schedule_change_with_attendance_sync";
const UPDATE_SCHEDULE_CHANGE_STATUS_WITH_ATTENDANCE_SYNC_RPC = "rpc_update_schedule_change_status_with_attendance_sync";
const SAVE_SCHEDULE_CHANGE_WITH_ATTENDANCE_SYNC_MIGRATION = "0157_schedule_change_attendance_sync_rpc.sql";
const SCHEDULE_CHANGE_SELECT =
  "id, member_id, change_type, effective_start_date, effective_end_date, original_days, new_days, suspend_base_schedule, reason, notes, entered_by, entered_by_user_id, status, created_at, updated_at, closed_at, closed_by, closed_by_user_id";

function normalizeDistinctUuidIds(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => String(value ?? "").trim())
        .filter((value) => UUID_PATTERN.test(value))
    )
  );
}

async function resolveScheduleMemberIdsBulk(rawIds: Array<string | null | undefined>, actionLabel: string) {
  const normalizedIds = normalizeDistinctUuidIds(rawIds);
  if (normalizedIds.length === 0) return [] as string[];

  const supabase = await createClient();
  const { data: memberRows, error: memberRowsError } = await supabase.from("members").select("id").in("id", normalizedIds);
  if (memberRowsError) {
    throw new Error(`${actionLabel} failed member.id lookup: ${memberRowsError.message}`);
  }

  const resolvedMemberIdsByInput = new Map<string, string>();
  const canonicalIds = new Set<string>();
  (memberRows ?? []).forEach((row) => {
    const memberId = String((row as { id: string }).id);
    resolvedMemberIdsByInput.set(memberId, memberId);
    canonicalIds.add(memberId);
  });

  const unresolvedIds = normalizedIds.filter((id) => !resolvedMemberIdsByInput.has(id));
  if (unresolvedIds.length > 0) {
    const leadLinks = await listCanonicalMemberLinksForLeadIds(unresolvedIds, {
      actionLabel: `${actionLabel}:lead-links`
    });
    unresolvedIds.forEach((id) => {
      const memberId = leadLinks.get(id)?.memberId ?? null;
      if (!memberId) return;
      resolvedMemberIdsByInput.set(id, memberId);
      canonicalIds.add(memberId);
    });
  }

  const stillUnresolvedIds = normalizedIds.filter((id) => !resolvedMemberIdsByInput.has(id));
  if (stillUnresolvedIds.length > 0) {
    throw new Error(
      `${actionLabel} expected canonical member identities, but ${stillUnresolvedIds.length} id(s) could not be resolved.`
    );
  }

  return Array.from(canonicalIds);
}


async function resolveScheduleMemberId(rawMemberId: string, actionLabel: string) {
  return resolveCanonicalMemberId(rawMemberId, { actionLabel });
}

type PostgrestErrorLike = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

function extractErrorText(error: PostgrestErrorLike | null | undefined) {
  return [error?.message, error?.details, error?.hint].filter(Boolean).join(" ").toLowerCase();
}

function isMissingRpcFunctionError(error: unknown, rpcName: string) {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: string }).code ?? "").toUpperCase();
  const text = String((error as { message?: string }).message ?? "").toLowerCase();
  return (code === "PGRST202" || code === "42883") && text.includes(rpcName.toLowerCase());
}

function isMissingScheduleChangesTableError(error: PostgrestErrorLike | null | undefined) {
  const text = extractErrorText(error);
  if (!text) return false;
  if (error?.code === "PGRST205") return text.includes("schedule_changes");
  return (
    text.includes("schedule_changes") &&
    (text.includes("schema cache") || text.includes("does not exist") || text.includes("relation"))
  );
}

function scheduleChangesStorageRequiredError() {
  return new Error("Schedule Changes storage is not available. Run Supabase migration 0014_schedule_changes_workflow.sql.");
}

function normalizeChangeType(value: string): ScheduleChangeType {
  if (SCHEDULE_CHANGE_TYPES.includes(value as ScheduleChangeType)) return value as ScheduleChangeType;
  throw new Error("Invalid schedule change type.");
}

function normalizeStatus(value: string): ScheduleChangeStatus {
  if (SCHEDULE_CHANGE_STATUSES.includes(value as ScheduleChangeStatus)) return value as ScheduleChangeStatus;
  throw new Error("Invalid schedule change status.");
}

type ScheduleChangeDbRow = Record<string, unknown> & {
  id?: string;
  member_id?: string;
  change_type?: string;
  effective_start_date?: string;
  effective_end_date?: string | null;
  original_days?: Array<string | null>;
  new_days?: Array<string | null>;
  suspend_base_schedule?: boolean | null;
  reason?: string | null;
  notes?: string | null;
  entered_by?: string | null;
  entered_by_user_id?: string | null;
  status?: string | null;
  created_at?: string;
  updated_at?: string;
  closed_at?: string | null;
  closed_by?: string | null;
  closed_by_user_id?: string | null;
};

type SaveScheduleChangeWithAttendanceSyncRpcRow = ScheduleChangeDbRow;

function toRow(data: ScheduleChangeDbRow): ScheduleChangeRow {
  return {
    id: String(data.id ?? ""),
    member_id: String(data.member_id ?? ""),
    change_type: normalizeChangeType(String(data.change_type)),
    effective_start_date: String(data.effective_start_date),
    effective_end_date: data.effective_end_date ? String(data.effective_end_date) : null,
    original_days: normalizeScheduleWeekdays(Array.isArray(data.original_days) ? data.original_days : []),
    new_days: normalizeScheduleWeekdays(Array.isArray(data.new_days) ? data.new_days : []),
    suspend_base_schedule: Boolean(data.suspend_base_schedule),
    reason: String(data.reason ?? ""),
    notes: data.notes ? String(data.notes) : null,
    entered_by: String(data.entered_by ?? ""),
    entered_by_user_id: data.entered_by_user_id ? String(data.entered_by_user_id) : null,
    status: normalizeStatus(String(data.status ?? "active")),
    created_at: String(data.created_at),
    updated_at: String(data.updated_at),
    closed_at: data.closed_at ? String(data.closed_at) : null,
    closed_by: data.closed_by ? String(data.closed_by) : null,
    closed_by_user_id: data.closed_by_user_id ? String(data.closed_by_user_id) : null
  };
}

export async function listScheduleChangesSupabase(input?: {
  memberId?: string | null;
  status?: ScheduleChangeStatus | "all";
  changeType?: ScheduleChangeType | "all";
  effectiveDate?: string | null;
  limit?: number;
}) {
  const supabase = await createClient();
  let query = supabase.from("schedule_changes").select(SCHEDULE_CHANGE_SELECT).order("created_at", { ascending: false });
  if (input?.memberId) {
    const canonicalMemberIds = await resolveScheduleMemberIdsBulk([input.memberId], "listScheduleChangesSupabase");
    if (canonicalMemberIds.length === 0) return [] as ScheduleChangeRow[];
    query = query.eq("member_id", canonicalMemberIds[0]);
  }
  if (input?.status && input.status !== "all") query = query.eq("status", input.status);
  if (input?.changeType && input.changeType !== "all") query = query.eq("change_type", input.changeType);
  if (input?.effectiveDate) {
    const dateOnly = normalizeOperationalDateOnly(input.effectiveDate);
    query = query.lte("effective_start_date", dateOnly).or(`effective_end_date.is.null,effective_end_date.gte.${dateOnly}`);
  }
  if (typeof input?.limit === "number" && input.limit > 0) query = query.limit(input.limit);

  const { data, error } = await query;
  if (error) {
    if (isMissingScheduleChangesTableError(error)) {
      throw scheduleChangesStorageRequiredError();
    }
    throw new Error(error.message);
  }
  return (data ?? []).map(toRow);
}

export async function listActiveScheduleChangesForMembersSupabase(input: {
  memberIds: Array<string | null | undefined>;
  startDate: string;
  endDate: string;
}) {
  const canonicalMemberIds = await resolveScheduleMemberIdsBulk(
    input.memberIds,
    "listActiveScheduleChangesForMembersSupabase"
  );
  if (canonicalMemberIds.length === 0) return [] as ScheduleChangeRow[];

  const startDate = normalizeOperationalDateOnly(input.startDate);
  const endDate = normalizeOperationalDateOnly(input.endDate);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("schedule_changes")
    .select(SCHEDULE_CHANGE_SELECT)
    .in("member_id", canonicalMemberIds)
    .eq("status", "active")
    .lte("effective_start_date", endDate)
    .or(`effective_end_date.is.null,effective_end_date.gte.${startDate}`)
    .order("effective_start_date", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    if (isMissingScheduleChangesTableError(error)) {
      throw scheduleChangesStorageRequiredError();
    }
    throw new Error(error.message);
  }

  return (data ?? []).map(toRow);
}

export async function getScheduleChangeSupabase(id: string) {
  const normalizedId = id.trim();
  if (!normalizedId) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("schedule_changes")
    .select(SCHEDULE_CHANGE_SELECT)
    .eq("id", normalizedId)
    .maybeSingle();

  if (error) {
    if (isMissingScheduleChangesTableError(error)) {
      throw scheduleChangesStorageRequiredError();
    }
    throw new Error(error.message);
  }

  return data ? toRow(data) : null;
}

export async function saveScheduleChangeWithAttendanceSyncSupabase(input: {
  id?: string | null;
  memberId: string;
  changeType: ScheduleChangeType;
  effectiveStartDate: string;
  effectiveEndDate: string | null;
  originalDays: Array<string | null | undefined>;
  newDays: Array<string | null | undefined>;
  suspendBaseSchedule: boolean;
  reason: string;
  notes: string | null;
  enteredBy?: string | null;
  enteredByUserId?: string | null;
  actorName: string;
  actorUserId: string;
}) {
  const canonicalMemberId = await resolveScheduleMemberId(input.memberId, "saveScheduleChangeWithAttendanceSyncSupabase");
  await getRequiredMemberAttendanceScheduleSupabase(canonicalMemberId, { canonicalInput: true });
  const supabase = await createClient();
  const now = toEasternISO();
  const normalizedId = String(input.id ?? "").trim() || null;
  const originalDays = normalizeScheduleWeekdays(input.originalDays);
  const newDays = normalizeScheduleWeekdays(input.newDays);

  try {
    const data = await invokeSupabaseRpcOrThrow<unknown>(supabase, SAVE_SCHEDULE_CHANGE_WITH_ATTENDANCE_SYNC_RPC, {
      p_schedule_change_id: normalizedId,
      p_member_id: canonicalMemberId,
      p_change_type: input.changeType,
      p_effective_start_date: normalizeOperationalDateOnly(input.effectiveStartDate),
      p_effective_end_date: input.effectiveEndDate ? normalizeOperationalDateOnly(input.effectiveEndDate) : null,
      p_original_days: originalDays,
      p_new_days: newDays,
      p_suspend_base_schedule: Boolean(input.suspendBaseSchedule),
      p_reason: input.reason.trim(),
      p_notes: input.notes?.trim() || null,
      p_entered_by: String(input.enteredBy ?? "").trim() || input.actorName.trim(),
      p_entered_by_user_id: String(input.enteredByUserId ?? "").trim() || input.actorUserId,
      p_actor_user_id: input.actorUserId,
      p_actor_name: input.actorName,
      p_now: now
    });
    const row = (Array.isArray(data) ? data[0] : null) as SaveScheduleChangeWithAttendanceSyncRpcRow | null;
    if (!row?.id) {
      throw new Error("Schedule change attendance sync RPC did not return the saved row.");
    }
    return toRow(row);
  } catch (error) {
    if (isMissingRpcFunctionError(error, SAVE_SCHEDULE_CHANGE_WITH_ATTENDANCE_SYNC_RPC)) {
      throw new Error(
        `Schedule change attendance sync RPC is not available. Apply Supabase migration ${SAVE_SCHEDULE_CHANGE_WITH_ATTENDANCE_SYNC_MIGRATION} and refresh PostgREST schema cache.`
      );
    }
    throw error;
  }
}

export async function updateScheduleChangeStatusWithAttendanceSyncSupabase(input: {
  id: string;
  status: ScheduleChangeStatus;
  actorName: string;
  actorUserId: string;
}) {
  const existing = await getScheduleChangeSupabase(input.id);
  if (!existing) {
    return null;
  }
  await getRequiredMemberAttendanceScheduleSupabase(existing.member_id, { canonicalInput: true });
  const supabase = await createClient();
  try {
    const data = await invokeSupabaseRpcOrThrow<unknown>(supabase, UPDATE_SCHEDULE_CHANGE_STATUS_WITH_ATTENDANCE_SYNC_RPC, {
      p_schedule_change_id: input.id.trim(),
      p_status: input.status,
      p_actor_user_id: input.actorUserId,
      p_actor_name: input.actorName,
      p_now: toEasternISO()
    });
    const row = (Array.isArray(data) ? data[0] : null) as SaveScheduleChangeWithAttendanceSyncRpcRow | null;
    if (!row?.id) {
      throw new Error("Schedule change status attendance sync RPC did not return the saved row.");
    }
    return toRow(row);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update schedule change.";
    if (message.includes(UPDATE_SCHEDULE_CHANGE_STATUS_WITH_ATTENDANCE_SYNC_RPC)) {
      throw new Error(
        `Schedule change attendance sync RPC is not available. Apply Supabase migration ${SAVE_SCHEDULE_CHANGE_WITH_ATTENDANCE_SYNC_MIGRATION} and refresh PostgREST schema cache.`
      );
    }
    throw error;
  }
}
