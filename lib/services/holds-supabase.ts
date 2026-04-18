import { createClient } from "@/lib/supabase/server";
import { normalizeOperationalDateOnly } from "@/lib/services/operations-calendar";
import { resolveCanonicalMemberId } from "@/lib/services/canonical-person-ref";
import { toEasternISO } from "@/lib/timezone";

type PostgrestErrorLike = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

function isActiveHoldOverlapConstraintError(error: PostgrestErrorLike | null | undefined) {
  if (!error) return false;
  const code = String(error.code ?? "").toUpperCase();
  const text = [error.message, error.details, error.hint].filter(Boolean).join(" ").toLowerCase();
  if (code === "23P01") return true;
  return text.includes("member_holds_no_overlapping_active_ranges");
}


type ResolveHoldMemberOptions = {
  canonicalInput?: boolean;
};

async function resolveHoldMemberId(rawMemberId: string, actionLabel: string, options?: ResolveHoldMemberOptions) {
  if (options?.canonicalInput) return rawMemberId;
  return resolveCanonicalMemberId(rawMemberId, { actionLabel });
}

export interface MemberHoldRow {
  id: string;
  member_id: string;
  start_date: string;
  end_date: string | null;
  status: "active" | "ended";
  reason: string;
  reason_other: string | null;
  notes: string | null;
  created_by_user_id: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  ended_at: string | null;
  ended_by_user_id: string | null;
  ended_by_name: string | null;
}

export async function listMemberHolds(input?: {
  memberId?: string | null;
  canonicalInput?: boolean;
  status?: MemberHoldRow["status"] | "all";
}) {
  const supabase = await createClient();
  let query = supabase
    .from("member_holds")
    .select("id, member_id, start_date, end_date, status, reason, reason_other, notes, created_by_user_id, created_by_name, created_at, updated_at, ended_at, ended_by_user_id, ended_by_name")
    .order("start_date", { ascending: false });
  if (input?.memberId) {
    const canonicalMemberId = await resolveHoldMemberId(input.memberId, "listMemberHolds", {
      canonicalInput: input.canonicalInput
    });
    query = query.eq("member_id", canonicalMemberId);
  }
  if (input?.status && input.status !== "all") {
    query = query.eq("status", input.status);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as MemberHoldRow[];
}

export async function createMemberHoldSupabase(input: {
  memberId: string;
  startDate: string;
  endDate: string | null;
  reason: string;
  reasonOther?: string | null;
  notes?: string | null;
  actorUserId: string;
  actorName: string;
  canonicalInput?: boolean;
}) {
  const canonicalMemberId = await resolveHoldMemberId(input.memberId, "createMemberHoldSupabase", {
    canonicalInput: input.canonicalInput
  });
  const supabase = await createClient();
  const now = toEasternISO();
  const normalizedStartDate = normalizeOperationalDateOnly(input.startDate);
  const normalizedEndDate = input.endDate ? normalizeOperationalDateOnly(input.endDate) : null;
  if (normalizedEndDate && normalizedEndDate < normalizedStartDate) {
    throw new Error("End date cannot be earlier than start date.");
  }

  const { data: activeHolds, error: activeHoldsError } = await supabase
    .from("member_holds")
    .select("id, start_date, end_date")
    .eq("member_id", canonicalMemberId)
    .eq("status", "active");
  if (activeHoldsError) throw new Error(activeHoldsError.message);

  const incomingEnd = normalizedEndDate ?? "9999-12-31";
  const overlapsExistingActiveHold = ((activeHolds ?? []) as Array<{ id: string; start_date: string; end_date: string | null }>).some(
    (hold) => {
      const existingStart = normalizeOperationalDateOnly(hold.start_date);
      const existingEnd = hold.end_date ? normalizeOperationalDateOnly(hold.end_date) : "9999-12-31";
      return existingStart <= incomingEnd && existingEnd >= normalizedStartDate;
    }
  );
  if (overlapsExistingActiveHold) {
    throw new Error(
      "Member already has an overlapping active hold. End the existing hold or pick a non-overlapping date range."
    );
  }

  const { data, error } = await supabase
    .from("member_holds")
    .insert({
      member_id: canonicalMemberId,
      start_date: normalizedStartDate,
      end_date: normalizedEndDate,
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
    })
    .select("*")
    .single();
  if (error) {
    if (isActiveHoldOverlapConstraintError(error)) {
      throw new Error("Member already has an overlapping active hold. End the existing hold or pick a non-overlapping date range.");
    }
    throw new Error(error.message);
  }
  return data as MemberHoldRow;
}

export async function endMemberHoldSupabase(input: {
  holdId: string;
  actorUserId: string;
  actorName: string;
}) {
  const supabase = await createClient();
  const now = toEasternISO();
  const { data, error } = await supabase
    .from("member_holds")
    .update({
      status: "ended",
      ended_at: now,
      ended_by_user_id: input.actorUserId,
      ended_by_name: input.actorName,
      updated_at: now
    })
    .eq("id", input.holdId)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as MemberHoldRow | null) ?? null;
}
