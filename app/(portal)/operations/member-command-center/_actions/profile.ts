import "server-only";

import { saveMemberCommandCenterBundle } from "@/lib/services/member-command-center";
import { toEasternISO } from "@/lib/timezone";

import {
  asNullableBoolSelect,
  asNullableString,
  asString,
  requireCommandCenterEditor,
  revalidateCommandCenter,
  toServiceActor
} from "./shared";

export async function saveMemberCommandCenterDemographicsAction(formData: FormData) {
  const actor = await requireCommandCenterEditor();
  const memberId = asString(formData, "memberId");
  if (!memberId) return { ok: false, error: "Member is required." };

  const now = toEasternISO();
  const city = asNullableString(formData, "city");
  const isVeteran = asNullableBoolSelect(formData, "isVeteran");
  const veteranBranch = isVeteran ? asNullableString(formData, "veteranBranch") : null;
  const rawGender = asString(formData, "gender");
  const gender = rawGender === "M" || rawGender === "F" ? rawGender : null;
  const memberDisplayName = asString(formData, "memberDisplayName");
  const memberDob = asNullableString(formData, "memberDob");

  const memberPatch: Record<string, string | null> = { city };
  if (memberDisplayName.length > 0) {
    memberPatch.display_name = memberDisplayName;
  }

  await saveMemberCommandCenterBundle({
    memberId,
    mccPatch: {
      gender,
      street_address: asNullableString(formData, "streetAddress"),
      city,
      state: asNullableString(formData, "state"),
      zip: asNullableString(formData, "zip"),
      marital_status: asNullableString(formData, "maritalStatus"),
      primary_language: asNullableString(formData, "primaryLanguage") ?? "English",
      secondary_language: asNullableString(formData, "secondaryLanguage"),
      religion: asNullableString(formData, "religion"),
      ethnicity: asNullableString(formData, "ethnicity"),
      is_veteran: isVeteran,
      veteran_branch: veteranBranch
    },
    memberPatch: {
      ...memberPatch,
      dob: memberDob ?? null
    },
    actor: toServiceActor(actor),
    now
  });

  revalidateCommandCenter(memberId);
  return { ok: true };
}

export async function saveMemberCommandCenterLegalAction(formData: FormData) {
  const actor = await requireCommandCenterEditor();
  const memberId = asString(formData, "memberId");
  if (!memberId) return { ok: false, error: "Member is required." };

  const now = toEasternISO();
  const codeStatusInput = asNullableString(formData, "codeStatus");
  const dnrInput = asNullableBoolSelect(formData, "dnr");
  const codeStatus =
    codeStatusInput ?? (dnrInput === true ? "DNR" : dnrInput === false ? "Full Code" : null);
  const dnr = codeStatus === "DNR" ? true : codeStatus === "Full Code" ? false : dnrInput;

  await saveMemberCommandCenterBundle({
    memberId,
    mccPatch: {
      code_status: codeStatus,
      dnr,
      dni: asNullableBoolSelect(formData, "dni"),
      polst_molst_colst: asNullableString(formData, "polstMolstColst"),
      hospice: asNullableBoolSelect(formData, "hospice"),
      advanced_directives_obtained: asNullableBoolSelect(formData, "advancedDirectivesObtained"),
      power_of_attorney: asNullableString(formData, "powerOfAttorney"),
      legal_comments: asNullableString(formData, "legalComments")
    },
    memberPatch: { code_status: codeStatus },
    actor: toServiceActor(actor),
    now
  });

  revalidateCommandCenter(memberId);
  return { ok: true };
}

export async function saveMemberCommandCenterDietAction(formData: FormData) {
  const actor = await requireCommandCenterEditor();
  const memberId = asString(formData, "memberId");
  if (!memberId) return { ok: false, error: "Member is required." };

  const now = toEasternISO();
  const dietType = asString(formData, "dietType");
  const dietTypeOther = asNullableString(formData, "dietTypeOther");
  const normalizedDietType = dietType === "Other" ? (dietTypeOther ?? "Other") : dietType || "Regular";

  await saveMemberCommandCenterBundle({
    memberId,
    mccPatch: {
      diet_type: normalizedDietType,
      dietary_preferences_restrictions: asNullableString(formData, "dietaryPreferencesRestrictions"),
      swallowing_difficulty: asNullableString(formData, "swallowingDifficulty"),
      supplements: asNullableString(formData, "supplements"),
      food_dislikes: asNullableString(formData, "foodDislikes"),
      foods_to_omit: asNullableString(formData, "foodsToOmit"),
      diet_texture: asNullableString(formData, "dietTexture") ?? "Regular",
      command_center_notes: asNullableString(formData, "commandCenterNotes")
    },
    actor: toServiceActor(actor),
    now
  });
  revalidateCommandCenter(memberId);
  return { ok: true };
}
