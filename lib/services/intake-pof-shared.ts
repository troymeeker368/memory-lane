export const SHARED_DIET_OPTIONS = [
  "Regular",
  "Diabetic",
  "Low Sodium",
  "Pureed",
  "Mechanical Soft",
  "Other"
] as const;

export const SHARED_ASSISTIVE_DEVICE_OPTIONS = ["Walker", "Cane", "Wheelchair", "Gait Belt", "None", "Other"] as const;

export const SHARED_AMBULATORY_STATUS_OPTIONS = ["Full", "Semi", "Non"] as const;

export const SHARED_TRANSFER_ASSIST_OPTIONS = ["Independent", "Setup only", "Needs partial assistance", "Needs full assistance"] as const;

export const SHARED_TOILETING_ASSIST_OPTIONS = ["Independent", "Setup only", "Needs partial assistance", "Needs full assistance"] as const;

export const SHARED_MEDICATION_ASSIST_OPTIONS = [
  "Independent",
  "Needs reminders",
  "Needs cueing",
  "Needs full assistance"
] as const;

export const SHARED_ORIENTATION_SUPPORT_OPTIONS = ["Yes", "No"] as const;

export const SHARED_BEHAVIOR_FLAG_OPTIONS = [
  "Wanderer",
  "Verbal aggression",
  "Aggression",
  "Easily overwhelmed",
  "Afraid loud noises",
  "Exit-seeking",
  "None",
  "Other"
] as const;

export const SHARED_INCONTINENCE_OPTIONS = ["Continent", "Incontinent", "Other", "Unknown"] as const;

export const SHARED_TRANSPORT_ASSIST_OPTIONS = ["Independent", "Standby", "1:1 Assist", "2:1 Assist", "Lift Required"] as const;

function clean(value: string | null | undefined) {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

export function splitCsv(value: string | null | undefined) {
  return (value ?? "")
    .split(/[,;\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function canonicalDietSelection(intakeDietType: string | null | undefined, intakeDietOther: string | null | undefined) {
  const rawDiet = clean(intakeDietType);
  const rawOther = clean(intakeDietOther);
  if (!rawDiet && !rawOther) {
    return { diets: ["Regular"] as string[], other: null as string | null };
  }

  const normalized = (rawDiet ?? rawOther ?? "Regular").toLowerCase();
  if (normalized.includes("diabet")) return { diets: ["Diabetic"] as string[], other: null as string | null };
  if (normalized.includes("low sodium") || normalized.includes("sodium")) return { diets: ["Low Sodium"] as string[], other: null as string | null };
  if (normalized.includes("puree") || normalized.includes("pureed")) return { diets: ["Pureed"] as string[], other: null as string | null };
  if (normalized.includes("mechanical soft") || normalized.includes("soft")) {
    return { diets: ["Mechanical Soft"] as string[], other: null as string | null };
  }
  if (normalized.includes("regular")) return { diets: ["Regular"] as string[], other: null as string | null };

  return { diets: ["Other"] as string[], other: rawOther ?? rawDiet };
}

export function mapMedicationAssistToPof(input: string | null | undefined) {
  const normalized = (input ?? "").toLowerCase();
  if (!normalized) {
    return { medAdministrationSelf: false, medAdministrationNurse: true, maySelfMedicate: null as boolean | null };
  }
  if (normalized.includes("independent")) {
    return { medAdministrationSelf: true, medAdministrationNurse: false, maySelfMedicate: true as boolean | null };
  }
  return { medAdministrationSelf: false, medAdministrationNurse: true, maySelfMedicate: false as boolean | null };
}

export function mapMobilityToAmbulatoryStatus(input: string | null | undefined) {
  const normalized = (input ?? "").toLowerCase();
  if (!normalized) return null;
  if (normalized.includes("full") || normalized.includes("steady") || normalized.includes("independent")) return "Full";
  if (normalized.includes("non") || normalized.includes("wheelchair") || normalized.includes("total")) return "Non";
  return "Semi";
}

export function mapCodeStatusToDnr(input: string | null | undefined) {
  return (input ?? "").trim().toUpperCase() === "DNR";
}

export function mapOrientationBoolToAnswer(value: boolean | null | undefined): "Yes" | "No" | null {
  if (value == null) return null;
  return value ? "Yes" : "No";
}
