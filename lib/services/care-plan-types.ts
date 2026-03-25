import type { CarePlanNurseSignatureStatus } from "@/lib/services/care-plan-nurse-esign-core";
import type { CarePlanSectionType, CarePlanTrack } from "@/lib/services/care-plan-track-definitions";

export type CarePlanStatus = "Due Soon" | "Due Now" | "Overdue" | "Completed";
export type CaregiverSignatureStatus =
  | "not_requested"
  | "ready_to_send"
  | "send_failed"
  | "sent"
  | "viewed"
  | "signed"
  | "expired";
export type CarePlanPostSignReadinessStatus =
  | "not_started"
  | "signed_pending_snapshot"
  | "signed_pending_caregiver_dispatch"
  | "ready";

export interface CarePlan {
  id: string;
  memberId: string;
  memberName: string;
  track: CarePlanTrack;
  enrollmentDate: string;
  reviewDate: string;
  lastCompletedDate: string | null;
  nextDueDate: string;
  status: CarePlanStatus;
  completedBy: string | null;
  dateOfCompletion: string | null;
  responsiblePartySignature: string | null;
  responsiblePartySignatureDate: string | null;
  administratorSignature: string | null;
  administratorSignatureDate: string | null;
  careTeamNotes: string;
  noChangesNeeded: boolean;
  modificationsRequired: boolean;
  modificationsDescription: string;
  nurseDesigneeUserId: string | null;
  nurseDesigneeName: string | null;
  nurseSignedAt: string | null;
  nurseSignatureStatus: CarePlanNurseSignatureStatus;
  nurseSignedByUserId: string | null;
  nurseSignedByName: string | null;
  nurseSignatureArtifactStoragePath: string | null;
  nurseSignatureArtifactMemberFileId: string | null;
  nurseSignatureMetadata: Record<string, unknown>;
  caregiverName: string | null;
  caregiverEmail: string | null;
  caregiverSignatureStatus: CaregiverSignatureStatus;
  caregiverSentAt: string | null;
  caregiverSentByUserId: string | null;
  caregiverViewedAt: string | null;
  caregiverSignedAt: string | null;
  caregiverSignatureExpiresAt: string | null;
  caregiverSignatureRequestUrl: string | null;
  caregiverSignedName: string | null;
  finalMemberFileId: string | null;
  postSignReadinessStatus: CarePlanPostSignReadinessStatus;
  postSignReadinessReason: string | null;
  designeeCleanupRequired: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CarePlanSection {
  id: string;
  carePlanId: string;
  sectionType: CarePlanSectionType;
  shortTermGoals: string;
  longTermGoals: string;
  displayOrder: number;
}

export interface CarePlanSectionInput {
  sectionType: CarePlanSectionType;
  shortTermGoals: string;
  longTermGoals: string;
}

export interface CarePlanTemplate {
  id: string;
  track: CarePlanTrack;
  sectionType: CarePlanSectionType;
  defaultShortTermGoals: string;
  defaultLongTermGoals: string;
}

export interface CarePlanReviewHistory {
  id: string;
  carePlanId: string;
  reviewDate: string;
  reviewedBy: string;
  summary: string;
  changesMade: boolean;
  nextDueDate: string;
  versionId?: string | null;
}

export interface CarePlanVersion {
  id: string;
  carePlanId: string;
  versionNumber: number;
  snapshotType: "initial" | "review";
  snapshotDate: string;
  reviewedBy: string | null;
  status: CarePlanStatus;
  nextDueDate: string;
  noChangesNeeded: boolean;
  modificationsRequired: boolean;
  modificationsDescription: string;
  careTeamNotes: string;
  sections: Array<{
    sectionType: CarePlanSectionType;
    shortTermGoals: string;
    longTermGoals: string;
    displayOrder: number;
  }>;
  createdAt: string;
}

export interface CarePlanListRow {
  id: string;
  memberId: string;
  memberName: string;
  track: CarePlanTrack;
  enrollmentDate: string;
  reviewDate: string;
  lastCompletedDate: string | null;
  nextDueDate: string;
  status: CarePlanStatus;
  completedBy: string | null;
  postSignReadinessStatus: CarePlanPostSignReadinessStatus;
  postSignReadinessReason: string | null;
  hasExistingPlan: boolean;
  actionHref: string;
  openHref: string;
}

export interface CarePlanListResult {
  rows: CarePlanListRow[];
  page: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
  summary: {
    total: number;
    dueSoon: number;
    dueNow: number;
    overdue: number;
    completedRecently: number;
  };
}

export interface MemberCarePlanSummary {
  hasExistingPlan: boolean;
  nextDueDate: string | null;
  status: CarePlanStatus | null;
  postSignReadinessStatus: CarePlanPostSignReadinessStatus | null;
  postSignReadinessReason: string | null;
  actionHref: string;
  actionLabel: "New Care Plan" | "Review Care Plan";
  planId: string | null;
}

export interface MemberCarePlanSnapshot {
  rows: CarePlan[];
  latest: CarePlan | null;
  summary: MemberCarePlanSummary;
}

export interface CarePlanParticipationSummary {
  attendanceDays: number;
  participationDays: number;
  participationRate: number | null;
  windowStartDate: string;
  windowEndDate: string;
}

export type DbCarePlan = {
  id: string;
  member_id: string;
  track: string;
  enrollment_date: string;
  review_date: string;
  last_completed_date: string | null;
  next_due_date: string;
  status: string;
  completed_by: string | null;
  date_of_completion: string | null;
  responsible_party_signature: string | null;
  responsible_party_signature_date: string | null;
  administrator_signature: string | null;
  administrator_signature_date: string | null;
  care_team_notes: string | null;
  no_changes_needed: boolean;
  modifications_required: boolean;
  modifications_description: string | null;
  nurse_designee_user_id: string | null;
  nurse_designee_name: string | null;
  nurse_signed_at: string | null;
  nurse_signature_status: string | null;
  nurse_signed_by_user_id: string | null;
  nurse_signed_by_name: string | null;
  nurse_signature_artifact_storage_path: string | null;
  nurse_signature_artifact_member_file_id: string | null;
  nurse_signature_metadata: Record<string, unknown> | null;
  caregiver_name: string | null;
  caregiver_email: string | null;
  caregiver_signature_status: string | null;
  caregiver_sent_at: string | null;
  caregiver_sent_by_user_id: string | null;
  caregiver_viewed_at: string | null;
  caregiver_signed_at: string | null;
  caregiver_signature_expires_at: string | null;
  caregiver_signature_request_url: string | null;
  caregiver_signed_name: string | null;
  final_member_file_id: string | null;
  post_sign_readiness_status: string | null;
  post_sign_readiness_reason: string | null;
  legacy_cleanup_flag: boolean | null;
  created_at: string;
  updated_at: string;
  member: { display_name: string } | null;
};

export type DbCarePlanVersion = {
  id: string;
  care_plan_id: string;
  version_number: number;
  snapshot_type: "initial" | "review";
  snapshot_date: string;
  reviewed_by: string | null;
  status: string;
  next_due_date: string;
  no_changes_needed: boolean;
  modifications_required: boolean;
  modifications_description: string | null;
  care_team_notes: string | null;
  sections_snapshot: unknown;
  created_at: string;
};

export type DbCarePlanSection = {
  id: string;
  care_plan_id: string;
  section_type: string;
  short_term_goals: string;
  long_term_goals: string;
  display_order: number;
};
