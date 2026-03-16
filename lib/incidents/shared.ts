export const INCIDENT_CATEGORY_OPTIONS = [
  { value: "fall", label: "Fall" },
  { value: "behavioral", label: "Behavioral" },
  { value: "medication", label: "Medication" },
  { value: "injury", label: "Injury" },
  { value: "elopement", label: "Elopement" },
  { value: "transportation", label: "Transportation" },
  { value: "choking", label: "Choking" },
  { value: "environmental", label: "Environmental" },
  { value: "staff_injury", label: "Staff Injury" },
  { value: "other", label: "Other" }
] as const;

export const INCIDENT_STATUS_VALUES = ["draft", "submitted", "returned", "approved", "closed"] as const;
export const INCIDENT_DIRECTOR_DECISION_VALUES = ["approved", "returned"] as const;
export const INCIDENT_LOCATION_OPTIONS = [
  "Activity Floor",
  "Dining Area",
  "Bathroom",
  "Hallway",
  "Entry / Exit",
  "Transportation Vehicle",
  "Parking Lot",
  "Outside Grounds",
  "Other"
] as const;
export const INCIDENT_INJURY_TYPE_OPTIONS = [
  "None",
  "Abrasion",
  "Bruise",
  "Cut / Laceration",
  "Head Injury",
  "Pain",
  "Skin Tear",
  "Sprain / Strain",
  "Other"
] as const;

export type IncidentCategory = (typeof INCIDENT_CATEGORY_OPTIONS)[number]["value"];
export type IncidentStatus = (typeof INCIDENT_STATUS_VALUES)[number];
export type IncidentDirectorDecision = (typeof INCIDENT_DIRECTOR_DECISION_VALUES)[number];

export type IncidentLookupOption = {
  id: string;
  label: string;
  subtitle?: string | null;
};

export type IncidentSummaryRow = {
  id: string;
  incidentNumber: string;
  category: IncidentCategory;
  reportable: boolean;
  status: IncidentStatus;
  participantName: string | null;
  staffMemberName: string | null;
  reporterName: string;
  incidentDateTime: string;
  location: string;
  updatedAt: string;
};

export type IncidentHistoryEntry = {
  id: string;
  action: string;
  userId: string | null;
  userName: string | null;
  notes: string | null;
  previousValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  createdAt: string;
};

export type IncidentDetail = {
  id: string;
  incidentNumber: string;
  incidentCategory: IncidentCategory;
  reportable: boolean;
  participantId: string | null;
  participantName: string | null;
  staffMemberId: string | null;
  staffMemberName: string | null;
  reporterUserId: string;
  reporterName: string;
  additionalParties: string | null;
  incidentDateTime: string;
  reportedDateTime: string;
  location: string;
  exactLocationDetails: string | null;
  description: string;
  unsafeConditionsPresent: boolean;
  unsafeConditionsDescription: string | null;
  injuredBy: string | null;
  injuryType: string | null;
  bodyPart: string | null;
  generalNotes: string | null;
  followUpNote: string | null;
  status: IncidentStatus;
  submittedAt: string | null;
  submittedByUserId: string | null;
  submittedByName: string | null;
  submitterSignatureName: string | null;
  submitterSignedAt: string | null;
  directorReviewedBy: string | null;
  directorReviewedAt: string | null;
  directorDecision: IncidentDirectorDecision | null;
  directorSignatureName: string | null;
  directorReviewNotes: string | null;
  createdAt: string;
  updatedAt: string;
  history: IncidentHistoryEntry[];
};

export type IncidentDashboard = {
  counts: {
    total: number;
    submitted: number;
    returned: number;
    approved: number;
    reportableOpen: number;
  };
  recent: IncidentSummaryRow[];
};

export type IncidentEditorLookups = {
  participants: IncidentLookupOption[];
  staffMembers: IncidentLookupOption[];
};

export type IncidentDraftInput = {
  incidentId?: string | null;
  incidentCategory: string;
  reportable: boolean;
  participantId?: string | null;
  staffMemberId?: string | null;
  additionalParties?: string | null;
  incidentDateTime: string;
  reportedDateTime: string;
  location: string;
  exactLocationDetails?: string | null;
  description: string;
  unsafeConditionsPresent: boolean;
  unsafeConditionsDescription?: string | null;
  injuredBy?: string | null;
  injuryType?: string | null;
  bodyPart?: string | null;
  generalNotes?: string | null;
  followUpNote?: string | null;
  submitterSignatureName?: string | null;
};

export type IncidentReviewInput = {
  incidentId: string;
  decision: string;
  reviewNotes?: string | null;
};

export type IncidentAmendmentInput = IncidentDraftInput & {
  incidentId: string;
  amendmentNote: string;
};
