import type { EnrollmentPacketIntakeFieldKey, EnrollmentPacketIntakePayload } from "@/lib/services/enrollment-packet-intake-payload";

export type EnrollmentPacketSourceDocument =
  | "Face Sheet and Biography"
  | "Membership Agreement"
  | "Membership Agreement Exhibit A"
  | "Notice of Privacy Practices"
  | "Statement of Rights of Adult Day Care Participants"
  | "Photo Consent"
  | "Ancillary Charges Notice"
  | "Insurance and Legal Uploads";

export type EnrollmentPacketFieldType =
  | "text"
  | "email"
  | "tel"
  | "date"
  | "number"
  | "textarea"
  | "select"
  | "radio"
  | "checkbox-group";

export type EnrollmentPacketFieldDefinition = {
  key: EnrollmentPacketIntakeFieldKey;
  label: string;
  type: EnrollmentPacketFieldType;
  sourceDocument: EnrollmentPacketSourceDocument;
  required?: boolean;
  staffPrepared?: boolean;
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
  key: "insuranceCardUploads" | "idUploads" | "legalDocumentUploads";
  category: "insurance" | "supporting" | "poa_guardianship";
  label: string;
  sourceDocument: EnrollmentPacketSourceDocument;
};

export type EnrollmentPacketCompletionValidationResult = {
  isComplete: boolean;
  missingItems: string[];
};

const YES_NO_OPTIONS = ["Yes", "No"];

export const ENROLLMENT_PACKET_LIVING_SITUATION_OPTIONS = [
  "Independent",
  "With Spouse",
  "With Adult Child",
  "Group Home",
  "Assisted Living",
  "Other"
];

export const ENROLLMENT_PACKET_ADL_SUPPORT_OPTIONS = [
  "Independent",
  "Needs prompting",
  "Needs assistance",
  "Dependent"
];

export const ENROLLMENT_PACKET_BEHAVIORAL_OPTIONS = [
  "Anxiety",
  "Aggression",
  "Confusion",
  "Wandering",
  "Sundowning",
  "Depression",
  "Agitation"
];

export const ENROLLMENT_PACKET_MEMORY_STAGE_OPTIONS = [
  "No Cognitive Impairment",
  "Mild",
  "Moderate",
  "Severe"
];

export const ENROLLMENT_PACKET_HEARING_OPTIONS = ["Normal hearing", "Hearing aids"];

export const ENROLLMENT_PACKET_DENTURE_OPTIONS = ["Upper", "Lower"];

export const ENROLLMENT_PACKET_PET_OPTIONS = ["Dogs", "Cats", "Other"];

export const ENROLLMENT_PACKET_RECREATIONAL_INTEREST_OPTIONS = [
  "Social - Current Events",
  "Social - Pictionary",
  "Social - Charades",
  "Social - Name That Tune",
  "Social - Group Discussions",
  "Social - Board Games",
  "Social - Card Games",
  "Social - Chess / Checkers",
  "Cognitive - Trivia",
  "Cognitive - Spelling Bee",
  "Cognitive - Jeopardy",
  "Cognitive - Word Games",
  "Cognitive - Crosswords",
  "Cognitive - Sudoku",
  "Cognitive - Jigsaw Puzzles",
  "Physical - Yoga / Tai Chi",
  "Physical - Playing Pool",
  "Physical - Fitness / Exercise",
  "Physical - Dancing",
  "Physical - Walking Club",
  "Physical - Volleyball",
  "Physical - Cornhole",
  "Physical - Mini Golf",
  "Physical - Bowling",
  "Physical - Frisbee Toss",
  "Expressive - Painting",
  "Expressive - Drawing",
  "Expressive - Arts & Crafts",
  "Expressive - Poetry",
  "Expressive - Sewing / Knitting",
  "Expressive - Woodworking",
  "Expressive - Drama Club",
  "Expressive - Photography",
  "Expressive - Baking / Cooking",
  "Expressive - Singing",
  "Expressive - Gardening",
  "Expressive - Meditation",
  "Expressive - Flower Arranging"
];

export const ENROLLMENT_PACKET_UPLOAD_FIELDS: EnrollmentPacketUploadDefinition[] = [
  {
    key: "insuranceCardUploads",
    category: "insurance",
    label: "Insurance Card",
    sourceDocument: "Insurance and Legal Uploads"
  },
  {
    key: "idUploads",
    category: "supporting",
    label: "ID",
    sourceDocument: "Insurance and Legal Uploads"
  },
  {
    key: "legalDocumentUploads",
    category: "poa_guardianship",
    label: "Legal Documents",
    sourceDocument: "Insurance and Legal Uploads"
  }
];

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
      { key: "memberCity", label: "City", type: "text", sourceDocument: "Face Sheet and Biography" },
      { key: "memberState", label: "State", type: "text", sourceDocument: "Face Sheet and Biography" },
      { key: "memberZip", label: "ZIP", type: "text", sourceDocument: "Face Sheet and Biography" }
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
      { key: "primaryContactAddress", label: "Address", type: "text", sourceDocument: "Face Sheet and Biography", required: true, columns: 2 }
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
      { key: "secondaryContactAddress", label: "Address", type: "text", sourceDocument: "Face Sheet and Biography", required: true, columns: 2 }
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
      { key: "veteranStatus", label: "VA benefits", type: "radio", sourceDocument: "Face Sheet and Biography", options: YES_NO_OPTIONS },
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
      { key: "adlMobilityLevel", label: "Mobility / transfer", type: "select", sourceDocument: "Face Sheet and Biography", options: ENROLLMENT_PACKET_ADL_SUPPORT_OPTIONS },
      { key: "adlToiletingLevel", label: "Toileting", type: "select", sourceDocument: "Face Sheet and Biography", options: ENROLLMENT_PACKET_ADL_SUPPORT_OPTIONS },
      { key: "adlBathingLevel", label: "Bathing", type: "select", sourceDocument: "Face Sheet and Biography", options: ENROLLMENT_PACKET_ADL_SUPPORT_OPTIONS },
      { key: "adlDressingLevel", label: "Dressing", type: "select", sourceDocument: "Face Sheet and Biography", options: ENROLLMENT_PACKET_ADL_SUPPORT_OPTIONS },
      { key: "adlEatingLevel", label: "Eating", type: "select", sourceDocument: "Face Sheet and Biography", options: ENROLLMENT_PACKET_ADL_SUPPORT_OPTIONS },
      { key: "adlContinenceLevel", label: "Continence", type: "select", sourceDocument: "Face Sheet and Biography", options: ENROLLMENT_PACKET_ADL_SUPPORT_OPTIONS },
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
      { key: "behavioralNotes", label: "Behavioral notes", type: "textarea", sourceDocument: "Face Sheet and Biography", columns: 2 },
      { key: "communicationStyle", label: "Communication style", type: "text", sourceDocument: "Face Sheet and Biography", columns: 2 }
    ]
  },
  {
    id: "recreation-interests",
    title: "Recreation Interests",
    description: "Interests used to personalize member programming.",
    sourceDocuments: ["Face Sheet and Biography"],
    fields: [
      { key: "recreationalInterests", label: "Recreation interests", type: "checkbox-group", sourceDocument: "Face Sheet and Biography", options: ENROLLMENT_PACKET_RECREATIONAL_INTEREST_OPTIONS, columns: 2 }
    ]
  },
  {
    id: "veteran-status",
    title: "Veteran Status",
    description: "Military background details.",
    sourceDocuments: ["Face Sheet and Biography"],
    fields: [
      { key: "veteranStatus", label: "Is the participant a veteran?", type: "radio", sourceDocument: "Face Sheet and Biography", options: YES_NO_OPTIONS },
      { key: "branchOfService", label: "Branch of service", type: "text", sourceDocument: "Face Sheet and Biography" }
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
      { key: "totalInitialEnrollmentAmount", label: "Total initial enrollment amount", type: "number", sourceDocument: "Membership Agreement", required: true, staffPrepared: true }
    ]
  },
  {
    id: "exhibit-a",
    title: "Exhibit A - Payment Authorization",
    description: "ACH or credit card authorization.",
    sourceDocuments: ["Membership Agreement Exhibit A"],
    fields: [
      { key: "paymentMethodSelection", label: "Payment method", type: "select", sourceDocument: "Membership Agreement Exhibit A", options: ["ACH", "Credit Card"], required: true },
      { key: "bankName", label: "Bank name", type: "text", sourceDocument: "Membership Agreement Exhibit A" },
      { key: "bankAba", label: "Routing number", type: "text", sourceDocument: "Membership Agreement Exhibit A" },
      { key: "bankAccountNumber", label: "Account number", type: "text", sourceDocument: "Membership Agreement Exhibit A" },
      { key: "cardNumber", label: "Card number", type: "text", sourceDocument: "Membership Agreement Exhibit A" },
      { key: "cardExpiration", label: "Expiration", type: "text", sourceDocument: "Membership Agreement Exhibit A" },
      { key: "cardCvv", label: "CVV", type: "text", sourceDocument: "Membership Agreement Exhibit A" }
    ]
  },
  {
    id: "privacy-practices",
    title: "Privacy Practices Acknowledgement",
    description: "Notice of privacy practices acknowledgement.",
    sourceDocuments: ["Notice of Privacy Practices"],
    fields: [{ key: "privacyPracticesAcknowledged", label: "I acknowledge the Notice of Privacy Practices", type: "radio", sourceDocument: "Notice of Privacy Practices", options: ["Acknowledged"] }]
  },
  {
    id: "statement-of-rights",
    title: "Statement of Rights",
    description: "Participant rights acknowledgement.",
    sourceDocuments: ["Statement of Rights of Adult Day Care Participants"],
    fields: [{ key: "statementOfRightsAcknowledged", label: "I acknowledge the Statement of Rights", type: "radio", sourceDocument: "Statement of Rights of Adult Day Care Participants", options: ["Acknowledged"] }]
  },
  {
    id: "photo-consent",
    title: "Photo Consent",
    description: "Photo, voice, and likeness consent.",
    sourceDocuments: ["Photo Consent"],
    fields: [
      { key: "photoConsentChoice", label: "Photo consent", type: "radio", sourceDocument: "Photo Consent", options: ["I do permit", "I do not permit"], required: true },
      { key: "photoConsentAcknowledged", label: "I acknowledge the photo consent terms", type: "radio", sourceDocument: "Photo Consent", options: ["Acknowledged"] }
    ]
  },
  {
    id: "ancillary-charges",
    title: "Ancillary Charges Notice",
    description: "Acknowledgement of ancillary charge policy.",
    sourceDocuments: ["Ancillary Charges Notice"],
    fields: [{ key: "ancillaryChargesAcknowledged", label: "I acknowledge the ancillary charges notice", type: "radio", sourceDocument: "Ancillary Charges Notice", options: ["Acknowledged"] }]
  },
  {
    id: "final-review",
    title: "Final Review",
    description: "Review all sections before signature.",
    sourceDocuments: ["Membership Agreement", "Membership Agreement Exhibit A"],
    fields: [{ key: "additionalNotes", label: "Additional notes", type: "textarea", sourceDocument: "Membership Agreement", columns: 2 }]
  }
];

export const ENROLLMENT_PACKET_LEGAL_TEXT = {
  membershipAgreement: [
    "This Membership Agreement is entered into by and between Town Square Fort Mill and the Member and Responsible Party/Guarantor.",
    "Town Square provides adult day care and support services that include assistance with activities of daily living, education programs, physical activities, health monitoring, social activities, meal service, and transportation coordination.",
    "Extra services may be available outside the basic daily charge, including shower assistance and other ancillary services listed in packet documents.",
    "Fees are due at enrollment and then monthly, generally by the first of the month. Accounts not paid within terms may be subject to finance charges, collection costs, and limits on attendance until balances are resolved.",
    "The first payment includes the non-refundable community fee and daily attendance charges for the initial month. Ongoing invoices cover scheduled attendance for the upcoming month, with additional attended days added to a subsequent invoice.",
    "Requested schedule and absences must be communicated to the center. For foreseeable absences, provide at least 2 days notice when possible. Make-up days follow center policy.",
    "In emergencies, center personnel may take professionally appropriate measures, including emergency transfer. Hospital preference is honored when possible but not guaranteed.",
    "Members remain under the care of a healthcare practitioner while enrolled and must report clinical changes such as medication changes, hospitalizations, ER visits, urgent care, and falls.",
    "Town Square may terminate membership when medically or behaviorally inappropriate, with written notice consistent with policy and safety requirements.",
    "By continuing, you acknowledge acceptance of the Membership Agreement terms presented in this enrollment packet."
  ],
  exhibitAPaymentAuthorization: [
    "Exhibit A includes the payment authorization and fee schedule used for enrollment and recurring monthly billing.",
    "Fee schedule reference: 1 day per week $205/day, 2-3 days per week $180/day, 4-5 days per week $170/day, plus community fee and other authorized charges.",
    "Total Amount Due for Initial Enrollment is calculated for the initial enrollment period and shown in this packet.",
    "Please select one payment method: ACH (Bank Draft) or Credit Card (Auto Charge).",
    "ACH Authorization: you authorize Town Square to initiate debit entries and credit correction entries for the listed account on or about the 1st day of each month. Returned drafts may result in return and late fees.",
    "Credit Card Authorization: you authorize Town Square to charge recurring monthly membership fees and authorized services on or about the 1st day of each month.",
    "Credit card transactions are subject to a processing surcharge, and declined transactions may result in additional fees as described in packet documents.",
    "By continuing, you acknowledge and authorize the payment terms in Exhibit A."
  ],
  privacyPractices: [
    "This Notice of Privacy Practices describes how medical information about the Member may be used and disclosed, and how the Member or legal representative can access that information.",
    "Member rights include requesting an electronic or paper copy of records, asking for corrections, requesting confidential communications, requesting limits on certain uses/disclosures, and receiving an accounting of disclosures where applicable.",
    "The Member may designate an authorized person (such as an attorney-in-fact or legal guardian) to act on the Member's behalf.",
    "Town Square may use and disclose information for treatment, payment, and healthcare operations, and may make disclosures required or permitted by law.",
    "Permitted disclosures can include public health and safety reporting, legal process, law enforcement and oversight activities, research, and other lawful uses as stated in the notice.",
    "Town Square is required to maintain privacy and security of protected health information and provide breach notification when required by law.",
    "The notice describes complaint rights and states that no retaliation will occur for filing a complaint.",
    "By acknowledging below, you confirm receipt and review of the Notice of Privacy Practices included in this enrollment packet."
  ],
  statementOfRights: [
    "Each participant has the right to be treated as an adult with consideration, respect, dignity, and privacy in care and treatment.",
    "Each participant has the right to participate in services and activities that encourage independence, learning, growth, and awareness of interests and talents.",
    "Participants have self-determination rights within the day care setting, including participation in planning, deciding whether to join activities, refusal of treatment where applicable, and ending participation.",
    "Participants have the right to a safe, secure, and clean environment and to confidentiality of information except where release is authorized by law.",
    "Participants have the right to voice grievances without discrimination or reprisal, to be free from harm, exploitation, abuse, and neglect, and to be informed of services, charges, and responsibilities.",
    "The facility provides grievance and complaint procedures for participants, sponsors, and responsible parties, including South Carolina Department contact pathways.",
    "By acknowledging below, you confirm receipt and review of the Statement of Rights of Adult Day Care Participants."
  ],
  photoConsent: [
    "This authorization addresses use of image, voice, performance, and likeness by Town Square Franchising, LLC and affiliates.",
    "You may choose to permit or not permit use of name, photographs, video, voice recordings, or likeness for publicity, marketing, training, and promotion without compensation.",
    "If permission is granted, materials may be copied and distributed in media such as publications, video, broadcasts, websites, brochures, and signage.",
    "The consent language includes release terms related to reproduction, distribution, display, and related media usage, and explains limits of Company supervision over downstream dissemination.",
    "By selecting an option and acknowledging below, you confirm review and acceptance of the Photo Consent terms included in this enrollment packet."
  ],
  ancillaryCharges: [
    "The Ancillary Charges Notice informs families of additional fees associated with certain supplies and services.",
    "Listed ancillary charges include soiled laundry, disposable briefs, insulin supplies, showers, and late pick-up fees.",
    "The notice also explains abandonment safety escalation expectations for significantly late pick-up and requests timely family communication about delays.",
    "By acknowledging below, you confirm receipt and review of the Ancillary Charges Notice included in this enrollment packet."
  ]
} as const;

function clean(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function hasValue(value: string | null | undefined) {
  return clean(value) != null;
}

function hasAcknowledged(value: string | null | undefined) {
  const normalized = clean(value)?.toLowerCase();
  if (!normalized) return false;
  return ["acknowledged", "yes", "true", "1", "checked"].includes(normalized);
}

function isYes(value: string | null | undefined) {
  const normalized = clean(value)?.toLowerCase();
  return normalized === "yes" || normalized === "true" || normalized === "1";
}

function isSelectedCreditCard(value: string | null | undefined) {
  return clean(value)?.toLowerCase() === "credit card";
}

function isSelectedAch(value: string | null | undefined) {
  return clean(value)?.toLowerCase() === "ach";
}

export function validateEnrollmentPacketCompletion(input: {
  payload: EnrollmentPacketIntakePayload;
  showTransportationQuestion: boolean;
}): EnrollmentPacketCompletionValidationResult {
  const { payload } = input;
  const missingItems: string[] = [];

  if (!hasValue(payload.memberLegalFirstName) || !hasValue(payload.memberLegalLastName)) {
    missingItems.push("Member name");
  }
  if (!hasValue(payload.memberDob)) missingItems.push("Member DOB");
  if (!hasValue(payload.memberGender)) missingItems.push("Member gender");
  if (!hasValue(payload.memberAddressLine1)) missingItems.push("Member address");

  if (!hasValue(payload.primaryContactName)) missingItems.push("Primary contact name");
  if (!hasValue(payload.primaryContactRelationship)) missingItems.push("Primary contact relationship");
  if (!hasValue(payload.primaryContactPhone)) missingItems.push("Primary contact phone");
  if (!hasValue(payload.primaryContactEmail)) missingItems.push("Primary contact email");
  if (!hasValue(payload.primaryContactAddress)) missingItems.push("Primary contact address");

  if (!hasValue(payload.secondaryContactName)) missingItems.push("Secondary contact name");
  if (!hasValue(payload.secondaryContactRelationship)) missingItems.push("Secondary contact relationship");
  if (!hasValue(payload.secondaryContactPhone)) missingItems.push("Secondary contact phone");
  if (!hasValue(payload.secondaryContactEmail)) missingItems.push("Secondary contact email");
  if (!hasValue(payload.secondaryContactAddress)) missingItems.push("Secondary contact address");

  if (!hasValue(payload.pcpName)) missingItems.push("PCP name");
  if (!hasValue(payload.pcpAddress)) missingItems.push("PCP address");
  if (!hasValue(payload.pcpPhone)) missingItems.push("PCP phone");

  if (!hasValue(payload.pharmacy)) missingItems.push("Pharmacy name");
  if (!hasValue(payload.pharmacyAddress)) missingItems.push("Pharmacy address");
  if (!hasValue(payload.pharmacyPhone)) missingItems.push("Pharmacy phone");

  if (!hasValue(payload.requestedStartDate)) missingItems.push("Requested start date");
  if (!hasValue(payload.totalInitialEnrollmentAmount)) missingItems.push("Total initial enrollment amount");
  if (!hasValue(payload.paymentMethodSelection)) missingItems.push("Payment method selection");

  if (input.showTransportationQuestion && !hasValue(payload.transportationPreference)) {
    missingItems.push("Transportation needed");
  }

  if (isYes(payload.veteranStatus) && !hasValue(payload.branchOfService)) {
    missingItems.push("Branch of service");
  }

  if (isYes(payload.veteranStatus) && !hasValue(payload.tricareNumber)) {
    missingItems.push("Tricare number");
  }

  if (isYes(payload.medicationNeededDuringDay) && !hasValue(payload.medicationNamesDuringDay)) {
    missingItems.push("Medication names");
  }

  if (isYes(payload.oxygenUse) && !hasValue(payload.oxygenFlowRate)) {
    missingItems.push("Oxygen flow rate");
  }

  if (!hasValue(payload.fallsHistory)) {
    missingItems.push("History of falls");
  } else if (isYes(payload.fallsHistory) && !hasValue(payload.fallsWithinLast3Months)) {
    missingItems.push("Falls within last 3 months");
  }

  if (payload.petTypes.length > 0 && !hasValue(payload.petNames)) {
    missingItems.push("Pet names");
  }

  if (isYes(payload.dentures) && payload.dentureTypes.length === 0) {
    missingItems.push("Dentures selection (upper/lower)");
  }

  if (isSelectedAch(payload.paymentMethodSelection)) {
    if (!hasValue(payload.bankName)) missingItems.push("Bank name");
    if (!hasValue(payload.bankAba)) missingItems.push("Routing number");
    if (!hasValue(payload.bankAccountNumber)) missingItems.push("Account number");
  }

  if (isSelectedCreditCard(payload.paymentMethodSelection)) {
    if (!hasValue(payload.cardNumber)) missingItems.push("Card number");
    if (!hasValue(payload.cardExpiration)) missingItems.push("Card expiration");
    if (!hasValue(payload.cardCvv)) missingItems.push("Card CVV");
  }

  if (!hasAcknowledged(payload.privacyPracticesAcknowledged)) {
    missingItems.push("Privacy Practices acknowledgement");
  }
  if (!hasAcknowledged(payload.statementOfRightsAcknowledged)) {
    missingItems.push("Statement of Rights acknowledgement");
  }
  if (!hasAcknowledged(payload.photoConsentAcknowledged)) {
    missingItems.push("Photo Consent acknowledgement");
  }
  if (!hasAcknowledged(payload.ancillaryChargesAcknowledged)) {
    missingItems.push("Ancillary Charges acknowledgement");
  }

  if (!hasValue(payload.photoConsentChoice)) {
    missingItems.push("Photo consent selection");
  }

  return {
    isComplete: missingItems.length === 0,
    missingItems
  };
}

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
