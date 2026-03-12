import { randomUUID } from "node:crypto";

import { createClient } from "@/lib/supabase/server";
import { normalizeOperationalDateOnly } from "@/lib/services/operations-calendar";
import { toEasternISO } from "@/lib/timezone";

export const SCHEDULE_CHANGE_TYPES = [
  "Scheduled Absence",
  "Makeup Day",
  "Day Swap",
  "Temporary Schedule Change",
  "Permanent Schedule Change"
] as const;

export type ScheduleChangeType = (typeof SCHEDULE_CHANGE_TYPES)[number];

export const SCHEDULE_CHANGE_STATUSES = ["active", "cancelled", "completed"] as const;
export type ScheduleChangeStatus = (typeof SCHEDULE_CHANGE_STATUSES)[number];

export const SCHEDULE_WEEKDAY_KEYS = ["monday", "tuesday", "wednesday", "thursday", "friday"] as const;
export type ScheduleWeekdayKey = (typeof SCHEDULE_WEEKDAY_KEYS)[number];

export interface ScheduleChangeRow {
  id: string;
  member_id: string;
  change_type: ScheduleChangeType;
  effective_start_date: string;
  effective_end_date: string | null;
  original_days: ScheduleWeekdayKey[];
  new_days: ScheduleWeekdayKey[];
  suspend_base_schedule: boolean;
  reason: string;
  notes: string | null;
  entered_by: string;
  entered_by_user_id: string | null;
  status: ScheduleChangeStatus;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  closed_by: string | null;
  closed_by_user_id: string | null;
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

function normalizeWeekdays(values: Array<string | null | undefined>): ScheduleWeekdayKey[] {
  const normalized = Array.from(
    new Set(
      values
        .map((value) => String(value ?? "").trim().toLowerCase())
        .filter((value): value is ScheduleWeekdayKey => SCHEDULE_WEEKDAY_KEYS.includes(value as ScheduleWeekdayKey))
    )
  );
  return normalized;
}

function toRow(data: any): ScheduleChangeRow {
  return {
    id: data.id,
    member_id: data.member_id,
    change_type: normalizeChangeType(String(data.change_type)),
    effective_start_date: String(data.effective_start_date),
    effective_end_date: data.effective_end_date ? String(data.effective_end_date) : null,
    original_days: normalizeWeekdays(Array.isArray(data.original_days) ? data.original_days : []),
    new_days: normalizeWeekdays(Array.isArray(data.new_days) ? data.new_days : []),
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
  let query = supabase.from("schedule_changes").select("*").order("created_at", { ascending: false });
  if (input?.memberId) query = query.eq("member_id", input.memberId);
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
  const memberIds = Array.from(
    new Set(
      input.memberIds
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)
    )
  );
  if (memberIds.length === 0) return [] as ScheduleChangeRow[];

  const startDate = normalizeOperationalDateOnly(input.startDate);
  const endDate = normalizeOperationalDateOnly(input.endDate);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("schedule_changes")
    .select("*")
    .in("member_id", memberIds)
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

export async function createScheduleChangeSupabase(input: {
  memberId: string;
  changeType: ScheduleChangeType;
  effectiveStartDate: string;
  effectiveEndDate: string | null;
  originalDays: Array<string | null | undefined>;
  newDays: Array<string | null | undefined>;
  suspendBaseSchedule: boolean;
  reason: string;
  notes: string | null;
  enteredBy: string;
  enteredByUserId: string;
}) {
  const supabase = await createClient();
  const now = toEasternISO();
  const originalDays = normalizeWeekdays(input.originalDays);
  const newDays = normalizeWeekdays(input.newDays);
  const payload = {
    id: `schedule-change-${randomUUID()}`,
    member_id: input.memberId,
    change_type: input.changeType,
    effective_start_date: normalizeOperationalDateOnly(input.effectiveStartDate),
    effective_end_date: input.effectiveEndDate ? normalizeOperationalDateOnly(input.effectiveEndDate) : null,
    original_days: originalDays,
    new_days: newDays,
    suspend_base_schedule: Boolean(input.suspendBaseSchedule),
    reason: input.reason.trim(),
    notes: input.notes?.trim() || null,
    entered_by: input.enteredBy.trim(),
    entered_by_user_id: input.enteredByUserId,
    status: "active" as ScheduleChangeStatus,
    created_at: now,
    updated_at: now,
    closed_at: null,
    closed_by: null,
    closed_by_user_id: null
  };

  const { data, error } = await supabase.from("schedule_changes").insert(payload).select("*").single();
  if (error) {
    if (isMissingScheduleChangesTableError(error)) throw scheduleChangesStorageRequiredError();
    throw new Error(error.message);
  }
  return toRow(data);
}

export async function updateScheduleChangeStatusSupabase(input: {
  id: string;
  status: ScheduleChangeStatus;
  actorName: string;
  actorUserId: string;
}) {
  const supabase = await createClient();
  const now = toEasternISO();
  const updates =
    input.status === "active"
      ? {
          status: input.status,
          closed_at: null,
          closed_by: null,
          closed_by_user_id: null,
          updated_at: now
        }
      : {
          status: input.status,
          closed_at: now,
          closed_by: input.actorName,
          closed_by_user_id: input.actorUserId,
          updated_at: now
        };

  const { data, error } = await supabase.from("schedule_changes").update(updates).eq("id", input.id).select("*").maybeSingle();
  if (error) {
    if (isMissingScheduleChangesTableError(error)) throw scheduleChangesStorageRequiredError();
    throw new Error(error.message);
  }
  return data ? toRow(data) : null;
}
