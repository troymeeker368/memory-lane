import { addMockRecord, getMockDb, removeMockRecord, updateMockRecord } from "@/lib/mock-repo";
import { ensureMemberCommandCenterProfile } from "@/lib/services/member-command-center";
import { ensureMemberHealthProfile } from "@/lib/services/member-health-profiles";
import { POF_MHP_FIELD_MAPPINGS } from "@/lib/services/pof-mhp-field-mapping";
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

function getValueByPath(source: Record<string, unknown>, dotPath: string) {
  const segments = dotPath.split(".");
  let cursor: unknown = source;
  for (const segment of segments) {
    if (!cursor || typeof cursor !== "object" || !(segment in (cursor as Record<string, unknown>))) {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

function isMeaningfulSyncValue(value: unknown) {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

type PofMedicationInput = {
  name: string;
  dose: string | null;
  quantity: string | null;
  form: string | null;
  route: string | null;
  routeLaterality?: string | null;
  frequency: string | null;
  givenAtCenter?: boolean;
  comments?: string | null;
};

type PofDiagnosisInput = {
  diagnosisType: "primary" | "secondary";
  diagnosisName: string;
  diagnosisCode: string | null;
};

type PofAllergyInput = {
  allergyGroup: "food" | "medication" | "environmental" | "other";
  allergyName: string;
  severity: string | null;
  comments: string | null;
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
  adlProfile: {
    ambulation: string | null;
    transferring: string | null;
    bathing: string | null;
    dressing: string | null;
    eating: string | null;
    bladderContinence: string | null;
    bowelContinence: string | null;
    toileting: string | null;
    toiletingNeeds: string | null;
    toiletingComments: string | null;
    hearing: string | null;
    vision: string | null;
    dental: string | null;
    speechVerbalStatus: string | null;
    speechComments: string | null;
    hygieneGrooming: string | null;
    maySelfMedicate: boolean | null;
    medicationManagerName: string | null;
  };
  orientationProfile: {
    orientationDob: "Yes" | "No" | null;
    orientationCity: "Yes" | "No" | null;
    orientationCurrentYear: "Yes" | "No" | null;
    orientationFormerOccupation: "Yes" | "No" | null;
    disorientation: boolean | null;
    memoryImpairment: string | null;
    memorySeverity: string | null;
    cognitiveBehaviorComments: string | null;
  };
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
    memberDobSnapshot: string | null;
    dnrSelected: boolean;
    status: "Draft" | "Completed" | "Signed";
    diagnosisRows: PofDiagnosisInput[];
    diagnoses: string[];
    allergyRows: PofAllergyInput[];
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
  const normalizedAllergies = uniqueCaseInsensitive(
    input.pof.allergyRows.length > 0
      ? input.pof.allergyRows.map((row) => row.allergyName.trim()).filter(Boolean)
      : input.pof.allergies.map((value) => value.trim()).filter(Boolean)
  );

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

  // Apply normalized direct field mappings so ADL/orientation stay aligned with MHP structures.
  const directMappingSkips = new Set([
    "member_dob",
    "diagnoses",
    "allergies",
    "diet_type",
    "dietary_restrictions",
    "code_status"
  ]);
  POF_MHP_FIELD_MAPPINGS.forEach((mapping) => {
    if (directMappingSkips.has(mapping.key)) return;
    const value = getValueByPath(input.pof as unknown as Record<string, unknown>, mapping.pofField);
    if (!isMeaningfulSyncValue(value)) return;
    mhpPatch[mapping.mhpField] = value;
  });

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

  const memberDob = normalizeString(input.pof.memberDobSnapshot);
  if (memberDob) {
    const member = db.members.find((row) => row.id === input.memberId);
    if (member && (isCommitted || !normalizeString(member.dob))) {
      updateMockRecord("members", input.memberId, { dob: memberDob });
    }
  }

  if (shouldSetCodeStatus) {
    updateMockRecord("members", input.memberId, { code_status: "DNR" });
  } else if (isCommitted) {
    updateMockRecord("members", input.memberId, { code_status: "Full Code" });
  }

  if (isCommitted) {
    const diagnosisTargets =
      input.pof.diagnosisRows.length > 0
        ? input.pof.diagnosisRows
            .map((row, idx) => ({
              diagnosisType: idx === 0 ? "primary" : "secondary",
              diagnosisName: row.diagnosisName.trim(),
              diagnosisCode: normalizeString(row.diagnosisCode)
            }))
            .filter((row) => row.diagnosisName.length > 0)
        : uniqueCaseInsensitive(input.pof.diagnoses.map((value) => value.trim()).filter(Boolean)).map((diagnosisName, idx) => ({
            diagnosisType: idx === 0 ? "primary" : "secondary",
            diagnosisName,
            diagnosisCode: null
          }));

    if (diagnosisTargets.length > 0) {
      const firstDiagnosis = diagnosisTargets[0]?.diagnosisName ?? null;
      const existingDiagnoses = db.memberDiagnoses.filter((row) => row.member_id === input.memberId);

      existingDiagnoses.forEach((row) => {
        if (
          row.diagnosis_type === "primary" &&
          firstDiagnosis &&
          row.diagnosis_name.trim().toLowerCase() !== firstDiagnosis.toLowerCase()
        ) {
          updateMockRecord("memberDiagnoses", row.id, {
            diagnosis_type: "secondary",
            updated_at: now
          });
        }
      });

      diagnosisTargets.forEach((target, idx) => {
        const diagnosisType = idx === 0 ? "primary" : "secondary";
        const existing = db.memberDiagnoses.find(
          (row) =>
            row.member_id === input.memberId &&
            row.diagnosis_name.trim().toLowerCase() === target.diagnosisName.toLowerCase()
        );

        if (existing) {
          updateMockRecord("memberDiagnoses", existing.id, {
            diagnosis_type: diagnosisType,
            diagnosis_code: target.diagnosisCode,
            date_added: existing.date_added ?? now.slice(0, 10),
            updated_at: now
          });
          return;
        }

        addMockRecord("memberDiagnoses", {
          member_id: input.memberId,
          diagnosis_type: diagnosisType,
          diagnosis_name: target.diagnosisName,
          diagnosis_code: target.diagnosisCode,
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

  const allergyTargets: Array<{
    group: "food" | "medication" | "environmental";
    name: string;
    severity: string | null;
    comments: string | null;
  }> =
    input.pof.allergyRows.length > 0
      ? input.pof.allergyRows
          .map((row) => ({
            group:
              row.allergyGroup === "food" || row.allergyGroup === "medication" || row.allergyGroup === "environmental"
                ? row.allergyGroup
                : inferAllergyGroup(row.allergyName),
            name: row.allergyName.trim(),
            severity: normalizeString(row.severity),
            comments: normalizeString(row.comments)
          }))
          .filter((row) => row.name.length > 0)
      : normalizedAllergies.map((name) => ({
          group: inferAllergyGroup(name),
          name,
          severity: null,
          comments: null
        }));
  if (flags.nutAllergy) allergyTargets.push({ group: "food", name: "Nut allergy", severity: null, comments: null });
  if (flags.shellfishAllergy) allergyTargets.push({ group: "food", name: "Shellfish allergy", severity: null, comments: null });
  if (flags.fishAllergy) allergyTargets.push({ group: "food", name: "Fish allergy", severity: null, comments: null });

  const dedupedAllergyTargets = uniqueCaseInsensitive(allergyTargets.map((row) => `${row.group}::${row.name}`))
    .map((entry) => {
      const [groupRaw, nameRaw] = entry.split("::");
      const source = allergyTargets.find((row) => `${row.group}::${row.name}`.toLowerCase() === entry.toLowerCase());
      return {
        group: groupRaw as "food" | "medication" | "environmental",
        name: nameRaw?.trim() ?? "",
        severity: source?.severity ?? null,
        comments: source?.comments ?? null
      };
    })
    .filter((row) => row.name.length > 0);

  dedupedAllergyTargets.forEach((target) => {
    const group = target.group;
    const name = target.name;

    const existing = db.memberAllergies.find(
      (row) =>
        row.member_id === input.memberId &&
        row.allergy_group === group &&
        row.allergy_name.trim().toLowerCase() === name.toLowerCase()
    );
    if (existing) {
      updateMockRecord("memberAllergies", existing.id, {
        severity: target.severity ?? existing.severity,
        comments: target.comments ?? existing.comments,
        updated_at: now
      });
      return;
    }

    addMockRecord("memberAllergies", {
      member_id: input.memberId,
      allergy_group: group,
      allergy_name: name,
      severity: target.severity,
      comments: target.comments ?? "Synced from Physician Order Form.",
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
      quantity: normalizeString(row.quantity),
      form: normalizeString(row.form),
      route: normalizeString(row.route),
      routeLaterality: normalizeString(row.routeLaterality),
      frequency: normalizeString(row.frequency),
      givenAtCenter: row.givenAtCenter === true,
      comments: normalizeString(row.comments)
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
          quantity: medication.quantity ?? existing.quantity,
          form: medication.form ?? existing.form,
          route: medication.route ?? existing.route,
          route_laterality: medication.routeLaterality ?? existing.route_laterality ?? null,
          frequency: medication.frequency ?? existing.frequency,
          comments:
            medication.comments ??
            (medication.givenAtCenter ? "Given at center (from POF)." : existing.comments ?? null),
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
        quantity: medication.quantity,
        form: medication.form,
        frequency: medication.frequency,
        route: medication.route,
        route_laterality: medication.routeLaterality,
        comments: medication.comments ?? (medication.givenAtCenter ? "Given at center (from POF)." : "Synced from Physician Order Form."),
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
