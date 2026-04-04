import "server-only";

import { redirect } from "next/navigation";

import { normalizePhoneForStorage } from "@/lib/phone";
import { saveMemberHealthProfileBundle, updateMemberTrackWithCarePlanNote } from "@/lib/services/member-health-profiles";
import { getMemberTrackForMhpSupabase } from "@/lib/services/member-health-profiles-write-supabase";
import { ensureMemberHealthProfileSupabase } from "@/lib/services/member-health-profiles-supabase";
import { asUploadedImageDataUrl } from "@/lib/utils/uploaded-image-data-url";
import { toEasternISO } from "@/lib/timezone";

import {
  asNullableBool,
  asNullableString,
  asString,
  buildMhpUpdatedByPatch,
  requireNurseAdmin,
  revalidateMhp,
  toServiceActor
} from "./shared";

export async function saveMhpOverviewAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  if (!memberId) return;

  const now = toEasternISO();
  const profile = await ensureMemberHealthProfileSupabase(memberId);
  const profileImageUrl = await asUploadedImageDataUrl(formData, "photoFile", profile.profile_image_url ?? null);
  const sameAsPrimary = asNullableBool(formData, "sameAsPrimary") === true;
  const primaryCaregiverName = asNullableString(formData, "primaryCaregiverName");
  const primaryCaregiverPhone = normalizePhoneForStorage(asNullableString(formData, "primaryCaregiverPhone"));
  const responsiblePartyName = sameAsPrimary ? primaryCaregiverName : asNullableString(formData, "responsiblePartyName");
  const responsiblePartyPhone = sameAsPrimary
    ? primaryCaregiverPhone
    : normalizePhoneForStorage(asNullableString(formData, "responsiblePartyPhone"));
  const memberDob = asNullableString(formData, "memberDob");

  await saveMemberHealthProfileBundle({
    memberId,
    mhpPatch: {
      gender: asNullableString(formData, "gender"),
      original_referral_source: asNullableString(formData, "originalReferralSource"),
      photo_consent: asNullableBool(formData, "photoConsent"),
      profile_image_url: profileImageUrl,
      primary_caregiver_name: primaryCaregiverName,
      primary_caregiver_phone: primaryCaregiverPhone,
      responsible_party_name: responsiblePartyName,
      responsible_party_phone: responsiblePartyPhone,
      important_alerts: asNullableString(formData, "importantAlerts"),
      ...buildMhpUpdatedByPatch(actor, now)
    },
    memberPatch: {
      dob: memberDob
    },
    actor: toServiceActor(actor),
    now,
    syncToCommandCenter: true
  });

  revalidateMhp(memberId);
  redirect(`/health/member-health-profiles/${memberId}?tab=overview`);
}

export async function updateMhpPhotoAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const returnTab = asString(formData, "returnTab") || "overview";
  if (!memberId) return;

  const now = toEasternISO();
  const profile = await ensureMemberHealthProfileSupabase(memberId);
  const profileImageUrl = await asUploadedImageDataUrl(formData, "photoFile", profile.profile_image_url ?? null);

  await saveMemberHealthProfileBundle({
    memberId,
    mhpPatch: {
      profile_image_url: profileImageUrl,
      ...buildMhpUpdatedByPatch(actor, now)
    },
    actor: toServiceActor(actor),
    now,
    syncToCommandCenter: true
  });

  revalidateMhp(memberId);
  redirect(`/health/member-health-profiles/${memberId}?tab=${returnTab}`);
}

export async function saveMhpMedicalAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  if (!memberId) return;

  const now = toEasternISO();
  const dietType = asString(formData, "dietType");
  const dietTypeOther = asNullableString(formData, "dietTypeOther");
  const normalizedDietType = dietType === "Other" ? (dietTypeOther ?? "Other") : (dietType || null);

  await saveMemberHealthProfileBundle({
    memberId,
    mhpPatch: {
      diet_type: normalizedDietType,
      dietary_restrictions: asNullableString(formData, "dietaryRestrictions"),
      swallowing_difficulty: asNullableString(formData, "swallowingDifficulty"),
      diet_texture: asNullableString(formData, "dietTexture"),
      supplements: asNullableString(formData, "supplements"),
      foods_to_omit: asNullableString(formData, "foodsToOmit"),
      ...buildMhpUpdatedByPatch(actor, now)
    },
    actor: toServiceActor(actor),
    now,
    syncToCommandCenter: true
  });

  revalidateMhp(memberId);
  redirect(`/health/member-health-profiles/${memberId}?tab=medical`);
}

export async function saveMhpFunctionalAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  if (!memberId) return;

  const now = toEasternISO();
  await saveMemberHealthProfileBundle({
    memberId,
    mhpPatch: {
      ambulation: asNullableString(formData, "ambulation"),
      transferring: asNullableString(formData, "transferring"),
      bathing: asNullableString(formData, "bathing"),
      dressing: asNullableString(formData, "dressing"),
      eating: asNullableString(formData, "eating"),
      bladder_continence: asNullableString(formData, "bladderContinence"),
      bowel_continence: asNullableString(formData, "bowelContinence"),
      toileting: asNullableString(formData, "toileting"),
      toileting_needs: asNullableString(formData, "toiletingNeeds"),
      toileting_comments: asNullableString(formData, "toiletingComments"),
      hearing: asNullableString(formData, "hearing"),
      vision: asNullableString(formData, "vision"),
      dental: asNullableString(formData, "dental"),
      speech_verbal_status: asNullableString(formData, "speechVerbalStatus"),
      speech_comments: asNullableString(formData, "speechComments"),
      personal_appearance_hygiene_grooming: asNullableString(formData, "hygieneGrooming"),
      may_self_medicate: asNullableBool(formData, "maySelfMedicate"),
      medication_manager_name: asNullableString(formData, "medicationManagerName"),
      ...buildMhpUpdatedByPatch(actor, now)
    },
    actor: toServiceActor(actor),
    now,
    syncToCommandCenter: true
  });

  revalidateMhp(memberId);
  redirect(`/health/member-health-profiles/${memberId}?tab=functional`);
}

export async function saveMhpCognitiveBehaviorAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  if (!memberId) return;

  const now = toEasternISO();
  await saveMemberHealthProfileBundle({
    memberId,
    mhpPatch: {
      orientation_dob: asNullableString(formData, "orientationDob"),
      orientation_city: asNullableString(formData, "orientationCity"),
      orientation_current_year: asNullableString(formData, "orientationCurrentYear"),
      orientation_former_occupation: asNullableString(formData, "orientationFormerOccupation"),
      memory_impairment: asNullableString(formData, "memoryImpairment"),
      memory_severity: asNullableString(formData, "memorySeverity"),
      wandering: asNullableBool(formData, "wandering"),
      combative_disruptive: asNullableBool(formData, "combativeDisruptive"),
      sleep_issues: asNullableBool(formData, "sleepIssues"),
      self_harm_unsafe: asNullableBool(formData, "selfHarmUnsafe"),
      impaired_judgement: asNullableBool(formData, "impairedJudgement"),
      delirium: asNullableBool(formData, "delirium"),
      disorientation: asNullableBool(formData, "disorientation"),
      agitation_resistive: asNullableBool(formData, "agitationResistive"),
      screaming_loud_noises: asNullableBool(formData, "screamingLoudNoises"),
      exhibitionism_disrobing: asNullableBool(formData, "exhibitionismDisrobing"),
      exit_seeking: asNullableBool(formData, "exitSeeking"),
      cognitive_behavior_comments: asNullableString(formData, "cognitiveBehaviorComments"),
      ...buildMhpUpdatedByPatch(actor, now)
    },
    actor: toServiceActor(actor),
    now,
    syncToCommandCenter: true
  });

  revalidateMhp(memberId);
  redirect(`/health/member-health-profiles/${memberId}?tab=cognitive-behavioral`);
}

export async function saveMhpLegalAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  if (!memberId) return;

  const now = toEasternISO();
  const codeStatus = asNullableString(formData, "codeStatus");
  const computedDnr = codeStatus === "DNR" ? true : codeStatus === "Full Code" ? false : asNullableBool(formData, "dnr");
  const hospitalPreference = asNullableString(formData, "hospitalPreference");

  await saveMemberHealthProfileBundle({
    memberId,
    mhpPatch: {
      code_status: codeStatus,
      dnr: computedDnr,
      dni: asNullableBool(formData, "dni"),
      polst_molst_colst: asNullableString(formData, "polst"),
      hospice: asNullableBool(formData, "hospice"),
      advanced_directives_obtained: asNullableBool(formData, "advancedDirectivesObtained"),
      power_of_attorney: asNullableString(formData, "powerOfAttorney"),
      hospital_preference: hospitalPreference,
      legal_comments: asNullableString(formData, "legalComments"),
      ...buildMhpUpdatedByPatch(actor, now)
    },
    memberPatch: {
      code_status: codeStatus
    },
    actor: toServiceActor(actor),
    now,
    syncToCommandCenter: true,
    hospitalName: hospitalPreference
  });

  revalidateMhp(memberId);
  redirect(`/health/member-health-profiles/${memberId}?tab=legal`);
}

export async function updateMhpTrackInlineAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const track = asString(formData, "track");
  if (!memberId) return { ok: false, error: "Member is required." };

  const allowedTracks = new Set(["Track 1", "Track 2", "Track 3"]);
  if (!allowedTracks.has(track)) return { ok: false, error: "Invalid track." };

  const member = await getMemberTrackForMhpSupabase(memberId);
  if (!member) return { ok: false, error: "Member not found." };

  const changed = (member.latest_assessment_track ?? "") !== track;
  if (!changed) return { ok: true, changed: false, track };

  const now = toEasternISO();
  await updateMemberTrackWithCarePlanNote({
    memberId,
    track: track as "Track 1" | "Track 2" | "Track 3",
    actor: toServiceActor(actor),
    now
  });
  revalidateMhp(memberId);

  return { ok: true, changed: true, track };
}
