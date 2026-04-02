import { createClient } from "@/lib/supabase/server";
import { normalizeOperationalDateOnly } from "@/lib/services/operations-calendar";
import { resolveCanonicalMemberId } from "@/lib/services/canonical-person-ref";
import { toEasternISO } from "@/lib/timezone";


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
  const { data, error } = await supabase
    .from("member_holds")
    .insert({
      member_id: canonicalMemberId,
      start_date: normalizeOperationalDateOnly(input.startDate),
      end_date: input.endDate ? normalizeOperationalDateOnly(input.endDate) : null,
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
  if (error) throw new Error(error.message);
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
