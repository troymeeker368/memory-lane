import {
  canonicalDietSelection,
  mapCodeStatusToDnr,
  mapMedicationAssistToPof,
  mapMobilityToAmbulatoryStatus,
  mapOrientationBoolToAnswer,
  splitCsv
} from "@/lib/services/intake-pof-shared";

function clean(value: string | null | undefined) {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function includesWord(values: string[], pattern: RegExp) {
  return values.some((value) => pattern.test(value.toLowerCase()));
}

export interface IntakeAssessmentForPofPrefill {
  id: string;
  member_id: string;
  vitals_bp: string;
  vitals_hr: number;
  vitals_o2_percent: number;
  vitals_rr: number;
  allergies: string;
  code_status: string;
  diet_type: string;
  diet_other: string;
  diet_restrictions_notes: string;
  mobility_steadiness: string;
  mobility_aids: string;
  assistive_devices: string;
  medication_management_status: string;
  dressing_support_status: string;
  incontinence_products: string;
  orientation_dob_verified: boolean;
  orientation_city_verified: boolean;
  orientation_year_verified: boolean;
  orientation_occupation_verified: boolean;
  overwhelmed_by_noise: boolean;
  social_triggers: string;
  emotional_wellness_notes: string;
  transport_assistance_level: string;
  transport_mobility_aid: string;
  transport_behavior_concern: string;
  transport_notes: string;
  joy_sparks: string;
  personal_notes: string;
}

export interface IntakeToPofPrefill {
  dnrSelected: boolean;
  vitalsBloodPressure: string | null;
  vitalsPulse: string | null;
  vitalsOxygenSaturation: string | null;
  vitalsRespiration: string | null;
  allergyRows: Array<{
    allergyGroup: "food" | "medication" | "environmental" | "other";
    allergyName: string;
    severity: string | null;
    comments: string | null;
  }>;
  careInformation: {
    ambulatoryStatus: "Full" | "Semi" | "Non" | null;
    mobilityIndependent: boolean;
    mobilityWalker: boolean;
    mobilityWheelchair: boolean;
    mobilityOther: boolean;
    mobilityOtherText: string | null;
    personalCareDressing: boolean;
    personalCareMedication: boolean;
    personalCareToileting: boolean;
    medAdministrationSelf: boolean;
    medAdministrationNurse: boolean;
    bladderContinent: boolean;
    bladderIncontinent: boolean;
    bowelContinent: boolean;
    bowelIncontinent: boolean;
    nutritionDiets: string[];
    nutritionDietOther: string | null;
    joySparksNotes: string | null;
    stimulationAfraidLoudNoises: boolean;
    stimulationEasilyOverwhelmed: boolean;
    orientationProfile: {
      orientationDob: "Yes" | "No" | null;
      orientationCity: "Yes" | "No" | null;
      orientationCurrentYear: "Yes" | "No" | null;
      orientationFormerOccupation: "Yes" | "No" | null;
      disorientation: boolean | null;
      cognitiveBehaviorComments: string | null;
    };
    adlProfile: {
      dressing: string | null;
      toiletingNeeds: string | null;
      toiletingComments: string | null;
      maySelfMedicate: boolean | null;
    };
  };
  operationalFlags: {
    dnr: boolean;
    diabeticRestrictedSweets: boolean;
    bathroomAssistance: boolean;
  };
}

// Deterministic mapping layer:
// - Intake wording is observational, POF wording is physician-order oriented.
// - Diagnoses are intentionally excluded; they remain physician-entered.
export function mapIntakeAssessmentToPofPrefill(assessment: IntakeAssessmentForPofPrefill): IntakeToPofPrefill {
  const allergyValues = splitCsv(assessment.allergies).filter((value) => value.toUpperCase() !== "NKA");
  const allergyRows = allergyValues.map((value, idx) => ({
    allergyGroup: /nut|fish|shellfish|food|egg|milk|dairy|gluten|soy/i.test(value)
      ? ("food" as const)
      : /dust|latex|pollen|mold|environment/i.test(value)
        ? ("environmental" as const)
        : ("medication" as const),
    allergyName: value,
    severity: null,
    comments: idx === 0 ? "Prefilled from intake assessment." : null
  }));

  const mobilityItems = splitCsv(`${assessment.mobility_aids},${assessment.assistive_devices}`);
  const nonStandardMobilityItems = mobilityItems.filter(
    (value) => !/(none|walker|wheelchair)/i.test(value.toLowerCase())
  );
  const medSupport = mapMedicationAssistToPof(assessment.medication_management_status);
  const diet = canonicalDietSelection(assessment.diet_type, assessment.diet_other);
  const dnrSelected = mapCodeStatusToDnr(assessment.code_status);
  const toiletingNeeds = clean(assessment.incontinence_products);
  const behaviorCombined = clean([assessment.social_triggers, assessment.emotional_wellness_notes].filter(Boolean).join(" | "));

  return {
    dnrSelected,
    vitalsBloodPressure: clean(assessment.vitals_bp),
    vitalsPulse: Number.isFinite(assessment.vitals_hr) ? String(assessment.vitals_hr) : null,
    vitalsOxygenSaturation: Number.isFinite(assessment.vitals_o2_percent) ? String(assessment.vitals_o2_percent) : null,
    vitalsRespiration: Number.isFinite(assessment.vitals_rr) ? String(assessment.vitals_rr) : null,
    allergyRows,
    careInformation: {
      ambulatoryStatus: mapMobilityToAmbulatoryStatus(assessment.mobility_steadiness),
      mobilityIndependent: !includesWord(mobilityItems, /(walker|cane|wheelchair|gait|assist|other)/),
      mobilityWalker: includesWord(mobilityItems, /walker/),
      mobilityWheelchair: includesWord(mobilityItems, /wheelchair/),
      mobilityOther: includesWord(mobilityItems, /other|cane|gait|scooter/),
      mobilityOtherText: nonStandardMobilityItems.length > 0 ? nonStandardMobilityItems.join(", ") : null,
      personalCareDressing: !assessment.dressing_support_status.toLowerCase().includes("independent"),
      personalCareMedication: !assessment.medication_management_status.toLowerCase().includes("independent"),
      personalCareToileting: Boolean(toiletingNeeds),
      medAdministrationSelf: medSupport.medAdministrationSelf,
      medAdministrationNurse: medSupport.medAdministrationNurse,
      bladderContinent: !Boolean(toiletingNeeds),
      bladderIncontinent: Boolean(toiletingNeeds),
      bowelContinent: !Boolean(toiletingNeeds),
      bowelIncontinent: Boolean(toiletingNeeds),
      nutritionDiets: diet.diets,
      nutritionDietOther: diet.other ?? clean(assessment.diet_restrictions_notes),
      joySparksNotes: clean([assessment.joy_sparks, assessment.personal_notes].filter(Boolean).join(" | ")),
      stimulationAfraidLoudNoises: assessment.overwhelmed_by_noise || /noise/i.test(assessment.social_triggers),
      stimulationEasilyOverwhelmed: assessment.overwhelmed_by_noise || /overwhelm/i.test(assessment.social_triggers),
      orientationProfile: {
        orientationDob: mapOrientationBoolToAnswer(assessment.orientation_dob_verified),
        orientationCity: mapOrientationBoolToAnswer(assessment.orientation_city_verified),
        orientationCurrentYear: mapOrientationBoolToAnswer(assessment.orientation_year_verified),
        orientationFormerOccupation: mapOrientationBoolToAnswer(assessment.orientation_occupation_verified),
        disorientation:
          assessment.orientation_dob_verified &&
          assessment.orientation_city_verified &&
          assessment.orientation_year_verified &&
          assessment.orientation_occupation_verified
            ? false
            : true,
        cognitiveBehaviorComments: behaviorCombined
      },
      adlProfile: {
        dressing: clean(assessment.dressing_support_status),
        toiletingNeeds,
        toiletingComments: clean(assessment.transport_notes),
        maySelfMedicate: medSupport.maySelfMedicate
      }
    },
    operationalFlags: {
      dnr: dnrSelected,
      diabeticRestrictedSweets: /diabet|restricted sweets/i.test(`${assessment.diet_type} ${assessment.diet_restrictions_notes}`),
      bathroomAssistance: Boolean(toiletingNeeds)
    }
  };
}
