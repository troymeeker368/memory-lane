import {
  buildMemberContactsSchemaOutOfDateError,
  isMemberContactsPayorColumnMissingError,
  MEMBER_CONTACT_SELECT_LEGACY,
  MEMBER_CONTACT_SELECT_WITH_PAYOR
} from "@/lib/services/member-contact-payor-schema";

export type MappingSystem = "mcc" | "mhp" | "pof_staging" | "member_files";
export type MappingStatus = "written" | "skipped" | "conflict" | "staged" | "error";

export type MappingRecord = {
  targetSystem: MappingSystem;
  targetTable: string;
  targetField: string;
  sourceField: string | null;
  status: MappingStatus;
  sourceValue: string | null;
  destinationValue: string | null;
  note: string | null;
};

export function clean(value: string | null | undefined) {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

export function joinParts(parts: Array<string | null | undefined>, separator = " | ") {
  const values = parts.map((part) => clean(part)).filter((part): part is string => Boolean(part));
  return values.length > 0 ? values.join(separator) : null;
}

export function cleanEmail(value: string | null | undefined) {
  const normalized = clean(value);
  return normalized ? normalized.toLowerCase() : null;
}

export function cleanPhone(value: string | null | undefined) {
  const normalized = clean(value);
  return normalized ? normalized.replace(/\D+/g, "") : null;
}

export function coerceMemberContactSchemaError(error: { code?: string | null; message?: string | null } | null | undefined) {
  if (isMemberContactsPayorColumnMissingError(error)) {
    return buildMemberContactsSchemaOutOfDateError();
  }
  return new Error(error?.message ?? "Unable to save member contacts from enrollment sync.");
}

export async function selectEnrollmentMemberContacts(
  admin: any,
  memberId: string
) {
  let lastError: { code?: string | null; message?: string | null } | null = null;
  for (const selectClause of [MEMBER_CONTACT_SELECT_WITH_PAYOR, MEMBER_CONTACT_SELECT_LEGACY]) {
    const result = await admin
      .from("member_contacts")
      .select(selectClause)
      .eq("member_id", memberId)
      .order("updated_at", { ascending: false });
    if (!result.error) {
      return (result.data ?? []) as Array<Record<string, unknown>>;
    }
    lastError = result.error;
    if (!isMemberContactsPayorColumnMissingError(result.error)) {
      throw new Error(result.error.message ?? "Unable to query member contacts from enrollment sync.");
    }
  }
  if (isMemberContactsPayorColumnMissingError(lastError)) {
    return [];
  }
  throw new Error(lastError?.message ?? "Unable to query member contacts from enrollment sync.");
}

export function contactMatchesCandidate(
  contact: Record<string, unknown>,
  candidate: {
    name: string | null;
    email: string | null;
    phone: string | null;
    category?: string | null;
  }
) {
  const contactName = clean(String(contact.contact_name ?? ""));
  const contactEmail = cleanEmail(String(contact.email ?? ""));
  const contactCategory = clean(String(contact.category ?? ""));
  const contactPhones = [
    cleanPhone(String(contact.cellular_number ?? "")),
    cleanPhone(String(contact.work_number ?? "")),
    cleanPhone(String(contact.home_number ?? ""))
  ].filter((value): value is string => Boolean(value));

  if (!candidate.name) return false;
  if (contactName?.toLowerCase() !== candidate.name.toLowerCase()) return false;
  if (candidate.category && contactCategory?.toLowerCase() !== candidate.category.toLowerCase()) return false;
  if (candidate.email && contactEmail && contactEmail !== candidate.email) return false;
  if (candidate.phone && contactPhones.length > 0 && !contactPhones.includes(candidate.phone)) return false;
  return true;
}

export function findBestExistingContactMatch(
  contacts: Array<Record<string, unknown>>,
  candidate: {
    name: string | null;
    email: string | null;
    phone: string | null;
    category?: string | null;
  }
) {
  if (!candidate.name) return null;
  return (
    contacts.find((contact) => contactMatchesCandidate(contact, candidate)) ??
    contacts.find((contact) => {
      const contactName = clean(String(contact.contact_name ?? ""));
      return contactName?.toLowerCase() === candidate.name?.toLowerCase();
    }) ??
    null
  );
}

export function toTextValue(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return clean(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const flattened = value
      .map((item) => (typeof item === "string" ? clean(item) : null))
      .filter((item): item is string => Boolean(item));
    return flattened.length > 0 ? flattened.join(", ") : null;
  }
  return clean(String(value));
}

export function isBlankValue(value: unknown) {
  if (value == null) return true;
  if (typeof value === "string") return clean(value) == null;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

export function parseBoolLike(value: string | null | undefined): boolean | null {
  const normalized = clean(value)?.toLowerCase();
  if (!normalized) return null;
  if (["yes", "y", "true", "1", "veteran"].includes(normalized)) return true;
  if (["no", "n", "false", "0", "not veteran"].includes(normalized)) return false;
  return null;
}

export function parsePhotoConsentChoice(value: string | null | undefined): boolean | null {
  const normalized = clean(value)?.toLowerCase();
  if (!normalized) return null;
  if (normalized.includes("do not")) return false;
  if (normalized.includes("do permit")) return true;
  if (normalized.includes("permit")) return true;
  return null;
}

export function hasSelection(values: string[], expected: string) {
  const target = expected.trim().toLowerCase();
  return values.some((value) => value.trim().toLowerCase() === target);
}

export function normalizeGender(value: string | null | undefined): "M" | "F" | null {
  const normalized = clean(value)?.toLowerCase();
  if (!normalized) return null;
  if (["m", "male", "man"].includes(normalized)) return "M";
  if (["f", "female", "woman"].includes(normalized)) return "F";
  return null;
}

export function normalizeTransportationMode(value: string | null | undefined): "Door to Door" | "Bus Stop" | null {
  const normalized = clean(value)?.toLowerCase();
  if (!normalized) return null;
  if (normalized.includes("door")) return "Door to Door";
  if (normalized.includes("bus")) return "Bus Stop";
  if (normalized === "yes") return "Door to Door";
  return null;
}

export function normalizeTransportationRequired(value: string | null | undefined): boolean | null {
  const normalized = clean(value)?.toLowerCase();
  if (!normalized) return null;
  if (normalized === "none" || normalized === "no") return false;
  if (normalized.includes("door") || normalized.includes("bus") || normalized.includes("mixed")) return true;
  return null;
}

export function toYesLikeBoolean(value: string | null | undefined): boolean | null {
  const normalized = clean(value)?.toLowerCase();
  if (!normalized) return null;
  if (["yes", "y", "true", "1"].includes(normalized)) return true;
  if (["no", "n", "false", "0"].includes(normalized)) return false;
  return null;
}

export function impliesAssistance(value: string | null | undefined) {
  const normalized = clean(value)?.toLowerCase();
  if (!normalized) return false;
  if (normalized.includes("independent")) return false;
  return (
    normalized.includes("assist") ||
    normalized.includes("dependent") ||
    normalized.includes("wheelchair") ||
    normalized.includes("prompt") ||
    normalized.includes("transfer") ||
    normalized.includes("help")
  );
}

export function attendanceDaysFromRequestedDays(days: string[]) {
  const normalized = new Set(days.map((day) => day.trim().toLowerCase()));
  return {
    monday: normalized.has("monday") || normalized.has("mon"),
    tuesday: normalized.has("tuesday") || normalized.has("tue"),
    wednesday: normalized.has("wednesday") || normalized.has("wed"),
    thursday: normalized.has("thursday") || normalized.has("thu"),
    friday: normalized.has("friday") || normalized.has("fri")
  };
}

export function addRecord(records: MappingRecord[], record: MappingRecord) {
  records.push(record);
}

export function applyFillBlankString(input: {
  records: MappingRecord[];
  patch: Record<string, unknown>;
  targetSystem: MappingSystem;
  targetTable: string;
  targetField: string;
  sourceField: string;
  sourceValue: string | null;
  existingValue: unknown;
  skipNote?: string;
}) {
  const sourceValue = clean(input.sourceValue);
  if (!sourceValue) {
    addRecord(input.records, {
      targetSystem: input.targetSystem,
      targetTable: input.targetTable,
      targetField: input.targetField,
      sourceField: input.sourceField,
      status: "skipped",
      sourceValue: null,
      destinationValue: toTextValue(input.existingValue),
      note: input.skipNote ?? "Source blank."
    });
    return;
  }

  if (isBlankValue(input.existingValue)) {
    input.patch[input.targetField] = sourceValue;
    addRecord(input.records, {
      targetSystem: input.targetSystem,
      targetTable: input.targetTable,
      targetField: input.targetField,
      sourceField: input.sourceField,
      status: "written",
      sourceValue,
      destinationValue: null,
      note: null
    });
    return;
  }

  const existingValue = clean(toTextValue(input.existingValue));
  if (existingValue === sourceValue) {
    addRecord(input.records, {
      targetSystem: input.targetSystem,
      targetTable: input.targetTable,
      targetField: input.targetField,
      sourceField: input.sourceField,
      status: "skipped",
      sourceValue,
      destinationValue: existingValue,
      note: "Already matched existing value."
    });
    return;
  }

  addRecord(input.records, {
    targetSystem: input.targetSystem,
    targetTable: input.targetTable,
    targetField: input.targetField,
    sourceField: input.sourceField,
    status: "conflict",
    sourceValue,
    destinationValue: existingValue,
    note: "Existing non-blank value retained."
  });
}

export function applyFillBlankBoolean(input: {
  records: MappingRecord[];
  patch: Record<string, unknown>;
  targetSystem: MappingSystem;
  targetTable: string;
  targetField: string;
  sourceField: string;
  sourceValue: boolean | null;
  existingValue: unknown;
}) {
  if (input.sourceValue == null) {
    addRecord(input.records, {
      targetSystem: input.targetSystem,
      targetTable: input.targetTable,
      targetField: input.targetField,
      sourceField: input.sourceField,
      status: "skipped",
      sourceValue: null,
      destinationValue: toTextValue(input.existingValue),
      note: "Source blank."
    });
    return;
  }

  if (input.existingValue == null) {
    input.patch[input.targetField] = input.sourceValue;
    addRecord(input.records, {
      targetSystem: input.targetSystem,
      targetTable: input.targetTable,
      targetField: input.targetField,
      sourceField: input.sourceField,
      status: "written",
      sourceValue: String(input.sourceValue),
      destinationValue: null,
      note: null
    });
    return;
  }

  const existingBool = typeof input.existingValue === "boolean" ? input.existingValue : null;
  if (existingBool === input.sourceValue) {
    addRecord(input.records, {
      targetSystem: input.targetSystem,
      targetTable: input.targetTable,
      targetField: input.targetField,
      sourceField: input.sourceField,
      status: "skipped",
      sourceValue: String(input.sourceValue),
      destinationValue: existingBool == null ? null : String(existingBool),
      note: "Already matched existing value."
    });
    return;
  }

  addRecord(input.records, {
    targetSystem: input.targetSystem,
    targetTable: input.targetTable,
    targetField: input.targetField,
    sourceField: input.sourceField,
    status: "conflict",
    sourceValue: String(input.sourceValue),
    destinationValue: existingBool == null ? toTextValue(input.existingValue) : String(existingBool),
    note: "Existing non-blank value retained."
  });
}

export function summarizeRecords(records: MappingRecord[]) {
  const count = (targetSystem: MappingSystem, statuses: MappingStatus[]) =>
    records.filter((row) => row.targetSystem === targetSystem && statuses.includes(row.status)).length;

  const mccWritten = count("mcc", ["written"]);
  const mccSkipped = count("mcc", ["skipped"]);
  const mccConflicts = count("mcc", ["conflict"]);
  const mhpWritten = count("mhp", ["written"]);
  const mhpSkipped = count("mhp", ["skipped"]);
  const mhpConflicts = count("mhp", ["conflict"]);
  const pofStaged = count("pof_staging", ["staged", "written"]);
  const pofSkipped = count("pof_staging", ["skipped"]);
  const memberFilesWritten = count("member_files", ["written"]);
  const memberFilesSkipped = count("member_files", ["skipped"]);

  const downstreamSystemsUpdated = [
    mccWritten > 0 ? "mcc" : null,
    mhpWritten > 0 ? "mhp" : null,
    pofStaged > 0 ? "pof_staging" : null,
    memberFilesWritten > 0 ? "member_files" : null
  ].filter((value): value is string => Boolean(value));

  return {
    systems: {
      mcc: { written: mccWritten, skipped: mccSkipped, conflicts: mccConflicts },
      mhp: { written: mhpWritten, skipped: mhpSkipped, conflicts: mhpConflicts },
      pofStaging: { staged: pofStaged, skipped: pofSkipped },
      memberFiles: { written: memberFilesWritten, skipped: memberFilesSkipped }
    },
    downstreamSystemsUpdated,
    conflictsRequiringReview: mccConflicts + mhpConflicts
  };
}

export function stripNoopPatch(patch: Record<string, unknown>, minimumKeys: number) {
  return Object.keys(patch).length > minimumKeys ? patch : {};
}

export function parseCount(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseMappingSystems(value: unknown) {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const mcc = source.mcc && typeof source.mcc === "object" ? (source.mcc as Record<string, unknown>) : {};
  const mhp = source.mhp && typeof source.mhp === "object" ? (source.mhp as Record<string, unknown>) : {};
  const pofStaging =
    source.pofStaging && typeof source.pofStaging === "object"
      ? (source.pofStaging as Record<string, unknown>)
      : {};
  const memberFiles =
    source.memberFiles && typeof source.memberFiles === "object"
      ? (source.memberFiles as Record<string, unknown>)
      : {};

  return {
    mcc: {
      written: parseCount(mcc.written),
      skipped: parseCount(mcc.skipped),
      conflicts: parseCount(mcc.conflicts)
    },
    mhp: {
      written: parseCount(mhp.written),
      skipped: parseCount(mhp.skipped),
      conflicts: parseCount(mhp.conflicts)
    },
    pofStaging: {
      staged: parseCount(pofStaging.staged),
      skipped: parseCount(pofStaging.skipped)
    },
    memberFiles: {
      written: parseCount(memberFiles.written),
      skipped: parseCount(memberFiles.skipped)
    }
  };
}
