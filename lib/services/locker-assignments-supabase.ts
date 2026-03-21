import { resolveCanonicalMemberId } from "@/lib/services/canonical-person-ref";
import { createClient } from "@/lib/supabase/server";
import { toEasternISO } from "@/lib/timezone";

export type LockerAssignmentHistoryRow = {
  locker_number: string | null;
  previous_member_assigned: string | null;
  updated_at: string | null;
};

export async function listLockerAssignmentHistorySupabase() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("locker_assignment_history")
    .select("locker_number, previous_member_assigned, updated_at")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as LockerAssignmentHistoryRow[];
}

export async function assignLockerToMemberSupabase(input: {
  memberId: string;
  lockerNumber: string;
  actionLabel?: string;
}) {
  const actionLabel = input.actionLabel ?? "assignLockerToMemberSupabase";
  const canonicalMemberId = await resolveCanonicalMemberId(input.memberId, { actionLabel });

  const supabase = await createClient();
  const { data: member, error: memberError } = await supabase
    .from("members")
    .select("id, display_name, status, locker_number")
    .eq("id", canonicalMemberId)
    .maybeSingle();
  if (memberError) throw new Error(memberError.message);
  if (!member) throw new Error("Member not found.");
  if (member.status !== "active") throw new Error("Only active members can be assigned a locker.");

  const { data: conflictRows, error: conflictError } = await supabase
    .from("members")
    .select("id, display_name")
    .neq("id", canonicalMemberId)
    .eq("status", "active")
    .eq("locker_number", input.lockerNumber)
    .limit(1);
  if (conflictError) throw new Error(conflictError.message);
  const conflict = conflictRows?.[0] ?? null;
  if (conflict) {
    throw new Error(`Locker ${input.lockerNumber} is already assigned to ${conflict.display_name}.`);
  }

  const { error: updateError } = await supabase
    .from("members")
    .update({
      locker_number: input.lockerNumber,
      updated_at: toEasternISO()
    })
    .eq("id", canonicalMemberId);
  if (updateError) throw new Error("Unable to save locker assignment.");

  return {
    memberId: canonicalMemberId,
    memberName: member.display_name,
    lockerNumber: input.lockerNumber
  };
}

export async function clearLockerForMemberSupabase(input: {
  memberId: string;
  actionLabel?: string;
}) {
  const actionLabel = input.actionLabel ?? "clearLockerForMemberSupabase";
  const canonicalMemberId = await resolveCanonicalMemberId(input.memberId, { actionLabel });

  const supabase = await createClient();
  const { data: member, error: memberError } = await supabase
    .from("members")
    .select("id, display_name, locker_number")
    .eq("id", canonicalMemberId)
    .maybeSingle();
  if (memberError) throw new Error(memberError.message);
  if (!member) throw new Error("Member not found.");

  const at = toEasternISO();
  const clearedLocker = typeof member.locker_number === "string" ? member.locker_number.trim() : "";
  if (clearedLocker) {
    const { error: historyError } = await supabase
      .from("locker_assignment_history")
      .upsert(
        {
          locker_number: clearedLocker,
          previous_member_id: canonicalMemberId,
          previous_member_assigned: member.display_name,
          previous_assigned_at: at,
          updated_at: at
        },
        { onConflict: "locker_number" }
      );
    if (historyError) throw new Error("Unable to save previous locker assignment.");
  }

  const { error: clearError } = await supabase
    .from("members")
    .update({
      locker_number: null,
      updated_at: at
    })
    .eq("id", canonicalMemberId);
  if (clearError) throw new Error("Unable to clear locker.");

  return {
    memberId: canonicalMemberId,
    memberName: member.display_name
  };
}
