import { addMockRecord, getMockDb, removeMockRecord, updateMockRecord } from "@/lib/mock-repo";
import { ensureMemberCommandCenterProfile } from "@/lib/services/member-command-center";
import { ensureMemberHealthProfile } from "@/lib/services/member-health-profiles";
import { toEasternISO } from "@/lib/timezone";

type SyncActor = {
  id?: string | null;
  fullName?: string | null;
};

function normalizeString(value: string | null | undefined) {
  const cleaned = (value ?? "").trim();
  return cleaned.length > 0 ? cleaned : null;
}

function toDelimitedString(values: string[]) {
  if (values.length === 0) return null;
  return values.join(", ");
}

function splitDelimited(value: string | null | undefined) {
  return (value ?? "")
    .split(/[,;\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitPipeOrDelimited(value: string | null | undefined) {
  return (value ?? "")
    .split(/[|,;\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueCaseInsensitive(values: string[]) {
  const seen = new Set<string>();
  const unique: string[] = [];
  values.forEach((value) => {
    const key = value.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(value);
  });
  return unique;
}

function resolveActor(
  input: SyncActor,
  defaults: { id: string | null | undefined; fullName: string | null | undefined }
) {
  return {
    id: input.id ?? defaults.id ?? null,
    fullName: input.fullName ?? defaults.fullName ?? null
  };
}

function hasMeaningfulValue(value: string | null | undefined) {
  return Boolean(normalizeString(value));
}

function inferAllergyGroup(name: string): "food" | "medication" | "environmental" {
  const normalized = name.toLowerCase();
  if (
    /(nut|peanut|tree nut|shellfish|shrimp|lobster|crab|fish|seafood|egg|dairy|milk|gluten|soy|wheat)/.test(
      normalized
    )
  ) {
    return "food";
  }
  if (/(pollen|dust|latex|mold|dander|fragrance|environment)/.test(normalized)) {
    return "environmental";
  }
  return "medication";
}

type PofMedicationInput = {
  name: string;
  dose: string | null;
  route: string | null;
  frequency: string | null;
};

type PofCareInput = {
  nutritionDiets: string[];
  nutritionDietOther: string | null;
  medAdministrationSelf: boolean;
  medAdministrationNurse: boolean;
  personalCareToileting: boolean;
  breathingOxygenTank: boolean;
  breathingOxygenLiters: string | null;
  joySparksNotes: string | null;
};

type PofOperationalFlagsInput = {
  nutAllergy: boolean;
  shellfishAllergy: boolean;
  fishAllergy: boolean;
  diabeticRestrictedSweets: boolean;
  oxygenRequirement: boolean;
  dnr: boolean;
  noPhotos: boolean;
  bathroomAssistance: boolean;
};

type PofSyncInput = {
  memberId: string;
  pof: {
    id: string;
    dnrSelected: boolean;
    status: "Draft" | "Completed" | "Signed";
    diagnoses: string[];
    allergies: string[];
    medications: PofMedicationInput[];
    careInformation: PofCareInput;
    operationalFlags: PofOperationalFlagsInput;
  };
  actor?: SyncActor;
  at?: string;
};

export function syncMhpToCommandCenter(memberId: string, actor: SyncActor = {}, at?: string) {
  const db = getMockDb();
  const mhp = ensureMemberHealthProfile(memberId);
  const mcc = ensureMemberCommandCenterProfile(memberId);
  const now = at ?? toEasternISO();
  const resolvedActor = resolveActor(actor, {
    id: mhp.updated_by_user_id ?? mcc.updated_by_user_id,
    fullName: mhp.updated_by_name ?? mcc.updated_by_name
  });

  const allergies = db.memberAllergies.filter((row) => row.member_id === memberId);
  const medicationAllergies = uniqueCaseInsensitive(
    allergies.filter((row) => row.allergy_group === "medication").map((row) => row.allergy_name.trim())
  );
  const foodAllergies = uniqueCaseInsensitive(
    allergies.filter((row) => row.allergy_group === "food").map((row) => row.allergy_name.trim())
  );
  const environmentalAllergies = uniqueCaseInsensitive(
    allergies.filter((row) => row.allergy_group === "environmental").map((row) => row.allergy_name.trim())
  );
  const hasAllergyRows = allergies.length > 0;

  updateMockRecord("memberCommandCenters", mcc.id, {
    gender:
      mhp.gender === "M" || mhp.gender === "F"
        ? mhp.gender
        : mhp.gender?.toLowerCase().startsWith("m")
          ? "M"
          : mhp.gender?.toLowerCase().startsWith("f")
            ? "F"
            : null,
    payor: normalizeString(mhp.payor),
    original_referral_source: normalizeString(mhp.original_referral_source),
    photo_consent: mhp.photo_consent,
    profile_image_url: normalizeString(mhp.profile_image_url),
    code_status: normalizeString(mhp.code_status),
    dnr: mhp.dnr,
    dni: mhp.dni,
    polst_molst_colst: normalizeString(mhp.polst_molst_colst),
    hospice: mhp.hospice,
    advanced_directives_obtained: mhp.advanced_directives_obtained,
    power_of_attorney: normalizeString(mhp.power_of_attorney),
    legal_comments: normalizeString(mhp.legal_comments),
    diet_type: normalizeString(mhp.diet_type),
    dietary_preferences_restrictions: normalizeString(mhp.dietary_restrictions),
    swallowing_difficulty: normalizeString(mhp.swallowing_difficulty),
    supplements: normalizeString(mhp.supplements),
    foods_to_omit: normalizeString(mhp.foods_to_omit),
    diet_texture: normalizeString(mhp.diet_texture),
    no_known_allergies: hasAllergyRows ? false : mcc.no_known_allergies,
    medication_allergies: hasAllergyRows ? toDelimitedString(medicationAllergies) : mcc.medication_allergies,
    food_allergies: hasAllergyRows ? toDelimitedString(foodAllergies) : mcc.food_allergies,
    environmental_allergies: hasAllergyRows ? toDelimitedString(environmentalAllergies) : mcc.environmental_allergies,
    command_center_notes: normalizeString(mhp.important_alerts) ?? mcc.command_center_notes,
    updated_by_user_id: resolvedActor.id,
    updated_by_name: resolvedActor.fullName,
    updated_at: now
  });

  if (mhp.code_status) {
    updateMockRecord("members", memberId, { code_status: mhp.code_status });
  }
}

export function syncCommandCenterToMhp(
  memberId: string,
  actor: SyncActor = {},
  at?: string,
  options?: { syncAllergies?: boolean }
) {
  const db = getMockDb();
  const mcc = ensureMemberCommandCenterProfile(memberId);
  const mhp = ensureMemberHealthProfile(memberId);
  const now = at ?? toEasternISO();
  const resolvedActor = resolveActor(actor, {
    id: mcc.updated_by_user_id ?? mhp.updated_by_user_id,
    fullName: mcc.updated_by_name ?? mhp.updated_by_name
  });

  updateMockRecord("memberHealthProfiles", mhp.id, {
    gender: mcc.gender,
    payor: normalizeString(mcc.payor),
    original_referral_source: normalizeString(mcc.original_referral_source),
    photo_consent: mcc.photo_consent,
    profile_image_url: normalizeString(mcc.profile_image_url),
    code_status: normalizeString(mcc.code_status),
    dnr: mcc.dnr,
    dni: mcc.dni,
    polst_molst_colst: normalizeString(mcc.polst_molst_colst),
    hospice: mcc.hospice,
    advanced_directives_obtained: mcc.advanced_directives_obtained,
    power_of_attorney: normalizeString(mcc.power_of_attorney),
    legal_comments: normalizeString(mcc.legal_comments),
    diet_type: normalizeString(mcc.diet_type),
    dietary_restrictions: normalizeString(mcc.dietary_preferences_restrictions),
    swallowing_difficulty: normalizeString(mcc.swallowing_difficulty),
    supplements: normalizeString(mcc.supplements),
    foods_to_omit: normalizeString(mcc.foods_to_omit),
    diet_texture: normalizeString(mcc.diet_texture),
    important_alerts: normalizeString(mcc.command_center_notes) ?? mhp.important_alerts,
    updated_by_user_id: resolvedActor.id,
    updated_by_name: resolvedActor.fullName,
    updated_at: now
  });

  if (mcc.code_status) {
    updateMockRecord("members", memberId, { code_status: mcc.code_status });
  }

  const syncAllergies = options?.syncAllergies === true;
  if (!syncAllergies) {
    return;
  }

  const existing = db.memberAllergies.filter((row) => row.member_id === memberId);
  const desired = [
    ...splitDelimited(mcc.medication_allergies).map((name) => ({ group: "medication" as const, name })),
    ...splitDelimited(mcc.food_allergies).map((name) => ({ group: "food" as const, name })),
    ...splitDelimited(mcc.environmental_allergies).map((name) => ({ group: "environmental" as const, name }))
  ];
  const dedupedDesired = uniqueCaseInsensitive(
    desired.map((row) => `${row.group}::${row.name}`)
  ).map((entry) => {
    const [group, name] = entry.split("::");
    return {
      group: group as "food" | "medication" | "environmental",
      name
    };
  });

  const shouldClearAllergyRows =
    mcc.no_known_allergies === true || (mcc.no_known_allergies === false && dedupedDesired.length === 0);

  if (shouldClearAllergyRows) {
    existing.forEach((row) => {
      removeMockRecord("memberAllergies", row.id);
    });
    return;
  }

  if (dedupedDesired.length === 0) {
    return;
  }

  const desiredKeys = new Set(dedupedDesired.map((row) => `${row.group}::${row.name.toLowerCase()}`));

  existing.forEach((row) => {
    const key = `${row.allergy_group}::${row.allergy_name.trim().toLowerCase()}`;
    if (!desiredKeys.has(key)) {
      removeMockRecord("memberAllergies", row.id);
    }
  });

  dedupedDesired.forEach((target) => {
    const match = db.memberAllergies.find(
      (row) =>
        row.member_id === memberId &&
        row.allergy_group === target.group &&
        row.allergy_name.trim().toLowerCase() === target.name.toLowerCase()
    );

    if (match) {
      updateMockRecord("memberAllergies", match.id, {
        updated_at: now
      });
      return;
    }

    addMockRecord("memberAllergies", {
      member_id: memberId,
      allergy_group: target.group,
      allergy_name: target.name,
      severity: null,
      comments: "Synced from Member Command Center.",
      created_by_user_id: resolvedActor.id ?? "system",
      created_by_name: resolvedActor.fullName ?? "System",
      created_at: now,
      updated_at: now
    });
  });
}

export function syncPhysicianOrderToMemberProfiles(input: PofSyncInput) {
  const db = getMockDb();
  const mhp = ensureMemberHealthProfile(input.memberId);
  const mcc = ensureMemberCommandCenterProfile(input.memberId);
  const now = input.at ?? toEasternISO();
  const resolvedActor = resolveActor(input.actor ?? {}, {
    id: mhp.updated_by_user_id ?? mcc.updated_by_user_id,
    fullName: mhp.updated_by_name ?? mcc.updated_by_name
  });

  const care = input.pof.careInformation;
  const flags = input.pof.operationalFlags;
  const isCommitted = input.pof.status === "Completed" || input.pof.status === "Signed";
  const normalizedAllergies = uniqueCaseInsensitive(input.pof.allergies.map((value) => value.trim()).filter(Boolean));

  const canonicalDiet = care.nutritionDiets.find((entry) => entry !== "Other") ?? null;
  const customDiet = normalizeString(care.nutritionDietOther);
  const nextDietType = canonicalDiet ?? customDiet ?? null;
  const restrictionsFromDiet = uniqueCaseInsensitive(
    care.nutritionDiets.filter((entry) => entry !== "Other")
  );
  const nextDietRestrictions =
    restrictionsFromDiet.length > 1
      ? restrictionsFromDiet.slice(1).join(", ")
      : restrictionsFromDiet.length === 0
        ? null
        : null;

  const shouldSetCodeStatus = input.pof.dnrSelected || flags.dnr;
  const mhpPatch: Record<string, unknown> = {
    updated_by_user_id: resolvedActor.id,
    updated_by_name: resolvedActor.fullName,
    updated_at: now,
    source_assessment_id: mhp.source_assessment_id ?? input.pof.id,
    source_assessment_at: mhp.source_assessment_at ?? now
  };

  if (shouldSetCodeStatus) {
    mhpPatch.code_status = "DNR";
    mhpPatch.dnr = true;
  } else if (isCommitted) {
    mhpPatch.code_status = "Full Code";
    mhpPatch.dnr = false;
  } else if (!hasMeaningfulValue(mhp.code_status)) {
    mhpPatch.code_status = "Full Code";
    mhpPatch.dnr = false;
  }
  if (hasMeaningfulValue(nextDietType) && !hasMeaningfulValue(mhp.diet_type)) {
    mhpPatch.diet_type = nextDietType;
  } else if (hasMeaningfulValue(nextDietType) && input.pof.status !== "Draft") {
    mhpPatch.diet_type = nextDietType;
  }
  if (hasMeaningfulValue(nextDietRestrictions) && !hasMeaningfulValue(mhp.dietary_restrictions)) {
    mhpPatch.dietary_restrictions = nextDietRestrictions;
  }
  if (flags.diabeticRestrictedSweets) {
    const existingRestrictions = splitPipeOrDelimited(mhp.dietary_restrictions);
    const next = uniqueCaseInsensitive([...existingRestrictions, "Restricted sweets"]);
    mhpPatch.dietary_restrictions = next.join(", ");
  }
  if (isCommitted && care.medAdministrationSelf) {
    mhpPatch.may_self_medicate = true;
  } else if (isCommitted && care.medAdministrationNurse) {
    mhpPatch.may_self_medicate = false;
  } else if (care.medAdministrationSelf && mhp.may_self_medicate == null) {
    mhpPatch.may_self_medicate = true;
  } else if (care.medAdministrationNurse && mhp.may_self_medicate == null) {
    mhpPatch.may_self_medicate = false;
  }
  if (isCommitted && care.personalCareToileting) {
    mhpPatch.toileting = "Needs assistance";
  } else if (care.personalCareToileting && !hasMeaningfulValue(mhp.toileting)) {
    mhpPatch.toileting = "Needs assistance";
  }
  if (isCommitted && (care.breathingOxygenTank || flags.oxygenRequirement)) {
    mhpPatch.ambulation = "Oxygen support";
  } else if ((care.breathingOxygenTank || flags.oxygenRequirement) && !hasMeaningfulValue(mhp.ambulation)) {
    mhpPatch.ambulation = "Oxygen support";
  }
  if (isCommitted && hasMeaningfulValue(care.joySparksNotes)) {
    mhpPatch.important_alerts = normalizeString(care.joySparksNotes);
  } else if (hasMeaningfulValue(care.joySparksNotes) && !hasMeaningfulValue(mhp.important_alerts)) {
    mhpPatch.important_alerts = normalizeString(care.joySparksNotes);
  }
  if (isCommitted && flags.noPhotos) {
    mhpPatch.photo_consent = false;
  }

  updateMockRecord("memberHealthProfiles", mhp.id, mhpPatch);

  if (shouldSetCodeStatus) {
    updateMockRecord("members", input.memberId, { code_status: "DNR" });
  } else if (isCommitted) {
    updateMockRecord("members", input.memberId, { code_status: "Full Code" });
  }

  if (isCommitted) {
    const cleanedDiagnoses = uniqueCaseInsensitive(
      input.pof.diagnoses
        .map((value) => value.trim())
        .filter(Boolean)
    );
    if (cleanedDiagnoses.length > 0) {
      const firstDiagnosis = cleanedDiagnoses[0];
      const existingDiagnoses = db.memberDiagnoses.filter((row) => row.member_id === input.memberId);

      existingDiagnoses.forEach((row) => {
        if (
          row.diagnosis_type === "primary" &&
          row.diagnosis_name.trim().toLowerCase() !== firstDiagnosis.toLowerCase()
        ) {
          updateMockRecord("memberDiagnoses", row.id, {
            diagnosis_type: "secondary",
            updated_at: now
          });
        }
      });

      cleanedDiagnoses.forEach((diagnosisName, idx) => {
        const diagnosisType = idx === 0 ? "primary" : "secondary";
        const existing = db.memberDiagnoses.find(
          (row) =>
            row.member_id === input.memberId &&
            row.diagnosis_name.trim().toLowerCase() === diagnosisName.toLowerCase()
        );

        if (existing) {
          updateMockRecord("memberDiagnoses", existing.id, {
            diagnosis_type: diagnosisType,
            date_added: existing.date_added ?? now.slice(0, 10),
            updated_at: now
          });
          return;
        }

        addMockRecord("memberDiagnoses", {
          member_id: input.memberId,
          diagnosis_type: diagnosisType,
          diagnosis_name: diagnosisName,
          diagnosis_code: null,
          date_added: now.slice(0, 10),
          comments: "Synced from Physician Order Form.",
          created_by_user_id: resolvedActor.id ?? "system",
          created_by_name: resolvedActor.fullName ?? "System",
          created_at: now,
          updated_at: now
        });
      });
    }
  }

  const allergyTargets: Array<{ group: "food" | "medication" | "environmental"; name: string }> = normalizedAllergies.map(
    (name) => ({
      group: inferAllergyGroup(name),
      name
    })
  );
  if (flags.nutAllergy) allergyTargets.push({ group: "food", name: "Nut allergy" });
  if (flags.shellfishAllergy) allergyTargets.push({ group: "food", name: "Shellfish allergy" });
  if (flags.fishAllergy) allergyTargets.push({ group: "food", name: "Fish allergy" });

  uniqueCaseInsensitive(allergyTargets.map((row) => `${row.group}::${row.name}`)).forEach((entry) => {
    const [groupRaw, nameRaw] = entry.split("::");
    const group = groupRaw as "food" | "medication" | "environmental";
    const name = nameRaw?.trim();
    if (!name) return;

    const existing = db.memberAllergies.find(
      (row) =>
        row.member_id === input.memberId &&
        row.allergy_group === group &&
        row.allergy_name.trim().toLowerCase() === name.toLowerCase()
    );
    if (existing) {
      updateMockRecord("memberAllergies", existing.id, {
        updated_at: now
      });
      return;
    }

    addMockRecord("memberAllergies", {
      member_id: input.memberId,
      allergy_group: group,
      allergy_name: name,
      severity: null,
      comments: "Synced from Physician Order Form.",
      created_by_user_id: resolvedActor.id ?? "system",
      created_by_name: resolvedActor.fullName ?? "System",
      created_at: now,
      updated_at: now
    });
  });

  input.pof.medications
    .map((row) => ({
      name: row.name.trim(),
      dose: normalizeString(row.dose),
      route: normalizeString(row.route),
      frequency: normalizeString(row.frequency)
    }))
    .filter((row) => row.name.length > 0)
    .forEach((medication) => {
      const existing = db.memberMedications.find(
        (row) => row.member_id === input.memberId && row.medication_name.trim().toLowerCase() === medication.name.toLowerCase()
      );
      if (existing) {
        updateMockRecord("memberMedications", existing.id, {
          medication_name: medication.name,
          medication_status: "active",
          inactivated_at: null,
          dose: medication.dose ?? existing.dose,
          route: medication.route ?? existing.route,
          frequency: medication.frequency ?? existing.frequency,
          updated_at: now
        });
        return;
      }

      addMockRecord("memberMedications", {
        member_id: input.memberId,
        medication_name: medication.name,
        date_started: now.slice(0, 10),
        medication_status: "active",
        inactivated_at: null,
        dose: medication.dose,
        quantity: null,
        form: null,
        frequency: medication.frequency,
        route: medication.route,
        route_laterality: null,
        comments: "Synced from Physician Order Form.",
        created_by_user_id: resolvedActor.id ?? "system",
        created_by_name: resolvedActor.fullName ?? "System",
        created_at: now,
        updated_at: now
      });
    });

  syncMhpToCommandCenter(
    input.memberId,
    {
      id: resolvedActor.id,
      fullName: resolvedActor.fullName
    },
    now
  );
}
