import type { EnrollmentPacketIntakeFieldKey, EnrollmentPacketIntakePayload } from "@/lib/services/enrollment-packet-intake-payload";

export type EnrollmentPacketSourceDocument =
  | "TS Welcome Checklist"
  | "Face Sheet and Biography"
  | "Membership Agreement"
  | "Membership Agreement Exhibit A"
  | "Notice of Privacy Practices"
  | "Statement of Rights of Adult Day Care Participants"
  | "Photo Consent"
  | "Ancillary Charges Notice"
  | "Insurance and POA Upload";

export type EnrollmentPacketFieldType =
  | "text"
  | "email"
  | "tel"
  | "date"
  | "number"
  | "textarea"
  | "select"
  | "radio"
  | "checkbox-group"
  | "weekday-group";

export type EnrollmentPacketFieldDefinition = {
  key: EnrollmentPacketIntakeFieldKey;
  label: string;
  type: EnrollmentPacketFieldType;
  sourceDocument: EnrollmentPacketSourceDocument;
  required?: boolean;
  staffPrepared?: boolean;
  placeholder?: string;
  options?: string[];
  columns?: 1 | 2;
};

export type EnrollmentPacketSectionDefinition = {
  id: string;
  title: string;
  description: string;
  sourceDocuments: EnrollmentPacketSourceDocument[];
  fields: EnrollmentPacketFieldDefinition[];
};

export type EnrollmentPacketUploadDefinition = {
  key:
    | "medicareCardUploads"
    | "privateInsuranceCardUploads"
    | "supplementalInsuranceCardUploads"
    | "poaGuardianshipUploads"
    | "advanceDirectiveUploads"
    | "supportingUploads";
  category:
    | "medicare_card"
    | "private_insurance"
    | "supplemental_insurance"
    | "poa_guardianship"
    | "dnr_dni_advance_directive"
    | "supporting";
  label: string;
  sourceDocument: EnrollmentPacketSourceDocument;
  required?: boolean;
};

const YES_NO_OPTIONS = ["Yes", "No"];

export const ENROLLMENT_PACKET_UPLOAD_FIELDS: EnrollmentPacketUploadDefinition[] = [
  {
    key: "medicareCardUploads",
    category: "medicare_card",
    label: "Medicare card",
    sourceDocument: "Insurance and POA Upload"
  },
  {
    key: "privateInsuranceCardUploads",
    category: "private_insurance",
    label: "Private insurance cards",
    sourceDocument: "Insurance and POA Upload"
  },
  {
    key: "supplementalInsuranceCardUploads",
    category: "supplemental_insurance",
    label: "Supplemental insurance cards",
    sourceDocument: "Insurance and POA Upload"
  },
  {
    key: "poaGuardianshipUploads",
    category: "poa_guardianship",
    label: "POA / guardianship paperwork",
    sourceDocument: "Insurance and POA Upload"
  },
  {
    key: "advanceDirectiveUploads",
    category: "dnr_dni_advance_directive",
    label: "DNR / DNI / advance directive paperwork",
    sourceDocument: "Insurance and POA Upload"
  },
  {
    key: "supportingUploads",
    category: "supporting",
    label: "Other supporting documents",
    sourceDocument: "Insurance and POA Upload"
  }
];

export const ENROLLMENT_PACKET_PERSONALITY_PAIR_OPTIONS = [
  "Quiet environments",
  "Social activities",
  "Structured routine",
  "Flexible routine",
  "One-on-one conversation",
  "Small group activities",
  "Morning preference",
  "Afternoon preference"
];

export const ENROLLMENT_PACKET_RECREATIONAL_INTEREST_OPTIONS = [
  "Arts and crafts",
  "Music and sing-alongs",
  "Games and puzzles",
  "Reading",
  "Faith-based activities",
  "Gardening",
  "Walking groups",
  "Movies",
  "Cooking",
  "Community outings"
];

export const ENROLLMENT_PACKET_SECTIONS: EnrollmentPacketSectionDefinition[] = [
  {
    id: "welcome",
    title: "Welcome & Instructions",
    description: "Review the packet overview and confirm the welcome checklist acknowledgment.",
    sourceDocuments: ["TS Welcome Checklist"],
    fields: [
      {
        key: "welcomeChecklistAcknowledgedName",
        label: "Checklist acknowledged by",
        type: "text",
        sourceDocument: "TS Welcome Checklist",
        required: true
      },
      {
        key: "welcomeChecklistAcknowledgedDate",
        label: "Checklist acknowledgment date",
        type: "date",
        sourceDocument: "TS Welcome Checklist",
        required: true
      }
    ]
  },
  {
    id: "member-demographics",
    title: "Member Demographics",
    description: "Member identity and demographic details from the Face Sheet and Biography.",
    sourceDocuments: ["Face Sheet and Biography"],
    fields: [
      { key: "memberLegalFirstName", label: "Member first name", type: "text", sourceDocument: "Face Sheet and Biography", required: true },
      { key: "memberLegalLastName", label: "Member last name", type: "text", sourceDocument: "Face Sheet and Biography", required: true },
      { key: "memberPreferredName", label: "Preferred name", type: "text", sourceDocument: "Face Sheet and Biography" },
      { key: "memberDob", label: "Date of birth", type: "date", sourceDocument: "Face Sheet and Biography", required: true },
      { key: "memberAge", label: "Age", type: "number", sourceDocument: "Face Sheet and Biography" },
      {
        key: "memberGender",
        label: "Gender",
        type: "select",
        sourceDocument: "Face Sheet and Biography",
        options: ["Male", "Female", "Non-binary", "Prefer not to say"]
      },
      { key: "memberSsn", label: "SSN", type: "text", sourceDocument: "Face Sheet and Biography" },
      { key: "maritalStatus", label: "Marital status", type: "text", sourceDocument: "Face Sheet and Biography" },
      { key: "memberAddressLine1", label: "Address line 1", type: "text", sourceDocument: "Face Sheet and Biography", columns: 2 },
      { key: "memberAddressLine2", label: "Address line 2", type: "text", sourceDocument: "Face Sheet and Biography", columns: 2 },
      { key: "memberCity", label: "City", type: "text", sourceDocument: "Face Sheet and Biography" },
      { key: "memberState", label: "State", type: "text", sourceDocument: "Face Sheet and Biography" },
      { key: "memberZip", label: "ZIP", type: "text", sourceDocument: "Face Sheet and Biography" }
    ]
  },
  {
    id: "schedule-transportation",
    title: "Schedule & Transportation",
    description: "Start date, attendance days, and transportation preferences.",
    sourceDocuments: ["Face Sheet and Biography", "Membership Agreement"],
    fields: [
      { key: "requestedStartDate", label: "Requested start date", type: "date", sourceDocument: "Face Sheet and Biography" },
      {
        key: "requestedAttendanceDays",
        label: "Days attending",
        type: "weekday-group",
        sourceDocument: "Face Sheet and Biography",
        required: true,
        staffPrepared: true
      },
      {
        key: "transportationPreference",
        label: "Transportation needed",
        type: "select",
        sourceDocument: "Face Sheet and Biography",
        options: ["Door to door", "Bus stop", "Family provided", "Not needed"],
        staffPrepared: true
      },
      {
        key: "membershipRequestedWeekdays",
        label: "Membership requested weekdays",
        type: "weekday-group",
        sourceDocument: "Membership Agreement",
        staffPrepared: true
      }
    ]
  },
  {
    id: "insurance-payment",
    title: "Insurance & Payment",
    description: "Insurance identifiers and payment context.",
    sourceDocuments: ["Face Sheet and Biography", "Membership Agreement Exhibit A"],
    fields: [
      { key: "medicareNumber", label: "Medicare number", type: "text", sourceDocument: "Face Sheet and Biography" },
      { key: "privateInsuranceName", label: "Private insurance name", type: "text", sourceDocument: "Face Sheet and Biography" },
      { key: "privateInsurancePolicyNumber", label: "Private insurance policy number", type: "text", sourceDocument: "Face Sheet and Biography" },
      { key: "veteranStatus", label: "Veteran benefits", type: "radio", sourceDocument: "Face Sheet and Biography", options: YES_NO_OPTIONS },
      {
        key: "communityFee",
        label: "Community fee",
        type: "number",
        sourceDocument: "Membership Agreement Exhibit A",
        staffPrepared: true
      },
      { key: "totalInitialEnrollmentAmount", label: "Total initial enrollment amount", type: "number", sourceDocument: "Membership Agreement Exhibit A" }
    ]
  },
  {
    id: "emergency-contact",
    title: "Emergency / Contact Information",
    description: "Responsible party, guardian, and emergency contacts.",
    sourceDocuments: ["Face Sheet and Biography"],
    fields: [
      { key: "memberRepresentativeGuardianPoa", label: "Member representative / guardian / POA", type: "text", sourceDocument: "Face Sheet and Biography", columns: 2 },
      { key: "referredBy", label: "Referred by", type: "text", sourceDocument: "Face Sheet and Biography", columns: 2 },
      { key: "primaryContactName", label: "Primary contact name", type: "text", sourceDocument: "Face Sheet and Biography", required: true },
      { key: "primaryContactRelationship", label: "Primary contact relationship", type: "text", sourceDocument: "Face Sheet and Biography" },
      { key: "primaryContactPhone", label: "Primary contact phone", type: "tel", sourceDocument: "Face Sheet and Biography", required: true },
      { key: "primaryContactEmail", label: "Primary contact email", type: "email", sourceDocument: "Face Sheet and Biography", required: true },
      { key: "secondaryContactName", label: "Secondary contact name", type: "text", sourceDocument: "Face Sheet and Biography" },
      { key: "secondaryContactRelationship", label: "Secondary contact relationship", type: "text", sourceDocument: "Face Sheet and Biography" },
      { key: "secondaryContactPhone", label: "Secondary contact phone", type: "tel", sourceDocument: "Face Sheet and Biography" },
      { key: "secondaryContactEmail", label: "Secondary contact email", type: "email", sourceDocument: "Face Sheet and Biography" }
    ]
  },
  {
    id: "care-coordination",
    title: "Care Coordination",
    description: "Primary providers and care coordination details.",
    sourceDocuments: ["Face Sheet and Biography", "Membership Agreement"],
    fields: [
      { key: "pcpName", label: "PCP / physician name", type: "text", sourceDocument: "Face Sheet and Biography", columns: 2 },
      { key: "pcpPhone", label: "PCP / physician phone", type: "tel", sourceDocument: "Face Sheet and Biography" },
      { key: "pcpFax", label: "PCP / physician fax", type: "text", sourceDocument: "Face Sheet and Biography" },
      { key: "pcpAddress", label: "PCP / physician address", type: "textarea", sourceDocument: "Face Sheet and Biography", columns: 2 },
      { key: "pharmacy", label: "Pharmacy", type: "text", sourceDocument: "Face Sheet and Biography" },
      { key: "hospitalPreference", label: "Hospital preference", type: "text", sourceDocument: "Face Sheet and Biography" },
      { key: "membershipMemberInfoBlock", label: "Membership agreement member info block", type: "textarea", sourceDocument: "Membership Agreement", columns: 2 }
    ]
  },
  {
    id: "living-situation",
    title: "Living Situation",
    description: "Home/living context and support environment.",
    sourceDocuments: ["Face Sheet and Biography"],
    fields: [
      { key: "livingSituation", label: "Living situation", type: "textarea", sourceDocument: "Face Sheet and Biography", columns: 2 },
      { key: "spousePartner", label: "Spouse / partner", type: "text", sourceDocument: "Face Sheet and Biography" },
      { key: "childrenGrandchildren", label: "Children / grandchildren", type: "textarea", sourceDocument: "Face Sheet and Biography", columns: 2 },
      { key: "importantPeople", label: "Important people", type: "textarea", sourceDocument: "Face Sheet and Biography", columns: 2 },
      { key: "pets", label: "Pets", type: "textarea", sourceDocument: "Face Sheet and Biography", columns: 2 }
    ]
  },
  {
    id: "health-abilities",
    title: "Health & Abilities",
    description: "Clinical profile and overall functioning.",
    sourceDocuments: ["Face Sheet and Biography"],
    fields: [
      { key: "medicationNeededDuringDay", label: "Medication needed during day", type: "radio", sourceDocument: "Face Sheet and Biography", options: YES_NO_OPTIONS },
      { key: "oxygenUse", label: "Oxygen daily", type: "radio", sourceDocument: "Face Sheet and Biography", options: YES_NO_OPTIONS },
      { key: "mentalHealthHistory", label: "Mental health history", type: "textarea", sourceDocument: "Face Sheet and Biography", columns: 2 },
      { key: "ptsdHistory", label: "PTSD history", type: "textarea", sourceDocument: "Face Sheet and Biography", columns: 2 },
      { key: "memoryStage", label: "Memory stage", type: "text", sourceDocument: "Face Sheet and Biography" },
      { key: "fallsHistory", label: "History of falls", type: "textarea", sourceDocument: "Face Sheet and Biography", columns: 2 },
      { key: "physicalHealthProblems", label: "Physical health problems", type: "textarea", sourceDocument: "Face Sheet and Biography", columns: 2 },
      { key: "behavioralNotes", label: "Behavioral notes", type: "textarea", sourceDocument: "Face Sheet and Biography", columns: 2 },
      { key: "communicationStyle", label: "Communication style", type: "textarea", sourceDocument: "Face Sheet and Biography", columns: 2 },
      { key: "intakeClinicalNotes", label: "Care coordination notes", type: "textarea", sourceDocument: "Face Sheet and Biography", columns: 2 }
    ]
  },
  {
    id: "adl-support",
    title: "ADLs / Functional Support",
    description: "Functional support and ADL needs.",
    sourceDocuments: ["Face Sheet and Biography"],
    fields: [
      { key: "mobilityTransferStatus", label: "Walking / transferring", type: "text", sourceDocument: "Face Sheet and Biography" },
      { key: "caneWalkerUse", label: "Cane / walker", type: "text", sourceDocument: "Face Sheet and Biography" },
      { key: "wheelchairUse", label: "Wheelchair", type: "text", sourceDocument: "Face Sheet and Biography" },
      { key: "toiletingBathingAssistance", label: "Toileting / bathing", type: "text", sourceDocument: "Face Sheet and Biography" },
      { key: "continenceStatus", label: "Incontinence", type: "text", sourceDocument: "Face Sheet and Biography" },
      { key: "incontinenceProducts", label: "Incontinence products / type", type: "text", sourceDocument: "Face Sheet and Biography" },
      { key: "dressesSelf", label: "Dresses self", type: "radio", sourceDocument: "Face Sheet and Biography", options: YES_NO_OPTIONS },
      { key: "feedsSelf", label: "Feeds self", type: "radio", sourceDocument: "Face Sheet and Biography", options: YES_NO_OPTIONS },
      { key: "dietaryRestrictions", label: "Dietary restrictions", type: "textarea", sourceDocument: "Face Sheet and Biography", columns: 2 },
      { key: "dentures", label: "Dentures", type: "radio", sourceDocument: "Face Sheet and Biography", options: YES_NO_OPTIONS },
      { key: "speech", label: "Speech", type: "text", sourceDocument: "Face Sheet and Biography" },
      { key: "hearing", label: "Hearing", type: "text", sourceDocument: "Face Sheet and Biography" },
      { key: "hearingAids", label: "Hearing aids", type: "radio", sourceDocument: "Face Sheet and Biography", options: YES_NO_OPTIONS },
      { key: "vision", label: "Vision", type: "text", sourceDocument: "Face Sheet and Biography" },
      { key: "glasses", label: "Glasses", type: "radio", sourceDocument: "Face Sheet and Biography", options: YES_NO_OPTIONS },
      { key: "cataracts", label: "Cataracts", type: "radio", sourceDocument: "Face Sheet and Biography", options: YES_NO_OPTIONS }
    ]
  },
  {
    id: "home-environment",
    title: "Home Environment",
    description: "Home accessibility and safety setup.",
    sourceDocuments: ["Face Sheet and Biography"],
    fields: [
      { key: "stepsOutside", label: "Steps outside", type: "text", sourceDocument: "Face Sheet and Biography" },
      { key: "stepsInside", label: "Steps inside", type: "text", sourceDocument: "Face Sheet and Biography" },
      { key: "bedBathSameFloor", label: "Bed and bath on same floor", type: "radio", sourceDocument: "Face Sheet and Biography", options: YES_NO_OPTIONS },
      { key: "safetyBars", label: "Safety bars", type: "radio", sourceDocument: "Face Sheet and Biography", options: YES_NO_OPTIONS },
      { key: "showerChair", label: "Shower chair", type: "radio", sourceDocument: "Face Sheet and Biography", options: YES_NO_OPTIONS }
    ]
  },
  {
    id: "background-biography",
    title: "Background & Biography",
    description: "Biography details to personalize care and programming.",
    sourceDocuments: ["Face Sheet and Biography"],
    fields: [
      { key: "militaryWarService", label: "Military / war service", type: "textarea", sourceDocument: "Face Sheet and Biography", columns: 2 },
      { key: "religion", label: "Religion", type: "text", sourceDocument: "Face Sheet and Biography" },
      { key: "pastOccupation", label: "Past occupation", type: "text", sourceDocument: "Face Sheet and Biography" },
      { key: "nickname", label: "Nickname", type: "text", sourceDocument: "Face Sheet and Biography" }
    ]
  },
  {
    id: "likes-lifestyle",
    title: "Personal Likes / Lifestyle",
    description: "Preferences, personality, and recreational interests.",
    sourceDocuments: ["Face Sheet and Biography"],
    fields: [
      { key: "favoriteMusic", label: "Favorite music", type: "text", sourceDocument: "Face Sheet and Biography" },
      { key: "favoriteSong", label: "Favorite song", type: "text", sourceDocument: "Face Sheet and Biography" },
      { key: "favoriteTv", label: "Favorite TV", type: "text", sourceDocument: "Face Sheet and Biography" },
      { key: "favoriteMovie", label: "Favorite movie", type: "text", sourceDocument: "Face Sheet and Biography" },
      { key: "favoriteBook", label: "Favorite book", type: "text", sourceDocument: "Face Sheet and Biography" },
      { key: "favoriteHoliday", label: "Favorite holiday", type: "text", sourceDocument: "Face Sheet and Biography" },
      { key: "favoritePlace", label: "Favorite place", type: "text", sourceDocument: "Face Sheet and Biography" },
      { key: "favoriteColor", label: "Favorite color", type: "text", sourceDocument: "Face Sheet and Biography" },
      { key: "favoriteHobby", label: "Favorite hobby", type: "text", sourceDocument: "Face Sheet and Biography" },
      { key: "favoriteSport", label: "Favorite sport", type: "text", sourceDocument: "Face Sheet and Biography" },
      { key: "favoriteExercise", label: "Favorite exercise", type: "text", sourceDocument: "Face Sheet and Biography" },
      { key: "favoriteSeason", label: "Favorite season", type: "text", sourceDocument: "Face Sheet and Biography" },
      {
        key: "personalityPreferencePairs",
        label: "Personality preference pairs",
        type: "checkbox-group",
        sourceDocument: "Face Sheet and Biography",
        options: ENROLLMENT_PACKET_PERSONALITY_PAIR_OPTIONS,
        columns: 2
      },
      {
        key: "recreationalInterests",
        label: "Recreational interests",
        type: "checkbox-group",
        sourceDocument: "Face Sheet and Biography",
        options: ENROLLMENT_PACKET_RECREATIONAL_INTEREST_OPTIONS,
        columns: 2
      }
    ]
  },
  {
    id: "membership-agreement",
    title: "Membership Agreement",
    description: "Guarantor and scheduling terms.",
    sourceDocuments: ["Membership Agreement"],
    fields: [
      { key: "responsiblePartyGuarantorFirstName", label: "Responsible party / guarantor first name", type: "text", sourceDocument: "Membership Agreement", required: true },
      { key: "responsiblePartyGuarantorLastName", label: "Responsible party / guarantor last name", type: "text", sourceDocument: "Membership Agreement", required: true },
      { key: "responsiblePartyGuarantorDob", label: "Responsible party DOB", type: "date", sourceDocument: "Membership Agreement" },
      { key: "responsiblePartyGuarantorSsn", label: "Responsible party SSN", type: "text", sourceDocument: "Membership Agreement" },
      { key: "membershipNumberOfDays", label: "Number of days", type: "number", sourceDocument: "Membership Agreement", staffPrepared: true },
      { key: "membershipDailyAmount", label: "Daily amount", type: "number", sourceDocument: "Membership Agreement", staffPrepared: true },
      { key: "guarantorSignatureName", label: "Guarantor signature", type: "text", sourceDocument: "Membership Agreement", required: true },
      { key: "guarantorSignatureDate", label: "Guarantor signature date", type: "date", sourceDocument: "Membership Agreement", required: true }
    ]
  },
  {
    id: "exhibit-a",
    title: "Exhibit A Payment Authorization",
    description: "Payment method and authorization details.",
    sourceDocuments: ["Membership Agreement Exhibit A"],
    fields: [
      { key: "communityFee", label: "Community fee", type: "number", sourceDocument: "Membership Agreement Exhibit A", staffPrepared: true },
      { key: "totalInitialEnrollmentAmount", label: "Total initial enrollment amount", type: "number", sourceDocument: "Membership Agreement Exhibit A", required: true },
      { key: "paymentMethodSelection", label: "Payment method", type: "select", sourceDocument: "Membership Agreement Exhibit A", options: ["ACH", "Credit Card", "Check"] },
      { key: "bankName", label: "Bank name", type: "text", sourceDocument: "Membership Agreement Exhibit A" },
      { key: "bankCityStateZip", label: "Bank city/state/zip", type: "text", sourceDocument: "Membership Agreement Exhibit A" },
      { key: "bankAba", label: "ABA", type: "text", sourceDocument: "Membership Agreement Exhibit A" },
      { key: "bankAccountNumber", label: "Account number", type: "text", sourceDocument: "Membership Agreement Exhibit A" },
      { key: "cardholderName", label: "Cardholder name", type: "text", sourceDocument: "Membership Agreement Exhibit A" },
      { key: "cardType", label: "Card type", type: "text", sourceDocument: "Membership Agreement Exhibit A" },
      { key: "cardNumber", label: "Card number", type: "text", sourceDocument: "Membership Agreement Exhibit A" },
      { key: "cardExpiration", label: "Expiration", type: "text", sourceDocument: "Membership Agreement Exhibit A" },
      { key: "cardCvv", label: "CVV", type: "text", sourceDocument: "Membership Agreement Exhibit A" },
      { key: "cardBillingAddress", label: "Billing address", type: "textarea", sourceDocument: "Membership Agreement Exhibit A", columns: 2 }
    ]
  },
  {
    id: "privacy-practices",
    title: "Privacy Practices Acknowledgment",
    description: "Notice of Privacy Practices acknowledgment.",
    sourceDocuments: ["Notice of Privacy Practices"],
    fields: [
      {
        key: "privacyAcknowledgmentSignatureName",
        label: "Acknowledgment signature",
        type: "text",
        sourceDocument: "Notice of Privacy Practices",
        required: true
      },
      {
        key: "privacyAcknowledgmentSignatureDate",
        label: "Acknowledgment date",
        type: "date",
        sourceDocument: "Notice of Privacy Practices",
        required: true
      }
    ]
  },
  {
    id: "statement-of-rights",
    title: "Statement of Rights Acknowledgment",
    description: "Statement of Rights acknowledgment.",
    sourceDocuments: ["Statement of Rights of Adult Day Care Participants"],
    fields: [
      {
        key: "rightsAcknowledgmentSignatureName",
        label: "Acknowledgment signature",
        type: "text",
        sourceDocument: "Statement of Rights of Adult Day Care Participants",
        required: true
      },
      {
        key: "rightsAcknowledgmentSignatureDate",
        label: "Acknowledgment date",
        type: "date",
        sourceDocument: "Statement of Rights of Adult Day Care Participants",
        required: true
      }
    ]
  },
  {
    id: "photo-consent",
    title: "Photo Consent",
    description: "Photo consent choices and acknowledgment.",
    sourceDocuments: ["Photo Consent"],
    fields: [
      {
        key: "photoConsentChoice",
        label: "Photo consent",
        type: "radio",
        sourceDocument: "Photo Consent",
        options: ["Yes, consent granted", "No, consent declined"],
        required: true
      },
      { key: "photoConsentAcknowledgmentName", label: "Responsible party / guarantor acknowledgment", type: "text", sourceDocument: "Photo Consent", required: true },
      { key: "photoConsentMemberName", label: "Member name", type: "text", sourceDocument: "Photo Consent", required: true }
    ]
  },
  {
    id: "ancillary-charges",
    title: "Ancillary Charges Notice",
    description: "Ancillary charges acknowledgment.",
    sourceDocuments: ["Ancillary Charges Notice"],
    fields: [
      {
        key: "ancillaryChargesAcknowledgmentSignatureName",
        label: "Acknowledgment signature",
        type: "text",
        sourceDocument: "Ancillary Charges Notice",
        required: true
      },
      {
        key: "ancillaryChargesAcknowledgmentSignatureDate",
        label: "Acknowledgment date",
        type: "date",
        sourceDocument: "Ancillary Charges Notice",
        required: true
      }
    ]
  },
  {
    id: "signatures",
    title: "Signatures & Final Notes",
    description: "Final review before signing and submitting the packet.",
    sourceDocuments: ["Membership Agreement", "Membership Agreement Exhibit A"],
    fields: [
      { key: "additionalNotes", label: "Additional notes", type: "textarea", sourceDocument: "Membership Agreement", columns: 2 }
    ]
  }
];

export function formatEnrollmentPacketValue(value: string | string[] | null | undefined) {
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(", ") : "-";
  }
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : "-";
  }
  return "-";
}

export function getEnrollmentPacketFieldDisplayValue(
  payload: EnrollmentPacketIntakePayload,
  field: EnrollmentPacketFieldDefinition
) {
  return formatEnrollmentPacketValue(payload[field.key]);
}
