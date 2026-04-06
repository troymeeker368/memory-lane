import { normalizePhoneForStorage } from "@/lib/phone";
import { toEasternISO } from "@/lib/timezone";
import { getMemberCommandCenterDetail } from "@/lib/services/member-command-center";
import { getMemberHealthProfileDetail } from "@/lib/services/member-health-profiles";

function clean(value: string | null | undefined) {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function boolLabel(value: boolean | null | undefined) {
  if (value == null) return "Not recorded";
  return value ? "Yes" : "No";
}

function pickFirstPhone(input: {
  cellular_number?: string | null;
  work_number?: string | null;
  home_number?: string | null;
}) {
  return normalizePhoneForStorage(
    clean(input.cellular_number) ?? clean(input.work_number) ?? clean(input.home_number) ?? null
  );
}

function formatAddress(input: {
  street_address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}) {
  const parts = [clean(input.street_address), clean(input.city), clean(input.state), clean(input.zip)].filter(
    (value): value is string => Boolean(value)
  );
  return parts.length > 0 ? parts.join(", ") : null;
}

function calculateAgeYears(dob: string | null) {
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

function categorizeAllergies(
  rows: Array<{
    allergy_group: "food" | "medication" | "environmental";
    allergy_name: string;
    severity: string | null;
  }>
) {
  const groups: Record<
    "food" | "medication" | "environmental",
    Array<{ name: string; severity: string | null }>
  > = {
    food: [],
    medication: [],
    environmental: []
  };

  rows.forEach((row) => {
    const name = clean(row.allergy_name);
    if (!name) return;
    const severity = clean(row.severity);
    const existing = groups[row.allergy_group].find(
      (entry) => entry.name.toLowerCase() === name.toLowerCase()
    );
    if (existing) {
      if (!existing.severity && severity) {
        existing.severity = severity;
      }
      return;
    }
    groups[row.allergy_group].push({ name, severity });
  });

  return groups;
}

export async function getMemberFaceSheet(memberId: string) {
  const [mcc, mhp] = await Promise.all([
    getMemberCommandCenterDetail(memberId),
    getMemberHealthProfileDetail(memberId, {
      includeProviderDirectory: false,
      includeHospitalPreferenceDirectory: false,
      includeAssessments: false,
      includeProviders: false,
      includeNotes: false
    })
  ]);
  if (!mcc || !mhp) return null;

  const member = mcc.member;
  const mccProfile = mcc.profile;
  const mhpProfile = mhp.profile;

  const contactPriority = ["Responsible Party", "Emergency Contact", "Care Provider", "Payor", "Spouse", "Child", "Other"] as const;
  const prioritizedContacts = contactPriority
    .flatMap((category) =>
      mcc.contacts
        .filter((row) => row.category === category)
        .map((row) => ({
          category: row.category === "Other" ? clean(row.category_other) ?? "Other" : row.category,
          name: row.contact_name,
          relationship: clean(row.relationship_to_member),
          phone: pickFirstPhone(row),
          email: clean(row.email)
        }))
    )
    .filter((row, index, array) => array.findIndex((candidate) => candidate.name === row.name && candidate.category === row.category) === index)
    .slice(0, 8);

  const diagnosesPrimary = mhp.diagnoses
    .filter((row) => row.diagnosis_type === "primary")
    .map((row) => row.diagnosis_name)
    .filter(Boolean);
  const diagnosesSecondary = mhp.diagnoses
    .filter((row) => row.diagnosis_type !== "primary")
    .map((row) => row.diagnosis_name)
    .filter(Boolean);

  const activeMedications = mhp.medications
    .filter((row) => row.medication_status !== "inactive")
    .sort((left, right) => left.medication_name.localeCompare(right.medication_name, undefined, { sensitivity: "base" }))
    .map((row) => ({
      id: row.id,
      medication_name: row.medication_name,
      dose: clean(row.dose),
      route: clean(row.route),
      frequency: clean(row.frequency)
    }));

  const allergyGroups = categorizeAllergies(mhp.allergies);

  const codeStatus = clean(mccProfile.code_status) ?? clean(mhpProfile.code_status) ?? clean(member.code_status);
  const dnr =
    mccProfile.dnr ??
    mhpProfile.dnr ??
    (codeStatus === "DNR" ? true : codeStatus === "Full Code" ? false : null);

  const behaviorConcerns = [
    mhpProfile.wandering ? "Wandering" : null,
    mhpProfile.combative_disruptive ? "Combative/Disruptive" : null,
    mhpProfile.sleep_issues ? "Sleep issues" : null,
    mhpProfile.self_harm_unsafe ? "Self-harm/unsafe behavior" : null,
    mhpProfile.impaired_judgement ? "Impaired judgement" : null,
    mhpProfile.delirium ? "Delirium" : null,
    mhpProfile.disorientation ? "Disorientation" : null,
    mhpProfile.agitation_resistive ? "Agitation/resistive behavior" : null,
    mhpProfile.screaming_loud_noises ? "Screaming/loud noises" : null,
    mhpProfile.exhibitionism_disrobing ? "Exhibitionism/disrobing" : null,
    mhpProfile.exit_seeking ? "Exit seeking" : null
  ].filter((value): value is string => Boolean(value));

  const oxygenRequired = mhp.equipment.some((row) => {
    const status = clean(row.status)?.toLowerCase();
    const type = clean(row.equipment_type)?.toLowerCase();
    if (!type) return false;
    const active = !status || status === "active";
    return active && type.includes("oxygen");
  });

  return {
    generatedAt: toEasternISO(),
    member: {
      id: member.id,
      name: member.display_name,
      dob: member.dob,
      age: calculateAgeYears(member.dob),
      gender: clean(mccProfile.gender) ?? clean(mhpProfile.gender),
      photoUrl: clean(mccProfile.profile_image_url) ?? clean(mhpProfile.profile_image_url)
    },
    demographics: {
      address: formatAddress(mccProfile),
      city: clean(mccProfile.city),
      state: clean(mccProfile.state),
      zip: clean(mccProfile.zip),
      primaryLanguage: clean(mccProfile.primary_language),
      maritalStatus: clean(mccProfile.marital_status),
      veteran: boolLabel(mccProfile.is_veteran),
      veteranBranch: clean(mccProfile.veteran_branch)
    },
    contacts: prioritizedContacts,
    legal: {
      codeStatus: codeStatus ?? "Not recorded",
      dnr: boolLabel(dnr),
      dni: boolLabel(mccProfile.dni ?? mhpProfile.dni),
      polst: clean(mccProfile.polst_molst_colst) ?? clean(mhpProfile.polst_molst_colst),
      hospice: boolLabel(mccProfile.hospice ?? mhpProfile.hospice),
      powerOfAttorney: clean(mccProfile.power_of_attorney) ?? clean(mhpProfile.power_of_attorney),
      advancedDirectives: boolLabel(
        mccProfile.advanced_directives_obtained ?? mhpProfile.advanced_directives_obtained
      )
    },
    medical: {
      primaryDiagnoses: diagnosesPrimary.slice(0, 5),
      secondaryDiagnoses: diagnosesSecondary.slice(0, 8),
      medications: activeMedications.slice(0, 20),
      allergyGroups,
      noKnownAllergies:
        Boolean(mccProfile.no_known_allergies) &&
        allergyGroups.food.length === 0 &&
        allergyGroups.medication.length === 0 &&
        allergyGroups.environmental.length === 0,
      dietType: clean(mccProfile.diet_type) ?? clean(mhpProfile.diet_type),
      dietRestrictions:
        clean(mccProfile.dietary_preferences_restrictions) ??
        clean(mhpProfile.dietary_restrictions),
      swallowingDifficulty:
        clean(mccProfile.swallowing_difficulty) ??
        clean(mhpProfile.swallowing_difficulty),
      oxygenRequired: oxygenRequired ? "Yes" : "No"
    },
    functionalSafety: {
      ambulation: clean(mhpProfile.ambulation),
      transferring: clean(mhpProfile.transferring),
      toiletingNeeds: clean(mhpProfile.toileting_needs),
      hearing: clean(mhpProfile.hearing),
      vision: clean(mhpProfile.vision),
      speech: clean(mhpProfile.speech_verbal_status),
      memoryImpairment: clean(mhpProfile.memory_impairment),
      behaviorConcerns: behaviorConcerns,
      bathroomAssistance: clean(mhpProfile.toileting)
    },
    providers: mhp.providers.slice(0, 10).map((row) => ({
      id: row.id,
      name: row.provider_name,
      specialty: clean(row.specialty),
      practice: clean(row.practice_name),
      phone: normalizePhoneForStorage(clean(row.provider_phone))
    })),
    dietAllergyFlags: {
      dietType: clean(mccProfile.diet_type) ?? clean(mhpProfile.diet_type),
      texture: clean(mccProfile.diet_texture) ?? clean(mhpProfile.diet_texture),
      restrictions:
        clean(mccProfile.dietary_preferences_restrictions) ??
        clean(mhpProfile.dietary_restrictions),
      foodAllergies:
        allergyGroups.food.length > 0
          ? allergyGroups.food.map((row) => row.name)
          : clean(mccProfile.food_allergies)
            ? [String(mccProfile.food_allergies)]
            : [],
      medicationAllergies:
        allergyGroups.medication.length > 0
          ? allergyGroups.medication.map((row) => row.name)
          : clean(mccProfile.medication_allergies)
            ? [String(mccProfile.medication_allergies)]
            : [],
      environmentalAllergies:
        allergyGroups.environmental.length > 0
          ? allergyGroups.environmental.map((row) => row.name)
          : clean(mccProfile.environmental_allergies)
            ? [String(mccProfile.environmental_allergies)]
            : []
    }
  };
}
