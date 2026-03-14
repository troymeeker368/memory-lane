export const ENROLLMENT_PACKET_INTAKE_TEXT_KEYS = [
  "memberLegalFirstName",
  "memberLegalLastName",
  "memberPreferredName",
  "memberDob",
  "memberAge",
  "memberGender",
  "memberSsn",
  "memberSsnLast4",
  "maritalStatus",
  "memberAddressLine1",
  "memberAddressLine2",
  "memberCity",
  "memberState",
  "memberZip",
  "requestedStartDate",
  "transportationPreference",
  "medicareNumber",
  "privateInsuranceName",
  "privateInsurancePolicyNumber",
  "veteranStatus",
  "memberRepresentativeGuardianPoa",
  "guardianPoaStatus",
  "referredBy",
  "primaryContactName",
  "primaryContactRelationship",
  "primaryContactPhone",
  "primaryContactEmail",
  "secondaryContactName",
  "secondaryContactRelationship",
  "secondaryContactPhone",
  "secondaryContactEmail",
  "pcpName",
  "pcpPhone",
  "pcpFax",
  "pcpAddress",
  "physicianName",
  "physicianPhone",
  "physicianFax",
  "physicianAddress",
  "pharmacy",
  "hospitalPreference",
  "livingSituation",
  "insuranceSummaryReference",
  "medicationNeededDuringDay",
  "oxygenUse",
  "mentalHealthHistory",
  "ptsdHistory",
  "memoryStage",
  "intakeClinicalNotes",
  "fallsHistory",
  "physicalHealthProblems",
  "behavioralNotes",
  "communicationStyle",
  "mobilityTransferStatus",
  "caneWalkerUse",
  "wheelchairUse",
  "toiletingBathingAssistance",
  "continenceStatus",
  "incontinenceProducts",
  "dressesSelf",
  "feedsSelf",
  "dressingFeedingIndependence",
  "dietaryRestrictions",
  "dentures",
  "speech",
  "hearing",
  "hearingAids",
  "vision",
  "glasses",
  "cataracts",
  "speechHearingVision",
  "glassesHearingAidsCataracts",
  "stepsOutside",
  "stepsInside",
  "bedBathSameFloor",
  "safetyBars",
  "showerChair",
  "spousePartner",
  "childrenGrandchildren",
  "importantPeople",
  "pets",
  "militaryWarService",
  "religion",
  "pastOccupation",
  "nickname",
  "favoriteMusic",
  "favoriteSong",
  "favoriteTv",
  "favoriteMovie",
  "favoriteBook",
  "favoriteHoliday",
  "favoritePlace",
  "favoriteColor",
  "favoriteHobby",
  "favoriteSport",
  "favoriteExercise",
  "favoriteSeason",
  "responsiblePartyGuarantorFirstName",
  "responsiblePartyGuarantorLastName",
  "responsiblePartyGuarantorDob",
  "responsiblePartyGuarantorSsn",
  "membershipMemberInfoBlock",
  "membershipNumberOfDays",
  "membershipDailyAmount",
  "paymentMethodSelection",
  "bankName",
  "bankCityStateZip",
  "bankAba",
  "bankAccountNumber",
  "cardholderName",
  "cardType",
  "cardNumber",
  "cardExpiration",
  "cardCvv",
  "cardBillingAddress",
  "communityFee",
  "totalInitialEnrollmentAmount",
  "guarantorSignatureName",
  "guarantorSignatureDate",
  "privacyAcknowledgmentSignatureName",
  "privacyAcknowledgmentSignatureDate",
  "rightsAcknowledgmentSignatureName",
  "rightsAcknowledgmentSignatureDate",
  "photoConsentChoice",
  "photoConsentAcknowledgmentName",
  "photoConsentMemberName",
  "ancillaryChargesAcknowledgmentSignatureName",
  "ancillaryChargesAcknowledgmentSignatureDate",
  "welcomeChecklistAcknowledgedName",
  "welcomeChecklistAcknowledgedDate",
  "diagnosisPlaceholders",
  "allergiesSummary",
  "additionalNotes"
] as const;

export const ENROLLMENT_PACKET_INTAKE_ARRAY_KEYS = [
  "requestedAttendanceDays",
  "membershipRequestedWeekdays",
  "personalityPreferencePairs",
  "recreationalInterests"
] as const;

export type EnrollmentPacketIntakeTextKey = (typeof ENROLLMENT_PACKET_INTAKE_TEXT_KEYS)[number];
export type EnrollmentPacketIntakeArrayKey = (typeof ENROLLMENT_PACKET_INTAKE_ARRAY_KEYS)[number];
export type EnrollmentPacketIntakeFieldKey = EnrollmentPacketIntakeTextKey | EnrollmentPacketIntakeArrayKey;

export type EnrollmentPacketIntakePayload = {
  [K in EnrollmentPacketIntakeTextKey]: string | null;
} & {
  [K in EnrollmentPacketIntakeArrayKey]: string[];
};

type RawPayload = Partial<Record<EnrollmentPacketIntakeFieldKey, unknown>>;

function clean(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeDayLabel(value: string) {
  const lower = value.trim().toLowerCase();
  if (lower === "mon" || lower === "monday") return "Monday";
  if (lower === "tue" || lower === "tues" || lower === "tuesday") return "Tuesday";
  if (lower === "wed" || lower === "wednesday") return "Wednesday";
  if (lower === "thu" || lower === "thur" || lower === "thurs" || lower === "thursday") return "Thursday";
  if (lower === "fri" || lower === "friday") return "Friday";
  if (lower === "sat" || lower === "saturday") return "Saturday";
  if (lower === "sun" || lower === "sunday") return "Sunday";
  return value.trim();
}

function normalizeArray(values: unknown, normalizeValue?: (value: string) => string): string[] {
  const rawValues = Array.isArray(values)
    ? values
    : typeof values === "string"
      ? values
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      : [];

  const normalized = rawValues
    .map((value) => String(value).trim())
    .filter(Boolean)
    .map((value) => (normalizeValue ? normalizeValue(value) : value));

  return Array.from(new Set(normalized));
}

function deriveLast4(ssn: string | null) {
  if (!ssn) return null;
  const digits = ssn.replace(/\D/g, "");
  if (digits.length < 4) return null;
  return digits.slice(-4);
}

function joinParts(parts: Array<string | null | undefined>) {
  const values = parts.map((part) => clean(part)).filter((part): part is string => Boolean(part));
  return values.length > 0 ? values.join(" | ") : null;
}

export function getDefaultEnrollmentPacketIntakePayload(): EnrollmentPacketIntakePayload {
  const textEntries = ENROLLMENT_PACKET_INTAKE_TEXT_KEYS.map((key) => [key, null] as const);
  const arrayEntries = ENROLLMENT_PACKET_INTAKE_ARRAY_KEYS.map((key) => [key, [] as string[]] as const);
  return Object.fromEntries([...textEntries, ...arrayEntries]) as EnrollmentPacketIntakePayload;
}

export function normalizeEnrollmentPacketIntakePayload(raw: RawPayload | null | undefined): EnrollmentPacketIntakePayload {
  const normalized = getDefaultEnrollmentPacketIntakePayload();
  const source = raw ?? {};

  ENROLLMENT_PACKET_INTAKE_TEXT_KEYS.forEach((key) => {
    normalized[key] = clean(source[key]);
  });

  ENROLLMENT_PACKET_INTAKE_ARRAY_KEYS.forEach((key) => {
    if (key === "requestedAttendanceDays" || key === "membershipRequestedWeekdays") {
      normalized[key] = normalizeArray(source[key], normalizeDayLabel);
      return;
    }
    normalized[key] = normalizeArray(source[key]);
  });

  if (!normalized.memberSsnLast4) {
    normalized.memberSsnLast4 = deriveLast4(normalized.memberSsn);
  }

  if (!normalized.guardianPoaStatus) {
    normalized.guardianPoaStatus = normalized.memberRepresentativeGuardianPoa;
  }
  if (!normalized.memberRepresentativeGuardianPoa) {
    normalized.memberRepresentativeGuardianPoa = normalized.guardianPoaStatus;
  }

  if (!normalized.pcpName) normalized.pcpName = normalized.physicianName;
  if (!normalized.pcpPhone) normalized.pcpPhone = normalized.physicianPhone;
  if (!normalized.pcpFax) normalized.pcpFax = normalized.physicianFax;
  if (!normalized.pcpAddress) normalized.pcpAddress = normalized.physicianAddress;
  if (!normalized.physicianName) normalized.physicianName = normalized.pcpName;
  if (!normalized.physicianPhone) normalized.physicianPhone = normalized.pcpPhone;
  if (!normalized.physicianFax) normalized.physicianFax = normalized.pcpFax;
  if (!normalized.physicianAddress) normalized.physicianAddress = normalized.pcpAddress;

  if (!normalized.speechHearingVision) {
    normalized.speechHearingVision = joinParts([
      normalized.speech ? `Speech: ${normalized.speech}` : null,
      normalized.hearing ? `Hearing: ${normalized.hearing}` : null,
      normalized.vision ? `Vision: ${normalized.vision}` : null
    ]);
  }

  if (!normalized.glassesHearingAidsCataracts) {
    normalized.glassesHearingAidsCataracts = joinParts([
      normalized.glasses ? `Glasses: ${normalized.glasses}` : null,
      normalized.hearingAids ? `Hearing aids: ${normalized.hearingAids}` : null,
      normalized.cataracts ? `Cataracts: ${normalized.cataracts}` : null
    ]);
  }

  if (!normalized.dressingFeedingIndependence) {
    normalized.dressingFeedingIndependence = joinParts([
      normalized.dressesSelf ? `Dresses self: ${normalized.dressesSelf}` : null,
      normalized.feedsSelf ? `Feeds self: ${normalized.feedsSelf}` : null
    ]);
  }

  if (!normalized.membershipNumberOfDays && normalized.requestedAttendanceDays.length > 0) {
    normalized.membershipNumberOfDays = String(normalized.requestedAttendanceDays.length);
  }

  if (normalized.membershipRequestedWeekdays.length === 0 && normalized.requestedAttendanceDays.length > 0) {
    normalized.membershipRequestedWeekdays = [...normalized.requestedAttendanceDays];
  }

  return normalized;
}
