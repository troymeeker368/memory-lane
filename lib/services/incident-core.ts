import {
  canAccessIncidentReportsForRole,
  canPerformModuleAction,
  normalizeRoleKey,
  type PermissionAction
} from "@/lib/permissions";
import {
  INCIDENT_CATEGORY_OPTIONS,
  INCIDENT_DIRECTOR_DECISION_VALUES,
  INCIDENT_STATUS_VALUES,
  type IncidentCategory,
  type IncidentDirectorDecision,
  type IncidentHistoryEntry,
  type IncidentStatus,
  type IncidentSummaryRow
} from "@/lib/services/incident-shared";

export type ActorContext = {
  id: string;
  fullName: string;
  role: string;
  permissions?: Parameters<typeof canPerformModuleAction>[3];
};

export type IncidentRow = {
  id: string;
  incident_number: string;
  incident_category: string;
  reportable: boolean;
  participant_id: string | null;
  participant_name_snapshot: string | null;
  staff_member_id: string | null;
  staff_member_name_snapshot: string | null;
  reporter_user_id: string;
  reporter_name_snapshot: string;
  additional_parties: string | null;
  incident_datetime: string;
  reported_datetime: string;
  location: string;
  exact_location_details: string | null;
  description: string;
  unsafe_conditions_present: boolean;
  unsafe_conditions_description: string | null;
  injured_by: string | null;
  injury_type: string | null;
  body_part: string | null;
  general_notes: string | null;
  follow_up_note: string | null;
  status: string;
  submitted_at: string | null;
  submitted_by_user_id: string | null;
  submitted_by_name_snapshot: string | null;
  submitter_signature_attested: boolean;
  submitter_signature_name: string | null;
  submitter_signed_at: string | null;
  submitter_signature_artifact_storage_path: string | null;
  director_reviewed_by: string | null;
  director_reviewed_at: string | null;
  director_decision: string | null;
  director_signature_name: string | null;
  director_review_notes: string | null;
  final_pdf_member_file_id: string | null;
  final_pdf_storage_object_path: string | null;
  final_pdf_saved_at: string | null;
  created_at: string;
  updated_at: string;
};

export type IncidentHistoryRow = {
  id: string;
  incident_id: string;
  action: string;
  user_id: string | null;
  user_name_snapshot: string | null;
  notes: string | null;
  previous_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  created_at: string;
};

export function clean(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function asCategory(value: string): IncidentCategory {
  const normalized = clean(value)?.toLowerCase() ?? "other";
  const match = INCIDENT_CATEGORY_OPTIONS.find((option) => option.value === normalized);
  return match?.value ?? "other";
}

export function asStatus(value: string): IncidentStatus {
  const normalized = clean(value)?.toLowerCase() ?? "draft";
  return (INCIDENT_STATUS_VALUES.find((item) => item === normalized) ?? "draft") as IncidentStatus;
}

export function asDirectorDecision(value: string | null | undefined): IncidentDirectorDecision | null {
  const normalized = clean(value)?.toLowerCase();
  if (!normalized) return null;
  return (INCIDENT_DIRECTOR_DECISION_VALUES.find((item) => item === normalized) ?? null) as IncidentDirectorDecision | null;
}

export function statusSortValue(status: IncidentStatus) {
  switch (status) {
    case "submitted":
      return 0;
    case "returned":
      return 1;
    case "draft":
      return 2;
    case "approved":
      return 3;
    case "closed":
    default:
      return 4;
  }
}

function canWriteDocumentation(role: string, permissions: ActorContext["permissions"], action: PermissionAction) {
  return canPerformModuleAction(normalizeRoleKey(role), "documentation", action, permissions);
}

export function assertIncidentReporter(actor: ActorContext) {
  if (!canAccessIncidentReportsForRole(actor.role)) {
    throw new Error("Only nurses, managers, directors, and admins can work with incident reports.");
  }
  if (!canWriteDocumentation(actor.role, actor.permissions, "canCreate") && !canWriteDocumentation(actor.role, actor.permissions, "canEdit")) {
    throw new Error("You do not have permission to create or edit incident reports.");
  }
}

export function assertDirectorReviewer(actor: ActorContext) {
  const role = normalizeRoleKey(actor.role);
  if (role !== "director" && role !== "admin") {
    throw new Error("Only directors or admins can review incident reports.");
  }
}

export function assertAdminAmendment(actor: ActorContext) {
  if (normalizeRoleKey(actor.role) !== "admin") {
    throw new Error("Only admins can amend an approved incident report.");
  }
}

export function serializeIncidentSnapshot(row: IncidentRow) {
  return {
    id: row.id,
    incident_number: row.incident_number,
    incident_category: asCategory(row.incident_category),
    reportable: Boolean(row.reportable),
    participant_id: clean(row.participant_id),
    participant_name_snapshot: clean(row.participant_name_snapshot),
    staff_member_id: clean(row.staff_member_id),
    staff_member_name_snapshot: clean(row.staff_member_name_snapshot),
    reporter_user_id: clean(row.reporter_user_id),
    reporter_name_snapshot: clean(row.reporter_name_snapshot),
    additional_parties: clean(row.additional_parties),
    incident_datetime: row.incident_datetime,
    reported_datetime: row.reported_datetime,
    location: clean(row.location),
    exact_location_details: clean(row.exact_location_details),
    description: clean(row.description),
    unsafe_conditions_present: Boolean(row.unsafe_conditions_present),
    unsafe_conditions_description: clean(row.unsafe_conditions_description),
    injured_by: clean(row.injured_by),
    injury_type: clean(row.injury_type),
    body_part: clean(row.body_part),
    general_notes: clean(row.general_notes),
    follow_up_note: clean(row.follow_up_note),
    status: asStatus(row.status),
    submitted_at: clean(row.submitted_at),
    submitted_by_user_id: clean(row.submitted_by_user_id),
    submitted_by_name_snapshot: clean(row.submitted_by_name_snapshot),
    submitter_signature_attested: Boolean(row.submitter_signature_attested),
    submitter_signature_name: clean(row.submitter_signature_name),
    submitter_signed_at: clean(row.submitter_signed_at),
    submitter_signature_artifact_storage_path: clean(row.submitter_signature_artifact_storage_path),
    director_reviewed_by: clean(row.director_reviewed_by),
    director_reviewed_at: clean(row.director_reviewed_at),
    director_decision: asDirectorDecision(row.director_decision),
    director_signature_name: clean(row.director_signature_name),
    director_review_notes: clean(row.director_review_notes),
    final_pdf_member_file_id: clean(row.final_pdf_member_file_id),
    final_pdf_storage_object_path: clean(row.final_pdf_storage_object_path),
    final_pdf_saved_at: clean(row.final_pdf_saved_at),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

export function mapIncidentSummary(row: IncidentRow): IncidentSummaryRow {
  return {
    id: row.id,
    incidentNumber: row.incident_number,
    category: asCategory(row.incident_category),
    reportable: Boolean(row.reportable),
    status: asStatus(row.status),
    participantName: clean(row.participant_name_snapshot),
    staffMemberName: clean(row.staff_member_name_snapshot),
    reporterName: row.reporter_name_snapshot,
    incidentDateTime: row.incident_datetime,
    location: row.location,
    updatedAt: row.updated_at
  };
}

export function mapIncidentHistory(row: IncidentHistoryRow): IncidentHistoryEntry {
  return {
    id: row.id,
    action: row.action,
    userId: clean(row.user_id),
    userName: clean(row.user_name_snapshot),
    notes: clean(row.notes),
    previousValue: row.previous_value ?? null,
    newValue: row.new_value ?? null,
    createdAt: row.created_at
  };
}
