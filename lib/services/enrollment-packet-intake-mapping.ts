import "server-only";

import { randomUUID } from "node:crypto";

import { normalizeEnrollmentPacketIntakePayload, type EnrollmentPacketIntakePayload } from "@/lib/services/enrollment-packet-intake-payload";
import {
  addRecord,
  applyFillBlankBoolean,
  applyFillBlankString,
  attendanceDaysFromRequestedDays,
  clean,
  cleanEmail,
  cleanPhone,
  coerceMemberContactSchemaError,
  findBestExistingContactMatch,
  hasSelection,
  impliesAssistance,
  joinParts,
  normalizeGender,
  normalizeTransportationMode,
  normalizeTransportationRequired,
  parseCount,
  parseBoolLike,
  parseMappingSystems,
  parsePhotoConsentChoice,
  selectEnrollmentMemberContacts,
  stripNoopPatch,
  summarizeRecords,
  toTextValue,
  toYesLikeBoolean,
  type MappingRecord,
  type MappingStatus,
  type MappingSystem
} from "@/lib/services/enrollment-packet-intake-mapping-core";
import {
  buildDefaultAttendanceScheduleSnapshot,
  buildDefaultCommandCenterSnapshot,
  buildDefaultMhpSnapshot,
  ENROLLMENT_PACKET_MAPPING_MEMBER_SELECT,
  MCC_STRING_MAP,
  MEMBER_STRING_MAP,
  MHP_STRING_MAP
} from "@/lib/services/enrollment-packet-intake-mapping-config";
import { setBillingPayorContact } from "@/lib/services/billing-payor-contacts";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";
import { recordWorkflowEvent } from "@/lib/services/workflow-observability";
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

type PreparedContactInsert = {
  id: string;
  contact_name: string;
  relationship_to_member: string | null;
  category: string;
  category_other: string | null;
  email: string | null;
  cellular_number: string | null;
  work_number: string | null;
  home_number: string | null;
  street_address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  is_payor: boolean;
};

type PreparedRecordRow = {
  target_system: MappingSystem;
  target_table: string;
  target_field: string;
  source_field: string | null;
  status: MappingStatus;
  source_value: string | null;
  destination_value: string | null;
  note: string | null;
};

type EnrollmentConversionRpcRow = {
  packet_id: string;
  member_id: string;
  lead_id: string | null;
  conversion_status: string;
  mapping_run_id: string;
  systems: unknown;
  downstream_systems_updated: string[] | null;
  conflicts_requiring_review: number | null;
  records_persisted: number | null;
  conflict_ids: string[] | null;
  entity_references: Record<string, unknown> | null;
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

const CONVERT_ENROLLMENT_PACKET_TO_MEMBER_RPC = "convert_enrollment_packet_to_member";

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
export async function mapEnrollmentPacketToDownstream(input: EnrollmentPacketMappingRequest): Promise<EnrollmentPacketMappingSummary> {
  const admin = createSupabaseAdminClient();
  const now = toEasternISO();
  const payload = buildNormalizedPayload(input.fields);
  const records: MappingRecord[] = [];
  const preparedContacts: PreparedContactInsert[] = [];

  const [memberResult, existingMccResult, existingAttendanceResult, contactsResult, mhpResult] = await Promise.all([
    admin
      .from("members")
      .select(ENROLLMENT_PACKET_MAPPING_MEMBER_SELECT)
      .eq("id", input.memberId)
      .maybeSingle(),
    admin.from("member_command_centers").select("*").eq("member_id", input.memberId).maybeSingle(),
    admin.from("member_attendance_schedules").select("*").eq("member_id", input.memberId).maybeSingle(),
    admin.from("member_contacts").select("*").eq("member_id", input.memberId).order("updated_at", { ascending: false }),
    admin.from("member_health_profiles").select("*").eq("member_id", input.memberId).maybeSingle()
  ]);

  if (memberResult.error) throw new Error(memberResult.error.message);
  if (!memberResult.data) throw new Error("Member not found for enrollment packet mapping.");
  if (existingMccResult.error) throw new Error(existingMccResult.error.message);
  if (existingAttendanceResult.error) throw new Error(existingAttendanceResult.error.message);
  if (contactsResult.error) throw new Error(contactsResult.error.message);
  if (mhpResult.error) throw new Error(mhpResult.error.message);

  const memberRow = memberResult.data as Record<string, unknown>;
  const mccProfileRecord =
    (existingMccResult.data as Record<string, unknown> | null) ?? buildDefaultCommandCenterSnapshot(input.memberId);
  const attendanceSchedule =
    (existingAttendanceResult.data as Record<string, unknown> | null) ??
    buildDefaultAttendanceScheduleSnapshot(input.memberId, toTextValue(memberRow.enrollment_date));
  const mhpRow = (mhpResult.data as Record<string, unknown> | null) ?? buildDefaultMhpSnapshot();
  const contacts = (contactsResult.data ?? []) as Array<Record<string, unknown>>;
  const existingBillingPayor = contacts.find((row) => row.is_payor === true) ?? null;

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
      existingValue: memberRow[map.targetField]
    });
  });
  const memberWritePatch = stripNoopPatch(memberPatch, 1);

  const mccPatch: Record<string, unknown> = {
    updated_by_user_id: input.senderUserId,
    updated_by_name: input.senderName,
    updated_at: now
  };

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
    existingValue: mccProfileRecord.gender
  });
  applyFillBlankBoolean({
    records,
    patch: mccPatch,
    targetSystem: "mcc",
    targetTable: "member_command_centers",
    targetField: "is_veteran",
    sourceField: "veteranStatus",
    sourceValue: parseBoolLike(payload.veteranStatus),
    existingValue: mccProfileRecord.is_veteran
  });
  applyFillBlankBoolean({
    records,
    patch: mccPatch,
    targetSystem: "mcc",
    targetTable: "member_command_centers",
    targetField: "photo_consent",
    sourceField: "photoConsentChoice",
    sourceValue: parsePhotoConsentChoice(payload.photoConsentChoice),
    existingValue: mccProfileRecord.photo_consent
  });
  const mccWritePatch = stripNoopPatch(mccPatch, 3);

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
  applyFillBlankBoolean({
    records,
    patch: attendancePatch,
    targetSystem: "mcc",
    targetTable: "member_attendance_schedules",
    targetField: "transportation_required",
    sourceField: "transportationPreference",
    sourceValue: normalizeTransportationRequired(payload.transportationPreference),
    existingValue: attendanceSchedule.transportation_required
  });
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
      note:
        Number(attendanceSchedule.daily_rate) === Number(input.fields.daily_rate)
          ? "Already matched existing value."
          : "Existing daily rate retained."
    });
  }
  const attendanceWritePatch = stripNoopPatch(attendancePatch, 3);

  const primaryName = clean(payload.primaryContactName);
  const primaryEmail = cleanEmail(payload.primaryContactEmail);
  const primaryPhone = cleanPhone(payload.primaryContactPhone);
  const responsibleContact = findBestExistingContactMatch(contacts, {
    name: primaryName,
    email: primaryEmail,
    phone: primaryPhone,
    category: "Responsible Party"
  });
  const shouldAssignResponsibleAsPayor =
    Boolean(primaryName) &&
    (!existingBillingPayor || String(existingBillingPayor.id) === String(responsibleContact?.id ?? ""));
  if (primaryName) {
    const responsibleContactId = clean(String(responsibleContact?.id ?? "")) ?? `contact-${randomUUID().replace(/-/g, "")}`;
    preparedContacts.push({
      id: responsibleContactId,
      contact_name: primaryName,
      relationship_to_member: clean(payload.primaryContactRelationship),
      category: "Responsible Party",
      category_other: null,
      email: cleanEmail(payload.primaryContactEmail),
      cellular_number: clean(payload.primaryContactPhone),
      work_number: null,
      home_number: null,
      street_address:
        clean(payload.primaryContactAddressLine1) ?? clean(payload.primaryContactAddress) ?? clean(payload.memberAddressLine1),
      city: clean(payload.primaryContactCity) ?? clean(payload.memberCity),
      state: clean(payload.primaryContactState) ?? clean(payload.memberState),
      zip: clean(payload.primaryContactZip) ?? clean(payload.memberZip),
      is_payor: shouldAssignResponsibleAsPayor
    });
    addRecord(records, {
      targetSystem: "mcc",
      targetTable: "member_contacts",
      targetField: "responsible_party",
      sourceField: "primaryContactName",
      status: responsibleContact ? "written" : "written",
      sourceValue: primaryName,
      destinationValue: responsibleContactId,
      note: responsibleContact
        ? shouldAssignResponsibleAsPayor
          ? "Updated matched responsible party contact and retained canonical payor."
          : "Updated matched responsible party contact. Existing manual payor was preserved."
        : shouldAssignResponsibleAsPayor
          ? "Created responsible party contact and designated as billing payor."
          : "Created responsible party contact. Existing manual payor was preserved."
    });
    if (existingBillingPayor && String(existingBillingPayor.id) !== responsibleContactId) {
      addRecord(records, {
        targetSystem: "mcc",
        targetTable: "member_contacts",
        targetField: "is_payor",
        sourceField: "primaryContactName",
        status: "conflict",
        sourceValue: primaryName,
        destinationValue: clean(String(existingBillingPayor.contact_name ?? "")),
        note: "Manual payor selection already exists and was preserved."
      });
    }
  }

  const secondaryName = clean(payload.secondaryContactName);
  if (secondaryName) {
    const existingSecondary = findBestExistingContactMatch(contacts, {
      name: secondaryName,
      email: cleanEmail(payload.secondaryContactEmail),
      phone: cleanPhone(payload.secondaryContactPhone),
      category: "Emergency Contact"
    });

    const secondaryContactId = clean(String(existingSecondary?.id ?? "")) ?? `contact-${randomUUID().replace(/-/g, "")}`;
    preparedContacts.push({
      id: secondaryContactId,
      contact_name: secondaryName,
      relationship_to_member: clean(payload.secondaryContactRelationship),
      category: "Emergency Contact",
      category_other: null,
      email: cleanEmail(payload.secondaryContactEmail),
      cellular_number: clean(payload.secondaryContactPhone),
      work_number: null,
      home_number: null,
      street_address: clean(payload.secondaryContactAddressLine1) ?? clean(payload.secondaryContactAddress),
      city: clean(payload.secondaryContactCity),
      state: clean(payload.secondaryContactState),
      zip: clean(payload.secondaryContactZip),
      is_payor: false
    });
    addRecord(records, {
      targetSystem: "mcc",
      targetTable: "member_contacts",
      targetField: "secondary_contact",
      sourceField: "secondaryContactName",
      status: "written",
      sourceValue: secondaryName,
      destinationValue: secondaryContactId,
      note: existingSecondary ? "Updated matched emergency contact." : "Created emergency contact."
    });
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
      existingValue: mhpRow[map.targetField]
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
    existingValue: mhpRow.mental_health_history
  });
  applyFillBlankString({
    records,
    patch: mhpPatch,
    targetSystem: "mhp",
    targetTable: "member_health_profiles",
    targetField: "mobility_aids",
    sourceField: "mobilityAids",
    sourceValue: [payload.caneWalkerUse, payload.wheelchairUse].filter(Boolean).join(" | "),
    existingValue: mhpRow.mobility_aids
  });

  const hasUrinaryIncontinence = hasSelection(payload.continenceSelections, "Urinary Incontinence");
  const hasBowelIncontinence = hasSelection(payload.continenceSelections, "Bowel Incontinence");
  const hasContinentSelection = hasSelection(payload.continenceSelections, "Continent");
  const bladderContinenceFromSelections =
    payload.continenceSelections.length === 0
      ? clean(payload.continenceStatus)
      : hasUrinaryIncontinence
        ? "Urinary Incontinence"
        : hasContinentSelection
          ? "Continent"
          : clean(payload.continenceStatus);
  const bowelContinenceFromSelections =
    payload.continenceSelections.length === 0
      ? clean(payload.continenceStatus)
      : hasBowelIncontinence
        ? "Bowel Incontinence"
        : hasContinentSelection
          ? "Continent"
          : clean(payload.continenceStatus);
  applyFillBlankString({
    records,
    patch: mhpPatch,
    targetSystem: "mhp",
    targetTable: "member_health_profiles",
    targetField: "bladder_continence",
    sourceField: "continenceSelections",
    sourceValue: bladderContinenceFromSelections,
    existingValue: mhpRow.bladder_continence
  });
  applyFillBlankString({
    records,
    patch: mhpPatch,
    targetSystem: "mhp",
    targetTable: "member_health_profiles",
    targetField: "bowel_continence",
    sourceField: "continenceSelections",
    sourceValue: bowelContinenceFromSelections,
    existingValue: mhpRow.bowel_continence
  });

  const hasBehaviorSelections = payload.behavioralObservations.length > 0;
  applyFillBlankBoolean({
    records,
    patch: mhpPatch,
    targetSystem: "mhp",
    targetTable: "member_health_profiles",
    targetField: "wandering",
    sourceField: "behavioralObservations",
    sourceValue: hasBehaviorSelections ? hasSelection(payload.behavioralObservations, "Wandering") : null,
    existingValue: mhpRow.wandering
  });
  applyFillBlankBoolean({
    records,
    patch: mhpPatch,
    targetSystem: "mhp",
    targetTable: "member_health_profiles",
    targetField: "combative_disruptive",
    sourceField: "behavioralObservations",
    sourceValue: hasBehaviorSelections ? hasSelection(payload.behavioralObservations, "Aggression") : null,
    existingValue: mhpRow.combative_disruptive
  });
  applyFillBlankBoolean({
    records,
    patch: mhpPatch,
    targetSystem: "mhp",
    targetTable: "member_health_profiles",
    targetField: "disorientation",
    sourceField: "behavioralObservations",
    sourceValue: hasBehaviorSelections ? hasSelection(payload.behavioralObservations, "Confusion") : null,
    existingValue: mhpRow.disorientation
  });
  applyFillBlankBoolean({
    records,
    patch: mhpPatch,
    targetSystem: "mhp",
    targetTable: "member_health_profiles",
    targetField: "agitation_resistive",
    sourceField: "behavioralObservations",
    sourceValue: hasBehaviorSelections ? hasSelection(payload.behavioralObservations, "Agitation") : null,
    existingValue: mhpRow.agitation_resistive
  });
  applyFillBlankBoolean({
    records,
    patch: mhpPatch,
    targetSystem: "mhp",
    targetTable: "member_health_profiles",
    targetField: "sleep_issues",
    sourceField: "behavioralObservations",
    sourceValue: hasBehaviorSelections ? hasSelection(payload.behavioralObservations, "Sundowning") : null,
    existingValue: mhpRow.sleep_issues
  });
  const mhpWritePatch = stripNoopPatch(mhpPatch, 3);

  const behavioralRiskSelections = payload.behavioralObservations.map((value) => clean(value)).filter((value): value is string => Boolean(value));
  const pofPrefillPayload = {
    providerName: clean(payload.pcpName),
    providerPhone: clean(payload.pcpPhone),
    providerFax: clean(payload.pcpFax),
    providerAddress: clean(payload.pcpAddress),
    pharmacy: joinParts([clean(payload.pharmacy), clean(payload.pharmacyAddress)]),
    allergiesSummary: clean(payload.allergiesSummary),
    dietaryRestrictions: clean(payload.dietaryRestrictions),
    oxygenUse: clean(payload.oxygenUse),
    medicationsDuringDay: clean(payload.medicationNamesDuringDay),
    mobilitySupport: clean(payload.mobilityTransferStatus),
    adlSupport: {
      toiletingBathingAssistance: clean(payload.toiletingBathingAssistance),
      continenceStatus: clean(payload.continenceStatus),
      dressingFeedingIndependence: clean(payload.dressingFeedingIndependence),
      caneWalkerUse: clean(payload.caneWalkerUse),
      wheelchairUse: clean(payload.wheelchairUse)
    },
    adlSnapshot: {
      ambulation: clean(payload.adlMobilityLevel),
      transfers: clean(payload.adlTransferLevel),
      toileting: clean(payload.adlToiletingLevel),
      bathing: clean(payload.adlBathingLevel),
      dressing: clean(payload.adlDressingLevel),
      eating: clean(payload.adlEatingLevel),
      continence: clean(payload.adlContinenceLevel)
    },
    behavioralRiskSelections,
    medicationDuringDayRequired:
      toYesLikeBoolean(payload.medicationNeededDuringDay) === true || clean(payload.medicationNamesDuringDay) != null,
    oxygenUseRequired:
      toYesLikeBoolean(payload.oxygenUse) === true ||
      clean(payload.oxygenFlowRate) != null ||
      clean(payload.oxygenUse)?.toLowerCase().includes("oxygen") === true,
    fallsHistoryYes: toYesLikeBoolean(payload.fallsHistory) === true,
    recentFalls: toYesLikeBoolean(payload.fallsWithinLast3Months) === true,
    mobilityAssistanceRequired: [
      payload.adlMobilityLevel,
      payload.adlTransferLevel,
      payload.adlToiletingLevel,
      payload.adlBathingLevel,
      payload.adlDressingLevel,
      payload.adlEatingLevel,
      payload.mobilityTransferStatus,
      payload.toiletingBathingAssistance,
      payload.dressingFeedingIndependence
    ].some((value) => impliesAssistance(value)),
    sourceLabel: "Caregiver Provided Intake",
    caregiverProvidedBy: clean(payload.primaryContactName),
    diagnosisPlaceholders: clean(payload.diagnosisPlaceholders),
    intakeNotes: joinParts([
      clean(payload.intakeClinicalNotes),
      clean(payload.behavioralNotes),
      clean(payload.medicationNamesDuringDay)
    ])
  };
  const pofStagePayload = {
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
  };

    [
      "pcpName",
      "pcpPhone",
      "pcpFax",
      "pcpAddress",
      "pharmacy",
      "pharmacyAddress",
      "allergiesSummary",
      "dietaryRestrictions",
      "oxygenUse",
      "oxygenFlowRate",
      "medicationNeededDuringDay",
      "medicationNamesDuringDay",
      "fallsHistory",
      "fallsWithinLast3Months",
      "behavioralObservations",
      "adlMobilityLevel",
      "adlTransferLevel",
      "adlToiletingLevel",
      "adlBathingLevel",
      "adlDressingLevel",
      "adlEatingLevel",
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
  const recordRows: PreparedRecordRow[] = records.map((record) => ({
    target_system: record.targetSystem,
    target_table: record.targetTable,
    target_field: record.targetField,
    source_field: record.sourceField,
    status: record.status,
    source_value: record.sourceValue,
    destination_value: record.destinationValue,
    note: record.note
  }));

  const rpcData = await invokeSupabaseRpcOrThrow<EnrollmentConversionRpcRow[]>(admin, CONVERT_ENROLLMENT_PACKET_TO_MEMBER_RPC, {
    p_packet_id: input.packetId,
    p_member_id: input.memberId,
    p_actor_user_id: input.senderUserId,
    p_actor_name: clean(input.senderName),
    p_actor_email: cleanEmail(input.senderEmail) ?? cleanEmail(input.caregiverEmail),
    p_started_at: now,
    p_member_patch: memberWritePatch,
    p_mcc_patch: mccWritePatch,
    p_attendance_patch: attendanceWritePatch,
    p_contacts: [],
    p_mhp_patch: mhpWritePatch,
    p_pof_stage_payload: pofStagePayload,
    p_record_rows: recordRows,
    p_summary: summary
  });

  const rpcRow = Array.isArray(rpcData) ? rpcData[0] : null;
  if (!rpcRow?.mapping_run_id) {
    throw new Error("Enrollment packet conversion RPC did not return a mapping run id.");
  }

  let refreshedContacts = await selectEnrollmentMemberContacts(admin, input.memberId);

  for (const preparedContact of preparedContacts) {
    const matchedContact =
      refreshedContacts.find((row) => String(row.id) === preparedContact.id) ??
      findBestExistingContactMatch(refreshedContacts, {
        name: preparedContact.contact_name,
        email: preparedContact.email,
        phone: cleanPhone(preparedContact.cellular_number),
        category: preparedContact.category
      });
    const contactPatch = {
      member_id: input.memberId,
      contact_name: preparedContact.contact_name,
      relationship_to_member: preparedContact.relationship_to_member,
      category: preparedContact.category,
      category_other: preparedContact.category_other,
      email: preparedContact.email,
      cellular_number: preparedContact.cellular_number,
      work_number: preparedContact.work_number,
      home_number: preparedContact.home_number,
      street_address: preparedContact.street_address,
      city: preparedContact.city,
      state: preparedContact.state,
      zip: preparedContact.zip,
      is_payor: false,
      updated_at: now
    };

    if (matchedContact) {
      const { error: updateContactError } = await admin
        .from("member_contacts")
        .update(contactPatch)
        .eq("id", String(matchedContact.id));
      if (updateContactError) {
        throw coerceMemberContactSchemaError(updateContactError);
      }
    } else {
      const { error: insertContactError } = await admin.from("member_contacts").insert({
        id: preparedContact.id,
        ...contactPatch,
        created_by_user_id: input.senderUserId,
        created_by_name: clean(input.senderName),
        created_at: now
      });
      if (insertContactError) {
        throw coerceMemberContactSchemaError(insertContactError);
      }
    }
  }

  refreshedContacts = await selectEnrollmentMemberContacts(admin, input.memberId);
  const refreshedResponsibleContact = findBestExistingContactMatch(refreshedContacts, {
    name: primaryName,
    email: primaryEmail,
    phone: primaryPhone,
    category: "Responsible Party"
  });

  if (refreshedResponsibleContact) {
    const contactPatch = {
      contact_name: primaryName,
      relationship_to_member: clean(payload.primaryContactRelationship),
      category: "Responsible Party",
      category_other: null,
      email: primaryEmail,
      cellular_number: clean(payload.primaryContactPhone),
      work_number: null,
      home_number: null,
      street_address:
        clean(payload.primaryContactAddressLine1) ?? clean(payload.primaryContactAddress) ?? clean(payload.memberAddressLine1),
      city: clean(payload.primaryContactCity) ?? clean(payload.memberCity),
      state: clean(payload.primaryContactState) ?? clean(payload.memberState),
      zip: clean(payload.primaryContactZip) ?? clean(payload.memberZip),
      updated_at: now
    };
    const { error: updateResponsibleError } = await admin
      .from("member_contacts")
      .update(contactPatch)
      .eq("id", String(refreshedResponsibleContact.id));
    if (updateResponsibleError) {
      throw coerceMemberContactSchemaError(updateResponsibleError);
    }
  }

  const refreshedSecondaryContact = findBestExistingContactMatch(refreshedContacts, {
    name: secondaryName,
    email: cleanEmail(payload.secondaryContactEmail),
    phone: cleanPhone(payload.secondaryContactPhone),
    category: "Emergency Contact"
  });
  if (refreshedSecondaryContact && secondaryName) {
    const { error: updateSecondaryError } = await admin
      .from("member_contacts")
      .update({
        contact_name: secondaryName,
        relationship_to_member: clean(payload.secondaryContactRelationship),
        category: "Emergency Contact",
        category_other: null,
        email: cleanEmail(payload.secondaryContactEmail),
        cellular_number: clean(payload.secondaryContactPhone),
        work_number: null,
        home_number: null,
        street_address: clean(payload.secondaryContactAddressLine1) ?? clean(payload.secondaryContactAddress),
        city: clean(payload.secondaryContactCity),
        state: clean(payload.secondaryContactState),
        zip: clean(payload.secondaryContactZip),
        updated_at: now
      })
      .eq("id", String(refreshedSecondaryContact.id));
    if (updateSecondaryError) {
      throw coerceMemberContactSchemaError(updateSecondaryError);
    }
  }

  if (refreshedResponsibleContact && shouldAssignResponsibleAsPayor) {
    await setBillingPayorContact({
      memberId: input.memberId,
      contactId: String(refreshedResponsibleContact.id),
      actorUserId: input.senderUserId,
      actorName: input.senderName,
      source: "mapEnrollmentPacketToDownstream",
      reason: "Enrollment packet responsible party matched canonical billing payor."
    });
  } else if (refreshedResponsibleContact && existingBillingPayor && String(existingBillingPayor.id) !== String(refreshedResponsibleContact.id)) {
    await recordWorkflowEvent({
      eventType: "billing_payor_conflict_preserved_manual",
      entityType: "member",
      entityId: input.memberId,
      actorType: "system",
      status: "conflict",
      severity: "medium",
      metadata: {
        source: "mapEnrollmentPacketToDownstream",
        existing_payor_contact_id: String(existingBillingPayor.id),
        enrollment_contact_id: String(refreshedResponsibleContact.id),
        enrollment_contact_name: primaryName
      }
    });
  }

  return {
    mappingRunId: String(rpcRow.mapping_run_id),
    systems: parseMappingSystems(rpcRow.systems),
    downstreamSystemsUpdated: (rpcRow.downstream_systems_updated ?? []).map((value) => String(value)),
    conflictsRequiringReview: parseCount(rpcRow.conflicts_requiring_review),
    recordsPersisted: parseCount(rpcRow.records_persisted),
    conflictIds: (rpcRow.conflict_ids ?? []).map((value) => String(value))
  };
}
