import "server-only";

import { randomUUID } from "node:crypto";

import { normalizeEnrollmentPacketIntakePayload, type EnrollmentPacketIntakePayload } from "@/lib/services/enrollment-packet-intake-payload";
import {
  ensureMemberAttendanceScheduleSupabase,
  ensureMemberCommandCenterProfileSupabase
} from "@/lib/services/member-command-center-supabase";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { toEasternISO } from "@/lib/timezone";

export type EnrollmentPacketFieldsForMapping = {
  requested_days: string[] | null;
  transportation: string | null;
  daily_rate: number | null;
  caregiver_name: string | null;
  caregiver_phone: string | null;
  caregiver_email: string | null;
  caregiver_address_line1: string | null;
  caregiver_address_line2: string | null;
  caregiver_city: string | null;
  caregiver_state: string | null;
  caregiver_zip: string | null;
  secondary_contact_name: string | null;
  secondary_contact_phone: string | null;
  secondary_contact_email: string | null;
  secondary_contact_relationship: string | null;
  notes: string | null;
  intake_payload: Record<string, unknown> | null;
};

export type EnrollmentPacketMappingRequest = {
  packetId: string;
  memberId: string;
  senderUserId: string;
  senderName: string;
  senderEmail: string | null;
  caregiverEmail: string | null;
  fields: EnrollmentPacketFieldsForMapping;
  memberFileArtifacts: Array<{
    uploadCategory: string;
    memberFileId: string | null;
  }>;
};

type MappingSystem = "mcc" | "mhp" | "pof_staging" | "member_files";
type MappingStatus = "written" | "skipped" | "conflict" | "staged" | "error";

type MappingRecord = {
  targetSystem: MappingSystem;
  targetTable: string;
  targetField: string;
  sourceField: string | null;
  status: MappingStatus;
  sourceValue: string | null;
  destinationValue: string | null;
  note: string | null;
};

export type EnrollmentPacketMappingSummary = {
  mappingRunId: string;
  systems: {
    mcc: { written: number; skipped: number; conflicts: number };
    mhp: { written: number; skipped: number; conflicts: number };
    pofStaging: { staged: number; skipped: number };
    memberFiles: { written: number; skipped: number };
  };
  downstreamSystemsUpdated: string[];
  conflictsRequiringReview: number;
  recordsPersisted: number;
  conflictIds: string[];
};

type StringMap = {
  sourceField: StringLikePayloadKey;
  targetField: string;
};

type StringLikePayloadKey = {
  [K in keyof EnrollmentPacketIntakePayload]: EnrollmentPacketIntakePayload[K] extends string | null | undefined ? K : never;
}[keyof EnrollmentPacketIntakePayload];

const MEMBER_STRING_MAP: StringMap[] = [
  { sourceField: "memberLegalFirstName", targetField: "legal_first_name" },
  { sourceField: "memberLegalLastName", targetField: "legal_last_name" },
  { sourceField: "memberPreferredName", targetField: "preferred_name" },
  { sourceField: "memberSsnLast4", targetField: "ssn_last4" },
  { sourceField: "memberDob", targetField: "dob" },
  { sourceField: "requestedStartDate", targetField: "enrollment_date" }
];

const MCC_STRING_MAP: StringMap[] = [
  { sourceField: "maritalStatus", targetField: "marital_status" },
  { sourceField: "memberAddressLine1", targetField: "street_address" },
  { sourceField: "memberCity", targetField: "city" },
  { sourceField: "memberState", targetField: "state" },
  { sourceField: "memberZip", targetField: "zip" },
  { sourceField: "guardianPoaStatus", targetField: "guardian_poa_status" },
  { sourceField: "guardianPoaStatus", targetField: "power_of_attorney" },
  { sourceField: "referredBy", targetField: "original_referral_source" },
  { sourceField: "pcpName", targetField: "pcp_name" },
  { sourceField: "pcpPhone", targetField: "pcp_phone" },
  { sourceField: "pcpFax", targetField: "pcp_fax" },
  { sourceField: "pcpAddress", targetField: "pcp_address" },
  { sourceField: "pharmacy", targetField: "pharmacy" },
  { sourceField: "livingSituation", targetField: "living_situation" },
  { sourceField: "insuranceSummaryReference", targetField: "insurance_summary_reference" }
];

const MHP_STRING_MAP: StringMap[] = [
  { sourceField: "pcpName", targetField: "provider_name" },
  { sourceField: "pcpPhone", targetField: "provider_phone" },
  { sourceField: "hospitalPreference", targetField: "hospital_preference" },
  { sourceField: "dietaryRestrictions", targetField: "dietary_restrictions" },
  { sourceField: "oxygenUse", targetField: "oxygen_use" },
  { sourceField: "memoryStage", targetField: "memory_severity" },
  { sourceField: "fallsHistory", targetField: "falls_history" },
  { sourceField: "physicalHealthProblems", targetField: "physical_health_problems" },
  { sourceField: "behavioralNotes", targetField: "cognitive_behavior_comments" },
  { sourceField: "communicationStyle", targetField: "communication_style" },
  { sourceField: "mobilityTransferStatus", targetField: "ambulation" },
  { sourceField: "mobilityTransferStatus", targetField: "transferring" },
  { sourceField: "toiletingBathingAssistance", targetField: "bathing" },
  { sourceField: "toiletingBathingAssistance", targetField: "toileting" },
  { sourceField: "continenceStatus", targetField: "bladder_continence" },
  { sourceField: "continenceStatus", targetField: "bowel_continence" },
  { sourceField: "incontinenceProducts", targetField: "incontinence_products" },
  { sourceField: "dressingFeedingIndependence", targetField: "dressing" },
  { sourceField: "dressingFeedingIndependence", targetField: "eating" },
  { sourceField: "dentures", targetField: "dental" },
  { sourceField: "speechHearingVision", targetField: "speech_comments" },
  { sourceField: "glassesHearingAidsCataracts", targetField: "glasses_hearing_aids_cataracts" },
  { sourceField: "intakeClinicalNotes", targetField: "intake_notes" }
];

function clean(value: string | null | undefined) {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function cleanEmail(value: string | null | undefined) {
  const normalized = clean(value);
  return normalized ? normalized.toLowerCase() : null;
}

function toTextValue(value: unknown): string | null {
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

function isBlankValue(value: unknown) {
  if (value == null) return true;
  if (typeof value === "string") return clean(value) == null;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function parseBoolLike(value: string | null | undefined): boolean | null {
  const normalized = clean(value)?.toLowerCase();
  if (!normalized) return null;
  if (["yes", "y", "true", "1", "veteran"].includes(normalized)) return true;
  if (["no", "n", "false", "0", "not veteran"].includes(normalized)) return false;
  return null;
}

function normalizeGender(value: string | null | undefined): "M" | "F" | null {
  const normalized = clean(value)?.toLowerCase();
  if (!normalized) return null;
  if (["m", "male", "man"].includes(normalized)) return "M";
  if (["f", "female", "woman"].includes(normalized)) return "F";
  return null;
}

function normalizeTransportationMode(value: string | null | undefined): "Door to Door" | "Bus Stop" | null {
  const normalized = clean(value)?.toLowerCase();
  if (!normalized) return null;
  if (normalized.includes("door")) return "Door to Door";
  if (normalized.includes("bus")) return "Bus Stop";
  if (normalized === "yes") return "Door to Door";
  return null;
}

function attendanceDaysFromRequestedDays(days: string[]) {
  const normalized = new Set(days.map((day) => day.trim().toLowerCase()));
  return {
    monday: normalized.has("monday") || normalized.has("mon"),
    tuesday: normalized.has("tuesday") || normalized.has("tue"),
    wednesday: normalized.has("wednesday") || normalized.has("wed"),
    thursday: normalized.has("thursday") || normalized.has("thu"),
    friday: normalized.has("friday") || normalized.has("fri")
  };
}

function addRecord(records: MappingRecord[], record: MappingRecord) {
  records.push(record);
}

function applyFillBlankString(input: {
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

function applyFillBlankBoolean(input: {
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

function buildNormalizedPayload(fields: EnrollmentPacketFieldsForMapping): EnrollmentPacketIntakePayload {
  const base = normalizeEnrollmentPacketIntakePayload((fields.intake_payload ?? {}) as Record<string, unknown>);
  const requestedAttendanceDays =
    base.requestedAttendanceDays.length > 0
      ? base.requestedAttendanceDays
      : (fields.requested_days ?? []).map((value) => String(value));

  return {
    ...base,
    requestedAttendanceDays,
    transportationPreference: base.transportationPreference ?? fields.transportation,
    primaryContactName: base.primaryContactName ?? fields.caregiver_name,
    primaryContactPhone: base.primaryContactPhone ?? fields.caregiver_phone,
    primaryContactEmail: base.primaryContactEmail ?? fields.caregiver_email,
    secondaryContactName: base.secondaryContactName ?? fields.secondary_contact_name,
    secondaryContactPhone: base.secondaryContactPhone ?? fields.secondary_contact_phone,
    secondaryContactEmail: base.secondaryContactEmail ?? fields.secondary_contact_email,
    secondaryContactRelationship: base.secondaryContactRelationship ?? fields.secondary_contact_relationship,
    memberAddressLine1: base.memberAddressLine1 ?? fields.caregiver_address_line1,
    memberAddressLine2: base.memberAddressLine2 ?? fields.caregiver_address_line2,
    memberCity: base.memberCity ?? fields.caregiver_city,
    memberState: base.memberState ?? fields.caregiver_state,
    memberZip: base.memberZip ?? fields.caregiver_zip,
    additionalNotes: base.additionalNotes ?? fields.notes
  };
}

function summarizeRecords(records: MappingRecord[]) {
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
export async function mapEnrollmentPacketToDownstream(input: EnrollmentPacketMappingRequest): Promise<EnrollmentPacketMappingSummary> {
  const admin = createSupabaseAdminClient();
  const now = toEasternISO();
  const payload = buildNormalizedPayload(input.fields);

  const { data: runRow, error: runError } = await admin
    .from("enrollment_packet_mapping_runs")
    .insert({
      packet_id: input.packetId,
      member_id: input.memberId,
      actor_user_id: input.senderUserId,
      actor_email: cleanEmail(input.senderEmail) ?? cleanEmail(input.caregiverEmail),
      actor_name: clean(input.senderName),
      status: "running",
      summary: {},
      started_at: now
    })
    .select("id")
    .single();
  if (runError) throw new Error(runError.message);

  const mappingRunId = String((runRow as { id: string }).id);
  const records: MappingRecord[] = [];

  try {
    const { data: memberRow, error: memberError } = await admin
      .from("members")
      .select("id, preferred_name, legal_first_name, legal_last_name, dob, enrollment_date, ssn_last4")
      .eq("id", input.memberId)
      .maybeSingle();
    if (memberError) throw new Error(memberError.message);
    if (!memberRow) throw new Error("Member not found for enrollment packet mapping.");

    const mccProfile = await ensureMemberCommandCenterProfileSupabase(input.memberId, {
      serviceRole: true,
      actor: { userId: input.senderUserId, name: input.senderName }
    });
    const attendanceSchedule = await ensureMemberAttendanceScheduleSupabase(input.memberId, {
      serviceRole: true,
      actor: { userId: input.senderUserId, name: input.senderName }
    });

    const { data: contactsRows, error: contactsError } = await admin
      .from("member_contacts")
      .select("*")
      .eq("member_id", input.memberId)
      .order("updated_at", { ascending: false });
    if (contactsError) throw new Error(contactsError.message);

    let { data: mhpRow, error: mhpError } = await admin
      .from("member_health_profiles")
      .select("*")
      .eq("member_id", input.memberId)
      .maybeSingle();
    if (mhpError) throw new Error(mhpError.message);
    if (!mhpRow) {
      const { error: mhpInsertError } = await admin.from("member_health_profiles").insert({
        member_id: input.memberId,
        created_at: now,
        updated_at: now,
        updated_by_user_id: input.senderUserId,
        updated_by_name: input.senderName
      });
      if (mhpInsertError) throw new Error(mhpInsertError.message);
      const { data: reloadedMhp, error: reloadedMhpError } = await admin
        .from("member_health_profiles")
        .select("*")
        .eq("member_id", input.memberId)
        .maybeSingle();
      if (reloadedMhpError) throw new Error(reloadedMhpError.message);
      mhpRow = reloadedMhp;
    }

    const memberPatch: Record<string, unknown> = { updated_at: now };
    MEMBER_STRING_MAP.forEach((map) => {
      applyFillBlankString({
        records,
        patch: memberPatch,
        targetSystem: "mcc",
        targetTable: "members",
        targetField: map.targetField,
        sourceField: String(map.sourceField),
        sourceValue: payload[map.sourceField],
        existingValue: (memberRow as Record<string, unknown>)[map.targetField]
      });
    });

    if (Object.keys(memberPatch).length > 1) {
      const { error } = await admin.from("members").update(memberPatch).eq("id", input.memberId);
      if (error) throw new Error(error.message);
    }

    const mccPatch: Record<string, unknown> = {
      updated_by_user_id: input.senderUserId,
      updated_by_name: input.senderName,
      updated_at: now
    };
    const mccProfileRecord = mccProfile as unknown as Record<string, unknown>;

    MCC_STRING_MAP.forEach((map) => {
      applyFillBlankString({
        records,
        patch: mccPatch,
        targetSystem: "mcc",
        targetTable: "member_command_centers",
        targetField: map.targetField,
        sourceField: String(map.sourceField),
        sourceValue: payload[map.sourceField],
        existingValue: mccProfileRecord[map.targetField]
      });
    });

    applyFillBlankString({
      records,
      patch: mccPatch,
      targetSystem: "mcc",
      targetTable: "member_command_centers",
      targetField: "gender",
      sourceField: "memberGender",
      sourceValue: normalizeGender(payload.memberGender),
      existingValue: mccProfile.gender
    });
    applyFillBlankBoolean({
      records,
      patch: mccPatch,
      targetSystem: "mcc",
      targetTable: "member_command_centers",
      targetField: "is_veteran",
      sourceField: "veteranStatus",
      sourceValue: parseBoolLike(payload.veteranStatus),
      existingValue: mccProfile.is_veteran
    });

    if (Object.keys(mccPatch).length > 3) {
      const { error } = await admin.from("member_command_centers").update(mccPatch).eq("id", mccProfile.id);
      if (error) throw new Error(error.message);
    }

    const attendancePatch: Record<string, unknown> = {
      updated_by_user_id: input.senderUserId,
      updated_by_name: input.senderName,
      updated_at: now
    };

    const attendanceDays = attendanceDaysFromRequestedDays(payload.requestedAttendanceDays);
    const existingHasAttendanceDays =
      Boolean(attendanceSchedule.monday) ||
      Boolean(attendanceSchedule.tuesday) ||
      Boolean(attendanceSchedule.wednesday) ||
      Boolean(attendanceSchedule.thursday) ||
      Boolean(attendanceSchedule.friday);

    if (!existingHasAttendanceDays) {
      attendancePatch.monday = attendanceDays.monday;
      attendancePatch.tuesday = attendanceDays.tuesday;
      attendancePatch.wednesday = attendanceDays.wednesday;
      attendancePatch.thursday = attendanceDays.thursday;
      attendancePatch.friday = attendanceDays.friday;
      attendancePatch.attendance_days_per_week = [
        attendanceDays.monday,
        attendanceDays.tuesday,
        attendanceDays.wednesday,
        attendanceDays.thursday,
        attendanceDays.friday
      ].filter(Boolean).length;
      addRecord(records, {
        targetSystem: "mcc",
        targetTable: "member_attendance_schedules",
        targetField: "requested_days",
        sourceField: "requestedAttendanceDays",
        status: "written",
        sourceValue: payload.requestedAttendanceDays.join(", "),
        destinationValue: null,
        note: null
      });
    } else {
      addRecord(records, {
        targetSystem: "mcc",
        targetTable: "member_attendance_schedules",
        targetField: "requested_days",
        sourceField: "requestedAttendanceDays",
        status: "conflict",
        sourceValue: payload.requestedAttendanceDays.join(", "),
        destinationValue: [
          attendanceSchedule.monday ? "Monday" : null,
          attendanceSchedule.tuesday ? "Tuesday" : null,
          attendanceSchedule.wednesday ? "Wednesday" : null,
          attendanceSchedule.thursday ? "Thursday" : null,
          attendanceSchedule.friday ? "Friday" : null
        ]
          .filter((value): value is string => Boolean(value))
          .join(", "),
        note: "Existing attendance schedule retained."
      });
    }

    applyFillBlankString({
      records,
      patch: attendancePatch,
      targetSystem: "mcc",
      targetTable: "member_attendance_schedules",
      targetField: "transportation_mode",
      sourceField: "transportationPreference",
      sourceValue: normalizeTransportationMode(payload.transportationPreference),
      existingValue: attendanceSchedule.transportation_mode
    });

    if (attendancePatch.transportation_mode) {
      attendancePatch.transportation_required = true;
    }

    if (attendanceSchedule.daily_rate == null && input.fields.daily_rate != null) {
      attendancePatch.daily_rate = Number(input.fields.daily_rate);
      addRecord(records, {
        targetSystem: "mcc",
        targetTable: "member_attendance_schedules",
        targetField: "daily_rate",
        sourceField: "daily_rate",
        status: "written",
        sourceValue: String(input.fields.daily_rate),
        destinationValue: null,
        note: null
      });
    } else if (attendanceSchedule.daily_rate != null && input.fields.daily_rate != null) {
      addRecord(records, {
        targetSystem: "mcc",
        targetTable: "member_attendance_schedules",
        targetField: "daily_rate",
        sourceField: "daily_rate",
        status: Number(attendanceSchedule.daily_rate) === Number(input.fields.daily_rate) ? "skipped" : "conflict",
        sourceValue: String(input.fields.daily_rate),
        destinationValue: String(attendanceSchedule.daily_rate),
        note: Number(attendanceSchedule.daily_rate) === Number(input.fields.daily_rate) ? "Already matched existing value." : "Existing daily rate retained."
      });
    }

    if (Object.keys(attendancePatch).length > 3) {
      const { error } = await admin.from("member_attendance_schedules").update(attendancePatch).eq("id", attendanceSchedule.id);
      if (error) throw new Error(error.message);
    }

    const contacts = (contactsRows ?? []) as Array<Record<string, unknown>>;
    const responsibleContact =
      contacts.find((row) => clean(String(row.category ?? ""))?.toLowerCase() === "responsible party") ??
      contacts.find((row) => clean(String(row.category ?? ""))?.toLowerCase() === "emergency contact") ??
      null;

    const primaryName = clean(payload.primaryContactName);
    if (!responsibleContact && primaryName) {
      const { error } = await admin.from("member_contacts").insert({
        id: `contact-${randomUUID().replace(/-/g, "")}`,
        member_id: input.memberId,
        contact_name: primaryName,
        relationship_to_member: clean(payload.primaryContactRelationship),
        category: "Responsible Party",
        category_other: null,
        email: cleanEmail(payload.primaryContactEmail),
        cellular_number: clean(payload.primaryContactPhone),
        work_number: null,
        home_number: null,
        street_address: clean(payload.memberAddressLine1),
        city: clean(payload.memberCity),
        state: clean(payload.memberState),
        zip: clean(payload.memberZip),
        created_by_user_id: input.senderUserId,
        created_by_name: input.senderName,
        created_at: now,
        updated_at: now
      });
      if (error) throw new Error(error.message);
      addRecord(records, {
        targetSystem: "mcc",
        targetTable: "member_contacts",
        targetField: "responsible_party",
        sourceField: "primaryContactName",
        status: "written",
        sourceValue: primaryName,
        destinationValue: null,
        note: "Created responsible party contact."
      });
    }

    const secondaryName = clean(payload.secondaryContactName);
    if (secondaryName) {
      const existingSecondary = contacts.find((row) => {
        const existingName = clean(String(row.contact_name ?? ""));
        if (!existingName) return false;
        if (existingName.toLowerCase() !== secondaryName.toLowerCase()) return false;
        return clean(String(row.category ?? ""))?.toLowerCase() === "emergency contact";
      });

      if (!existingSecondary) {
        const { error } = await admin.from("member_contacts").insert({
          id: `contact-${randomUUID().replace(/-/g, "")}`,
          member_id: input.memberId,
          contact_name: secondaryName,
          relationship_to_member: clean(payload.secondaryContactRelationship),
          category: "Emergency Contact",
          category_other: null,
          email: cleanEmail(payload.secondaryContactEmail),
          cellular_number: clean(payload.secondaryContactPhone),
          work_number: null,
          home_number: null,
          street_address: null,
          city: null,
          state: null,
          zip: null,
          created_by_user_id: input.senderUserId,
          created_by_name: input.senderName,
          created_at: now,
          updated_at: now
        });
        if (error) throw new Error(error.message);
        addRecord(records, {
          targetSystem: "mcc",
          targetTable: "member_contacts",
          targetField: "secondary_contact",
          sourceField: "secondaryContactName",
          status: "written",
          sourceValue: secondaryName,
          destinationValue: null,
          note: "Created emergency contact."
        });
      } else {
        addRecord(records, {
          targetSystem: "mcc",
          targetTable: "member_contacts",
          targetField: "secondary_contact",
          sourceField: "secondaryContactName",
          status: "conflict",
          sourceValue: secondaryName,
          destinationValue: clean(String(existingSecondary.contact_name ?? "")),
          note: "Existing emergency contact retained."
        });
      }
    }

    const mhpPatch: Record<string, unknown> = {
      updated_by_user_id: input.senderUserId,
      updated_by_name: input.senderName,
      updated_at: now
    };

    MHP_STRING_MAP.forEach((map) => {
      applyFillBlankString({
        records,
        patch: mhpPatch,
        targetSystem: "mhp",
        targetTable: "member_health_profiles",
        targetField: map.targetField,
        sourceField: String(map.sourceField),
        sourceValue: payload[map.sourceField],
        existingValue: (mhpRow as Record<string, unknown>)[map.targetField]
      });
    });

    applyFillBlankString({
      records,
      patch: mhpPatch,
      targetSystem: "mhp",
      targetTable: "member_health_profiles",
      targetField: "mental_health_history",
      sourceField: "mentalHealthHistory",
      sourceValue: [payload.mentalHealthHistory, payload.ptsdHistory].filter(Boolean).join(" | "),
      existingValue: (mhpRow as Record<string, unknown>).mental_health_history
    });

    applyFillBlankString({
      records,
      patch: mhpPatch,
      targetSystem: "mhp",
      targetTable: "member_health_profiles",
      targetField: "mobility_aids",
      sourceField: "mobilityAids",
      sourceValue: [payload.caneWalkerUse, payload.wheelchairUse].filter(Boolean).join(" | "),
      existingValue: (mhpRow as Record<string, unknown>).mobility_aids
    });

    if (Object.keys(mhpPatch).length > 3) {
      const { error } = await admin.from("member_health_profiles").update(mhpPatch).eq("member_id", input.memberId);
      if (error) throw new Error(error.message);
    }

    const pofPrefillPayload = {
      providerName: clean(payload.pcpName),
      providerPhone: clean(payload.pcpPhone),
      providerFax: clean(payload.pcpFax),
      providerAddress: clean(payload.pcpAddress),
      pharmacy: clean(payload.pharmacy),
      allergiesSummary: clean(payload.allergiesSummary),
      dietaryRestrictions: clean(payload.dietaryRestrictions),
      oxygenUse: clean(payload.oxygenUse),
      mobilitySupport: clean(payload.mobilityTransferStatus),
      adlSupport: {
        toiletingBathingAssistance: clean(payload.toiletingBathingAssistance),
        continenceStatus: clean(payload.continenceStatus),
        dressingFeedingIndependence: clean(payload.dressingFeedingIndependence),
        caneWalkerUse: clean(payload.caneWalkerUse),
        wheelchairUse: clean(payload.wheelchairUse)
      },
      diagnosisPlaceholders: clean(payload.diagnosisPlaceholders),
      intakeNotes: clean(payload.intakeClinicalNotes)
    };

    const { error: pofStageError } = await admin.from("enrollment_packet_pof_staging").upsert(
      {
        packet_id: input.packetId,
        member_id: input.memberId,
        pcp_name: pofPrefillPayload.providerName,
        physician_phone: pofPrefillPayload.providerPhone,
        physician_fax: pofPrefillPayload.providerFax,
        physician_address: pofPrefillPayload.providerAddress,
        pharmacy: pofPrefillPayload.pharmacy,
        allergies_summary: pofPrefillPayload.allergiesSummary,
        dietary_restrictions: pofPrefillPayload.dietaryRestrictions,
        oxygen_use: pofPrefillPayload.oxygenUse,
        mobility_support: pofPrefillPayload.mobilitySupport,
        adl_support: pofPrefillPayload.adlSupport,
        diagnosis_placeholders: pofPrefillPayload.diagnosisPlaceholders,
        intake_notes: pofPrefillPayload.intakeNotes,
        prefill_payload: pofPrefillPayload,
        review_required: true,
        updated_by_user_id: input.senderUserId,
        updated_by_name: input.senderName,
        updated_at: now
      },
      { onConflict: "packet_id" }
    );
    if (pofStageError) throw new Error(pofStageError.message);

    [
      "pcpName",
      "pcpPhone",
      "pcpFax",
      "pcpAddress",
      "pharmacy",
      "allergiesSummary",
      "dietaryRestrictions",
      "oxygenUse",
      "mobilityTransferStatus",
      "diagnosisPlaceholders",
      "intakeClinicalNotes"
    ].forEach((sourceField) => {
      const sourceValue = toTextValue((payload as unknown as Record<string, unknown>)[sourceField]);
      addRecord(records, {
        targetSystem: "pof_staging",
        targetTable: "enrollment_packet_pof_staging",
        targetField: sourceField,
        sourceField,
        status: sourceValue ? "staged" : "skipped",
        sourceValue,
        destinationValue: null,
        note: sourceValue ? "Prefilled for nurse/provider review." : "Source blank."
      });
    });

    if (input.memberFileArtifacts.length === 0) {
      addRecord(records, {
        targetSystem: "member_files",
        targetTable: "member_files",
        targetField: "artifacts",
        sourceField: null,
        status: "skipped",
        sourceValue: null,
        destinationValue: null,
        note: "No uploaded artifacts mapped."
      });
    } else {
      input.memberFileArtifacts.forEach((artifact) => {
        addRecord(records, {
          targetSystem: "member_files",
          targetTable: "member_files",
          targetField: "id",
          sourceField: "uploadCategory",
          status: artifact.memberFileId ? "written" : "skipped",
          sourceValue: artifact.uploadCategory,
          destinationValue: artifact.memberFileId,
          note: artifact.memberFileId ? "Artifact linked to member files." : "No member file id available."
        });
      });
    }

    const summary = summarizeRecords(records);

    const recordRows = records.map((record) => ({
      mapping_run_id: mappingRunId,
      packet_id: input.packetId,
      member_id: input.memberId,
      target_system: record.targetSystem,
      target_table: record.targetTable,
      target_field: record.targetField,
      source_field: record.sourceField,
      status: record.status,
      source_value: record.sourceValue,
      destination_value: record.destinationValue,
      note: record.note,
      created_at: now
    }));

    if (recordRows.length > 0) {
      const { error: recordError } = await admin.from("enrollment_packet_mapping_records").insert(recordRows);
      if (recordError) throw new Error(recordError.message);
    }

    const conflictRows = records
      .filter((record) => record.status === "conflict")
      .map((record) => ({
        mapping_run_id: mappingRunId,
        packet_id: input.packetId,
        member_id: input.memberId,
        target_system: record.targetSystem,
        target_table: record.targetTable,
        target_field: record.targetField,
        source_field: record.sourceField,
        source_value: record.sourceValue,
        destination_value: record.destinationValue,
        status: "open",
        created_at: now
      }));

    let conflictIds: string[] = [];
    if (conflictRows.length > 0) {
      const { data: insertedConflicts, error: conflictError } = await admin
        .from("enrollment_packet_field_conflicts")
        .insert(conflictRows)
        .select("id");
      if (conflictError) throw new Error(conflictError.message);
      conflictIds = ((insertedConflicts ?? []) as Array<{ id: string }>).map((row) => row.id);
    }

    const runSummary = {
      ...summary,
      recordsPersisted: recordRows.length,
      conflictIds
    };

    const { error: completeRunError } = await admin
      .from("enrollment_packet_mapping_runs")
      .update({
        status: "completed",
        summary: runSummary,
        completed_at: now
      })
      .eq("id", mappingRunId);
    if (completeRunError) throw new Error(completeRunError.message);

    return {
      mappingRunId,
      systems: runSummary.systems,
      downstreamSystemsUpdated: runSummary.downstreamSystemsUpdated,
      conflictsRequiringReview: runSummary.conflictsRequiringReview,
      recordsPersisted: runSummary.recordsPersisted,
      conflictIds: runSummary.conflictIds
    };
  } catch (error) {
    const failureSummary = {
      error: error instanceof Error ? error.message : "Enrollment packet mapping failed.",
      recordsCaptured: records.length
    };
    await admin
      .from("enrollment_packet_mapping_runs")
      .update({
        status: "failed",
        summary: failureSummary,
        completed_at: toEasternISO()
      })
      .eq("id", mappingRunId);
    throw error;
  }
}
