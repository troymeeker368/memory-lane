import { addMockRecord, getMockDb, updateMockRecord } from "@/lib/mock-repo";
import { isMockMode } from "@/lib/runtime";
import { toEasternDate, toEasternISO } from "@/lib/timezone";

type NullableString = string | null;

export const MHP_TABS = [
  "overview",
  "medical",
  "functional",
  "cognitive-behavioral",
  "equipment",
  "legal",
  "notes"
] as const;

export type MhpTab = (typeof MHP_TABS)[number];

function sortDesc<T>(rows: T[], getValue: (row: T) => string) {
  return [...rows].sort((a, b) => (getValue(a) < getValue(b) ? 1 : -1));
}

function calculateAge(dob: string | null) {
  if (!dob) return null;
  const parsedDob = new Date(`${dob}T00:00:00.000`);
  if (Number.isNaN(parsedDob.getTime())) return null;

  const now = new Date();
  let age = now.getFullYear() - parsedDob.getFullYear();
  const monthDelta = now.getMonth() - parsedDob.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < parsedDob.getDate())) {
    age -= 1;
  }
  return age >= 0 ? age : null;
}

function splitFirst(list: NullableString) {
  if (!list?.trim()) return null;
  return list
    .split(",")
    .map((item) => item.trim())
    .find(Boolean) ?? null;
}

function newestTimestamp(values: Array<string | null | undefined>) {
  const valid = values.filter((value): value is string => Boolean(value));
  if (valid.length === 0) return null;
  return valid.reduce((latest, current) => {
    const latestMs = Number.isNaN(Date.parse(latest)) ? 0 : Date.parse(latest);
    const currentMs = Number.isNaN(Date.parse(current)) ? 0 : Date.parse(current);
    return currentMs > latestMs ? current : latest;
  });
}

function newestUpdate(values: Array<{ at: string | null | undefined; by?: string | null | undefined }>) {
  let latestAt: string | null = null;
  let latestBy: string | null = null;
  values.forEach((value) => {
    if (!value.at) return;
    if (!latestAt) {
      latestAt = value.at;
      latestBy = value.by ?? null;
      return;
    }
    const latestMs = Number.isNaN(Date.parse(latestAt)) ? 0 : Date.parse(latestAt);
    const currentMs = Number.isNaN(Date.parse(value.at)) ? 0 : Date.parse(value.at);
    if (currentMs > latestMs) {
      latestAt = value.at;
      latestBy = value.by ?? null;
    }
  });
  return { at: latestAt, by: latestBy };
}

function emptyToNull(value: string | null | undefined) {
  const cleaned = value?.trim() ?? "";
  return cleaned.length > 0 ? cleaned : null;
}

function sortByLastName(a: string, b: string) {
  const toKey = (fullName: string) => {
    const parts = fullName.trim().split(/\s+/).filter(Boolean);
    if (parts.length <= 1) return fullName.toLowerCase();
    const last = parts[parts.length - 1];
    const first = parts.slice(0, -1).join(" ");
    return `${last}, ${first}`.toLowerCase();
  };
  return toKey(a).localeCompare(toKey(b));
}

function defaultHealthProfile(memberId: string) {
  const now = toEasternISO();
  return {
    id: "",
    member_id: memberId,
    gender: null,
    payor: null,
    original_referral_source: null,
    photo_consent: null,
    profile_image_url: null,
    primary_caregiver_name: null,
    primary_caregiver_phone: null,
    responsible_party_name: null,
    responsible_party_phone: null,
    provider_name: null,
    provider_phone: null,
    important_alerts: null,

    diet_type: null,
    dietary_restrictions: null,
    swallowing_difficulty: null,
    diet_texture: null,
    supplements: null,
    foods_to_omit: null,

    ambulation: null,
    transferring: null,
    bathing: null,
    dressing: null,
    eating: null,
    bladder_continence: null,
    bowel_continence: null,
    toileting: null,
    toileting_needs: null,
    toileting_comments: null,
    hearing: null,
    vision: null,
    dental: null,
    speech_verbal_status: null,
    speech_comments: null,
    personal_appearance_hygiene_grooming: null,
    may_self_medicate: null,
    medication_manager_name: null,

    orientation_dob: null,
    orientation_city: null,
    orientation_current_year: null,
    orientation_former_occupation: null,
    memory_impairment: null,
    memory_severity: null,
    wandering: null,
    combative_disruptive: null,
    sleep_issues: null,
    self_harm_unsafe: null,
    impaired_judgement: null,
    delirium: null,
    disorientation: null,
    agitation_resistive: null,
    screaming_loud_noises: null,
    exhibitionism_disrobing: null,
    exit_seeking: null,
    cognitive_behavior_comments: null,

    code_status: null,
    dnr: null,
    dni: null,
    polst_molst_colst: null,
    hospice: null,
    advanced_directives_obtained: null,
    power_of_attorney: null,
    hospital_preference: null,
    legal_comments: null,

    source_assessment_id: null,
    source_assessment_at: null,
    updated_by_user_id: null,
    updated_by_name: null,
    created_at: now,
    updated_at: now
  };
}

export function ensureMemberHealthProfile(memberId: string) {
  const db = getMockDb();
  const existing = db.memberHealthProfiles.find((row) => row.member_id === memberId);
  if (existing) return existing;

  return addMockRecord("memberHealthProfiles", {
    ...defaultHealthProfile(memberId),
    member_id: memberId
  });
}

export function getMemberHealthProfileIndex(filters?: { q?: string; status?: "all" | "active" | "inactive" }) {
  if (!isMockMode()) {
    // TODO(backend): replace with member + profile + latest assessment materialized view query.
    return [];
  }

  const db = getMockDb();
  const query = filters?.q?.trim().toLowerCase() ?? "";
  const status = filters?.status ?? "all";

  return db.members
    .filter((member) => (status === "all" ? true : member.status === status))
    .filter((member) => (query ? member.display_name.toLowerCase().includes(query) : true))
    .map((member) => {
      const profile = db.memberHealthProfiles.find((row) => row.member_id === member.id) ?? defaultHealthProfile(member.id);
      const mccPhoto = db.memberCommandCenters.find((row) => row.member_id === member.id)?.profile_image_url ?? null;
      const effectiveProfile = {
        ...profile,
        profile_image_url: profile.profile_image_url ?? mccPhoto
      };
      const latestAssessment = db.assessments.find((row) => row.id === member.latest_assessment_id) ?? null;
      return {
        member,
        profile: effectiveProfile,
        latestAssessment,
        age: calculateAge(member.dob),
        alerts: [member.latest_assessment_admission_review_required ? "Assessment review required" : null, effectiveProfile.important_alerts].filter(Boolean)
      };
    })
    .sort((a, b) => sortByLastName(a.member.display_name, b.member.display_name));
}

export function getMemberHealthProfileDetail(memberId: string) {
  if (!isMockMode()) {
    // TODO(backend): replace with joined member health profile relation query set.
    return null;
  }

  const db = getMockDb();
  const member = db.members.find((row) => row.id === memberId);
  if (!member) return null;

  const profile = db.memberHealthProfiles.find((row) => row.member_id === memberId) ?? defaultHealthProfile(memberId);
  const mccPhoto = db.memberCommandCenters.find((row) => row.member_id === memberId)?.profile_image_url ?? null;
  const effectiveProfile = {
    ...profile,
    profile_image_url: profile.profile_image_url ?? mccPhoto
  };
  const diagnoses = sortDesc(db.memberDiagnoses.filter((row) => row.member_id === memberId), (row) => row.date_added);
  const medications = sortDesc(db.memberMedications.filter((row) => row.member_id === memberId), (row) => row.updated_at);
  const allergies = sortDesc(db.memberAllergies.filter((row) => row.member_id === memberId), (row) => row.updated_at);
  const providers = sortDesc(db.memberProviders.filter((row) => row.member_id === memberId), (row) => row.updated_at);
  const providerDirectory = sortDesc(
    db.providerDirectory.filter((row) => row.provider_name.trim().length > 0),
    (row) => row.updated_at
  );
  const hospitalPreferenceDirectory = sortDesc(
    db.hospitalPreferenceDirectory.filter((row) => row.hospital_name.trim().length > 0),
    (row) => row.updated_at
  );
  const equipment = sortDesc(db.memberEquipment.filter((row) => row.member_id === memberId), (row) => row.updated_at);
  const notes = sortDesc(db.memberNotes.filter((row) => row.member_id === memberId), (row) => row.created_at);
  const assessments = sortDesc(db.assessments.filter((row) => row.member_id === memberId), (row) => row.created_at);
  const lastUpdatedAt =
    newestTimestamp([
      effectiveProfile.updated_at,
      ...diagnoses.map((row) => row.updated_at),
      ...medications.map((row) => row.updated_at),
      ...allergies.map((row) => row.updated_at),
      ...providers.map((row) => row.updated_at),
      ...equipment.map((row) => row.updated_at),
      ...notes.map((row) => row.updated_at)
    ]) ?? effectiveProfile.updated_at;
  const newest = newestUpdate([
    { at: effectiveProfile.updated_at, by: effectiveProfile.updated_by_name ?? null },
    ...diagnoses.map((row) => ({ at: row.updated_at, by: row.created_by_name })),
    ...medications.map((row) => ({ at: row.updated_at, by: row.created_by_name })),
    ...allergies.map((row) => ({ at: row.updated_at, by: row.created_by_name })),
    ...providers.map((row) => ({ at: row.updated_at, by: row.created_by_name })),
    ...equipment.map((row) => ({ at: row.updated_at, by: row.created_by_name })),
    ...notes.map((row) => ({ at: row.updated_at, by: row.created_by_name }))
  ]);

  return {
    member,
    profile: effectiveProfile,
    diagnoses,
    medications,
    allergies,
    providers,
    providerDirectory,
    hospitalPreferenceDirectory,
    equipment,
    notes,
    assessments,
    lastUpdatedAt,
    lastUpdatedBy: newest.by ?? null,
    overview: {
      age: calculateAge(member.dob),
      codeStatus: effectiveProfile.code_status ?? member.code_status ?? null,
      primaryCaregiver: effectiveProfile.primary_caregiver_name,
      provider: providers[0]?.provider_name ?? effectiveProfile.provider_name
    }
  };
}

export function prefillMemberHealthProfileFromAssessment(input: {
  memberId: string;
  assessment: {
    id: string;
    assessment_date: string;
    allergies: string;
    code_status: string;
    medication_management_status: string;
    dressing_support_status: string;
    assistive_devices: string;
    incontinence_products: string;
    on_site_medication_use: string;
    on_site_medication_list: string;
    diet_type: string;
    diet_restrictions_notes: string;
    mobility_steadiness: string;
    mobility_aids: string;
    social_triggers: string;
    personal_notes: string;
    joy_sparks: string;
    orientation_dob_verified: boolean;
    orientation_city_verified: boolean;
    orientation_year_verified: boolean;
    orientation_occupation_verified: boolean;
    transport_assistance_level: string;
    transport_can_enter_exit_vehicle: string;
    transport_mobility_aid: string;
    transport_can_remain_seated_buckled: boolean;
    transport_behavior_concern: string;
    transport_appropriate: boolean;
    overwhelmed_by_noise: boolean;
  };
  actor: { id: string; fullName: string };
}) {
  const db = getMockDb();
  const member = db.members.find((row) => row.id === input.memberId);
  if (!member) return null;

  const profile = ensureMemberHealthProfile(input.memberId);
  const now = toEasternISO();
  const codeStatus = emptyToNull(input.assessment.code_status);

  const profilePatch = {
    code_status: profile.code_status ?? codeStatus,
    dnr: profile.dnr ?? (codeStatus === "DNR"),
    may_self_medicate:
      profile.may_self_medicate ??
      (input.assessment.medication_management_status.toLowerCase().includes("independent")
        ? true
        : input.assessment.medication_management_status
            ? false
            : null),
    dressing: profile.dressing ?? emptyToNull(input.assessment.dressing_support_status),
    bladder_continence: profile.bladder_continence ?? emptyToNull(input.assessment.incontinence_products),
    toileting_needs: profile.toileting_needs ?? emptyToNull(input.assessment.incontinence_products),
    ambulation: profile.ambulation ?? emptyToNull(input.assessment.mobility_steadiness),
    memory_impairment: profile.memory_impairment ?? (input.assessment.overwhelmed_by_noise ? "Present" : null),
    cognitive_behavior_comments:
      profile.cognitive_behavior_comments ??
      emptyToNull([input.assessment.social_triggers, input.assessment.personal_notes].filter(Boolean).join(" | ")),
    orientation_dob: profile.orientation_dob ?? (input.assessment.orientation_dob_verified ? member.dob : null),
    orientation_city: profile.orientation_city ?? (input.assessment.orientation_city_verified ? member.city : null),
    orientation_current_year:
      profile.orientation_current_year ??
      (input.assessment.orientation_year_verified ? toEasternDate().slice(0, 4) : null),
    orientation_former_occupation:
      profile.orientation_former_occupation ??
      (input.assessment.orientation_occupation_verified ? "Verified" : null),
    diet_type: profile.diet_type ?? emptyToNull(input.assessment.diet_type),
    dietary_restrictions: profile.dietary_restrictions ?? emptyToNull(input.assessment.diet_restrictions_notes),
    important_alerts: profile.important_alerts ?? emptyToNull(input.assessment.social_triggers),
    source_assessment_id: input.assessment.id,
    source_assessment_at: input.assessment.assessment_date,
    updated_at: now,
    updated_by_user_id: input.actor.id,
    updated_by_name: input.actor.fullName
  };

  updateMockRecord("memberHealthProfiles", profile.id, profilePatch);

  if (input.assessment.assistive_devices.trim() && db.memberEquipment.filter((row) => row.member_id === input.memberId).length === 0) {
    const deviceNames = input.assessment.assistive_devices
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    deviceNames.forEach((equipmentType) => {
      addMockRecord("memberEquipment", {
        member_id: input.memberId,
        equipment_type: equipmentType,
        provider_source: "Assessment Intake",
        status: "Active",
        comments: "Prefilled from intake assessment.",
        created_by_user_id: input.actor.id,
        created_by_name: input.actor.fullName,
        created_at: now,
        updated_at: now
      });
    });
  }

  if (input.assessment.allergies.trim() && input.assessment.allergies.trim().toUpperCase() !== "NKA") {
    const existingAllergy = db.memberAllergies.some((row) => row.member_id === input.memberId);
    if (!existingAllergy) {
      addMockRecord("memberAllergies", {
        member_id: input.memberId,
        allergy_group: "medication",
        allergy_name: input.assessment.allergies.trim(),
        severity: null,
        comments: "Prefilled from intake assessment.",
        created_by_user_id: input.actor.id,
        created_by_name: input.actor.fullName,
        created_at: now,
        updated_at: now
      });
    }
  }

  if (input.assessment.on_site_medication_use === "Yes" && input.assessment.medication_management_status.trim()) {
    const hasMedication = db.memberMedications.some((row) => row.member_id === input.memberId);
    if (!hasMedication) {
      const medName = splitFirst(input.assessment.on_site_medication_list || "") ?? "Medication list pending";
      addMockRecord("memberMedications", {
        member_id: input.memberId,
        medication_name: medName,
        date_started: toEasternDate(),
        medication_status: "active",
        inactivated_at: null,
        dose: null,
        quantity: null,
        form: null,
        frequency: null,
        route: null,
        comments: "Prefilled from intake assessment.",
        created_by_user_id: input.actor.id,
        created_by_name: input.actor.fullName,
        created_at: now,
        updated_at: now
      });
    }
  }

  if (input.assessment.joy_sparks.trim() || input.assessment.personal_notes.trim()) {
    addMockRecord("memberNotes", {
      member_id: input.memberId,
      note_type: "Assessment Intake",
      note_text: [input.assessment.joy_sparks, input.assessment.personal_notes].filter(Boolean).join(" | "),
      created_by_user_id: input.actor.id,
      created_by_name: input.actor.fullName,
      created_at: now,
      updated_at: now
    });
  }

  return getMemberHealthProfileDetail(input.memberId);
}
