"use server";

import { Buffer } from "node:buffer";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getCurrentProfile } from "@/lib/auth";
import { addMockRecord, getMockDb, removeMockRecord, updateMockRecord } from "@/lib/mock-repo";
import { ensureMemberHealthProfile } from "@/lib/services/member-health-profiles";
import { syncMhpToCommandCenter } from "@/lib/services/member-profile-sync";
import { toEasternDate, toEasternISO } from "@/lib/timezone";

function asString(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function asNullableString(formData: FormData, key: string) {
  const value = asString(formData, key);
  return value.length > 0 ? value : null;
}

function asNullableBool(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim().toLowerCase();
  if (!value) return null;
  if (value === "true" || value === "yes" || value === "1") return true;
  if (value === "false" || value === "no" || value === "0") return false;
  return null;
}

const OPHTHALMIC_LATERALITY = new Set(["OD", "OS", "OU"]);
const OTIC_LATERALITY = new Set(["AD", "AS", "AU"]);

function parseRouteLaterality(route: string | null | undefined, formData: FormData) {
  const normalizedRoute = (route ?? "").trim().toLowerCase();
  const laterality = asNullableString(formData, "routeLaterality");

  if (normalizedRoute === "ophthalmic") {
    if (!laterality || !OPHTHALMIC_LATERALITY.has(laterality)) {
      return { ok: false as const, error: "Ophthalmic route requires OD, OS, or OU." };
    }
    return { ok: true as const, value: laterality };
  }

  if (normalizedRoute === "otic") {
    if (!laterality || !OTIC_LATERALITY.has(laterality)) {
      return { ok: false as const, error: "Otic route requires AD, AS, or AU." };
    }
    return { ok: true as const, value: laterality };
  }

  return { ok: true as const, value: null };
}

function resolveProviderSpecialty(formData: FormData) {
  const specialtyChoice = asString(formData, "providerSpecialty");
  const specialtyOther = asNullableString(formData, "providerSpecialtyOther");
  if (specialtyChoice === "Other") {
    const cleanedOther = specialtyOther?.trim() ?? "";
    return {
      specialty: cleanedOther.length > 0 ? cleanedOther : "Other",
      specialty_other: cleanedOther.length > 0 ? cleanedOther : null
    };
  }
  return {
    specialty: specialtyChoice || null,
    specialty_other: null
  };
}

function upsertProviderDirectoryFromValues(input: {
  providerName: string;
  specialty: string | null;
  specialtyOther: string | null;
  practiceName: string | null;
  providerPhone: string | null;
  actor: { id: string; full_name: string };
  now: string;
}) {
  const normalizedProviderName = input.providerName.trim();
  if (!normalizedProviderName) return;

  const db = getMockDb();
  const existing = db.providerDirectory.find(
    (row) => row.provider_name.trim().toLowerCase() === normalizedProviderName.toLowerCase()
  );

  if (existing) {
    updateMockRecord("providerDirectory", existing.id, {
      provider_name: normalizedProviderName,
      specialty: input.specialty ?? existing.specialty ?? null,
      specialty_other: input.specialtyOther ?? existing.specialty_other ?? null,
      practice_name: input.practiceName ?? existing.practice_name ?? null,
      provider_phone: input.providerPhone ?? existing.provider_phone ?? null,
      updated_at: input.now
    });
    return;
  }

  addMockRecord("providerDirectory", {
    provider_name: normalizedProviderName,
    specialty: input.specialty,
    specialty_other: input.specialtyOther,
    practice_name: input.practiceName,
    provider_phone: input.providerPhone,
    created_by_user_id: input.actor.id,
    created_by_name: input.actor.full_name,
    created_at: input.now,
    updated_at: input.now
  });
}

function upsertHospitalPreferenceDirectoryFromValue(input: {
  hospitalName: string | null;
  actor: { id: string; full_name: string };
  now: string;
}) {
  const normalizedHospitalName = (input.hospitalName ?? "").trim();
  if (!normalizedHospitalName) return;

  const db = getMockDb();
  const existing = db.hospitalPreferenceDirectory.find(
    (row) => row.hospital_name.trim().toLowerCase() === normalizedHospitalName.toLowerCase()
  );

  if (existing) {
    updateMockRecord("hospitalPreferenceDirectory", existing.id, {
      hospital_name: normalizedHospitalName,
      updated_at: input.now
    });
    return;
  }

  addMockRecord("hospitalPreferenceDirectory", {
    hospital_name: normalizedHospitalName,
    created_by_user_id: input.actor.id,
    created_by_name: input.actor.full_name,
    created_at: input.now,
    updated_at: input.now
  });
}

async function requireNurseAdmin() {
  const profile = await getCurrentProfile();
  if (profile.role !== "admin" && profile.role !== "nurse") {
    throw new Error("Only Nurse/Admin can manage Member Health Profiles.");
  }
  return profile;
}

function revalidateMhp(memberId: string) {
  revalidatePath("/health/member-health-profiles");
  revalidatePath(`/health/member-health-profiles/${memberId}`);
  revalidatePath("/operations/member-command-center");
  revalidatePath(`/operations/member-command-center/${memberId}`);
  revalidatePath(`/members/${memberId}`);
  revalidatePath("/health");
}

async function asUploadedImageDataUrl(formData: FormData, key: string, fallback: string | null) {
  const file = formData.get(key);
  if (file instanceof File && file.size > 0 && file.type.startsWith("image/")) {
    const bytes = Buffer.from(await file.arrayBuffer());
    return `data:${file.type};base64,${bytes.toString("base64")}`;
  }
  return fallback;
}

function touchMhpProfile(memberId: string, actor: { id: string; full_name: string }, at?: string) {
  const now = at ?? toEasternISO();
  const profile = ensureMemberHealthProfile(memberId);
  updateMockRecord("memberHealthProfiles", profile.id, {
    updated_at: now,
    updated_by_user_id: actor.id,
    updated_by_name: actor.full_name
  });
}

export async function saveMhpOverviewAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  if (!memberId) return;
  const now = toEasternISO();
  const profile = ensureMemberHealthProfile(memberId);
  const profileImageUrl = await asUploadedImageDataUrl(formData, "photoFile", profile.profile_image_url ?? null);
  const sameAsPrimary = asNullableBool(formData, "sameAsPrimary") === true;
  const primaryCaregiverName = asNullableString(formData, "primaryCaregiverName");
  const primaryCaregiverPhone = asNullableString(formData, "primaryCaregiverPhone");
  const responsiblePartyName = sameAsPrimary ? primaryCaregiverName : asNullableString(formData, "responsiblePartyName");
  const responsiblePartyPhone = sameAsPrimary ? primaryCaregiverPhone : asNullableString(formData, "responsiblePartyPhone");
  const memberDob = asNullableString(formData, "memberDob");

  updateMockRecord("memberHealthProfiles", profile.id, {
    gender: asNullableString(formData, "gender"),
    payor: asNullableString(formData, "payor"),
    original_referral_source: asNullableString(formData, "originalReferralSource"),
    photo_consent: asNullableBool(formData, "photoConsent"),
    profile_image_url: profileImageUrl,
    primary_caregiver_name: primaryCaregiverName,
    primary_caregiver_phone: primaryCaregiverPhone,
    responsible_party_name: responsiblePartyName,
    responsible_party_phone: responsiblePartyPhone,
    important_alerts: asNullableString(formData, "importantAlerts"),
    updated_at: now,
    updated_by_user_id: actor.id,
    updated_by_name: actor.full_name
  });
  updateMockRecord("members", memberId, {
    dob: memberDob
  });
  syncMhpToCommandCenter(
    memberId,
    {
      id: actor.id,
      fullName: actor.full_name
    },
    now
  );

  revalidateMhp(memberId);
  redirect(`/health/member-health-profiles/${memberId}?tab=overview`);
}

export async function updateMhpPhotoAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const returnTab = asString(formData, "returnTab") || "overview";
  if (!memberId) return;
  const now = toEasternISO();
  const profile = ensureMemberHealthProfile(memberId);
  const profileImageUrl = await asUploadedImageDataUrl(formData, "photoFile", profile.profile_image_url ?? null);

  updateMockRecord("memberHealthProfiles", profile.id, {
    profile_image_url: profileImageUrl,
    updated_at: now,
    updated_by_user_id: actor.id,
    updated_by_name: actor.full_name
  });
  syncMhpToCommandCenter(
    memberId,
    {
      id: actor.id,
      fullName: actor.full_name
    },
    now
  );

  revalidateMhp(memberId);
  redirect(`/health/member-health-profiles/${memberId}?tab=${returnTab}`);
}

export async function saveMhpMedicalAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  if (!memberId) return;
  const now = toEasternISO();
  const profile = ensureMemberHealthProfile(memberId);
  const dietType = asString(formData, "dietType");
  const dietTypeOther = asNullableString(formData, "dietTypeOther");
  const normalizedDietType = dietType === "Other" ? (dietTypeOther ?? "Other") : (dietType || null);

  updateMockRecord("memberHealthProfiles", profile.id, {
    diet_type: normalizedDietType,
    dietary_restrictions: asNullableString(formData, "dietaryRestrictions"),
    swallowing_difficulty: asNullableString(formData, "swallowingDifficulty"),
    diet_texture: asNullableString(formData, "dietTexture"),
    supplements: asNullableString(formData, "supplements"),
    foods_to_omit: asNullableString(formData, "foodsToOmit"),
    updated_at: now,
    updated_by_user_id: actor.id,
    updated_by_name: actor.full_name
  });
  syncMhpToCommandCenter(
    memberId,
    {
      id: actor.id,
      fullName: actor.full_name
    },
    now
  );

  revalidateMhp(memberId);
  redirect(`/health/member-health-profiles/${memberId}?tab=medical`);
}

export async function saveMhpFunctionalAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  if (!memberId) return;
  const now = toEasternISO();
  const profile = ensureMemberHealthProfile(memberId);

  updateMockRecord("memberHealthProfiles", profile.id, {
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
    updated_at: now,
    updated_by_user_id: actor.id,
    updated_by_name: actor.full_name
  });

  revalidateMhp(memberId);
  redirect(`/health/member-health-profiles/${memberId}?tab=functional`);
}

export async function saveMhpCognitiveBehaviorAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  if (!memberId) return;
  const now = toEasternISO();
  const profile = ensureMemberHealthProfile(memberId);

  updateMockRecord("memberHealthProfiles", profile.id, {
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
    updated_at: now,
    updated_by_user_id: actor.id,
    updated_by_name: actor.full_name
  });

  revalidateMhp(memberId);
  redirect(`/health/member-health-profiles/${memberId}?tab=cognitive-behavioral`);
}

export async function saveMhpLegalAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  if (!memberId) return;
  const now = toEasternISO();
  const profile = ensureMemberHealthProfile(memberId);
  const codeStatus = asNullableString(formData, "codeStatus");
  const computedDnr = codeStatus === "DNR" ? true : codeStatus === "Full Code" ? false : asNullableBool(formData, "dnr");
  const hospitalPreference = asNullableString(formData, "hospitalPreference");

  updateMockRecord("memberHealthProfiles", profile.id, {
    code_status: codeStatus,
    dnr: computedDnr,
    dni: asNullableBool(formData, "dni"),
    polst_molst_colst: asNullableString(formData, "polst"),
    hospice: asNullableBool(formData, "hospice"),
    advanced_directives_obtained: asNullableBool(formData, "advancedDirectivesObtained"),
    power_of_attorney: asNullableString(formData, "powerOfAttorney"),
    hospital_preference: hospitalPreference,
    legal_comments: asNullableString(formData, "legalComments"),
    updated_at: now,
    updated_by_user_id: actor.id,
    updated_by_name: actor.full_name
  });
  upsertHospitalPreferenceDirectoryFromValue({
    hospitalName: hospitalPreference,
    actor,
    now
  });
  syncMhpToCommandCenter(
    memberId,
    {
      id: actor.id,
      fullName: actor.full_name
    },
    now
  );

  revalidateMhp(memberId);
  redirect(`/health/member-health-profiles/${memberId}?tab=legal`);
}

export async function addMhpDiagnosisAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  if (!memberId) return;
  const now = toEasternISO();
  const db = getMockDb();
  const existingDiagnosisCount = db.memberDiagnoses.filter((row) => row.member_id === memberId).length;
  const diagnosisType = existingDiagnosisCount === 0 ? "primary" : "secondary";
  addMockRecord("memberDiagnoses", {
    member_id: memberId,
    diagnosis_type: diagnosisType,
    diagnosis_name: asString(formData, "diagnosisName"),
    diagnosis_code: null,
    date_added: asString(formData, "diagnosisDate") || now.slice(0, 10),
    comments: null,
    created_by_user_id: actor.id,
    created_by_name: actor.full_name,
    created_at: now,
    updated_at: now
  });
  touchMhpProfile(memberId, actor, now);
  syncMhpToCommandCenter(
    memberId,
    {
      id: actor.id,
      fullName: actor.full_name
    },
    now
  );

  revalidateMhp(memberId);
  redirect(`/health/member-health-profiles/${memberId}?tab=medical`);
}

export async function updateMhpDiagnosisAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const diagnosisId = asString(formData, "diagnosisId");
  if (!memberId || !diagnosisId) return;
  const now = toEasternISO();

  updateMockRecord("memberDiagnoses", diagnosisId, {
    diagnosis_name: asString(formData, "diagnosisName"),
    diagnosis_code: null,
    date_added: asString(formData, "diagnosisDate"),
    comments: null,
    updated_at: now
  });
  touchMhpProfile(memberId, actor, now);
  syncMhpToCommandCenter(
    memberId,
    {
      id: actor.id,
      fullName: actor.full_name
    },
    now
  );

  revalidateMhp(memberId);
  redirect(`/health/member-health-profiles/${memberId}?tab=medical`);
}

export async function addMhpDiagnosisInlineAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  if (!memberId) return { ok: false, error: "Member is required." };

  const now = toEasternISO();
  const db = getMockDb();
  const existingDiagnosisCount = db.memberDiagnoses.filter((row) => row.member_id === memberId).length;
  const diagnosisType = existingDiagnosisCount === 0 ? "primary" : "secondary";
  const diagnosisName = asString(formData, "diagnosisName");
  const diagnosisDate = asString(formData, "diagnosisDate") || now.slice(0, 10);
  if (!diagnosisName) return { ok: false, error: "Diagnosis is required." };

  const created = addMockRecord("memberDiagnoses", {
    member_id: memberId,
    diagnosis_type: diagnosisType,
    diagnosis_name: diagnosisName,
    diagnosis_code: null,
    date_added: diagnosisDate,
    comments: null,
    created_by_user_id: actor.id,
    created_by_name: actor.full_name,
    created_at: now,
    updated_at: now
  });

  touchMhpProfile(memberId, actor, now);
  revalidateMhp(memberId);

  return {
    ok: true,
    diagnosis: {
      id: created.id,
      diagnosis_type: created.diagnosis_type,
      diagnosis_name: created.diagnosis_name,
      date_added: created.date_added
    }
  };
}

export async function updateMhpDiagnosisInlineAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const diagnosisId = asString(formData, "diagnosisId");
  if (!memberId || !diagnosisId) return { ok: false, error: "Missing diagnosis reference." };

  const diagnosisName = asString(formData, "diagnosisName");
  const diagnosisDate = asString(formData, "diagnosisDate");
  if (!diagnosisName || !diagnosisDate) return { ok: false, error: "Diagnosis and date are required." };

  const now = toEasternISO();
  const updated = updateMockRecord("memberDiagnoses", diagnosisId, {
    diagnosis_name: diagnosisName,
    diagnosis_code: null,
    date_added: diagnosisDate,
    comments: null,
    updated_at: now
  });
  if (!updated) return { ok: false, error: "Diagnosis not found." };

  touchMhpProfile(memberId, actor, now);
  revalidateMhp(memberId);

  return {
    ok: true,
    diagnosis: {
      id: updated.id,
      diagnosis_type: updated.diagnosis_type,
      diagnosis_name: updated.diagnosis_name,
      date_added: updated.date_added
    }
  };
}

export async function addMhpMedicationAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  if (!memberId) return;
  const now = toEasternISO();
  const route = asNullableString(formData, "route");
  const parsedLaterality = parseRouteLaterality(route, formData);
  if (!parsedLaterality.ok) return;

  addMockRecord("memberMedications", {
    member_id: memberId,
    medication_name: asString(formData, "medicationName"),
    date_started: asString(formData, "dateStarted") || toEasternDate(),
    medication_status: "active",
    inactivated_at: null,
    dose: asNullableString(formData, "dose"),
    quantity: asNullableString(formData, "quantity"),
    form: asNullableString(formData, "medicationForm"),
    frequency: asNullableString(formData, "frequency"),
    route,
    route_laterality: parsedLaterality.value,
    comments: asNullableString(formData, "medicationComments"),
    created_by_user_id: actor.id,
    created_by_name: actor.full_name,
    created_at: now,
    updated_at: now
  });
  touchMhpProfile(memberId, actor, now);

  revalidateMhp(memberId);
  redirect(`/health/member-health-profiles/${memberId}?tab=medical`);
}

export async function updateMhpMedicationAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const medicationId = asString(formData, "medicationId");
  if (!memberId || !medicationId) return;
  const now = toEasternISO();
  const route = asNullableString(formData, "route");
  const parsedLaterality = parseRouteLaterality(route, formData);
  if (!parsedLaterality.ok) return;

  updateMockRecord("memberMedications", medicationId, {
    medication_name: asString(formData, "medicationName"),
    date_started: asString(formData, "dateStarted") || toEasternDate(),
    dose: asNullableString(formData, "dose"),
    quantity: asNullableString(formData, "quantity"),
    form: asNullableString(formData, "medicationForm"),
    frequency: asNullableString(formData, "frequency"),
    route,
    route_laterality: parsedLaterality.value,
    comments: asNullableString(formData, "medicationComments"),
    updated_at: now
  });
  touchMhpProfile(memberId, actor, now);

  revalidateMhp(memberId);
  redirect(`/health/member-health-profiles/${memberId}?tab=medical`);
}

export async function addMhpAllergyAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  if (!memberId) return;
  const now = toEasternISO();

  addMockRecord("memberAllergies", {
    member_id: memberId,
    allergy_group: asString(formData, "allergyGroup") || "medication",
    allergy_name: asString(formData, "allergyName"),
    severity: asNullableString(formData, "allergySeverity"),
    comments: asNullableString(formData, "allergyComments"),
    created_by_user_id: actor.id,
    created_by_name: actor.full_name,
    created_at: now,
    updated_at: now
  });
  touchMhpProfile(memberId, actor, now);

  revalidateMhp(memberId);
  redirect(`/health/member-health-profiles/${memberId}?tab=medical`);
}

export async function updateMhpAllergyAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const allergyId = asString(formData, "allergyId");
  if (!memberId || !allergyId) return;
  const now = toEasternISO();

  updateMockRecord("memberAllergies", allergyId, {
    allergy_group: asString(formData, "allergyGroup") || "medication",
    allergy_name: asString(formData, "allergyName"),
    severity: asNullableString(formData, "allergySeverity"),
    comments: asNullableString(formData, "allergyComments"),
    updated_at: now
  });
  touchMhpProfile(memberId, actor, now);

  revalidateMhp(memberId);
  redirect(`/health/member-health-profiles/${memberId}?tab=medical`);
}

export async function addMhpProviderAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  if (!memberId) return;
  const now = toEasternISO();

  const specialty = resolveProviderSpecialty(formData);
  const practiceName = asNullableString(formData, "practiceName");
  const providerPhone = asNullableString(formData, "providerPhone");
  const providerName = asString(formData, "providerName");
  addMockRecord("memberProviders", {
    member_id: memberId,
    provider_name: providerName,
    specialty: specialty.specialty,
    specialty_other: specialty.specialty_other,
    practice_name: practiceName,
    provider_phone: providerPhone,
    created_by_user_id: actor.id,
    created_by_name: actor.full_name,
    created_at: now,
    updated_at: now
  });
  upsertProviderDirectoryFromValues({
    providerName,
    specialty: specialty.specialty,
    specialtyOther: specialty.specialty_other,
    practiceName,
    providerPhone,
    actor,
    now
  });
  touchMhpProfile(memberId, actor, now);

  revalidateMhp(memberId);
  redirect(`/health/member-health-profiles/${memberId}?tab=medical`);
}

export async function updateMhpProviderAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const providerId = asString(formData, "providerId");
  if (!memberId || !providerId) return;
  const now = toEasternISO();

  const specialty = resolveProviderSpecialty(formData);
  const providerName = asString(formData, "providerName");
  const practiceName = asNullableString(formData, "practiceName");
  const providerPhone = asNullableString(formData, "providerPhone");
  updateMockRecord("memberProviders", providerId, {
    provider_name: providerName,
    specialty: specialty.specialty,
    specialty_other: specialty.specialty_other,
    practice_name: practiceName,
    provider_phone: providerPhone,
    updated_at: now
  });
  upsertProviderDirectoryFromValues({
    providerName,
    specialty: specialty.specialty,
    specialtyOther: specialty.specialty_other,
    practiceName,
    providerPhone,
    actor,
    now
  });
  touchMhpProfile(memberId, actor, now);

  revalidateMhp(memberId);
  redirect(`/health/member-health-profiles/${memberId}?tab=medical`);
}

export async function deleteMhpDiagnosisInlineAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const diagnosisId = asString(formData, "diagnosisId");
  if (!memberId || !diagnosisId) return { ok: false, error: "Missing diagnosis reference." };
  const now = toEasternISO();
  const deleted = removeMockRecord("memberDiagnoses", diagnosisId);
  if (!deleted) return { ok: false, error: "Diagnosis not found." };
  touchMhpProfile(memberId, actor, now);
  revalidateMhp(memberId);
  return { ok: true };
}

export async function deleteMhpProviderAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const providerId = asString(formData, "providerId");
  if (!memberId || !providerId) return;
  const now = toEasternISO();
  const deleted = removeMockRecord("memberProviders", providerId);
  if (!deleted) return;
  touchMhpProfile(memberId, actor, now);
  revalidateMhp(memberId);
  redirect(`/health/member-health-profiles/${memberId}?tab=medical`);
}

export async function deleteMhpMedicationAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const medicationId = asString(formData, "medicationId");
  if (!memberId || !medicationId) return;
  const now = toEasternISO();
  const deleted = removeMockRecord("memberMedications", medicationId);
  if (!deleted) return;
  touchMhpProfile(memberId, actor, now);
  revalidateMhp(memberId);
  redirect(`/health/member-health-profiles/${memberId}?tab=medical`);
}

export async function deleteMhpAllergyAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const allergyId = asString(formData, "allergyId");
  if (!memberId || !allergyId) return;
  const now = toEasternISO();
  const deleted = removeMockRecord("memberAllergies", allergyId);
  if (!deleted) return;
  touchMhpProfile(memberId, actor, now);
  syncMhpToCommandCenter(
    memberId,
    {
      id: actor.id,
      fullName: actor.full_name
    },
    now
  );
  revalidateMhp(memberId);
  redirect(`/health/member-health-profiles/${memberId}?tab=medical`);
}

export async function addMhpProviderInlineAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  if (!memberId) return { ok: false, error: "Member is required." };
  const providerName = asString(formData, "providerName");
  if (!providerName) return { ok: false, error: "Provider name is required." };

  const now = toEasternISO();
  const specialty = resolveProviderSpecialty(formData);
  const practiceName = asNullableString(formData, "practiceName");
  const providerPhone = asNullableString(formData, "providerPhone");
  const created = addMockRecord("memberProviders", {
    member_id: memberId,
    provider_name: providerName,
    specialty: specialty.specialty,
    specialty_other: specialty.specialty_other,
    practice_name: practiceName,
    provider_phone: providerPhone,
    created_by_user_id: actor.id,
    created_by_name: actor.full_name,
    created_at: now,
    updated_at: now
  });

  upsertProviderDirectoryFromValues({
    providerName,
    specialty: specialty.specialty,
    specialtyOther: specialty.specialty_other,
    practiceName,
    providerPhone,
    actor,
    now
  });

  touchMhpProfile(memberId, actor, now);
  revalidateMhp(memberId);

  return { ok: true, row: created };
}

export async function deleteMhpProviderInlineAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const providerId = asString(formData, "providerId");
  if (!memberId || !providerId) return { ok: false, error: "Missing provider reference." };

  const now = toEasternISO();
  const deleted = removeMockRecord("memberProviders", providerId);
  if (!deleted) return { ok: false, error: "Provider not found." };

  touchMhpProfile(memberId, actor, now);
  revalidateMhp(memberId);
  return { ok: true };
}

export async function updateMhpProviderInlineAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const providerId = asString(formData, "providerId");
  if (!memberId || !providerId) return { ok: false, error: "Missing provider reference." };
  const providerName = asString(formData, "providerName");
  if (!providerName) return { ok: false, error: "Provider name is required." };

  const specialty = resolveProviderSpecialty(formData);
  const practiceName = asNullableString(formData, "practiceName");
  const providerPhone = asNullableString(formData, "providerPhone");
  const now = toEasternISO();
  const updated = updateMockRecord("memberProviders", providerId, {
    provider_name: providerName,
    specialty: specialty.specialty,
    specialty_other: specialty.specialty_other,
    practice_name: practiceName,
    provider_phone: providerPhone,
    updated_at: now
  });
  if (!updated) return { ok: false, error: "Provider not found." };

  upsertProviderDirectoryFromValues({
    providerName,
    specialty: specialty.specialty,
    specialtyOther: specialty.specialty_other,
    practiceName,
    providerPhone,
    actor,
    now
  });

  touchMhpProfile(memberId, actor, now);
  revalidateMhp(memberId);
  return { ok: true, row: updated };
}

export async function addMhpMedicationInlineAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  if (!memberId) return { ok: false, error: "Member is required." };
  const medicationName = asString(formData, "medicationName");
  if (!medicationName) return { ok: false, error: "Medication is required." };
  const route = asNullableString(formData, "route");
  const parsedLaterality = parseRouteLaterality(route, formData);
  if (!parsedLaterality.ok) return { ok: false, error: parsedLaterality.error };

  const now = toEasternISO();
  const created = addMockRecord("memberMedications", {
    member_id: memberId,
    medication_name: medicationName,
    date_started: asString(formData, "dateStarted") || toEasternDate(),
    medication_status: "active",
    inactivated_at: null,
    dose: asNullableString(formData, "dose"),
    quantity: asNullableString(formData, "quantity"),
    form: asNullableString(formData, "medicationForm"),
    frequency: asNullableString(formData, "frequency"),
    route,
    route_laterality: parsedLaterality.value,
    comments: asNullableString(formData, "medicationComments"),
    created_by_user_id: actor.id,
    created_by_name: actor.full_name,
    created_at: now,
    updated_at: now
  });

  touchMhpProfile(memberId, actor, now);
  syncMhpToCommandCenter(
    memberId,
    {
      id: actor.id,
      fullName: actor.full_name
    },
    now
  );
  revalidateMhp(memberId);
  return { ok: true, row: created };
}

export async function updateMhpMedicationInlineAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const medicationId = asString(formData, "medicationId");
  if (!memberId || !medicationId) return { ok: false, error: "Missing medication reference." };
  const medicationName = asString(formData, "medicationName");
  if (!medicationName) return { ok: false, error: "Medication is required." };
  const route = asNullableString(formData, "route");
  const parsedLaterality = parseRouteLaterality(route, formData);
  if (!parsedLaterality.ok) return { ok: false, error: parsedLaterality.error };

  const now = toEasternISO();
  const updated = updateMockRecord("memberMedications", medicationId, {
    medication_name: medicationName,
    date_started: asString(formData, "dateStarted") || toEasternDate(),
    dose: asNullableString(formData, "dose"),
    quantity: asNullableString(formData, "quantity"),
    form: asNullableString(formData, "medicationForm"),
    frequency: asNullableString(formData, "frequency"),
    route,
    route_laterality: parsedLaterality.value,
    comments: asNullableString(formData, "medicationComments"),
    updated_at: now
  });
  if (!updated) return { ok: false, error: "Medication not found." };

  touchMhpProfile(memberId, actor, now);
  revalidateMhp(memberId);
  return { ok: true, row: updated };
}

export async function deleteMhpMedicationInlineAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const medicationId = asString(formData, "medicationId");
  if (!memberId || !medicationId) return { ok: false, error: "Missing medication reference." };

  const now = toEasternISO();
  const deleted = removeMockRecord("memberMedications", medicationId);
  if (!deleted) return { ok: false, error: "Medication not found." };

  touchMhpProfile(memberId, actor, now);
  revalidateMhp(memberId);
  return { ok: true };
}

export async function inactivateMhpMedicationInlineAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const medicationId = asString(formData, "medicationId");
  if (!memberId || !medicationId) return { ok: false, error: "Missing medication reference." };

  const now = toEasternISO();
  const today = toEasternDate();
  const updated = updateMockRecord("memberMedications", medicationId, {
    medication_status: "inactive",
    inactivated_at: today,
    updated_at: now
  });
  if (!updated) return { ok: false, error: "Medication not found." };

  touchMhpProfile(memberId, actor, now);
  revalidateMhp(memberId);
  return { ok: true, row: updated };
}

export async function reactivateMhpMedicationInlineAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const medicationId = asString(formData, "medicationId");
  if (!memberId || !medicationId) return { ok: false, error: "Missing medication reference." };

  const now = toEasternISO();
  const today = toEasternDate();
  const updated = updateMockRecord("memberMedications", medicationId, {
    medication_status: "active",
    date_started: today,
    inactivated_at: null,
    updated_at: now
  });
  if (!updated) return { ok: false, error: "Medication not found." };

  touchMhpProfile(memberId, actor, now);
  revalidateMhp(memberId);
  return { ok: true, row: updated };
}

export async function addMhpAllergyInlineAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  if (!memberId) return { ok: false, error: "Member is required." };
  const allergyName = asString(formData, "allergyName");
  if (!allergyName) return { ok: false, error: "Allergy is required." };

  const now = toEasternISO();
  const created = addMockRecord("memberAllergies", {
    member_id: memberId,
    allergy_group: asString(formData, "allergyGroup") || "medication",
    allergy_name: allergyName,
    severity: asNullableString(formData, "allergySeverity"),
    comments: asNullableString(formData, "allergyComments"),
    created_by_user_id: actor.id,
    created_by_name: actor.full_name,
    created_at: now,
    updated_at: now
  });

  touchMhpProfile(memberId, actor, now);
  revalidateMhp(memberId);
  return { ok: true, row: created };
}

export async function deleteMhpAllergyInlineAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const allergyId = asString(formData, "allergyId");
  if (!memberId || !allergyId) return { ok: false, error: "Missing allergy reference." };

  const now = toEasternISO();
  const deleted = removeMockRecord("memberAllergies", allergyId);
  if (!deleted) return { ok: false, error: "Allergy not found." };

  touchMhpProfile(memberId, actor, now);
  syncMhpToCommandCenter(
    memberId,
    {
      id: actor.id,
      fullName: actor.full_name
    },
    now
  );
  revalidateMhp(memberId);
  return { ok: true };
}

export async function updateMhpAllergyInlineAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const allergyId = asString(formData, "allergyId");
  if (!memberId || !allergyId) return { ok: false, error: "Missing allergy reference." };
  const allergyName = asString(formData, "allergyName");
  if (!allergyName) return { ok: false, error: "Allergy is required." };

  const now = toEasternISO();
  const updated = updateMockRecord("memberAllergies", allergyId, {
    allergy_group: asString(formData, "allergyGroup") || "medication",
    allergy_name: allergyName,
    severity: asNullableString(formData, "allergySeverity"),
    comments: asNullableString(formData, "allergyComments"),
    updated_at: now
  });
  if (!updated) return { ok: false, error: "Allergy not found." };

  touchMhpProfile(memberId, actor, now);
  syncMhpToCommandCenter(
    memberId,
    {
      id: actor.id,
      fullName: actor.full_name
    },
    now
  );
  revalidateMhp(memberId);
  return { ok: true, row: updated };
}

export async function addMhpEquipmentAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  if (!memberId) return;
  const now = toEasternISO();

  addMockRecord("memberEquipment", {
    member_id: memberId,
    equipment_type: asString(formData, "equipmentType"),
    provider_source: null,
    status: asNullableString(formData, "equipmentStatus") ?? "Active",
    comments: asNullableString(formData, "equipmentComments"),
    created_by_user_id: actor.id,
    created_by_name: actor.full_name,
    created_at: now,
    updated_at: now
  });
  touchMhpProfile(memberId, actor, now);

  revalidateMhp(memberId);
  redirect(`/health/member-health-profiles/${memberId}?tab=equipment`);
}

export async function updateMhpEquipmentAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const equipmentId = asString(formData, "equipmentId");
  if (!memberId || !equipmentId) return;
  const now = toEasternISO();

  updateMockRecord("memberEquipment", equipmentId, {
    equipment_type: asString(formData, "equipmentType"),
    provider_source: null,
    status: asNullableString(formData, "equipmentStatus") ?? "Active",
    comments: asNullableString(formData, "equipmentComments"),
    updated_at: now
  });
  touchMhpProfile(memberId, actor, now);

  revalidateMhp(memberId);
  redirect(`/health/member-health-profiles/${memberId}?tab=equipment`);
}

export async function addMhpEquipmentInlineAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  if (!memberId) return { ok: false, error: "Member is required." };
  const equipmentType = asString(formData, "equipmentType");
  if (!equipmentType) return { ok: false, error: "Equipment type is required." };

  const now = toEasternISO();
  const created = addMockRecord("memberEquipment", {
    member_id: memberId,
    equipment_type: equipmentType,
    provider_source: null,
    status: asNullableString(formData, "equipmentStatus") ?? "Active",
    comments: asNullableString(formData, "equipmentComments"),
    created_by_user_id: actor.id,
    created_by_name: actor.full_name,
    created_at: now,
    updated_at: now
  });
  touchMhpProfile(memberId, actor, now);
  revalidateMhp(memberId);
  return { ok: true, row: created };
}

export async function updateMhpEquipmentInlineAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const equipmentId = asString(formData, "equipmentId");
  if (!memberId || !equipmentId) return { ok: false, error: "Missing equipment reference." };

  const now = toEasternISO();
  const updated = updateMockRecord("memberEquipment", equipmentId, {
    equipment_type: asString(formData, "equipmentType"),
    provider_source: null,
    status: asNullableString(formData, "equipmentStatus") ?? "Active",
    comments: asNullableString(formData, "equipmentComments"),
    updated_at: now
  });
  if (!updated) return { ok: false, error: "Equipment not found." };

  touchMhpProfile(memberId, actor, now);
  revalidateMhp(memberId);
  return { ok: true, row: updated };
}

export async function deleteMhpEquipmentInlineAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const equipmentId = asString(formData, "equipmentId");
  if (!memberId || !equipmentId) return { ok: false, error: "Missing equipment reference." };

  const now = toEasternISO();
  const deleted = removeMockRecord("memberEquipment", equipmentId);
  if (!deleted) return { ok: false, error: "Equipment not found." };

  touchMhpProfile(memberId, actor, now);
  revalidateMhp(memberId);
  return { ok: true };
}

export async function addMhpNoteAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  if (!memberId) return;
  const now = toEasternISO();

  addMockRecord("memberNotes", {
    member_id: memberId,
    note_type: asString(formData, "noteType") || "General",
    note_text: asString(formData, "noteText"),
    created_by_user_id: actor.id,
    created_by_name: actor.full_name,
    created_at: now,
    updated_at: now
  });
  touchMhpProfile(memberId, actor, now);

  revalidateMhp(memberId);
  redirect(`/health/member-health-profiles/${memberId}?tab=notes`);
}

export async function updateMhpNoteAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const noteId = asString(formData, "noteId");
  if (!memberId || !noteId) return;
  const now = toEasternISO();

  updateMockRecord("memberNotes", noteId, {
    note_type: asString(formData, "noteType") || "General",
    note_text: asString(formData, "noteText"),
    updated_at: now
  });
  touchMhpProfile(memberId, actor, now);

  revalidateMhp(memberId);
  redirect(`/health/member-health-profiles/${memberId}?tab=notes`);
}

export async function addMhpNoteInlineAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  if (!memberId) return { ok: false, error: "Member is required." };
  const noteText = asString(formData, "noteText");
  if (!noteText) return { ok: false, error: "Note text is required." };

  const now = toEasternISO();
  const created = addMockRecord("memberNotes", {
    member_id: memberId,
    note_type: asString(formData, "noteType") || "General",
    note_text: noteText,
    created_by_user_id: actor.id,
    created_by_name: actor.full_name,
    created_at: now,
    updated_at: now
  });
  touchMhpProfile(memberId, actor, now);
  revalidateMhp(memberId);
  return { ok: true, row: created };
}

export async function updateMhpNoteInlineAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const noteId = asString(formData, "noteId");
  if (!memberId || !noteId) return { ok: false, error: "Missing note reference." };
  const noteText = asString(formData, "noteText");
  if (!noteText) return { ok: false, error: "Note text is required." };

  const now = toEasternISO();
  const updated = updateMockRecord("memberNotes", noteId, {
    note_type: asString(formData, "noteType") || "General",
    note_text: noteText,
    updated_at: now
  });
  if (!updated) return { ok: false, error: "Note not found." };

  touchMhpProfile(memberId, actor, now);
  revalidateMhp(memberId);
  return { ok: true, row: updated };
}

export async function deleteMhpNoteInlineAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const noteId = asString(formData, "noteId");
  if (!memberId || !noteId) return { ok: false, error: "Missing note reference." };

  const now = toEasternISO();
  const deleted = removeMockRecord("memberNotes", noteId);
  if (!deleted) return { ok: false, error: "Note not found." };

  touchMhpProfile(memberId, actor, now);
  revalidateMhp(memberId);
  return { ok: true };
}

export async function updateMhpTrackInlineAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const track = asString(formData, "track");
  if (!memberId) return { ok: false, error: "Member is required." };

  const allowedTracks = new Set(["Track 1", "Track 2", "Track 3"]);
  if (!allowedTracks.has(track)) return { ok: false, error: "Invalid track." };

  const db = getMockDb();
  const member = db.members.find((row) => row.id === memberId);
  if (!member) return { ok: false, error: "Member not found." };

  const changed = (member.latest_assessment_track ?? "") !== track;
  if (!changed) return { ok: true, changed: false, track };

  const now = toEasternISO();
  updateMockRecord("members", memberId, {
    latest_assessment_track: track
  });

  addMockRecord("memberNotes", {
    member_id: memberId,
    note_type: "Care Plan",
    note_text: `Track changed to ${track}. Care plan review requested.`,
    created_by_user_id: actor.id,
    created_by_name: actor.full_name,
    created_at: now,
    updated_at: now
  });

  touchMhpProfile(memberId, actor, now);
  revalidateMhp(memberId);

  return { ok: true, changed: true, track };
}
