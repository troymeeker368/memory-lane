import { resolveCanonicalMemberRef } from "@/lib/services/canonical-person-ref";
import { createClient } from "@/lib/supabase/server";
import { toEasternISO } from "@/lib/timezone";

type MemberLockerRow = {
  id: string;
  display_name: string;
  status: "active" | "inactive" | null;
  locker_number: string | null;
};

export async function assignLockerToMemberSupabase(input: {
  memberId: string;
  lockerNumber: string;
  actionLabel?: string;
}) {
  const actionLabel = input.actionLabel ?? "assignLockerToMemberSupabase";
  const canonical = await resolveCanonicalMemberRef(
    {
      sourceType: "member",
      memberId: input.memberId,
      selectedId: input.memberId
    },
    { actionLabel }
  );
  if (!canonical.memberId) {
    throw new Error(`${actionLabel} expected member.id but canonical member resolution returned empty memberId.`);
  }

  const supabase = await createClient();
  const { data: member, error: memberError } = await supabase
    .from("members")
    .select("id, display_name, status, locker_number")
    .eq("id", canonical.memberId)
    .maybeSingle();
  if (memberError) throw new Error(memberError.message);
  if (!member) throw new Error("Member not found.");
  if (member.status !== "active") throw new Error("Only active members can be assigned a locker.");

  const { data: conflictRows, error: conflictError } = await supabase
    .from("members")
    .select("id, display_name")
    .neq("id", canonical.memberId)
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
    .eq("id", canonical.memberId);
  if (updateError) throw new Error("Unable to save locker assignment.");

  return {
    memberId: canonical.memberId,
    memberName: member.display_name,
    lockerNumber: input.lockerNumber
  };
}

export async function clearLockerForMemberSupabase(input: {
  memberId: string;
  actionLabel?: string;
}) {
  const actionLabel = input.actionLabel ?? "clearLockerForMemberSupabase";
  const canonical = await resolveCanonicalMemberRef(
    {
      sourceType: "member",
      memberId: input.memberId,
      selectedId: input.memberId
    },
    { actionLabel }
  );
  if (!canonical.memberId) {
    throw new Error(`${actionLabel} expected member.id but canonical member resolution returned empty memberId.`);
  }

  const supabase = await createClient();
  const { data: member, error: memberError } = await supabase
    .from("members")
    .select("id, display_name, locker_number")
    .eq("id", canonical.memberId)
    .maybeSingle();
  if (memberError) throw new Error(memberError.message);
  if (!member) throw new Error("Member not found.");

  const { error: clearError } = await supabase
    .from("members")
    .update({
      locker_number: null,
      updated_at: toEasternISO()
    })
    .eq("id", canonical.memberId);
  if (clearError) throw new Error("Unable to clear locker.");

  return {
    memberId: canonical.memberId,
    memberName: member.display_name
  };
}
