import { addMockRecord, getMockDb, updateMockRecord } from "@/lib/mock-repo";
import { normalizeOperationalDateOnly } from "@/lib/services/operations-calendar";
import { toEasternISO } from "@/lib/timezone";

export interface HoldCoverageResult {
  isOnHold: boolean;
  hold: ReturnType<typeof getMockDb>["memberHolds"][number] | null;
}

function normalizeDate(value: string | null | undefined) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return normalizeOperationalDateOnly(raw);
}

function isHoldActiveForDate(
  hold: ReturnType<typeof getMockDb>["memberHolds"][number],
  dateOnly: string
) {
  if (hold.status !== "active") return false;
  const start = normalizeDate(hold.start_date);
  const end = normalizeDate(hold.end_date);
  if (!start) return false;
  if (dateOnly < start) return false;
  if (end && dateOnly > end) return false;
  return true;
}

export function getMemberHoldCoverageForDate(memberId: string, dateOnlyInput: string): HoldCoverageResult {
  const dateOnly = normalizeOperationalDateOnly(dateOnlyInput);
  const db = getMockDb();
  const hold =
    db.memberHolds
      .filter((row) => row.member_id === memberId)
      .find((row) => isHoldActiveForDate(row, dateOnly)) ?? null;
  return {
    isOnHold: Boolean(hold),
    hold
  };
}

export function isMemberOnHoldOnDate(memberId: string, dateOnlyInput: string) {
  return getMemberHoldCoverageForDate(memberId, dateOnlyInput).isOnHold;
}

export function getMemberHolds(memberId: string) {
  const db = getMockDb();
  return db.memberHolds
    .filter((row) => row.member_id === memberId)
    .sort((left, right) => (left.start_date < right.start_date ? 1 : -1));
}

export function getMemberHoldsByDate(dateOnlyInput: string) {
  const dateOnly = normalizeOperationalDateOnly(dateOnlyInput);
  const db = getMockDb();
  return db.memberHolds
    .filter((row) => isHoldActiveForDate(row, dateOnly))
    .sort((left, right) => left.member_id.localeCompare(right.member_id, undefined, { sensitivity: "base" }));
}

export function createMemberHold(input: {
  memberId: string;
  startDate: string;
  endDate: string | null;
  reason: string;
  reasonOther?: string | null;
  notes?: string | null;
  actorUserId: string;
  actorName: string;
}) {
  const now = toEasternISO();
  const startDate = normalizeOperationalDateOnly(input.startDate);
  const endDate = input.endDate ? normalizeOperationalDateOnly(input.endDate) : null;
  return addMockRecord("memberHolds", {
    member_id: input.memberId,
    start_date: startDate,
    end_date: endDate,
    status: "active",
    reason: input.reason,
    reason_other: input.reasonOther?.trim() || null,
    notes: input.notes?.trim() || null,
    created_by_user_id: input.actorUserId,
    created_by_name: input.actorName,
    created_at: now,
    updated_at: now,
    ended_at: null,
    ended_by_user_id: null,
    ended_by_name: null
  });
}

export function endMemberHold(input: { holdId: string; actorUserId: string; actorName: string }) {
  const now = toEasternISO();
  return updateMockRecord("memberHolds", input.holdId, {
    status: "ended",
    ended_at: now,
    ended_by_user_id: input.actorUserId,
    ended_by_name: input.actorName,
    updated_at: now
  });
}

