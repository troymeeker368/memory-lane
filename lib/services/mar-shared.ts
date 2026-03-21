export const MAR_NOT_GIVEN_REASON_OPTIONS = [
  "Refused",
  "Absent",
  "Medication unavailable",
  "Clinical hold",
  "Other"
] as const;

export const MAR_PRN_OUTCOME_OPTIONS = ["Effective", "Ineffective"] as const;
export const MAR_PRN_STATUS_OPTIONS = ["Given", "Refused", "Held", "Omitted"] as const;
export const MAR_PRN_FOLLOWUP_STATUS_OPTIONS = ["not_required", "due", "completed", "overdue"] as const;

export type MarNotGivenReason = (typeof MAR_NOT_GIVEN_REASON_OPTIONS)[number];
export type MarPrnOutcome = (typeof MAR_PRN_OUTCOME_OPTIONS)[number];
export type MarPrnStatus = (typeof MAR_PRN_STATUS_OPTIONS)[number];
export type MarPrnFollowupStatus = (typeof MAR_PRN_FOLLOWUP_STATUS_OPTIONS)[number];

export interface MarTodayRow {
  marScheduleId: string;
  memberId: string;
  memberName: string;
  memberPhotoUrl: string | null;
  pofMedicationId: string;
  medicationName: string;
  dose: string | null;
  route: string | null;
  frequency: string | null;
  instructions: string | null;
  prn: boolean;
  scheduledTime: string;
  administrationId: string | null;
  status: "Given" | "Not Given" | null;
  notGivenReason: MarNotGivenReason | null;
  prnReason: string | null;
  notes: string | null;
  administeredBy: string | null;
  administeredByUserId: string | null;
  administeredAt: string | null;
  source: "scheduled" | "prn" | null;
  completed: boolean;
}

export interface MarAdministrationHistoryRow {
  id: string;
  memberId: string;
  memberName: string;
  medicationOrderId: string | null;
  pofMedicationId: string | null;
  marScheduleId: string | null;
  administrationDate: string;
  scheduledTime: string | null;
  medicationName: string;
  dose: string | null;
  route: string | null;
  status: "Given" | "Not Given" | MarPrnStatus;
  notGivenReason: MarNotGivenReason | null;
  prnReason: string | null;
  prnOutcome: MarPrnOutcome | null;
  prnOutcomeAssessedAt: string | null;
  prnFollowupNote: string | null;
  followupDueAt: string | null;
  followupStatus: MarPrnFollowupStatus | null;
  requiresFollowup: boolean;
  notes: string | null;
  administeredBy: string;
  administeredByUserId: string | null;
  administeredAt: string;
  source: "scheduled" | "prn";
  createdAt: string;
  updatedAt: string;
}

export interface MarPrnOption {
  medicationOrderId: string;
  memberId: string;
  memberName: string;
  physicianOrderId: string | null;
  pofMedicationId: string | null;
  medicationName: string;
  strength: string | null;
  form: string | null;
  route: string | null;
  directions: string | null;
  prnReason: string | null;
  frequencyText: string | null;
  minIntervalMinutes: number | null;
  maxDosesPer24h: number | null;
  maxDailyDose: string | null;
  providerName: string | null;
  orderSource: "pof" | "manual_provider_order" | "legacy_mhp";
  status: "active" | "inactive" | "expired" | "discontinued";
  requiresReview: boolean;
  requiresEffectivenessFollowup: boolean;
  startDate: string | null;
  endDate: string | null;
}

export interface MarWorkflowSnapshot {
  today: MarTodayRow[];
  overdueToday: MarTodayRow[];
  notGivenToday: MarAdministrationHistoryRow[];
  history: MarAdministrationHistoryRow[];
  prnLog: MarAdministrationHistoryRow[];
  prnAwaitingOutcome: MarAdministrationHistoryRow[];
  prnEffective: MarAdministrationHistoryRow[];
  prnIneffective: MarAdministrationHistoryRow[];
  prnMedicationOptions: MarPrnOption[];
  memberOptions: Array<{
    memberId: string;
    memberName: string;
  }>;
}
