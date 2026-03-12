type SyncActor = {
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

const PROFILE_SYNC_TODO =
  "Legacy member profile sync moved off mock runtime. Use Supabase-native cascade in lib/services/intake-pof-mhp-cascade.ts and physician-order signing workflow.";

export async function syncMhpToCommandCenter(_memberId: string, _actor: SyncActor = {}, _at?: string) {
  throw new Error(`${PROFILE_SYNC_TODO} Missing dedicated Supabase sync function for MHP -> MCC.`);
}

export async function syncCommandCenterToMhp(_memberId: string, _actor: SyncActor = {}, _at?: string) {
  throw new Error(`${PROFILE_SYNC_TODO} Missing dedicated Supabase sync function for MCC -> MHP.`);
}

export async function syncPhysicianOrderToMemberProfiles(_input: PofSyncInput) {
  throw new Error(
    `${PROFILE_SYNC_TODO} Use syncMemberHealthProfileFromSignedPhysicianOrder from physician-orders-supabase.`
  );
}
