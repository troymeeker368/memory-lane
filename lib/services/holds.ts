import {
  createMemberHoldSupabase,
  endMemberHoldSupabase,
  listMemberHolds,
  type MemberHoldRow
} from "@/lib/services/holds-supabase";
import { normalizeOperationalDateOnly } from "@/lib/services/operations-calendar";
import { isMemberHoldActiveForDate } from "@/lib/services/expected-attendance";

export interface HoldCoverageResult {
  isOnHold: boolean;
  hold: MemberHoldRow | null;
}

export async function getMemberHoldCoverageForDate(memberId: string, dateOnlyInput: string): Promise<HoldCoverageResult> {
  const dateOnly = normalizeOperationalDateOnly(dateOnlyInput);
  const holds = await listMemberHolds();
  const hold =
    holds
      .filter((row) => row.member_id === memberId)
      .find((row) => isMemberHoldActiveForDate(row, dateOnly)) ?? null;

  return {
    isOnHold: Boolean(hold),
    hold
  };
}

export async function isMemberOnHoldOnDate(memberId: string, dateOnlyInput: string) {
  return (await getMemberHoldCoverageForDate(memberId, dateOnlyInput)).isOnHold;
}

export async function getMemberHolds(memberId: string) {
  const holds = await listMemberHolds();
  return holds
    .filter((row) => row.member_id === memberId)
    .sort((left, right) => (left.start_date < right.start_date ? 1 : -1));
}

export async function getMemberHoldsByDate(dateOnlyInput: string) {
  const dateOnly = normalizeOperationalDateOnly(dateOnlyInput);
  const holds = await listMemberHolds();
  return holds
    .filter((row) => isMemberHoldActiveForDate(row, dateOnly))
    .sort((left, right) => left.member_id.localeCompare(right.member_id, undefined, { sensitivity: "base" }));
}

export async function createMemberHold(input: {
  memberId: string;
  startDate: string;
  endDate: string | null;
  reason: string;
  reasonOther?: string | null;
  notes?: string | null;
  actorUserId: string;
  actorName: string;
}) {
  return createMemberHoldSupabase(input);
}

export async function endMemberHold(input: { holdId: string; actorUserId: string; actorName: string }) {
  return endMemberHoldSupabase(input);
}
