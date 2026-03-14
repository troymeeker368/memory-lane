export const MAR_NOT_GIVEN_REASON_OPTIONS = [
  "Refused",
  "Absent",
  "Medication unavailable",
  "Clinical hold",
  "Other"
] as const;

export const MAR_PRN_OUTCOME_OPTIONS = ["Effective", "Ineffective"] as const;

export type MarNotGivenReason = (typeof MAR_NOT_GIVEN_REASON_OPTIONS)[number];
export type MarPrnOutcome = (typeof MAR_PRN_OUTCOME_OPTIONS)[number];

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
  pofMedicationId: string;
  marScheduleId: string | null;
  administrationDate: string;
  scheduledTime: string | null;
  medicationName: string;
  dose: string | null;
  route: string | null;
  status: "Given" | "Not Given";
  notGivenReason: MarNotGivenReason | null;
  prnReason: string | null;
  prnOutcome: MarPrnOutcome | null;
  prnOutcomeAssessedAt: string | null;
  prnFollowupNote: string | null;
  notes: string | null;
  administeredBy: string;
  administeredByUserId: string | null;
  administeredAt: string;
  source: "scheduled" | "prn";
  createdAt: string;
  updatedAt: string;
}

export interface MarPrnOption {
  pofMedicationId: string;
  memberId: string;
  memberName: string;
  medicationName: string;
  dose: string | null;
  route: string | null;
  prnInstructions: string | null;
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
}
