import { ensureMemberCommandCenterProfileSupabase, updateMemberCommandCenterProfileSupabase, updateMemberSupabase } from "@/lib/services/member-command-center-supabase";
import { ensureMemberHealthProfileSupabase } from "@/lib/services/member-health-profiles-supabase";
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

const PROFILE_SYNC_TODO =
  "Legacy member profile sync moved off mock runtime. Use Supabase-native cascade in lib/services/intake-pof-mhp-cascade.ts and physician-order signing workflow.";

function isUuid(value: string | null | undefined) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value ?? ""));
}

function toNullableUuid(value: string | null | undefined) {
  return isUuid(value) ? String(value) : null;
}

export async function syncMhpToCommandCenter(memberId: string, actor: SyncActor = {}, at?: string) {
  const now = at ?? toEasternISO();
  const profile = await ensureMemberHealthProfileSupabase(memberId);
  const commandCenterProfile = await ensureMemberCommandCenterProfileSupabase(memberId, {
    actor: {
      userId: toNullableUuid(actor.actorUserId),
      name: actor.actorName ?? null
    }
  });

  await updateMemberCommandCenterProfileSupabase(commandCenterProfile.id, {
    member_id: memberId,
    gender: profile.gender,
    payor: profile.payor,
    original_referral_source: profile.original_referral_source,
    photo_consent: profile.photo_consent,
    profile_image_url: profile.profile_image_url,
    code_status: profile.code_status,
    dnr: profile.dnr,
    dni: profile.dni,
    polst_molst_colst: profile.polst_molst_colst,
    hospice: profile.hospice,
    advanced_directives_obtained: profile.advanced_directives_obtained,
    power_of_attorney: profile.power_of_attorney,
    legal_comments: profile.legal_comments,
    diet_type: profile.diet_type,
    dietary_preferences_restrictions: profile.dietary_restrictions,
    swallowing_difficulty: profile.swallowing_difficulty,
    supplements: profile.supplements,
    foods_to_omit: profile.foods_to_omit,
    diet_texture: profile.diet_texture,
    command_center_notes: profile.important_alerts,
    updated_by_user_id: toNullableUuid(actor.actorUserId),
    updated_by_name: actor.actorName ?? null,
    updated_at: now
  });

  if (profile.code_status) {
    await updateMemberSupabase(memberId, { code_status: profile.code_status });
  }
}

export async function syncCommandCenterToMhp(_memberId: string, _actor: SyncActor = {}, _at?: string) {
  throw new Error(`${PROFILE_SYNC_TODO} Missing dedicated Supabase sync function for MCC -> MHP.`);
}

export async function syncPhysicianOrderToMemberProfiles(_input: PofSyncInput) {
  throw new Error(
    `${PROFILE_SYNC_TODO} Use syncMemberHealthProfileFromSignedPhysicianOrder from physician-orders-supabase.`
  );
}
