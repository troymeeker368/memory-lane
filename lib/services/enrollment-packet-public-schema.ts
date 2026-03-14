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
  key:
    | "medicareCardUploads"
    | "primaryInsuranceCardUploads"
    | "secondaryInsuranceCardUploads"
    | "poaUploads"
    | "dnrUploads"
    | "advanceDirectiveUploads";
  category:
    | "medicare_card"
    | "private_insurance"
    | "supplemental_insurance"
    | "poa_guardianship"
    | "dnr_dni_advance_directive";
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

export const ENROLLMENT_PACKET_ADL_AMBULATION_OPTIONS = [
  "Ambulates independently",
  "Ambulates with supervision",
  "Ambulates with one-person assistance",
  "Ambulates with two-person assistance",
  "Uses wheelchair"
];

export const ENROLLMENT_PACKET_ADL_TRANSFER_OPTIONS = [
  "Transfers independently",
  "Transfers with supervision",
  "Transfers with one-person assistance",
  "Transfers with two-person assistance",
  "Requires mechanical lift"
];

export const ENROLLMENT_PACKET_ADL_TOILETING_OPTIONS = [
  "Toilets independently",
  "Needs prompting for toileting",
  "Needs assistance with toileting",
  "Dependent for toileting"
];

export const ENROLLMENT_PACKET_ADL_BATHING_OPTIONS = [
  "Bathes independently",
  "Needs setup for bathing",
  "Needs assistance with bathing",
  "Dependent for bathing"
];

export const ENROLLMENT_PACKET_ADL_DRESSING_OPTIONS = [
  "Dresses independently",
  "Needs prompting for dressing",
  "Needs assistance with dressing",
  "Dependent for dressing"
];

export const ENROLLMENT_PACKET_ADL_EATING_OPTIONS = [
  "Eats independently",
  "Needs setup for meals",
  "Needs cueing while eating",
  "Needs assistance with feeding",
  "Dependent for feeding"
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
export const ENROLLMENT_PACKET_CONTINENCE_OPTIONS = ["Continent", "Urinary Incontinence", "Bowel Incontinence"];
export const ENROLLMENT_PACKET_VETERAN_BRANCH_OPTIONS = [
  "Army",
  "Navy",
  "Air Force",
  "Marine Corps",
  "Coast Guard",
  "Space Force",
  "National Guard / Reserves"
];

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
    key: "medicareCardUploads",
    category: "medicare_card",
    label: "Medicare Card",
    sourceDocument: "Insurance and Legal Uploads"
  },
  {
    key: "primaryInsuranceCardUploads",
    category: "private_insurance",
    label: "Primary Private Insurance Card (if applicable)",
    sourceDocument: "Insurance and Legal Uploads"
  },
  {
    key: "secondaryInsuranceCardUploads",
    category: "supplemental_insurance",
    label: "Secondary Insurance Card (if applicable)",
    sourceDocument: "Insurance and Legal Uploads"
  },
  {
    key: "poaUploads",
    category: "poa_guardianship",
    label: "Power of Attorney (POA) Documentation",
    sourceDocument: "Insurance and Legal Uploads"
  },
  {
    key: "dnrUploads",
    category: "dnr_dni_advance_directive",
    label: "DNR / DNI Paperwork",
    sourceDocument: "Insurance and Legal Uploads"
  },
  {
    key: "advanceDirectiveUploads",
    category: "dnr_dni_advance_directive",
    label: "Advance Directives",
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
      { key: "membershipMemberSignatureName", label: "Member signature name", type: "text", sourceDocument: "Membership Agreement", required: true },
      { key: "membershipMemberSignatureDate", label: "Member signature date", type: "date", sourceDocument: "Membership Agreement", required: true },
      { key: "membershipGuarantorSignatureName", label: "Responsible Party / Guarantor signature name", type: "text", sourceDocument: "Membership Agreement", required: true }
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
    "This Membership Agreement is entered into by and between Town Square Fort Mill located at 368 Fort Mill Parkway, Suite 106, Fort Mill, SC 29715 and the Member and Responsible Party.",
    "Services: Town Square shall provide adult day care and support services to Member at its Town Square facility at the address above (the Center). The adult day care and support services that are available to the Member include, assistance with activities of daily living, education programs, physical activities, health monitoring, social activities, preparation of meals/snacks, and coordination of transportation services.",
    "Extra Services are available outside the basic daily charge. To take advantage of either of these services, please contact the Town Square Director. A working barber/hair salon offers several ancillary services for an additional fee. Shower Assistance: Town Square also understands that showers may become harder to manage at home, and we can help provide shower assistance for an additional $25 fee.",
    "Fees: Member shall pay the applicable fees as provided on Exhibit A, which is attached and incorporated by reference, at the time of enrollment and then thereafter on a monthly basis. This is payable by the first of the month. Fees shall be paid by ACH direct debit of Member's assigned bank account. Accounts not paid within terms are subject to a 1.5% per invoice finance charge plus attorney's fees and costs of collection.",
    "The first payment will include the non-refundable center fee and the daily rate for the upcoming month of attendance. Moving forward, the member will be billed on the first business day of the month for all scheduled attendance days for the upcoming month. Any additional days attended will be added to the next month's invoice. Invoices will be issued on/about the 25th of every month for the following month. Accounts will be auto drafted on/about the 1st of every month for the present month.",
    "Payment made by credit card for the initial charges are subject to a 3% fee, otherwise a check will be accepted for this payment. The member will be unable to attend the Town Square Center until all past balances are collected. Should any fee need to change the center will provide a 30-day written notice.",
    "Scheduling: Member or their representative shall schedule the dates and times that they will be attending the Center. The schedule shall be selected on the Enrollment Form. If Member is unable to attend a scheduled day for a foreseeable absence, the Member or their representative must notify the Center 2 days in advance. If less notice is given, the center will bill for the day (up to a scheduled week) but allow make-up days to be used within that same month.",
    "Please refer to the Welcome Guide regarding holiday closings and weather closings. Should the center close due to inclement weather, the member shall not be billed for that day.",
    "Emergencies: In the event of an emergency, personnel of the Center are authorized to take such measures for the Member's welfare as may be professionally appropriate, including transfer to an emergency center. The Center will make all efforts to honor hospital preference but not guarantee.",
    "Members' Responsibilities: Member will remain under the care of a Healthcare Practitioner while enrolled in Town Square. Should a member change their Healthcare Practitioner the Center will be notified of the change, within 7 days. The Member or Responsible Party will also report to the Center Nurse any changes in medication, treatments, surgery, hospitalizations, ER visits, urgent medical care, falls, etc. If the member is hospitalized, discharge paperwork is required to resume attendance.",
    "Termination of Membership: Town Square, in its sole discretion, may terminate a member's membership if a member is deemed medically or behaviorally inappropriate. Town Square will formulate a discharge plan, including at least a 30-day written notice to the Member or the Member's Responsible Party.",
    "Notice of Privacy Practices: The Notice of Privacy Practices provides information about how Town Square may use and disclose protected health information about the Member. By signing this Agreement, the Member consents to Town Square's use and disclosure of protected health information about Member for purposes of treatment, payment and health care operations.",
    "Use of Photography/Video: Member permits and authorizes Town Square to use photographs or video of themselves while in attendance of the Center for publicity, marketing, training, and promotion of Town Square.",
    "Binding Arbitration: Member agrees to binding arbitration pursuant to the commercial arbitration rules of the American Arbitration Association as the exclusive means to resolve all disputes arising from or related to this Agreement, with the exception of a Member's failure to pay fees or other amounts owed to Town Square for which Town Square may file an action in an applicable court of law to recover.",
    "By signing below, Member and Responsible Party/Guarantor acknowledge and accept the Membership Agreement terms."
  ],
  exhibitAPaymentAuthorization: [
    "Exhibit A: Payment Authorization & Fee Schedule",
    "Daily Center Fee: 1 day per week: $205 per day; 2-3 days per week: $180 per day; 4-5 days per week: $170 per day.",
    "Community Fee: due before the member's first day.",
    "Total Amount Due for Initial Enrollment: calculated by staff and shown in this packet.",
    "We are a membership-based program. Billing is processed at the beginning of each month for the upcoming month of services.",
    "Please select one payment option below: ACH (Bank Draft) or Credit Card (Auto Charge).",
    "ACH AUTHORIZATION: I hereby authorize payments for all invoices to be debited using the checking/savings account listed below. I understand that my account will be drafted on or about the 1st day of each month. If for any reason a bank draft is returned by my bank, a $25 return fee will be applied to the account plus a 2% late fee.",
    "The undersigned guarantor hereby authorizes Town Square to initiate debit entries and/or credit correction entries to the undersigned's checking and/or savings account(s) indicated below and the depository designated below (Bank) to debit or credit such account(s) pursuant to Town Square's instructions.",
    "CREDIT CARD AUTHORIZATION: I authorize Town Square to charge the credit card listed below for all membership fees and authorized services.",
    "I understand that a 3% processing surcharge will be added to all credit card transactions. My card will be charged on or about the 1st day of each month for the upcoming month of services, including the 3% surcharge. If a charge is declined, a $25 fee plus a 2% late fee may be applied.",
    "I authorize Town Square to retain this information on file and to charge the card for all recurring monthly membership fees and any additional authorized charges in accordance with the Membership Agreement."
  ],
  privacyPractices: [
    "Notice of Privacy Practices",
    "MEMBER INFORMATION. MEMBER RIGHTS. OUR RESPONSIBILITIES.",
    "This notice describes how medical information about the Member may be used and disclosed and how the Member (or your health care attorney-in-fact) can get access to this information. For purposes of this notice, Member means the person attending our Center and receiving the adult day care services. Please review this Notice carefully.",
    "MEMBER RIGHTS",
    "When it comes to the Member's health information, the Member has certain rights. This section explains the Member's rights and some of our responsibilities to help the Member.",
    "GET AN ELECTRONIC OR PAPER COPY OF THE MEMBER'S MEDICAL RECORD: The Member (or their attorney-in-fact) can ask to see or get an electronic or paper copy of the Member's medical record and other health information we have about the Member.",
    "ASK US TO CORRECT THE MEMBER'S MEDICAL RECORD: The Member (or their attorney-in-fact) can ask us to correct health information about the Member that is incorrect or incomplete.",
    "REQUEST CONFIDENTIAL COMMUNICATIONS: The Member (or their attorney-in-fact) can ask us to contact the Member (or their attorney-in-fact) in a specific way or to send mail to a different address.",
    "ASK US TO LIMIT WHAT WE USE OR SHARE: The Member (or their attorney-in-fact) can ask us not to use or share certain health information for treatment, payment, or our operations.",
    "GET A LIST OF THOSE WITH WHOM WE HAVE SHARED INFORMATION: The Member (or their attorney-in-fact) can request a list (accounting) of the times we've shared the Member's health information.",
    "CHOOSE SOMEONE TO ACT FOR THE MEMBER: If the Member has given someone medical power of attorney or if someone is the Member's legal guardian, that person can exercise the Member's rights and make choices about the Member's health information.",
    "FILE A COMPLAINT IF THE MEMBER FEELS THEIR RIGHTS ARE VIOLATED: The Member (or their attorney-in-fact) can complain if they feel we have violated the Member's rights.",
    "OUR USES & DISCLOSURES: We typically use or share the Member's health information to treat the Member, run our organization, and bill for services.",
    "OUR RESPONSIBILITIES: We are required by law to maintain the privacy and security of the Member's protected health information. We must follow the duties and privacy practices described in this notice.",
    "CHANGES TO THE TERMS OF THIS NOTICE: We can change the terms of this notice, and the changes will apply to all information we have about the Member.",
    "This Notice is effective as of 10/1/2024.",
    "CENTER CONTACT: Michelle Piscatelli, Center Director, 803-591-9898, mpiscatelli@townsquare.net, Town Square Fort Mill, 368 Fort Mill Parkway, Fort Mill, SC 29715."
  ],
  statementOfRights: [
    "Statement of Rights of Adult Day Care Participants",
    "Each Participant must be accorded the following rights:",
    "The right to be treated as an Adult, with consideration, respect, and dignity, including privacy in treatment and in care for personal needs.",
    "The right to participate in a program of services and activities designed to encourage independence, learning, growth, and awareness of constructive ways to develop one's interests and talents.",
    "The right to self-determination within the day care setting, including the opportunity to participate in developing one's plan for services and any changes therein; decide whether to participate in any given activity; be involved to the extent possible in program planning and operation; refuse treatment, if applicable, and be informed of the consequences of such refusal; and end participation in the Facility any time.",
    "The right to be cared about in an atmosphere of sincere interest and concern in which needed support and services are provided.",
    "The right to a safe, secure, and clean environment.",
    "The right to confidentiality and the requirement for written consent for release of information to persons not authorized under law to receive it.",
    "The right to voice grievances without discrimination or reprisal with respect to care or treatment, if applicable, that is or is not provided.",
    "The right to be fully informed, as evidenced by the Participant's written acknowledgment of these rights, of all rules and regulations regarding Participant conduct and responsibilities.",
    "The right to be free from Harm, Exploitation, Abuse, or Neglect.",
    "The right to be fully informed, at the time of enrollment, of services and activities available and related charges.",
    "The right to communicate with others and be understood by them to the extent of the Participant's capability.",
    "To voice grievances or file a complaint regarding care or treatment, you, your sponsor, or designated representative may do so without fear of retaliation. You may file a complaint with the South Carolina Department of Health and Environmental Control (DHEC)."
  ],
  photoConsent: [
    "AUTHORIZATION FOR USE OF IMAGE, VOICE, PERFORMANCE OR LIKENESS",
    "I do permit / I do not permit and authorize Town Square Franchising, LLC and its affiliates and its employees, agents, and personnel who are acting on behalf of the Company to use my name, photograph, video, sound/voice recording or other likeness for publicity, marketing, training, and promotion of the Company without compensation to me.",
    "I understand my name, photograph, video, sound/voice recording or other likeness may be copied and distributed by means of various media, including, but not limited to, publications, video, television broadcasts/rebroadcasts, radio transmissions/retransmissions, news releases, websites, brochures, billboards or signs.",
    "I acknowledge that the Company has the right to make one or more photographs, audio recordings, videotape or disk presentations, or other electronic reproductions of my image, voice or performance in accordance with this agreement. I waive any right to inspect or approve the finished product, or any material in which the Company may eventually use.",
    "I relinquish and give the Company all rights, title, and interests in and to the photograph, video, sound/voice recording or other likeness including any copyright therein. This consent and release shall be binding upon my heirs, successors, assigns, and legal representations.",
    "I understand that, although the Company will attempt to use my name, photograph, video, sound/voice recording or other likeness in accordance with standards of good judgment, the Company cannot warrant or guarantee that any further dissemination will be subject to Company supervision or control.",
    "I have read and understand the conditions of this consent form."
  ],
  ancillaryCharges: [
    "Ancillary Charges Notice",
    "Hello, Town Square Families!",
    "We would like to inform you of some minor ancillary charges that we have deemed necessary due to the cost of supplies and labor.",
    "Effective October 1, 2024, the following fees will be implemented for ancillary services below: Member Soiled Laundry: $5.00; Disposable Briefs: $5.00 each; Insulin Supplies: $5.00 per use; Shower: $25.00.",
    "Late Pick-up: $25 for the first 15 minutes, and $2.00/minute thereafter (not to exceed 30 minutes).",
    "It is important to note that if you are more than 60 minutes late to pick up your loved one, we are mandated to call 911 due to abandonment.",
    "If you would like to add any of the ancillary services mentioned above, please let us know and we will ensure to add the cost to your monthly invoice.",
    "Thank you for your understanding and cooperation. If you have any questions or concerns, please don't hesitate to reach out to us.",
    "Sincerely, Town Square Management"
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
}): EnrollmentPacketCompletionValidationResult {
  const { payload } = input;
  const missingItems: string[] = [];

  if (!hasValue(payload.memberLegalFirstName) || !hasValue(payload.memberLegalLastName)) {
    missingItems.push("Member name");
  }
  if (!hasValue(payload.memberDob)) missingItems.push("Member DOB");
  if (!hasValue(payload.memberGender)) missingItems.push("Member gender");
  if (!hasValue(payload.memberAddressLine1)) missingItems.push("Member street address");
  if (!hasValue(payload.memberCity)) missingItems.push("Member city/town");
  if (!hasValue(payload.memberState)) missingItems.push("Member state");
  if (!hasValue(payload.memberZip)) missingItems.push("Member ZIP code");

  if (!hasValue(payload.primaryContactName)) missingItems.push("Primary contact name");
  if (!hasValue(payload.primaryContactRelationship)) missingItems.push("Primary contact relationship");
  if (!hasValue(payload.primaryContactPhone)) missingItems.push("Primary contact phone");
  if (!hasValue(payload.primaryContactEmail)) missingItems.push("Primary contact email");
  if (!hasValue(payload.primaryContactAddressLine1)) missingItems.push("Primary contact street address");
  if (!hasValue(payload.primaryContactCity)) missingItems.push("Primary contact city/town");
  if (!hasValue(payload.primaryContactState)) missingItems.push("Primary contact state");
  if (!hasValue(payload.primaryContactZip)) missingItems.push("Primary contact ZIP code");

  if (!hasValue(payload.secondaryContactName)) missingItems.push("Secondary contact name");
  if (!hasValue(payload.secondaryContactRelationship)) missingItems.push("Secondary contact relationship");
  if (!hasValue(payload.secondaryContactPhone)) missingItems.push("Secondary contact phone");
  if (!hasValue(payload.secondaryContactEmail)) missingItems.push("Secondary contact email");
  if (!hasValue(payload.secondaryContactAddressLine1)) missingItems.push("Secondary contact street address");
  if (!hasValue(payload.secondaryContactCity)) missingItems.push("Secondary contact city/town");
  if (!hasValue(payload.secondaryContactState)) missingItems.push("Secondary contact state");
  if (!hasValue(payload.secondaryContactZip)) missingItems.push("Secondary contact ZIP code");

  if (!hasValue(payload.pcpName)) missingItems.push("PCP name");
  if (!hasValue(payload.pcpAddress)) missingItems.push("PCP address");
  if (!hasValue(payload.pcpPhone)) missingItems.push("PCP phone");

  if (!hasValue(payload.pharmacy)) missingItems.push("Pharmacy name");
  if (!hasValue(payload.pharmacyAddress)) missingItems.push("Pharmacy address");
  if (!hasValue(payload.pharmacyPhone)) missingItems.push("Pharmacy phone");

  if (!hasValue(payload.requestedStartDate)) missingItems.push("Requested start date");
  if (!hasValue(payload.totalInitialEnrollmentAmount)) missingItems.push("Total initial enrollment amount");
  if (!hasValue(payload.paymentMethodSelection)) missingItems.push("Payment method selection");

  if (isYes(payload.veteranStatus) && !hasValue(payload.branchOfService)) {
    missingItems.push("Branch of service");
  }

  if (isYes(payload.vaBenefits) && !hasValue(payload.tricareNumber)) {
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
    if (!hasValue(payload.cardBillingAddressLine1)) missingItems.push("Card billing street address");
    if (!hasValue(payload.cardBillingCity)) missingItems.push("Card billing city/town");
    if (!hasValue(payload.cardBillingState)) missingItems.push("Card billing state");
    if (!hasValue(payload.cardBillingZip)) missingItems.push("Card billing ZIP code");
  }

  if (!hasValue(payload.membershipMemberSignatureName)) missingItems.push("Membership member signature name");
  if (!hasValue(payload.membershipMemberSignatureDate)) missingItems.push("Membership member signature date");
  if (!hasValue(payload.membershipGuarantorSignatureName)) {
    missingItems.push("Membership responsible party / guarantor signature name");
  }
  if (!hasValue(payload.exhibitAGuarantorSignatureName)) {
    missingItems.push("Exhibit A responsible party / guarantor acknowledgement name");
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
