import { toEasternDate } from "@/lib/timezone";
import { parseCarePlanNurseSignatureStatus } from "@/lib/services/care-plan-nurse-esign-core";
import type {
  CaregiverSignatureStatus,
  CarePlan,
  CarePlanPostSignReadinessStatus,
  CarePlanSection,
  CarePlanSectionInput,
  CarePlanStatus,
  CarePlanTemplate,
  CarePlanVersion,
  DbCarePlan,
  DbCarePlanSection,
  DbCarePlanVersion
} from "@/lib/services/care-plan-types";
import {
  CARE_PLAN_SECTION_TYPES,
  type CarePlanSectionType,
  type CarePlanTrack,
  getAllCarePlanTrackDefinitions,
  getCanonicalTrackSections,
  isCarePlanTrack
} from "@/lib/services/care-plan-track-definitions";

export const CAREGIVER_SIGNATURE_STATUS_VALUES = [
  "not_requested",
  "ready_to_send",
  "send_failed",
  "sent",
  "viewed",
  "signed",
  "expired"
] as const;
export const CARE_PLAN_POST_SIGN_READINESS_STATUS_VALUES = [
  "not_started",
  "signed_pending_snapshot",
  "signed_pending_caregiver_dispatch",
  "ready"
] as const;

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysUntil(date: string) {
  const today = new Date(`${toEasternDate()}T00:00:00.000Z`);
  const target = new Date(`${date}T00:00:00.000Z`);
  return Math.floor((target.getTime() - today.getTime()) / 86400000);
}

function clean(value: string | null | undefined) {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function assertCarePlanTrack(value: string | null | undefined): CarePlanTrack {
  if (isCarePlanTrack(value)) return value;
  throw new Error(`Invalid care plan track value: ${value ?? "(null)"}`);
}

function toCarePlanStatus(value: string | null | undefined): CarePlanStatus {
  if (value === "Due Soon" || value === "Due Now" || value === "Overdue" || value === "Completed") return value;
  return "Completed";
}

function toCaregiverSignatureStatus(value: string | null | undefined): CaregiverSignatureStatus {
  if (value && CAREGIVER_SIGNATURE_STATUS_VALUES.includes(value as CaregiverSignatureStatus)) {
    return value as CaregiverSignatureStatus;
  }
  return "not_requested";
}

function toPostSignReadinessStatus(value: string | null | undefined): CarePlanPostSignReadinessStatus {
  if (value && CARE_PLAN_POST_SIGN_READINESS_STATUS_VALUES.includes(value as CarePlanPostSignReadinessStatus)) {
    return value as CarePlanPostSignReadinessStatus;
  }
  return "not_started";
}

export function resolveCarePlanPostSignReadiness(input: {
  status: string | null | undefined;
  reason: string | null | undefined;
  caregiverSignatureStatus: string | null | undefined;
  finalMemberFileId: string | null | undefined;
}) {
  const storedStatus = toPostSignReadinessStatus(input.status);
  const storedReason = clean(input.reason);
  const caregiverSigned = toCaregiverSignatureStatus(input.caregiverSignatureStatus) === "signed";
  const hasFinalMemberFile = Boolean(clean(input.finalMemberFileId));

  // Signed + filed is the canonical terminal state for care-plan caregiver follow-up.
  if (caregiverSigned && hasFinalMemberFile) {
    return {
      status: "ready" as const,
      reason: null
    };
  }

  return {
    status: storedStatus,
    reason: storedReason
  };
}

export function toCarePlan(row: DbCarePlan): CarePlan {
  const track = assertCarePlanTrack(row.track);
  if (!row.member?.display_name) {
    throw new Error(`Care plan ${row.id} is missing required member linkage.`);
  }
  const nurseSignedByUserId = clean(row.nurse_signed_by_user_id) ?? clean(row.nurse_designee_user_id);
  const parsedNurseSignatureStatus = parseCarePlanNurseSignatureStatus(row.nurse_signature_status);
  const nurseSignatureStatus =
    parsedNurseSignatureStatus === "unsigned" && nurseSignedByUserId && clean(row.nurse_signed_at)
      ? "signed"
      : parsedNurseSignatureStatus;
  const nurseSignedByName =
    clean(row.nurse_signed_by_name) ??
    clean(row.nurse_designee_name) ??
    clean(row.administrator_signature) ??
    clean(row.completed_by);
  const nurseSignatureMetadata =
    row.nurse_signature_metadata && typeof row.nurse_signature_metadata === "object"
      ? (row.nurse_signature_metadata as Record<string, unknown>)
      : {};
  const designeeLinkValid = nurseSignatureStatus !== "signed" || Boolean(nurseSignedByUserId);
  const postSignReadiness = resolveCarePlanPostSignReadiness({
    status: row.post_sign_readiness_status,
    reason: row.post_sign_readiness_reason,
    caregiverSignatureStatus: row.caregiver_signature_status,
    finalMemberFileId: row.final_member_file_id
  });
  return {
    id: row.id,
    memberId: row.member_id,
    memberName: row.member.display_name,
    track,
    enrollmentDate: row.enrollment_date,
    reviewDate: row.review_date,
    lastCompletedDate: row.last_completed_date,
    nextDueDate: row.next_due_date,
    status: computeCarePlanStatus(row.next_due_date),
    completedBy: clean(row.completed_by) ?? nurseSignedByName,
    dateOfCompletion: row.date_of_completion ?? (row.nurse_signed_at ? toEasternDate(row.nurse_signed_at) : null),
    responsiblePartySignature: clean(row.responsible_party_signature),
    responsiblePartySignatureDate: row.responsible_party_signature_date,
    administratorSignature: clean(row.administrator_signature) ?? nurseSignedByName,
    administratorSignatureDate:
      row.administrator_signature_date ?? (row.nurse_signed_at ? toEasternDate(row.nurse_signed_at) : null),
    careTeamNotes: row.care_team_notes ?? "",
    noChangesNeeded: Boolean(row.no_changes_needed),
    modificationsRequired: Boolean(row.modifications_required),
    modificationsDescription: row.modifications_description ?? "",
    nurseDesigneeUserId: row.nurse_designee_user_id ?? nurseSignedByUserId,
    nurseDesigneeName: clean(row.nurse_designee_name) ?? nurseSignedByName,
    nurseSignedAt: row.nurse_signed_at,
    nurseSignatureStatus,
    nurseSignedByUserId,
    nurseSignedByName,
    nurseSignatureArtifactStoragePath: clean(row.nurse_signature_artifact_storage_path),
    nurseSignatureArtifactMemberFileId: clean(row.nurse_signature_artifact_member_file_id),
    nurseSignatureMetadata,
    caregiverName: clean(row.caregiver_name),
    caregiverEmail: clean(row.caregiver_email),
    caregiverSignatureStatus: toCaregiverSignatureStatus(row.caregiver_signature_status),
    caregiverSentAt: row.caregiver_sent_at,
    caregiverSentByUserId: row.caregiver_sent_by_user_id,
    caregiverViewedAt: row.caregiver_viewed_at,
    caregiverSignedAt: row.caregiver_signed_at,
    caregiverSignatureExpiresAt: row.caregiver_signature_expires_at,
    caregiverSignatureRequestUrl: clean(row.caregiver_signature_request_url),
    caregiverSignedName: clean(row.caregiver_signed_name),
    finalMemberFileId: row.final_member_file_id,
    postSignReadinessStatus: postSignReadiness.status,
    postSignReadinessReason: postSignReadiness.reason,
    designeeCleanupRequired: Boolean(row.legacy_cleanup_flag) || !designeeLinkValid,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function cleanGoalLine(value: string) {
  return value.replace(/^\s*(\d+[.):-]|[-*])\s*/, "").trim();
}

function toGoalLines(value: string | null | undefined) {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) => cleanGoalLine(line))
    .filter(Boolean);
}

function toNumberedGoals(value: string | null | undefined, fallback: string) {
  const parsed = toGoalLines(value);
  const fallbackLines = parsed.length > 0 ? parsed : toGoalLines(fallback);
  return fallbackLines.map((line, index) => `${index + 1}. ${line}`).join("\n");
}

function isCarePlanSectionTypeValue(value: string): value is CarePlanSectionType {
  return CARE_PLAN_SECTION_TYPES.includes(value as CarePlanSectionType);
}

export function buildNormalizedSectionsForTrack(
  track: CarePlanTrack,
  overrides?: CarePlanSectionInput[] | null
) {
  const overrideByType = new Map((overrides ?? []).map((section) => [section.sectionType, section] as const));
  return getCanonicalTrackSections(track).map((section) => {
    const override = overrideByType.get(section.sectionType);
    return {
      sectionType: section.sectionType,
      shortTermGoals: toNumberedGoals(override?.shortTermGoals, section.shortTermGoals),
      longTermGoals: toNumberedGoals(override?.longTermGoals, section.longTermGoals),
      displayOrder: section.displayOrder
    };
  });
}

export function resolveCarePlanSections(input: {
  carePlanId: string;
  track: CarePlanTrack;
  sectionRows?: DbCarePlanSection[] | null;
}): CarePlanSection[] {
  const sectionRows = (input.sectionRows ?? []).filter((row) => isCarePlanSectionTypeValue(row.section_type));
  const overrideByType = new Map<CarePlanSectionType, CarePlanSectionInput>();
  const rowByType = new Map<CarePlanSectionType, DbCarePlanSection>();

  sectionRows.forEach((row) => {
    const sectionType = row.section_type as CarePlanSectionType;
    rowByType.set(sectionType, row);
    overrideByType.set(sectionType, {
      sectionType,
      shortTermGoals: row.short_term_goals,
      longTermGoals: row.long_term_goals
    });
  });

  const normalized = buildNormalizedSectionsForTrack(input.track, [...overrideByType.values()]);
  return normalized.map((section) => {
    const existingRow = rowByType.get(section.sectionType);
    return {
      id: existingRow?.id ?? `${input.carePlanId}-${section.sectionType}`,
      carePlanId: input.carePlanId,
      sectionType: section.sectionType,
      shortTermGoals: section.shortTermGoals,
      longTermGoals: section.longTermGoals,
      displayOrder: section.displayOrder
    };
  });
}

function parseSectionSnapshot(value: unknown): CarePlanSectionInput[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const candidate = row as {
        sectionType?: unknown;
        shortTermGoals?: unknown;
        longTermGoals?: unknown;
      };
      if (typeof candidate.sectionType !== "string") return null;
      if (!isCarePlanSectionTypeValue(candidate.sectionType)) return null;
      return {
        sectionType: candidate.sectionType,
        shortTermGoals: String(candidate.shortTermGoals ?? ""),
        longTermGoals: String(candidate.longTermGoals ?? "")
      } satisfies CarePlanSectionInput;
    })
    .filter((row): row is CarePlanSectionInput => Boolean(row));
}

export function toCarePlanVersion(row: DbCarePlanVersion, track: CarePlanTrack): CarePlanVersion {
  const normalizedSections = buildNormalizedSectionsForTrack(track, parseSectionSnapshot(row.sections_snapshot));
  return {
    id: row.id,
    carePlanId: row.care_plan_id,
    versionNumber: row.version_number,
    snapshotType: row.snapshot_type,
    snapshotDate: row.snapshot_date,
    reviewedBy: clean(row.reviewed_by),
    status: toCarePlanStatus(row.status),
    nextDueDate: row.next_due_date,
    noChangesNeeded: Boolean(row.no_changes_needed),
    modificationsRequired: Boolean(row.modifications_required),
    modificationsDescription: row.modifications_description ?? "",
    careTeamNotes: row.care_team_notes ?? "",
    sections: normalizedSections.map((section) => ({
      sectionType: section.sectionType,
      shortTermGoals: section.shortTermGoals,
      longTermGoals: section.longTermGoals,
      displayOrder: section.displayOrder
    })),
    createdAt: row.created_at
  };
}

export function serializeSectionsSnapshot(
  sections: Array<{
    sectionType: CarePlanSectionType;
    shortTermGoals: string;
    longTermGoals: string;
    displayOrder: number;
  }>
) {
  return sections.map((section) => ({
    sectionType: section.sectionType,
    shortTermGoals: section.shortTermGoals,
    longTermGoals: section.longTermGoals,
    displayOrder: section.displayOrder
  }));
}

export function computeCarePlanStatus(nextDueDate: string): CarePlanStatus {
  const delta = daysUntil(nextDueDate);
  if (delta < 0) return "Overdue";
  if (delta === 0) return "Due Now";
  if (delta <= 14) return "Due Soon";
  return "Completed";
}

export function computeInitialDueDate(enrollmentDate: string) {
  return addDays(enrollmentDate, 30);
}

export function computeNextReviewDueDate(lastReviewDate: string) {
  return addDays(lastReviewDate, 180);
}

const templates: CarePlanTemplate[] = getAllCarePlanTrackDefinitions().flatMap((trackDefinition) =>
  trackDefinition.sections.map((section, index) => ({
    id: `tpl-${trackDefinition.track.toLowerCase().replace(/\s+/g, "-")}-${index + 1}`,
    track: trackDefinition.track,
    sectionType: section.sectionType,
    defaultShortTermGoals: toNumberedGoals(section.shortTermGoals.join("\n"), section.shortTermGoals.join("\n")),
    defaultLongTermGoals: toNumberedGoals(section.longTermGoals.join("\n"), section.longTermGoals.join("\n"))
  }))
);

export function getCarePlanTemplates(track?: CarePlanTrack) {
  return templates.filter((template) => (track ? template.track === track : true));
}
