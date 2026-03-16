import "server-only";

import { Buffer } from "node:buffer";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getCurrentProfile } from "@/lib/auth";
import { normalizePhoneForStorage } from "@/lib/phone";
import {
  mutateMemberAllergyWorkflow,
  mutateMemberDiagnosisWorkflow,
  mutateMemberEquipmentWorkflow,
  mutateMemberMedicationWorkflow,
  mutateMemberNoteWorkflow,
  mutateMemberProviderWorkflow,
  saveMemberHealthProfileBundle,
  updateMemberTrackWithCarePlanNote
} from "@/lib/services/member-health-profiles";
import {
  getMemberTrackForMhpSupabase,
  updateMemberHealthProfileByMemberIdSupabase,
} from "@/lib/services/member-health-profiles-write-supabase";
import { ensureMemberHealthProfileSupabase } from "@/lib/services/member-health-profiles-supabase";
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

const TIME_24H_PATTERN = /^(\d{1,2}):(\d{2})$/;

function normalizeTime24h(value: string | null | undefined) {
  const normalized = (value ?? "").trim();
  if (!normalized) return null;
  const match = TIME_24H_PATTERN.exec(normalized);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function parseScheduledTimesInput(value: string | null | undefined) {
  const raw = (value ?? "").trim();
  if (!raw) return { ok: true as const, times: [] as string[] };
  const times = Array.from(
    new Set(
      raw
        .split(/[;,]/g)
        .map((entry) => normalizeTime24h(entry))
        .filter((entry): entry is string => Boolean(entry))
    )
  );
  if (times.length === 0) {
    return { ok: false as const, error: "Scheduled times must use 24-hour HH:MM format (example: 09:00, 13:30)." };
  }
  return { ok: true as const, times };
}

function parseMedicationMarInput(formData: FormData) {
  const givenAtCenter = asNullableBool(formData, "givenAtCenter") ?? true;
  const prn = asNullableBool(formData, "prn") ?? false;
  const prnInstructions = asNullableString(formData, "prnInstructions");
  const scheduledTimesResult = parseScheduledTimesInput(asNullableString(formData, "scheduledTimes"));
  if (!scheduledTimesResult.ok) return scheduledTimesResult;
  if (givenAtCenter && !prn && scheduledTimesResult.times.length === 0) {
    return {
      ok: false as const,
      error: "Center-administered non-PRN medications require at least one scheduled time."
    };
  }
  return {
    ok: true as const,
    givenAtCenter,
    prn,
    prnInstructions,
    scheduledTimes: scheduledTimesResult.times
  };
}

const OPHTHALMIC_LATERALITY = new Set(["OD", "OS", "OU"]);
const OTIC_LATERALITY = new Set(["AD", "AS", "AU"]);
const ALLERGY_GROUP_OPTIONS = ["medication", "food", "environmental"] as const;
type AllergyGroup = (typeof ALLERGY_GROUP_OPTIONS)[number];

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

function parseAllergyGroup(formData: FormData, key: string): AllergyGroup {
  const value = asString(formData, key);
  return ALLERGY_GROUP_OPTIONS.includes(value as AllergyGroup) ? (value as AllergyGroup) : "medication";
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

function isUuid(value: string | null | undefined) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value ?? ""));
}

function toNullableUuid(value: string | null | undefined) {
  return isUuid(value) ? String(value) : null;
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

function addDaysDateOnly(dateValue: string, days: number) {
  const [yearRaw, monthRaw, dayRaw] = dateValue.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const seed = new Date(Date.UTC(year, month - 1, day));
  seed.setUTCDate(seed.getUTCDate() + days);
  return `${seed.getUTCFullYear()}-${String(seed.getUTCMonth() + 1).padStart(2, "0")}-${String(seed.getUTCDate()).padStart(2, "0")}`;
}

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
      updated_by_user_id: toNullableUuid(actor.id),
      updated_by_name: actor.full_name
    },
    memberPatch: {
      dob: memberDob
    },
    actor: {
      id: actor.id,
      fullName: actor.full_name
    },
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
      updated_at: now,
      updated_by_user_id: toNullableUuid(actor.id),
      updated_by_name: actor.full_name
    },
    actor: {
      id: actor.id,
      fullName: actor.full_name
    },
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
      updated_at: now,
      updated_by_user_id: toNullableUuid(actor.id),
      updated_by_name: actor.full_name
    },
    actor: {
      id: actor.id,
      fullName: actor.full_name
    },
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

  await updateMemberHealthProfileByMemberIdSupabase({ memberId, patch: {
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
    updated_by_user_id: toNullableUuid(actor.id),
    updated_by_name: actor.full_name
  }});

  revalidateMhp(memberId);
  redirect(`/health/member-health-profiles/${memberId}?tab=functional`);
}

export async function saveMhpCognitiveBehaviorAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  if (!memberId) return;
  const now = toEasternISO();

  await updateMemberHealthProfileByMemberIdSupabase({ memberId, patch: {
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
    updated_by_user_id: toNullableUuid(actor.id),
    updated_by_name: actor.full_name
  }});

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
      updated_at: now,
      updated_by_user_id: toNullableUuid(actor.id),
      updated_by_name: actor.full_name
    },
    memberPatch: {
      code_status: codeStatus
    },
    actor: {
      id: actor.id,
      fullName: actor.full_name
    },
    now,
    syncToCommandCenter: true,
    hospitalName: hospitalPreference
  });

  revalidateMhp(memberId);
  redirect(`/health/member-health-profiles/${memberId}?tab=legal`);
}

export async function addMhpDiagnosisAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  if (!memberId) return;
  const now = toEasternISO();
  await mutateMemberDiagnosisWorkflow({
    memberId,
    operation: "create",
    payload: {
      diagnosis_name: asString(formData, "diagnosisName"),
      diagnosis_code: null,
      date_added: asString(formData, "diagnosisDate") || now.slice(0, 10),
      comments: null
    },
    actor: {
      id: actor.id,
      fullName: actor.full_name
    },
    now
  });

  revalidateMhp(memberId);
  redirect(`/health/member-health-profiles/${memberId}?tab=medical`);
}

export async function updateMhpDiagnosisAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const diagnosisId = asString(formData, "diagnosisId");
  if (!memberId || !diagnosisId) return;
  const now = toEasternISO();

  await mutateMemberDiagnosisWorkflow({
    memberId,
    diagnosisId,
    operation: "update",
    payload: {
      diagnosis_name: asString(formData, "diagnosisName"),
      diagnosis_code: null,
      date_added: asString(formData, "diagnosisDate"),
      comments: null
    },
    actor: {
      id: actor.id,
      fullName: actor.full_name
    },
    now
  });

  revalidateMhp(memberId);
  redirect(`/health/member-health-profiles/${memberId}?tab=medical`);
}

export async function addMhpDiagnosisInlineAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  if (!memberId) return { ok: false, error: "Member is required." };

  const now = toEasternISO();
  const diagnosisName = asString(formData, "diagnosisName");
  const diagnosisDate = asString(formData, "diagnosisDate") || now.slice(0, 10);
  if (!diagnosisName) return { ok: false, error: "Diagnosis is required." };

  const created = await mutateMemberDiagnosisWorkflow({
    memberId,
    operation: "create",
    payload: {
      diagnosis_name: diagnosisName,
      diagnosis_code: null,
      date_added: diagnosisDate,
      comments: null
    },
    actor: {
      id: actor.id,
      fullName: actor.full_name
    },
    now
  });
  if (!created.changed || !created.entity_row) return { ok: false, error: "Unable to create diagnosis." };
  revalidateMhp(memberId);

  return {
    ok: true,
    diagnosis: {
      id: created.entity_row.id,
      diagnosis_type: created.entity_row.diagnosis_type,
      diagnosis_name: created.entity_row.diagnosis_name,
      date_added: created.entity_row.date_added
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
  const updated = await mutateMemberDiagnosisWorkflow({
    memberId,
    diagnosisId,
    operation: "update",
    payload: {
      diagnosis_name: diagnosisName,
      diagnosis_code: null,
      date_added: diagnosisDate,
      comments: null
    },
    actor: {
      id: actor.id,
      fullName: actor.full_name
    },
    now
  });
  if (!updated.changed || !updated.entity_row) return { ok: false, error: "Diagnosis not found." };
  revalidateMhp(memberId);

  return {
    ok: true,
    diagnosis: {
      id: updated.entity_row.id,
      diagnosis_type: updated.entity_row.diagnosis_type,
      diagnosis_name: updated.entity_row.diagnosis_name,
      date_added: updated.entity_row.date_added
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
  const marInput = parseMedicationMarInput(formData);
  if (!marInput.ok) throw new Error(marInput.error);

  const startDate = toEasternDate();
  const endDate = addDaysDateOnly(startDate, 30);
  await mutateMemberMedicationWorkflow({
    memberId,
    operation: "create",
    payload: {
      medication_name: asString(formData, "medicationName"),
      date_started: asString(formData, "dateStarted") || startDate,
      medication_status: "active",
      inactivated_at: null,
      dose: asNullableString(formData, "dose"),
      quantity: asNullableString(formData, "quantity"),
      form: asNullableString(formData, "medicationForm"),
      frequency: asNullableString(formData, "frequency"),
      route,
      route_laterality: parsedLaterality.value,
      given_at_center: marInput.givenAtCenter,
      prn: marInput.prn,
      prn_instructions: marInput.prnInstructions,
      scheduled_times: marInput.scheduledTimes,
      comments: asNullableString(formData, "medicationComments")
    },
    actor: {
      id: actor.id,
      fullName: actor.full_name
    },
    now,
    marStartDate: startDate,
    marEndDate: endDate
  });

  revalidateMhp(memberId);
  revalidatePath("/health/mar");
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
  const marInput = parseMedicationMarInput(formData);
  if (!marInput.ok) throw new Error(marInput.error);

  const startDate = toEasternDate();
  const endDate = addDaysDateOnly(startDate, 30);
  await mutateMemberMedicationWorkflow({
    memberId,
    medicationId,
    operation: "update",
    payload: {
      medication_name: asString(formData, "medicationName"),
      date_started: asString(formData, "dateStarted") || startDate,
      dose: asNullableString(formData, "dose"),
      quantity: asNullableString(formData, "quantity"),
      form: asNullableString(formData, "medicationForm"),
      frequency: asNullableString(formData, "frequency"),
      route,
      route_laterality: parsedLaterality.value,
      given_at_center: marInput.givenAtCenter,
      prn: marInput.prn,
      prn_instructions: marInput.prnInstructions,
      scheduled_times: marInput.scheduledTimes,
      comments: asNullableString(formData, "medicationComments")
    },
    actor: {
      id: actor.id,
      fullName: actor.full_name
    },
    now,
    marStartDate: startDate,
    marEndDate: endDate
  });

  revalidateMhp(memberId);
  revalidatePath("/health/mar");
  redirect(`/health/member-health-profiles/${memberId}?tab=medical`);
}

export async function addMhpAllergyAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  if (!memberId) return;
  const now = toEasternISO();

  await mutateMemberAllergyWorkflow({
    memberId,
    operation: "create",
    payload: {
      allergy_group: parseAllergyGroup(formData, "allergyGroup"),
      allergy_name: asString(formData, "allergyName"),
      severity: asNullableString(formData, "allergySeverity"),
      comments: asNullableString(formData, "allergyComments")
    },
    actor: {
      id: actor.id,
      fullName: actor.full_name
    },
    now
  });

  revalidateMhp(memberId);
  redirect(`/health/member-health-profiles/${memberId}?tab=medical`);
}

export async function updateMhpAllergyAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const allergyId = asString(formData, "allergyId");
  if (!memberId || !allergyId) return;
  const now = toEasternISO();

  await mutateMemberAllergyWorkflow({
    memberId,
    allergyId,
    operation: "update",
    payload: {
      allergy_group: parseAllergyGroup(formData, "allergyGroup"),
      allergy_name: asString(formData, "allergyName"),
      severity: asNullableString(formData, "allergySeverity"),
      comments: asNullableString(formData, "allergyComments")
    },
    actor: {
      id: actor.id,
      fullName: actor.full_name
    },
    now
  });

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
  const providerPhone = normalizePhoneForStorage(asNullableString(formData, "providerPhone"));
  const providerName = asString(formData, "providerName");
  await mutateMemberProviderWorkflow({
    memberId,
    operation: "create",
    payload: {
      provider_name: providerName,
      specialty: specialty.specialty,
      specialty_other: specialty.specialty_other,
      practice_name: practiceName,
      provider_phone: providerPhone
    },
    actor: {
      id: actor.id,
      fullName: actor.full_name
    },
    now
  });

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
  const providerPhone = normalizePhoneForStorage(asNullableString(formData, "providerPhone"));
  await mutateMemberProviderWorkflow({
    memberId,
    providerId,
    operation: "update",
    payload: {
      provider_name: providerName,
      specialty: specialty.specialty,
      specialty_other: specialty.specialty_other,
      practice_name: practiceName,
      provider_phone: providerPhone
    },
    actor: {
      id: actor.id,
      fullName: actor.full_name
    },
    now
  });

  revalidateMhp(memberId);
  redirect(`/health/member-health-profiles/${memberId}?tab=medical`);
}

export async function deleteMhpDiagnosisInlineAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const diagnosisId = asString(formData, "diagnosisId");
  if (!memberId || !diagnosisId) return { ok: false, error: "Missing diagnosis reference." };
  const now = toEasternISO();
  const deleted = await mutateMemberDiagnosisWorkflow({
    memberId,
    diagnosisId,
    operation: "delete",
    actor: {
      id: actor.id,
      fullName: actor.full_name
    },
    now
  });
  if (!deleted.changed) return { ok: false, error: "Diagnosis not found." };
  revalidateMhp(memberId);
  return { ok: true };
}

export async function deleteMhpProviderAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const providerId = asString(formData, "providerId");
  if (!memberId || !providerId) return;
  const now = toEasternISO();
  const deleted = await mutateMemberProviderWorkflow({
    memberId,
    providerId,
    operation: "delete",
    actor: {
      id: actor.id,
      fullName: actor.full_name
    },
    now
  });
  if (!deleted.changed) return;
  revalidateMhp(memberId);
  redirect(`/health/member-health-profiles/${memberId}?tab=medical`);
}

export async function deleteMhpMedicationAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const medicationId = asString(formData, "medicationId");
  if (!memberId || !medicationId) return;
  const now = toEasternISO();
  const startDate = toEasternDate();
  const endDate = addDaysDateOnly(startDate, 30);
  const deleted = await mutateMemberMedicationWorkflow({
    memberId,
    medicationId,
    operation: "delete",
    actor: {
      id: actor.id,
      fullName: actor.full_name
    },
    now,
    marStartDate: startDate,
    marEndDate: endDate
  });
  if (!deleted.changed) return;
  revalidateMhp(memberId);
  revalidatePath("/health/mar");
  redirect(`/health/member-health-profiles/${memberId}?tab=medical`);
}

export async function deleteMhpAllergyAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const allergyId = asString(formData, "allergyId");
  if (!memberId || !allergyId) return;
  const now = toEasternISO();
  const deleted = await mutateMemberAllergyWorkflow({
    memberId,
    allergyId,
    operation: "delete",
    actor: {
      id: actor.id,
      fullName: actor.full_name
    },
    now
  });
  if (!deleted.changed) return;
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
  const providerPhone = normalizePhoneForStorage(asNullableString(formData, "providerPhone"));
  const created = await mutateMemberProviderWorkflow({
    memberId,
    operation: "create",
    payload: {
      provider_name: providerName,
      specialty: specialty.specialty,
      specialty_other: specialty.specialty_other,
      practice_name: practiceName,
      provider_phone: providerPhone
    },
    actor: {
      id: actor.id,
      fullName: actor.full_name
    },
    now
  });
  if (!created.changed || !created.entity_row) return { ok: false, error: "Unable to create provider." };
  revalidateMhp(memberId);

  return { ok: true, row: created.entity_row };
}

export async function deleteMhpProviderInlineAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const providerId = asString(formData, "providerId");
  if (!memberId || !providerId) return { ok: false, error: "Missing provider reference." };

  const now = toEasternISO();
  const deleted = await mutateMemberProviderWorkflow({
    memberId,
    providerId,
    operation: "delete",
    actor: {
      id: actor.id,
      fullName: actor.full_name
    },
    now
  });
  if (!deleted.changed) return { ok: false, error: "Provider not found." };
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
  const providerPhone = normalizePhoneForStorage(asNullableString(formData, "providerPhone"));
  const now = toEasternISO();
  const updated = await mutateMemberProviderWorkflow({
    memberId,
    providerId,
    operation: "update",
    payload: {
      provider_name: providerName,
      specialty: specialty.specialty,
      specialty_other: specialty.specialty_other,
      practice_name: practiceName,
      provider_phone: providerPhone
    },
    actor: {
      id: actor.id,
      fullName: actor.full_name
    },
    now
  });
  if (!updated.changed || !updated.entity_row) return { ok: false, error: "Provider not found." };
  revalidateMhp(memberId);
  return { ok: true, row: updated.entity_row };
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
  const marInput = parseMedicationMarInput(formData);
  if (!marInput.ok) return { ok: false, error: marInput.error };

  const now = toEasternISO();
  const startDate = toEasternDate();
  const endDate = addDaysDateOnly(startDate, 30);
  const created = await mutateMemberMedicationWorkflow({
    memberId,
    operation: "create",
    payload: {
      medication_name: medicationName,
      date_started: asString(formData, "dateStarted") || startDate,
      medication_status: "active",
      inactivated_at: null,
      dose: asNullableString(formData, "dose"),
      quantity: asNullableString(formData, "quantity"),
      form: asNullableString(formData, "medicationForm"),
      frequency: asNullableString(formData, "frequency"),
      route,
      route_laterality: parsedLaterality.value,
      given_at_center: marInput.givenAtCenter,
      prn: marInput.prn,
      prn_instructions: marInput.prnInstructions,
      scheduled_times: marInput.scheduledTimes,
      comments: asNullableString(formData, "medicationComments")
    },
    actor: {
      id: actor.id,
      fullName: actor.full_name
    },
    now,
    marStartDate: startDate,
    marEndDate: endDate
  });
  if (!created.changed || !created.entity_row) return { ok: false, error: "Unable to create medication." };
  revalidateMhp(memberId);
  revalidatePath("/health/mar");
  return { ok: true, row: created.entity_row };
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
  const marInput = parseMedicationMarInput(formData);
  if (!marInput.ok) return { ok: false, error: marInput.error };

  const now = toEasternISO();
  const startDate = toEasternDate();
  const endDate = addDaysDateOnly(startDate, 30);
  const updated = await mutateMemberMedicationWorkflow({
    memberId,
    medicationId,
    operation: "update",
    payload: {
      medication_name: medicationName,
      date_started: asString(formData, "dateStarted") || startDate,
      dose: asNullableString(formData, "dose"),
      quantity: asNullableString(formData, "quantity"),
      form: asNullableString(formData, "medicationForm"),
      frequency: asNullableString(formData, "frequency"),
      route,
      route_laterality: parsedLaterality.value,
      given_at_center: marInput.givenAtCenter,
      prn: marInput.prn,
      prn_instructions: marInput.prnInstructions,
      scheduled_times: marInput.scheduledTimes,
      comments: asNullableString(formData, "medicationComments")
    },
    actor: {
      id: actor.id,
      fullName: actor.full_name
    },
    now,
    marStartDate: startDate,
    marEndDate: endDate
  });
  if (!updated.changed || !updated.entity_row) return { ok: false, error: "Medication not found." };
  revalidateMhp(memberId);
  revalidatePath("/health/mar");
  return { ok: true, row: updated.entity_row };
}

export async function deleteMhpMedicationInlineAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const medicationId = asString(formData, "medicationId");
  if (!memberId || !medicationId) return { ok: false, error: "Missing medication reference." };

  const now = toEasternISO();
  const startDate = toEasternDate();
  const endDate = addDaysDateOnly(startDate, 30);
  const deleted = await mutateMemberMedicationWorkflow({
    memberId,
    medicationId,
    operation: "delete",
    actor: {
      id: actor.id,
      fullName: actor.full_name
    },
    now,
    marStartDate: startDate,
    marEndDate: endDate
  });
  if (!deleted.changed) return { ok: false, error: "Medication not found." };
  revalidateMhp(memberId);
  revalidatePath("/health/mar");
  return { ok: true };
}

export async function inactivateMhpMedicationInlineAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const medicationId = asString(formData, "medicationId");
  if (!memberId || !medicationId) return { ok: false, error: "Missing medication reference." };

  const now = toEasternISO();
  const today = toEasternDate();
  const startDate = toEasternDate();
  const endDate = addDaysDateOnly(startDate, 30);
  const updated = await mutateMemberMedicationWorkflow({
    memberId,
    medicationId,
    operation: "inactivate",
    payload: {
      inactivated_at: today
    },
    actor: {
      id: actor.id,
      fullName: actor.full_name
    },
    now,
    marStartDate: startDate,
    marEndDate: endDate
  });
  if (!updated.changed || !updated.entity_row) return { ok: false, error: "Medication not found." };
  revalidateMhp(memberId);
  revalidatePath("/health/mar");
  return { ok: true, row: updated.entity_row };
}

export async function reactivateMhpMedicationInlineAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const medicationId = asString(formData, "medicationId");
  if (!memberId || !medicationId) return { ok: false, error: "Missing medication reference." };

  const now = toEasternISO();
  const today = toEasternDate();
  const startDate = toEasternDate();
  const endDate = addDaysDateOnly(startDate, 30);
  const updated = await mutateMemberMedicationWorkflow({
    memberId,
    medicationId,
    operation: "reactivate",
    payload: {
      date_started: today
    },
    actor: {
      id: actor.id,
      fullName: actor.full_name
    },
    now,
    marStartDate: startDate,
    marEndDate: endDate
  });
  if (!updated.changed || !updated.entity_row) return { ok: false, error: "Medication not found." };
  revalidateMhp(memberId);
  revalidatePath("/health/mar");
  return { ok: true, row: updated.entity_row };
}

export async function addMhpAllergyInlineAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  if (!memberId) return { ok: false, error: "Member is required." };
  const allergyName = asString(formData, "allergyName");
  if (!allergyName) return { ok: false, error: "Allergy is required." };

  const now = toEasternISO();
  const created = await mutateMemberAllergyWorkflow({
    memberId,
    operation: "create",
    payload: {
      allergy_group: parseAllergyGroup(formData, "allergyGroup"),
      allergy_name: allergyName,
      severity: asNullableString(formData, "allergySeverity"),
      comments: asNullableString(formData, "allergyComments")
    },
    actor: {
      id: actor.id,
      fullName: actor.full_name
    },
    now
  });
  if (!created.changed || !created.entity_row) return { ok: false, error: "Unable to create allergy." };
  revalidateMhp(memberId);
  return { ok: true, row: created.entity_row };
}

export async function deleteMhpAllergyInlineAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const allergyId = asString(formData, "allergyId");
  if (!memberId || !allergyId) return { ok: false, error: "Missing allergy reference." };

  const now = toEasternISO();
  const deleted = await mutateMemberAllergyWorkflow({
    memberId,
    allergyId,
    operation: "delete",
    actor: {
      id: actor.id,
      fullName: actor.full_name
    },
    now
  });
  if (!deleted.changed) return { ok: false, error: "Allergy not found." };
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
  const updated = await mutateMemberAllergyWorkflow({
    memberId,
    allergyId,
    operation: "update",
    payload: {
      allergy_group: parseAllergyGroup(formData, "allergyGroup"),
      allergy_name: allergyName,
      severity: asNullableString(formData, "allergySeverity"),
      comments: asNullableString(formData, "allergyComments")
    },
    actor: {
      id: actor.id,
      fullName: actor.full_name
    },
    now
  });
  if (!updated.changed || !updated.entity_row) return { ok: false, error: "Allergy not found." };
  revalidateMhp(memberId);
  return { ok: true, row: updated.entity_row };
}

export async function addMhpEquipmentAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  if (!memberId) return;
  const now = toEasternISO();

  await mutateMemberEquipmentWorkflow({
    memberId,
    operation: "create",
    payload: {
      equipment_type: asString(formData, "equipmentType"),
      provider_source: null,
      status: asNullableString(formData, "equipmentStatus") ?? "Active",
      comments: asNullableString(formData, "equipmentComments")
    },
    actor: {
      id: actor.id,
      fullName: actor.full_name
    },
    now
  });

  revalidateMhp(memberId);
  redirect(`/health/member-health-profiles/${memberId}?tab=equipment`);
}

export async function updateMhpEquipmentAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const equipmentId = asString(formData, "equipmentId");
  if (!memberId || !equipmentId) return;
  const now = toEasternISO();

  await mutateMemberEquipmentWorkflow({
    memberId,
    equipmentId,
    operation: "update",
    payload: {
      equipment_type: asString(formData, "equipmentType"),
      provider_source: null,
      status: asNullableString(formData, "equipmentStatus") ?? "Active",
      comments: asNullableString(formData, "equipmentComments")
    },
    actor: {
      id: actor.id,
      fullName: actor.full_name
    },
    now
  });

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
  const created = await mutateMemberEquipmentWorkflow({
    memberId,
    operation: "create",
    payload: {
      equipment_type: equipmentType,
      provider_source: null,
      status: asNullableString(formData, "equipmentStatus") ?? "Active",
      comments: asNullableString(formData, "equipmentComments")
    },
    actor: {
      id: actor.id,
      fullName: actor.full_name
    },
    now
  });
  if (!created.changed || !created.entity_row) return { ok: false, error: "Unable to create equipment." };
  revalidateMhp(memberId);
  return { ok: true, row: created.entity_row };
}

export async function updateMhpEquipmentInlineAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const equipmentId = asString(formData, "equipmentId");
  if (!memberId || !equipmentId) return { ok: false, error: "Missing equipment reference." };

  const now = toEasternISO();
  const updated = await mutateMemberEquipmentWorkflow({
    memberId,
    equipmentId,
    operation: "update",
    payload: {
      equipment_type: asString(formData, "equipmentType"),
      provider_source: null,
      status: asNullableString(formData, "equipmentStatus") ?? "Active",
      comments: asNullableString(formData, "equipmentComments")
    },
    actor: {
      id: actor.id,
      fullName: actor.full_name
    },
    now
  });
  if (!updated.changed || !updated.entity_row) return { ok: false, error: "Equipment not found." };
  revalidateMhp(memberId);
  return { ok: true, row: updated.entity_row };
}

export async function deleteMhpEquipmentInlineAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const equipmentId = asString(formData, "equipmentId");
  if (!memberId || !equipmentId) return { ok: false, error: "Missing equipment reference." };

  const now = toEasternISO();
  const deleted = await mutateMemberEquipmentWorkflow({
    memberId,
    equipmentId,
    operation: "delete",
    actor: {
      id: actor.id,
      fullName: actor.full_name
    },
    now
  });
  if (!deleted.changed) return { ok: false, error: "Equipment not found." };
  revalidateMhp(memberId);
  return { ok: true };
}

export async function addMhpNoteAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  if (!memberId) return;
  const now = toEasternISO();

  await mutateMemberNoteWorkflow({
    memberId,
    operation: "create",
    payload: {
      note_type: asString(formData, "noteType") || "General",
      note_text: asString(formData, "noteText")
    },
    actor: {
      id: actor.id,
      fullName: actor.full_name
    },
    now
  });

  revalidateMhp(memberId);
  redirect(`/health/member-health-profiles/${memberId}?tab=notes`);
}

export async function updateMhpNoteAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const noteId = asString(formData, "noteId");
  if (!memberId || !noteId) return;
  const now = toEasternISO();

  await mutateMemberNoteWorkflow({
    memberId,
    noteId,
    operation: "update",
    payload: {
      note_type: asString(formData, "noteType") || "General",
      note_text: asString(formData, "noteText")
    },
    actor: {
      id: actor.id,
      fullName: actor.full_name
    },
    now
  });

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
  const created = await mutateMemberNoteWorkflow({
    memberId,
    operation: "create",
    payload: {
      note_type: asString(formData, "noteType") || "General",
      note_text: noteText
    },
    actor: {
      id: actor.id,
      fullName: actor.full_name
    },
    now
  });
  if (!created.changed || !created.entity_row) return { ok: false, error: "Unable to create note." };
  revalidateMhp(memberId);
  return { ok: true, row: created.entity_row };
}

export async function updateMhpNoteInlineAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const noteId = asString(formData, "noteId");
  if (!memberId || !noteId) return { ok: false, error: "Missing note reference." };
  const noteText = asString(formData, "noteText");
  if (!noteText) return { ok: false, error: "Note text is required." };

  const now = toEasternISO();
  const updated = await mutateMemberNoteWorkflow({
    memberId,
    noteId,
    operation: "update",
    payload: {
      note_type: asString(formData, "noteType") || "General",
      note_text: noteText
    },
    actor: {
      id: actor.id,
      fullName: actor.full_name
    },
    now
  });
  if (!updated.changed || !updated.entity_row) return { ok: false, error: "Note not found." };
  revalidateMhp(memberId);
  return { ok: true, row: updated.entity_row };
}

export async function deleteMhpNoteInlineAction(formData: FormData) {
  const actor = await requireNurseAdmin();
  const memberId = asString(formData, "memberId");
  const noteId = asString(formData, "noteId");
  if (!memberId || !noteId) return { ok: false, error: "Missing note reference." };

  const now = toEasternISO();
  const deleted = await mutateMemberNoteWorkflow({
    memberId,
    noteId,
    operation: "delete",
    actor: {
      id: actor.id,
      fullName: actor.full_name
    },
    now
  });
  if (!deleted.changed) return { ok: false, error: "Note not found." };
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

  const member = await getMemberTrackForMhpSupabase(memberId);
  if (!member) return { ok: false, error: "Member not found." };

  const changed = (member.latest_assessment_track ?? "") !== track;
  if (!changed) return { ok: true, changed: false, track };

  const now = toEasternISO();
  await updateMemberTrackWithCarePlanNote({
    memberId,
    track: track as "Track 1" | "Track 2" | "Track 3",
    actor: {
      id: actor.id,
      fullName: actor.full_name
    },
    now
  });
  revalidateMhp(memberId);

  return { ok: true, changed: true, track };
}








