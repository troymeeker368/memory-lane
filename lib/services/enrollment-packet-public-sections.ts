import {
  ENROLLMENT_PACKET_ADL_AMBULATION_OPTIONS,
  ENROLLMENT_PACKET_ADL_BATHING_OPTIONS,
  ENROLLMENT_PACKET_ADL_DRESSING_OPTIONS,
  ENROLLMENT_PACKET_ADL_EATING_OPTIONS,
  ENROLLMENT_PACKET_ADL_TOILETING_OPTIONS,
  ENROLLMENT_PACKET_ADL_TRANSFER_OPTIONS,
  ENROLLMENT_PACKET_BEHAVIORAL_OPTIONS,
  ENROLLMENT_PACKET_CONTINENCE_OPTIONS,
  ENROLLMENT_PACKET_DENTURE_OPTIONS,
  ENROLLMENT_PACKET_HEARING_OPTIONS,
  ENROLLMENT_PACKET_LIVING_SITUATION_OPTIONS,
  ENROLLMENT_PACKET_MEMORY_STAGE_OPTIONS,
  ENROLLMENT_PACKET_PET_OPTIONS,
  ENROLLMENT_PACKET_PHOTO_CONSENT_OPTIONS,
  ENROLLMENT_PACKET_VETERAN_BRANCH_OPTIONS,
  YES_NO_OPTIONS
} from "@/lib/services/enrollment-packet-public-options";
import {
  ENROLLMENT_PACKET_CARD_TYPE_OPTIONS,
  ENROLLMENT_PACKET_NOTICE_ACKNOWLEDGMENTS,
  ENROLLMENT_PACKET_PAYMENT_METHOD_OPTIONS
} from "@/lib/services/enrollment-packet-payment-consent";
import {
  ENROLLMENT_PACKET_RECREATION_CATEGORIES
} from "@/lib/services/enrollment-packet-recreation";
import type { EnrollmentPacketSectionDefinition } from "@/lib/services/enrollment-packet-public-types";

export const ENROLLMENT_PACKET_SECTIONS: EnrollmentPacketSectionDefinition[] = [
  {
    id: "member-demographics",
    title: "Member Demographics",
    description: "Member identity and address information.",
    sourceDocuments: ["Face Sheet and Biography"],
    fields: [
      { key: "memberLegalFirstName", label: "Member first name", type: "text", sourceDocument: "Face Sheet and Biography", required: true },
      { key: "memberLegalLastName", label: "Member last name", type: "text", sourceDocument: "Face Sheet and Biography", required: true },
      { key: "memberDob", label: "Date of birth", type: "date", sourceDocument: "Face Sheet and Biography", required: true },
      { key: "memberGender", label: "Gender", type: "select", sourceDocument: "Face Sheet and Biography", options: ["Male", "Female", "Non-binary", "Prefer not to say"], required: true },
      { key: "memberAddressLine1", label: "Address", type: "text", sourceDocument: "Face Sheet and Biography", required: true, columns: 2 },
      { key: "memberCity", label: "City", type: "text", sourceDocument: "Face Sheet and Biography", required: true },
      { key: "memberState", label: "State", type: "text", sourceDocument: "Face Sheet and Biography", required: true },
      { key: "memberZip", label: "ZIP", type: "text", sourceDocument: "Face Sheet and Biography", required: true }
    ]
  },
  {
    id: "primary-contact",
    title: "Primary Contact",
    description: "Required contact for daily communication.",
    sourceDocuments: ["Face Sheet and Biography"],
    fields: [
      { key: "primaryContactName", label: "Name", type: "text", sourceDocument: "Face Sheet and Biography", required: true },
      { key: "primaryContactRelationship", label: "Relationship", type: "text", sourceDocument: "Face Sheet and Biography", required: true },
      { key: "primaryContactPhone", label: "Phone", type: "tel", sourceDocument: "Face Sheet and Biography", required: true },
      { key: "primaryContactEmail", label: "Email", type: "email", sourceDocument: "Face Sheet and Biography", required: true },
      { key: "primaryContactAddressLine1", label: "Street Address", type: "text", sourceDocument: "Face Sheet and Biography", required: true, columns: 2 },
      { key: "primaryContactCity", label: "City / Town", type: "text", sourceDocument: "Face Sheet and Biography", required: true },
      { key: "primaryContactState", label: "State", type: "text", sourceDocument: "Face Sheet and Biography", required: true },
      { key: "primaryContactZip", label: "ZIP Code", type: "text", sourceDocument: "Face Sheet and Biography", required: true }
    ]
  },
  {
    id: "secondary-contact",
    title: "Secondary Contact",
    description: "Required backup contact.",
    sourceDocuments: ["Face Sheet and Biography"],
    fields: [
      { key: "secondaryContactName", label: "Name", type: "text", sourceDocument: "Face Sheet and Biography", required: true },
      { key: "secondaryContactRelationship", label: "Relationship", type: "text", sourceDocument: "Face Sheet and Biography", required: true },
      { key: "secondaryContactPhone", label: "Phone", type: "tel", sourceDocument: "Face Sheet and Biography", required: true },
      { key: "secondaryContactEmail", label: "Email", type: "email", sourceDocument: "Face Sheet and Biography", required: true },
      { key: "secondaryContactAddressLine1", label: "Street Address", type: "text", sourceDocument: "Face Sheet and Biography", required: true, columns: 2 },
      { key: "secondaryContactCity", label: "City / Town", type: "text", sourceDocument: "Face Sheet and Biography", required: true },
      { key: "secondaryContactState", label: "State", type: "text", sourceDocument: "Face Sheet and Biography", required: true },
      { key: "secondaryContactZip", label: "ZIP Code", type: "text", sourceDocument: "Face Sheet and Biography", required: true }
    ]
  },
  {
    id: "living-situation",
    title: "Living Situation",
    description: "Current living arrangement and supports.",
    sourceDocuments: ["Face Sheet and Biography"],
    fields: [
      { key: "livingSituationOptions", label: "Living situation", type: "checkbox-group", sourceDocument: "Face Sheet and Biography", options: ENROLLMENT_PACKET_LIVING_SITUATION_OPTIONS, columns: 2 },
      { key: "livingSituationOther", label: "Living situation (other)", type: "text", sourceDocument: "Face Sheet and Biography", columns: 2 },
      { key: "petTypes", label: "Pets", type: "checkbox-group", sourceDocument: "Face Sheet and Biography", options: ENROLLMENT_PACKET_PET_OPTIONS },
      { key: "petNames", label: "Pet names", type: "text", sourceDocument: "Face Sheet and Biography", columns: 2 }
    ]
  },
  {
    id: "medical-information",
    title: "Medical Information",
    description: "Insurance, medications, oxygen use, falls, and related health details.",
    sourceDocuments: ["Face Sheet and Biography"],
    fields: [
      { key: "referredBy", label: "Referred by", type: "text", sourceDocument: "Face Sheet and Biography", staffPrepared: true, columns: 2 },
      { key: "medicareNumber", label: "Medicare number", type: "text", sourceDocument: "Face Sheet and Biography" },
      { key: "privateInsuranceName", label: "Private insurance name", type: "text", sourceDocument: "Face Sheet and Biography" },
      { key: "privateInsurancePolicyNumber", label: "Private insurance policy number", type: "text", sourceDocument: "Face Sheet and Biography" },
      { key: "vaBenefits", label: "VA benefits", type: "radio", sourceDocument: "Face Sheet and Biography", options: YES_NO_OPTIONS },
      { key: "tricareNumber", label: "Tricare number", type: "text", sourceDocument: "Face Sheet and Biography" },
      { key: "medicationNeededDuringDay", label: "Medication needed during the day", type: "radio", sourceDocument: "Face Sheet and Biography", options: YES_NO_OPTIONS },
      { key: "medicationNamesDuringDay", label: "Medication names", type: "text", sourceDocument: "Face Sheet and Biography", columns: 2 },
      { key: "oxygenUse", label: "Uses oxygen daily", type: "radio", sourceDocument: "Face Sheet and Biography", options: YES_NO_OPTIONS },
      { key: "oxygenFlowRate", label: "Oxygen flow rate", type: "text", sourceDocument: "Face Sheet and Biography" },
      { key: "fallsHistory", label: "History of falls", type: "radio", sourceDocument: "Face Sheet and Biography", options: YES_NO_OPTIONS },
      { key: "fallsWithinLast3Months", label: "Any falls within the last 3 months?", type: "radio", sourceDocument: "Face Sheet and Biography", options: YES_NO_OPTIONS },
      { key: "physicalHealthProblems", label: "Physical health problems", type: "textarea", sourceDocument: "Face Sheet and Biography", columns: 2 }
    ]
  },
  {
    id: "functional-status-adls",
    title: "Functional Status / ADLs",
    description: "Daily functioning levels used for MHP and POF.",
    sourceDocuments: ["Face Sheet and Biography"],
    fields: [
      { key: "adlMobilityLevel", label: "Ambulation", type: "select", sourceDocument: "Face Sheet and Biography", options: ENROLLMENT_PACKET_ADL_AMBULATION_OPTIONS },
      { key: "adlTransferLevel", label: "Transfers", type: "select", sourceDocument: "Face Sheet and Biography", options: ENROLLMENT_PACKET_ADL_TRANSFER_OPTIONS },
      { key: "adlToiletingLevel", label: "Toileting", type: "select", sourceDocument: "Face Sheet and Biography", options: ENROLLMENT_PACKET_ADL_TOILETING_OPTIONS },
      { key: "adlBathingLevel", label: "Bathing", type: "select", sourceDocument: "Face Sheet and Biography", options: ENROLLMENT_PACKET_ADL_BATHING_OPTIONS },
      { key: "adlDressingLevel", label: "Dressing", type: "select", sourceDocument: "Face Sheet and Biography", options: ENROLLMENT_PACKET_ADL_DRESSING_OPTIONS },
      { key: "adlEatingLevel", label: "Eating", type: "select", sourceDocument: "Face Sheet and Biography", options: ENROLLMENT_PACKET_ADL_EATING_OPTIONS },
      { key: "continenceSelections", label: "Continence", type: "checkbox-group", sourceDocument: "Face Sheet and Biography", options: ENROLLMENT_PACKET_CONTINENCE_OPTIONS, columns: 2 },
      { key: "dentures", label: "Does the participant wear dentures?", type: "radio", sourceDocument: "Face Sheet and Biography", options: YES_NO_OPTIONS },
      { key: "dentureTypes", label: "Dentures", type: "checkbox-group", sourceDocument: "Face Sheet and Biography", options: ENROLLMENT_PACKET_DENTURE_OPTIONS },
      { key: "hearingStatus", label: "Hearing", type: "select", sourceDocument: "Face Sheet and Biography", options: ENROLLMENT_PACKET_HEARING_OPTIONS },
      { key: "memoryStage", label: "Memory stage", type: "select", sourceDocument: "Face Sheet and Biography", options: ENROLLMENT_PACKET_MEMORY_STAGE_OPTIONS }
    ]
  },
  {
    id: "behavioral-cognitive-status",
    title: "Behavioral & Cognitive Status",
    description: "Observed behavioral and cognitive concerns.",
    sourceDocuments: ["Face Sheet and Biography"],
    fields: [
      { key: "behavioralObservations", label: "Behavioral observations", type: "checkbox-group", sourceDocument: "Face Sheet and Biography", options: ENROLLMENT_PACKET_BEHAVIORAL_OPTIONS, columns: 2 },
      { key: "communicationStyle", label: "Communication style", type: "text", sourceDocument: "Face Sheet and Biography", columns: 2 }
    ]
  },
  {
    id: "recreation-interests",
    title: "Recreation Interests",
    description: "Interests used to personalize member programming.",
    sourceDocuments: ["Face Sheet and Biography"],
    fields: [
      {
        key: "recreationInterests",
        label: "Recreation interests",
        type: "categorized-checkbox-group",
        sourceDocument: "Face Sheet and Biography",
        options: [...ENROLLMENT_PACKET_RECREATION_CATEGORIES],
        required: true,
        columns: 2
      }
    ]
  },
  {
    id: "veteran-status",
    title: "Veteran Status",
    description: "Military background details.",
    sourceDocuments: ["Face Sheet and Biography"],
    fields: [
      { key: "veteranStatus", label: "Is the participant a veteran?", type: "radio", sourceDocument: "Face Sheet and Biography", options: YES_NO_OPTIONS },
      { key: "branchOfService", label: "Veteran service branch", type: "select", sourceDocument: "Face Sheet and Biography", options: ENROLLMENT_PACKET_VETERAN_BRANCH_OPTIONS }
    ]
  },
  {
    id: "pcp-pharmacy",
    title: "PCP & Pharmacy",
    description: "Primary provider and pharmacy contact details.",
    sourceDocuments: ["Face Sheet and Biography"],
    fields: [
      { key: "pcpName", label: "PCP name", type: "text", sourceDocument: "Face Sheet and Biography", required: true },
      { key: "pcpAddress", label: "PCP address", type: "text", sourceDocument: "Face Sheet and Biography", required: true, columns: 2 },
      { key: "pcpPhone", label: "PCP phone", type: "tel", sourceDocument: "Face Sheet and Biography", required: true },
      { key: "pharmacy", label: "Pharmacy name", type: "text", sourceDocument: "Face Sheet and Biography", required: true },
      { key: "pharmacyAddress", label: "Pharmacy address", type: "text", sourceDocument: "Face Sheet and Biography", required: true, columns: 2 },
      { key: "pharmacyPhone", label: "Pharmacy phone", type: "tel", sourceDocument: "Face Sheet and Biography", required: true }
    ]
  },
  {
    id: "payment-membership",
    title: "Payment & Membership Agreement",
    description: "Membership terms and packet pricing prepared by staff.",
    sourceDocuments: ["Membership Agreement"],
    fields: [
      { key: "requestedStartDate", label: "Requested start date", type: "date", sourceDocument: "Membership Agreement", required: true, staffPrepared: true },
      { key: "membershipNumberOfDays", label: "Number of days", type: "number", sourceDocument: "Membership Agreement", staffPrepared: true },
      { key: "membershipDailyAmount", label: "Daily amount", type: "number", sourceDocument: "Membership Agreement", staffPrepared: true },
      { key: "communityFee", label: "Community fee", type: "number", sourceDocument: "Membership Agreement", staffPrepared: true },
      { key: "totalInitialEnrollmentAmount", label: "Total initial enrollment amount", type: "number", sourceDocument: "Membership Agreement", required: true, staffPrepared: true },
      { key: "membershipGuarantorSignatureName", label: "Membership Agreement signature", type: "text", sourceDocument: "Membership Agreement", required: true },
      { key: "membershipGuarantorSignatureDate", label: "Membership Agreement signature date", type: "date", sourceDocument: "Membership Agreement", required: true }
    ]
  },
  {
    id: "exhibit-a",
    title: "Exhibit A - Payment Authorization",
    description: "ACH or credit card authorization.",
    sourceDocuments: ["Membership Agreement Exhibit A"],
    fields: [
      { key: "paymentMethodSelection", label: "Payment method", type: "radio", sourceDocument: "Membership Agreement Exhibit A", options: [...ENROLLMENT_PACKET_PAYMENT_METHOD_OPTIONS], required: true },
      { key: "bankName", label: "Bank name", type: "text", sourceDocument: "Membership Agreement Exhibit A" },
      { key: "bankCityStateZip", label: "Bank city / state / ZIP", type: "text", sourceDocument: "Membership Agreement Exhibit A", columns: 2 },
      { key: "bankAba", label: "Routing number", type: "text", sourceDocument: "Membership Agreement Exhibit A" },
      { key: "bankAccountNumber", label: "Account number", type: "text", sourceDocument: "Membership Agreement Exhibit A" },
      { key: "cardholderName", label: "Cardholder name", type: "text", sourceDocument: "Membership Agreement Exhibit A", columns: 2 },
      { key: "cardType", label: "Card type", type: "radio", sourceDocument: "Membership Agreement Exhibit A", options: [...ENROLLMENT_PACKET_CARD_TYPE_OPTIONS] },
      { key: "cardNumber", label: "Card number", type: "text", sourceDocument: "Membership Agreement Exhibit A" },
      { key: "cardExpiration", label: "Expiration", type: "text", sourceDocument: "Membership Agreement Exhibit A" },
      { key: "cardCvv", label: "CVV", type: "text", sourceDocument: "Membership Agreement Exhibit A" },
      { key: "cardUsePrimaryContactAddress", label: "Use Primary Contact Address as Billing Address", type: "radio", sourceDocument: "Membership Agreement Exhibit A", options: YES_NO_OPTIONS },
      { key: "cardBillingAddressLine1", label: "Billing street address", type: "text", sourceDocument: "Membership Agreement Exhibit A", columns: 2 },
      { key: "cardBillingCity", label: "Billing city / town", type: "text", sourceDocument: "Membership Agreement Exhibit A" },
      { key: "cardBillingState", label: "Billing state", type: "text", sourceDocument: "Membership Agreement Exhibit A" },
      { key: "cardBillingZip", label: "Billing ZIP code", type: "text", sourceDocument: "Membership Agreement Exhibit A" },
      { key: "exhibitAGuarantorSignatureName", label: "Exhibit A responsible party / guarantor acknowledgement name", type: "text", sourceDocument: "Membership Agreement Exhibit A", required: true }
    ]
  },
  {
    id: "privacy-practices",
    title: "Privacy Practices Acknowledgement",
    description: "Notice of privacy practices acknowledgement.",
    sourceDocuments: ["Notice of Privacy Practices"],
    fields: [
      {
        key: ENROLLMENT_PACKET_NOTICE_ACKNOWLEDGMENTS[0].nameKey,
        label: "Privacy practices acknowledgement name",
        type: "text",
        sourceDocument: "Notice of Privacy Practices",
        required: true
      },
      {
        key: ENROLLMENT_PACKET_NOTICE_ACKNOWLEDGMENTS[0].dateKey,
        label: "Privacy practices acknowledgement date",
        type: "date",
        sourceDocument: "Notice of Privacy Practices",
        required: true
      }
    ]
  },
  {
    id: "statement-of-rights",
    title: "Statement of Rights",
    description: "Participant rights acknowledgement.",
    sourceDocuments: ["Statement of Rights of Adult Day Care Participants"],
    fields: [
      {
        key: ENROLLMENT_PACKET_NOTICE_ACKNOWLEDGMENTS[1].nameKey,
        label: "Statement of rights acknowledgement name",
        type: "text",
        sourceDocument: "Statement of Rights of Adult Day Care Participants",
        required: true
      },
      {
        key: ENROLLMENT_PACKET_NOTICE_ACKNOWLEDGMENTS[1].dateKey,
        label: "Statement of rights acknowledgement date",
        type: "date",
        sourceDocument: "Statement of Rights of Adult Day Care Participants",
        required: true
      }
    ]
  },
  {
    id: "photo-consent",
    title: "Photo Consent",
    description: "Photo, voice, and likeness consent.",
    sourceDocuments: ["Photo Consent"],
    fields: [
      { key: "photoConsentChoice", label: "Photo consent", type: "radio", sourceDocument: "Photo Consent", options: [...ENROLLMENT_PACKET_PHOTO_CONSENT_OPTIONS], required: true }
    ]
  },
  {
    id: "ancillary-charges",
    title: "Ancillary Charges Notice",
    description: "Acknowledgement of ancillary charge policy.",
    sourceDocuments: ["Ancillary Charges Notice"],
    fields: [
      {
        key: ENROLLMENT_PACKET_NOTICE_ACKNOWLEDGMENTS[2].nameKey,
        label: "Ancillary charges acknowledgement name",
        type: "text",
        sourceDocument: "Ancillary Charges Notice",
        required: true
      },
      {
        key: ENROLLMENT_PACKET_NOTICE_ACKNOWLEDGMENTS[2].dateKey,
        label: "Ancillary charges acknowledgement date",
        type: "date",
        sourceDocument: "Ancillary Charges Notice",
        required: true
      }
    ]
  }
];
