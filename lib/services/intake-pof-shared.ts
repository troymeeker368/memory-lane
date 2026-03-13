export const SHARED_DIET_OPTIONS = [
  "Regular",
  "Diabetic",
  "Low Sodium",
  "Pureed",
  "Mechanical Soft",
  "Other"
] as const;

export const SHARED_ASSISTIVE_DEVICE_OPTIONS = ["Walker", "Cane", "Wheelchair", "Gait Belt", "None", "Other"] as const;
export const SHARED_MOBILITY_AID_OPTIONS = ["Walker", "Cane", "Wheelchair", "None", "Other"] as const;
export const SHARED_TRANSPORT_AID_OPTIONS = ["Walker", "Cane", "Wheelchair", "Gait Belt", "None", "Other"] as const;

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

const SYNCABLE_DEVICE_OPTIONS = ["Walker", "Cane", "Wheelchair", "Gait Belt", "None"] as const;
type SyncableDeviceOption = (typeof SYNCABLE_DEVICE_OPTIONS)[number];

function parseSyncableDeviceOption(value: string): SyncableDeviceOption | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "walker") return "Walker";
  if (normalized === "cane") return "Cane";
  if (normalized === "wheelchair") return "Wheelchair";
  if (normalized === "gait belt" || normalized === "gait-belt") return "Gait Belt";
  if (normalized === "none") return "None";
  return null;
}

function mergeWithSyncedSelections(input: {
  sourceValue: string | null | undefined;
  allowedOptions: readonly SyncableDeviceOption[];
  syncedSelections: Set<SyncableDeviceOption>;
}) {
  const sourceTokens = splitCsv(input.sourceValue);
  const preservedTokens = sourceTokens.filter((token) => !parseSyncableDeviceOption(token));
  const syncedTokens = input.allowedOptions.filter((option) => input.syncedSelections.has(option));
  const merged: string[] = [...syncedTokens];
  preservedTokens.forEach((token) => {
    if (!merged.some((existing) => existing.toLowerCase() === token.toLowerCase())) {
      merged.push(token);
    }
  });
  return merged.join(", ");
}

export function normalizeIntakeAssistiveDeviceFields(input: {
  assistiveDevices?: string | null;
  mobilityAids?: string | null;
  transportMobilityAid?: string | null;
}) {
  const allTokens = [
    ...splitCsv(input.assistiveDevices),
    ...splitCsv(input.mobilityAids),
    ...splitCsv(input.transportMobilityAid)
  ];
  const syncedSelections = new Set<SyncableDeviceOption>();
  let hasConcreteDevice = false;
  let sawNone = false;

  allTokens.forEach((token) => {
    const parsed = parseSyncableDeviceOption(token);
    if (!parsed) return;
    if (parsed === "None") {
      sawNone = true;
      return;
    }
    hasConcreteDevice = true;
    syncedSelections.add(parsed);
  });

  if (!hasConcreteDevice && sawNone) {
    syncedSelections.add("None");
  }

  return {
    assistiveDevices: mergeWithSyncedSelections({
      sourceValue: input.assistiveDevices,
      allowedOptions: ["Walker", "Cane", "Wheelchair", "Gait Belt", "None"],
      syncedSelections
    }),
    mobilityAids: mergeWithSyncedSelections({
      sourceValue: input.mobilityAids,
      allowedOptions: ["Walker", "Cane", "Wheelchair", "None"],
      syncedSelections
    }),
    transportMobilityAid: mergeWithSyncedSelections({
      sourceValue: input.transportMobilityAid,
      allowedOptions: ["Walker", "Cane", "Wheelchair", "Gait Belt", "None"],
      syncedSelections
    })
  };
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
