import { runSignedPhysicianOrderPostSignWorkflow } from "@/lib/services/physician-orders-supabase";
import { createClient } from "@/lib/supabase/server";
import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";
import { toEasternISO } from "@/lib/timezone";

export type SyncActor = {
  actorUserId?: string | null;
  actorName?: string | null;
};

type PofSyncInput = {
  memberId: string;
  physicianOrderId: string;
  actorUserId?: string | null;
  actorName?: string | null;
  atIso?: string | null;
};

const SYNC_MHP_TO_COMMAND_CENTER_RPC = "rpc_sync_member_health_profile_to_command_center";
const SYNC_COMMAND_CENTER_TO_MHP_RPC = "rpc_sync_command_center_to_member_health_profile";
const MEMBER_PROFILE_SYNC_RPC_MIGRATION = "0056_shared_rpc_orchestration_hardening.sql";

function isUuid(value: string | null | undefined) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value ?? ""));
}

function toNullableUuid(value: string | null | undefined) {
  return isUuid(value) ? String(value) : null;
}

export async function syncMhpToCommandCenter(memberId: string, actor: SyncActor = {}, at?: string) {
  const now = at ?? toEasternISO();
  const supabase = await createClient();
  try {
    await invokeSupabaseRpcOrThrow<unknown>(supabase, SYNC_MHP_TO_COMMAND_CENTER_RPC, {
      p_member_id: memberId,
      p_actor_user_id: toNullableUuid(actor.actorUserId),
      p_actor_name: actor.actorName ?? null,
      p_now: now
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to sync MHP to Command Center.";
    if (message.includes(SYNC_MHP_TO_COMMAND_CENTER_RPC)) {
      throw new Error(
        `Member profile sync RPC is not available. Apply Supabase migration ${MEMBER_PROFILE_SYNC_RPC_MIGRATION} and refresh PostgREST schema cache.`
      );
    }
    throw error;
  }
}

export async function syncCommandCenterToMhp(memberId: string, actor: SyncActor = {}, at?: string) {
  const now = at ?? toEasternISO();
  const supabase = await createClient();
  try {
    await invokeSupabaseRpcOrThrow<unknown>(supabase, SYNC_COMMAND_CENTER_TO_MHP_RPC, {
      p_member_id: memberId,
      p_actor_user_id: toNullableUuid(actor.actorUserId),
      p_actor_name: actor.actorName ?? null,
      p_now: now
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to sync Command Center to MHP.";
    if (message.includes(SYNC_COMMAND_CENTER_TO_MHP_RPC)) {
      throw new Error(
        `Command Center sync RPC is not available. Apply Supabase migration ${MEMBER_PROFILE_SYNC_RPC_MIGRATION} and refresh PostgREST schema cache.`
      );
    }
    throw error;
  }
}

export async function syncPhysicianOrderToMemberProfiles(input: PofSyncInput) {
  const syncedProfile = await runSignedPhysicianOrderPostSignWorkflow({
    pofId: input.physicianOrderId,
    syncTimestamp: input.atIso ?? undefined
  });
  const syncedMemberId = String((syncedProfile as { member_id?: string } | null)?.member_id ?? "");
  if (syncedMemberId && syncedMemberId !== input.memberId) {
    throw new Error("Physician order sync/member mismatch.");
  }

  return syncedProfile;
}
