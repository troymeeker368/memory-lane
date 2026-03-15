import { createClient } from "@/lib/supabase/server";
import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";
import { resolveCanonicalMemberRef } from "@/lib/services/canonical-person-ref";
import { toEasternDate, toEasternISO } from "@/lib/timezone";
import {
  parseCarePlanNurseSignatureStatus,
  type CarePlanNurseSignatureStatus
} from "@/lib/services/care-plan-nurse-esign-core";
import {
  getCarePlanNurseSignatureState,
  signCarePlanNurseEsign
} from "@/lib/services/care-plan-nurse-esign";
import { recordWorkflowMilestone } from "@/lib/services/lifecycle-milestones";
import { getDefaultCaregiverSignatureExpiresOnDate } from "@/lib/services/care-plan-esign-rules";
import { recordWorkflowEvent } from "@/lib/services/workflow-observability";
import {
  CARE_PLAN_CARE_TEAM_NOTES_LABEL,
  CARE_PLAN_LONG_TERM_LABEL,
  CARE_PLAN_REVIEW_OPTIONS,
  CARE_PLAN_REVIEW_UPDATES_LABEL,
  CARE_PLAN_SECTION_TYPES,
  CARE_PLAN_SEPARATOR_LINE,
  CARE_PLAN_SIGNATURE_LABELS,
  CARE_PLAN_SHORT_TERM_LABEL,
  CARE_PLAN_SIGNATURE_LINE_TEMPLATES,
  type CarePlanSectionType,
  type CarePlanTrack,
  getAllCarePlanTrackDefinitions,
  getCanonicalTrackSections,
  getCarePlanTrackDefinition,
  getCarePlanTracks,
  getGoalListItems,
  isCarePlanTrack
} from "@/lib/services/care-plan-track-definitions";

export {
  CARE_PLAN_CARE_TEAM_NOTES_LABEL,
  CARE_PLAN_LONG_TERM_LABEL,
  CARE_PLAN_REVIEW_OPTIONS,
  CARE_PLAN_REVIEW_UPDATES_LABEL,
  CARE_PLAN_SECTION_TYPES,
  CARE_PLAN_SEPARATOR_LINE,
  CARE_PLAN_SIGNATURE_LABELS,
  CARE_PLAN_SHORT_TERM_LABEL,
  CARE_PLAN_SIGNATURE_LINE_TEMPLATES,
  getCarePlanTracks,
  getGoalListItems
};
export type { CarePlanSectionType, CarePlanTrack };

export type CarePlanStatus = "Due Soon" | "Due Now" | "Overdue" | "Completed";

const CARE_PLAN_CORE_RPC = "rpc_upsert_care_plan_core";
const CARE_PLAN_CORE_RPC_MIGRATION = "0056_shared_rpc_orchestration_hardening.sql";
const CARE_PLAN_SNAPSHOT_RPC = "rpc_record_care_plan_snapshot";
const CARE_PLAN_SNAPSHOT_RPC_MIGRATION = "0054_care_plan_snapshot_atomicity.sql";

type CarePlanCoreRpcRow = {
  care_plan_id: string;
  was_created: boolean;
};

type CarePlanSnapshotRpcRow = {
  version_id: string;
  version_number: number;
};

type CarePlanWorkflowError = Error & {
  carePlanId?: string;
  partiallyCommitted?: boolean;
};

function buildCarePlanWorkflowError(message: string, carePlanId: string) {
  const error = new Error(message) as CarePlanWorkflowError;
  error.carePlanId = carePlanId;
  error.partiallyCommitted = true;
  return error;
}

async function resolveCarePlanMemberId(rawMemberId: string, actionLabel: string) {
  const canonical = await resolveCanonicalMemberRef(
    {
      sourceType: "member",
      memberId: rawMemberId
    },
    { actionLabel }
  );
  if (!canonical.memberId) {
    throw new Error(`${actionLabel} expected member.id but canonical member resolution returned empty memberId.`);
  }
  return canonical.memberId;
}

export const CAREGIVER_SIGNATURE_STATUS_VALUES = [
  "not_requested",
  "ready_to_send",
  "send_failed",
  "sent",
  "viewed",
  "signed",
  "expired"
] as const;
export type CaregiverSignatureStatus = (typeof CAREGIVER_SIGNATURE_STATUS_VALUES)[number];

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
  actionHref: string;
  actionLabel: "New Care Plan" | "Review Care Plan";
  planId: string | null;
}

export interface CarePlanParticipationSummary {
  attendanceDays: number;
  participationDays: number;
  participationRate: number | null;
  windowStartDate: string;
  windowEndDate: string;
}

type DbCarePlan = {
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
  legacy_cleanup_flag: boolean | null;
  created_at: string;
  updated_at: string;
  member: { display_name: string } | null;
};

type DbCarePlanVersion = {
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

type DbCarePlanSection = {
  id: string;
  care_plan_id: string;
  section_type: string;
  short_term_goals: string;
  long_term_goals: string;
  display_order: number;
};

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

function isPostgresUniqueViolation(error: { code?: string | null; message?: string | null; details?: string | null } | null | undefined) {
  const text = [error?.message, error?.details].filter(Boolean).join(" ").toLowerCase();
  return error?.code === "23505" || text.includes("duplicate key value") || text.includes("unique constraint");
}

function isCarePlanRootUniqueViolation(error: { code?: string | null; message?: string | null; details?: string | null } | null | undefined) {
  const text = [error?.message, error?.details].filter(Boolean).join(" ").toLowerCase();
  return isPostgresUniqueViolation(error) && text.includes("idx_care_plans_member_track_unique");
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

function toCarePlan(row: DbCarePlan): CarePlan {
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

function buildNormalizedSectionsForTrack(
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

function resolveCarePlanSections(input: {
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

function toCarePlanVersion(row: DbCarePlanVersion, track: CarePlanTrack): CarePlanVersion {
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

function serializeSectionsSnapshot(
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

async function createCarePlanVersionSnapshot(input: {
  carePlanId: string;
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
  reviewHistory?: {
    reviewDate: string;
    reviewedBy: string | null;
    summary: string;
    changesMade: boolean;
  } | null;
  serviceRole?: boolean;
}) {
  const supabase = await createClient({ serviceRole: Boolean(input.serviceRole) });
  try {
    const data = await invokeSupabaseRpcOrThrow<unknown>(supabase, CARE_PLAN_SNAPSHOT_RPC, {
      p_care_plan_id: input.carePlanId,
      p_snapshot_type: input.snapshotType,
      p_snapshot_date: input.snapshotDate,
      p_reviewed_by: input.reviewedBy,
      p_status: input.status,
      p_next_due_date: input.nextDueDate,
      p_no_changes_needed: input.noChangesNeeded,
      p_modifications_required: input.modificationsRequired,
      p_modifications_description: input.modificationsDescription,
      p_care_team_notes: input.careTeamNotes,
      p_sections_snapshot: serializeSectionsSnapshot(input.sections),
      p_review_date: input.reviewHistory?.reviewDate ?? null,
      p_review_summary: input.reviewHistory?.summary ?? null,
      p_review_changes_made: input.reviewHistory?.changesMade ?? null
    });
    const row = (Array.isArray(data) ? data[0] : null) as CarePlanSnapshotRpcRow | null;
    if (!row?.version_id) {
      throw new Error("Care plan snapshot RPC did not return a version id.");
    }
    return {
      versionId: String(row.version_id),
      versionNumber: Number(row.version_number ?? 0)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save care plan version snapshot.";
    if (message.includes(CARE_PLAN_SNAPSHOT_RPC)) {
      throw new Error(
        `Care plan snapshot RPC is not available. Apply Supabase migration ${CARE_PLAN_SNAPSHOT_RPC_MIGRATION} and refresh PostgREST schema cache.`
      );
    }
    throw error;
  }
}

async function syncCarePlanSectionsToCanonical(
  carePlanId: string,
  track: CarePlanTrack,
  sections: CarePlanSectionInput[] | null | undefined,
  serviceRole = false
) {
  const supabase = await createClient({ serviceRole });
  const normalizedSections = buildNormalizedSectionsForTrack(track, sections).map((section) => ({
    care_plan_id: carePlanId,
    section_type: section.sectionType,
    short_term_goals: section.shortTermGoals,
    long_term_goals: section.longTermGoals,
    display_order: section.displayOrder,
    updated_at: toEasternISO()
  }));
  const { error } = await supabase
    .from("care_plan_sections")
    .upsert(normalizedSections, { onConflict: "care_plan_id,section_type" });
  if (error) throw new Error(error.message);
}

async function upsertCarePlanCore(input: {
  carePlanId?: string | null;
  memberId: string;
  track: CarePlanTrack;
  enrollmentDate: string;
  reviewDate: string;
  lastCompletedDate: string;
  nextDueDate: string;
  status: CarePlanStatus;
  careTeamNotes: string;
  noChangesNeeded: boolean;
  modificationsRequired: boolean;
  modificationsDescription: string;
  caregiverName?: string | null;
  caregiverEmail?: string | null;
  actor: { id: string; fullName: string };
  now: string;
  sections: Array<{
    sectionType: CarePlanSectionType;
    shortTermGoals: string;
    longTermGoals: string;
    displayOrder: number;
  }>;
}) {
  const supabase = await createClient();
  try {
    const data = await invokeSupabaseRpcOrThrow<unknown>(supabase, CARE_PLAN_CORE_RPC, {
      p_care_plan_id: input.carePlanId ?? null,
      p_member_id: input.memberId,
      p_track: input.track,
      p_enrollment_date: input.enrollmentDate,
      p_review_date: input.reviewDate,
      p_last_completed_date: input.lastCompletedDate,
      p_next_due_date: input.nextDueDate,
      p_status: input.status,
      p_care_team_notes: input.careTeamNotes,
      p_no_changes_needed: input.noChangesNeeded,
      p_modifications_required: input.modificationsRequired,
      p_modifications_description: input.modificationsDescription,
      p_caregiver_name: input.caregiverName ?? null,
      p_caregiver_email: input.caregiverEmail ?? null,
      p_actor_user_id: input.actor.id,
      p_actor_name: input.actor.fullName,
      p_now: input.now,
      p_sections: serializeSectionsSnapshot(input.sections)
    });
    const row = (Array.isArray(data) ? data[0] : null) as CarePlanCoreRpcRow | null;
    if (!row?.care_plan_id) {
      throw new Error("Care plan core RPC did not return a care plan id.");
    }
    return {
      carePlanId: String(row.care_plan_id),
      wasCreated: Boolean(row.was_created)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save care plan core.";
    if (message.includes(CARE_PLAN_CORE_RPC)) {
      throw new Error(
        `Care plan core RPC is not available. Apply Supabase migration ${CARE_PLAN_CORE_RPC_MIGRATION} and refresh PostgREST schema cache.`
      );
    }
    throw error;
  }
}

async function findCarePlanRootByMemberTrack(memberId: string, track: CarePlanTrack, serviceRole = false) {
  const supabase = await createClient({ serviceRole });
  const { data, error } = await supabase
    .from("care_plans")
    .select("id")
    .eq("member_id", memberId)
    .eq("track", track)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? String(data.id) : null;
}

export async function getCarePlanParticipationSummary(memberId: string): Promise<CarePlanParticipationSummary> {
  const canonicalMemberId = await resolveCarePlanMemberId(memberId, "getCarePlanParticipationSummary");
  const supabase = await createClient();
  const windowEndDate = toEasternDate();
  const windowStartDate = addDays(windowEndDate, -180);
  const [{ data: attendanceRows, error: attendanceError }, { data: activityRows, error: activityError }] =
    await Promise.all([
      supabase
        .from("attendance_records")
        .select("attendance_date")
        .eq("member_id", canonicalMemberId)
        .gte("attendance_date", windowStartDate)
        .lte("attendance_date", windowEndDate),
      supabase
        .from("daily_activity_logs")
        .select("activity_date")
        .eq("member_id", canonicalMemberId)
        .gte("activity_date", windowStartDate)
        .lte("activity_date", windowEndDate)
    ]);
  if (attendanceError) throw new Error(attendanceError.message);
  if (activityError) throw new Error(activityError.message);
  const attendanceDays = (attendanceRows ?? []).length;
  const participationDays = new Set((activityRows ?? []).map((row: any) => String(row.activity_date).slice(0, 10))).size;
  return {
    attendanceDays,
    participationDays,
    participationRate: attendanceDays === 0 ? null : Math.round((participationDays / attendanceDays) * 100),
    windowStartDate,
    windowEndDate
  };
}

async function listCarePlanRows(filters?: {
  memberId?: string;
  track?: string;
  status?: string;
  query?: string;
  carePlanId?: string;
  serviceRole?: boolean;
}) {
  const supabase = await createClient({ serviceRole: Boolean(filters?.serviceRole) });
  const canonicalMemberId = filters?.memberId
    ? await resolveCarePlanMemberId(filters.memberId, "listCarePlanRows")
    : null;
  let query = supabase
    .from("care_plans")
    .select("*, member:members!care_plans_member_id_fkey(display_name)")
    .order("next_due_date", { ascending: true });
  if (filters?.carePlanId) query = query.eq("id", filters.carePlanId);
  if (canonicalMemberId) query = query.eq("member_id", canonicalMemberId);
  if (filters?.track && filters.track !== "All") query = query.eq("track", filters.track);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const plans = (data ?? []) as DbCarePlan[];
  const mapped = plans.map((row) => toCarePlan(row));
  return mapped
    .filter((row) => (filters?.status && filters.status !== "All" ? row.status === filters.status : true))
    .filter((row) =>
      filters?.query ? `${row.memberName} ${row.track}`.toLowerCase().includes(filters.query.toLowerCase()) : true
    );
}

async function resolveCarePlanQueryMemberIds(queryText?: string | null) {
  const query = clean(queryText);
  if (!query) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("members")
    .select("id")
    .ilike("display_name", `%${query.replace(/[%,_]/g, (match) => `\\${match}`)}%`)
    .order("display_name", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
}

function applyCarePlanStatusFilter(query: any, status: string | undefined) {
  if (!status || status === "All") return query;
  const today = toEasternDate();
  const dueSoonEnd = addDays(today, 14);
  if (status === "Overdue") return query.lt("next_due_date", today);
  if (status === "Due Now") return query.eq("next_due_date", today);
  if (status === "Due Soon") return query.gt("next_due_date", today).lte("next_due_date", dueSoonEnd);
  if (status === "Completed") return query.gt("next_due_date", dueSoonEnd);
  return query;
}

async function getCarePlanCount(filters: {
  memberId?: string;
  track?: string;
  status?: string;
  query?: string;
}) {
  const supabase = await createClient();
  const canonicalMemberId = filters.memberId
    ? await resolveCarePlanMemberId(filters.memberId, "getCarePlanCount")
    : null;
  const queryMemberIds = await resolveCarePlanQueryMemberIds(filters.query);
  if (queryMemberIds && queryMemberIds.length === 0) return 0;
  let query: any = supabase.from("care_plans").select("id", { count: "exact", head: true });
  if (canonicalMemberId) query = query.eq("member_id", canonicalMemberId);
  if (filters.track && filters.track !== "All") query = query.eq("track", filters.track);
  if (queryMemberIds) query = query.in("member_id", queryMemberIds);
  query = applyCarePlanStatusFilter(query, filters.status);
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function getCarePlans(filters?: {
  memberId?: string;
  track?: string;
  status?: string;
  query?: string;
  page?: number;
  pageSize?: number;
}): Promise<CarePlanListResult> {
  const supabase = await createClient();
  const page = Number.isFinite(filters?.page) && Number(filters?.page) > 0 ? Math.floor(Number(filters?.page)) : 1;
  const pageSize =
    Number.isFinite(filters?.pageSize) && Number(filters?.pageSize) > 0 ? Math.floor(Number(filters?.pageSize)) : 25;
  const canonicalMemberId = filters?.memberId
    ? await resolveCarePlanMemberId(filters.memberId, "getCarePlans")
    : null;
  const queryMemberIds = await resolveCarePlanQueryMemberIds(filters?.query);
  if (queryMemberIds && queryMemberIds.length === 0) {
    return {
      rows: [],
      page,
      pageSize,
      totalRows: 0,
      totalPages: 1,
      summary: { total: 0, dueSoon: 0, dueNow: 0, overdue: 0, completedRecently: 0 }
    };
  }

  let query: any = supabase
    .from("care_plans")
    .select("*, member:members!care_plans_member_id_fkey(display_name)", { count: "exact" })
    .order("next_due_date", { ascending: true })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (canonicalMemberId) query = query.eq("member_id", canonicalMemberId);
  if (filters?.track && filters.track !== "All") query = query.eq("track", filters.track);
  if (queryMemberIds) query = query.in("member_id", queryMemberIds);
  query = applyCarePlanStatusFilter(query, filters?.status);
  const { data, error, count } = await query;
  if (error) throw new Error(error.message);
  const rows = ((data ?? []) as DbCarePlan[]).map((plan) => toCarePlan(plan)).map((plan) => ({
    id: plan.id,
    memberId: plan.memberId,
    memberName: plan.memberName,
    track: plan.track,
    enrollmentDate: plan.enrollmentDate,
    reviewDate: plan.reviewDate,
    lastCompletedDate: plan.lastCompletedDate,
    nextDueDate: plan.nextDueDate,
    status: plan.status,
    completedBy: plan.completedBy,
    hasExistingPlan: true,
    actionHref: `/health/care-plans/${plan.id}?view=review`,
    openHref: `/health/care-plans/${plan.id}`
  }));
  const [totalCount, dueSoonCount, dueNowCount, overdueCount] = await Promise.all([
    getCarePlanCount({ memberId: filters?.memberId, track: filters?.track, query: filters?.query }),
    getCarePlanCount({ memberId: filters?.memberId, track: filters?.track, query: filters?.query, status: "Due Soon" }),
    getCarePlanCount({ memberId: filters?.memberId, track: filters?.track, query: filters?.query, status: "Due Now" }),
    getCarePlanCount({ memberId: filters?.memberId, track: filters?.track, query: filters?.query, status: "Overdue" })
  ]);
  return {
    rows,
    page,
    pageSize,
    totalRows: count ?? rows.length,
    totalPages: Math.max(1, Math.ceil((count ?? rows.length) / pageSize)),
    summary: {
      total: totalCount,
      dueSoon: dueSoonCount,
      dueNow: dueNowCount,
      overdue: overdueCount,
      completedRecently: 0
    }
  };
}

export async function getCarePlanById(id: string, options?: { serviceRole?: boolean }) {
  const rows = await listCarePlanRows({ carePlanId: id, serviceRole: Boolean(options?.serviceRole) });
  const baseCarePlan = rows[0] ?? null;
  if (!baseCarePlan) return null;
  const signature = await getCarePlanNurseSignatureState(id, { serviceRole: Boolean(options?.serviceRole) });
  const carePlan: CarePlan = {
    ...baseCarePlan,
    nurseSignatureStatus: signature.status,
    nurseSignedByUserId: signature.signedByUserId,
    nurseSignedByName: signature.signedByName,
    nurseSignedAt: signature.signedAt ?? baseCarePlan.nurseSignedAt,
    nurseSignatureArtifactStoragePath:
      signature.signatureArtifactStoragePath ?? baseCarePlan.nurseSignatureArtifactStoragePath,
    nurseSignatureArtifactMemberFileId:
      signature.signatureArtifactMemberFileId ?? baseCarePlan.nurseSignatureArtifactMemberFileId,
    nurseSignatureMetadata: signature.signatureMetadata,
    completedBy: signature.signedByName ?? baseCarePlan.completedBy,
    administratorSignature: signature.signedByName ?? baseCarePlan.administratorSignature,
    nurseDesigneeUserId: signature.signedByUserId ?? baseCarePlan.nurseDesigneeUserId,
    nurseDesigneeName: signature.signedByName ?? baseCarePlan.nurseDesigneeName
  };
  const supabase = await createClient({ serviceRole: Boolean(options?.serviceRole) });
  const [
    { data: historyRows, error: historyError },
    { data: versionRows, error: versionsError },
    { data: sectionRows, error: sectionError }
  ] = await Promise.all([
    supabase
      .from("care_plan_review_history")
      .select("*")
      .eq("care_plan_id", id)
      .order("review_date", { ascending: false }),
    supabase
      .from("care_plan_versions")
      .select("*")
      .eq("care_plan_id", id)
      .order("version_number", { ascending: false }),
    supabase
      .from("care_plan_sections")
      .select("*")
      .eq("care_plan_id", id)
      .order("display_order", { ascending: true })
  ]);
  if (historyError) throw new Error(historyError.message);
  if (versionsError) throw new Error(versionsError.message);
  if (sectionError) throw new Error(sectionError.message);
  const resolvedSections = resolveCarePlanSections({
    carePlanId: carePlan.id,
    track: carePlan.track,
    sectionRows: (sectionRows ?? []) as DbCarePlanSection[]
  });
  return {
    carePlan,
    sections: resolvedSections,
    history: (historyRows ?? []).map(
      (row: any) =>
        ({
          id: row.id,
          carePlanId: row.care_plan_id,
          reviewDate: row.review_date,
          reviewedBy: row.reviewed_by,
          summary: row.summary,
          changesMade: Boolean(row.changes_made),
          nextDueDate: row.next_due_date,
          versionId: row.version_id ?? null
        }) satisfies CarePlanReviewHistory
    ),
    versions: ((versionRows ?? []) as DbCarePlanVersion[]).map((row) => toCarePlanVersion(row, carePlan.track)),
    participationSummary: await getCarePlanParticipationSummary(carePlan.memberId)
  };
}

export async function getCarePlanDashboard(input?: { page?: number; pageSize?: number }) {
  const plans = await getCarePlans({ page: input?.page, pageSize: input?.pageSize });
  const dueSoon = plans.rows.filter((row) => row.status === "Due Soon");
  const dueNow = plans.rows.filter((row) => row.status === "Due Now");
  const overdue = plans.rows.filter((row) => row.status === "Overdue");
  return {
    summary: plans.summary,
    dueSoon,
    dueNow,
    overdue,
    recentlyCompleted: [] as Array<CarePlanReviewHistory & { memberId: string; memberName: string; track: CarePlanTrack }>,
    plans: plans.rows,
    page: plans.page,
    pageSize: plans.pageSize,
    totalRows: plans.totalRows,
    totalPages: plans.totalPages
  };
}

export async function getCarePlansForMember(memberId: string) {
  const canonicalMemberId = await resolveCarePlanMemberId(memberId, "getCarePlansForMember");
  return await listCarePlanRows({ memberId: canonicalMemberId });
}

export async function getLatestCarePlanForMember(memberId: string) {
  const canonicalMemberId = await resolveCarePlanMemberId(memberId, "getLatestCarePlanForMember");
  const rows = await listCarePlanRows({ memberId: canonicalMemberId });
  return (
    rows.sort((a, b) => {
      if (a.reviewDate === b.reviewDate) return a.updatedAt < b.updatedAt ? 1 : -1;
      return a.reviewDate < b.reviewDate ? 1 : -1;
    })[0] ?? null
  );
}

export async function getMemberCarePlanSummary(memberId: string): Promise<MemberCarePlanSummary> {
  const canonicalMemberId = await resolveCarePlanMemberId(memberId, "getMemberCarePlanSummary");
  const latest = await getLatestCarePlanForMember(canonicalMemberId);
  if (latest) {
    return {
      hasExistingPlan: true,
      nextDueDate: latest.nextDueDate,
      status: latest.status,
      actionHref: `/health/care-plans/${latest.id}?view=review`,
      actionLabel: "Review Care Plan",
      planId: latest.id
    };
  }
  return {
    hasExistingPlan: false,
    nextDueDate: null,
    status: null,
    actionHref: `/health/care-plans/new?memberId=${canonicalMemberId}`,
    actionLabel: "New Care Plan",
    planId: null
  };
}

export async function getCarePlanVersionById(carePlanId: string, versionId: string) {
  const detail = await getCarePlanById(carePlanId);
  if (!detail) return null;
  const version = detail.versions.find((row) => row.id === versionId) ?? null;
  if (!version) return null;
  return {
    carePlan: detail.carePlan,
    version
  };
}

function sanitizeCaregiverName(value: string | null | undefined) {
  return clean(value);
}

function sanitizeCaregiverEmail(value: string | null | undefined) {
  const normalized = clean(value);
  if (!normalized) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error("Caregiver email is invalid.");
  return normalized.toLowerCase();
}

async function finalizeCaregiverDispatchAfterNurseSignature(input: {
  carePlanId: string;
  actor: { id: string; fullName: string; signatureName: string };
}) {
  const signedRows = await listCarePlanRows({ carePlanId: input.carePlanId });
  const signedCarePlan = signedRows[0];
  if (!signedCarePlan) throw new Error("Care plan could not be loaded after nurse/admin signature.");

  const hasCaregiverContact =
    Boolean(clean(signedCarePlan.caregiverName)) && Boolean(clean(signedCarePlan.caregiverEmail));
  const shouldAutoSend = hasCaregiverContact && signedCarePlan.caregiverSignatureStatus !== "signed";

  if (shouldAutoSend) {
    const { sendCarePlanToCaregiverForSignature } = await import("@/lib/services/care-plan-esign");
    return sendCarePlanToCaregiverForSignature({
      carePlanId: signedCarePlan.id,
      caregiverName: signedCarePlan.caregiverName!,
      caregiverEmail: signedCarePlan.caregiverEmail!,
      optionalMessage: null,
      expiresOnDate: getDefaultCaregiverSignatureExpiresOnDate(),
      actor: {
        id: input.actor.id,
        fullName: input.actor.fullName,
        signatureName: input.actor.signatureName
      }
    });
  }

  const supabase = await createClient();
  const { error: touchError } = await supabase
    .from("care_plans")
    .update({
      updated_by_user_id: input.actor.id,
      updated_by_name: input.actor.fullName,
      updated_at: toEasternISO()
    })
    .eq("id", input.carePlanId);
  if (touchError) throw new Error(touchError.message);

  const refreshedRows = await listCarePlanRows({ carePlanId: input.carePlanId });
  const refreshed = refreshedRows[0];
  if (!refreshed) throw new Error("Care plan could not be reloaded after nurse/admin signature.");
  return refreshed;
}

export async function createCarePlan(input: {
  memberId: string;
  track: CarePlanTrack;
  sections: CarePlanSectionInput[];
  enrollmentDate: string;
  reviewDate: string;
  careTeamNotes: string;
  noChangesNeeded?: boolean;
  modificationsRequired?: boolean;
  modificationsDescription?: string;
  caregiverName?: string | null;
  caregiverEmail?: string | null;
  signatureAttested: boolean;
  signatureImageDataUrl: string;
  actor: { id: string; fullName: string; signatureName: string; role: string };
}) {
  const canonicalMemberId = await resolveCarePlanMemberId(input.memberId, "createCarePlan");
  const existingCarePlanId = await findCarePlanRootByMemberTrack(canonicalMemberId, input.track);
  if (existingCarePlanId) {
    throw new Error("A care plan already exists for this member and track. Review the existing plan instead of creating a new root record.");
  }
  const now = toEasternISO();
  const completionDate = input.reviewDate;
  const nextDueDate = computeNextReviewDueDate(completionDate);
  const normalizedSections = buildNormalizedSectionsForTrack(input.track, input.sections);
  const caregiverName = sanitizeCaregiverName(input.caregiverName);
  const caregiverEmail = sanitizeCaregiverEmail(input.caregiverEmail);
  let createdCarePlanId: string;
  try {
    const saved = await upsertCarePlanCore({
      memberId: canonicalMemberId,
      track: input.track,
      enrollmentDate: input.enrollmentDate,
      reviewDate: input.reviewDate,
      lastCompletedDate: completionDate,
      nextDueDate,
      status: computeCarePlanStatus(nextDueDate),
      careTeamNotes: input.careTeamNotes,
      noChangesNeeded: Boolean(input.noChangesNeeded),
      modificationsRequired: Boolean(input.modificationsRequired),
      modificationsDescription: input.modificationsDescription ?? "",
      caregiverName,
      caregiverEmail,
      actor: {
        id: input.actor.id,
        fullName: input.actor.fullName
      },
      now,
      sections: normalizedSections
    });
    createdCarePlanId = saved.carePlanId;
  } catch (error) {
    if (
      isCarePlanRootUniqueViolation(
        error as { code?: string | null; message?: string | null; details?: string | null } | null | undefined
      )
    ) {
      throw new Error("A care plan already exists for this member and track. Review the existing plan instead of creating a new root record.");
    }
    throw error;
  }

  let signedState: Awaited<ReturnType<typeof signCarePlanNurseEsign>>;
  try {
    signedState = await signCarePlanNurseEsign({
      carePlanId: createdCarePlanId,
      actor: {
        id: input.actor.id,
        fullName: input.actor.fullName,
        role: input.actor.role,
        signoffName: input.actor.signatureName
      },
      attested: input.signatureAttested,
      signatureImageDataUrl: input.signatureImageDataUrl,
      metadata: {
        module: "care-plan",
        signedFrom: "createCarePlan"
      }
    });
  } catch (error) {
    const signError = error instanceof Error ? error.message : "Unknown signature persistence error.";
    throw buildCarePlanWorkflowError(
      `Care Plan was created, but nurse/admin e-signature finalization failed (${signError}). Open the saved care plan and retry signing.`,
      createdCarePlanId
    );
  }

  try {
    await createCarePlanVersionSnapshot({
      carePlanId: createdCarePlanId,
      snapshotType: "initial",
      snapshotDate: input.reviewDate,
      reviewedBy: signedState.signedByName ?? input.actor.signatureName,
      status: computeCarePlanStatus(nextDueDate),
      nextDueDate,
      noChangesNeeded: Boolean(input.noChangesNeeded),
      modificationsRequired: Boolean(input.modificationsRequired),
      modificationsDescription: input.modificationsDescription ?? "",
      careTeamNotes: input.careTeamNotes,
      sections: normalizedSections
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to persist care plan version snapshot.";
    throw buildCarePlanWorkflowError(
      `Care Plan was created and signed, but version history persistence failed (${message}). Open the saved care plan before retrying downstream actions.`,
      createdCarePlanId
    );
  }

  await recordWorkflowEvent({
    eventType: "care_plan_created",
    entityType: "care_plan",
    entityId: createdCarePlanId,
    actorType: "user",
    actorUserId: input.actor.id,
    status: "created",
    severity: "low",
    metadata: {
      member_id: canonicalMemberId,
      track: input.track,
      review_date: input.reviewDate,
      next_due_date: nextDueDate
    }
  });
  await recordWorkflowMilestone({
    event: {
      eventType: "care_plan_created",
      entityType: "care_plan",
      entityId: createdCarePlanId,
      actorType: "user",
      actorUserId: input.actor.id,
      status: "created",
      severity: "low",
      metadata: {
        member_id: canonicalMemberId,
        track: input.track,
        review_date: input.reviewDate,
        next_due_date: nextDueDate
      }
    }
  });

  try {
    return await finalizeCaregiverDispatchAfterNurseSignature({
      carePlanId: createdCarePlanId,
      actor: {
        id: input.actor.id,
        fullName: input.actor.fullName,
        signatureName: input.actor.signatureName
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to complete caregiver dispatch.";
    throw buildCarePlanWorkflowError(
      `Care Plan was created and signed, but caregiver dispatch failed (${message}). Open the saved care plan to retry sending the caregiver link.`,
      createdCarePlanId
    );
  }
}

export async function reviewCarePlan(input: {
  carePlanId: string;
  reviewDate: string;
  sections: CarePlanSectionInput[];
  noChangesNeeded: boolean;
  modificationsRequired: boolean;
  modificationsDescription: string;
  careTeamNotes: string;
  caregiverName?: string | null;
  caregiverEmail?: string | null;
  signatureAttested: boolean;
  signatureImageDataUrl: string;
  actor: { id: string; fullName: string; signatureName: string; role: string };
}) {
  const supabase = await createClient();
  const { data: existing, error: existingError } = await supabase
    .from("care_plans")
    .select("id, member_id, track, enrollment_date")
    .eq("id", input.carePlanId)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (!existing) throw new Error("Care plan not found.");

  const track = assertCarePlanTrack(existing.track);
  const normalizedSections = buildNormalizedSectionsForTrack(track, input.sections);
  const now = toEasternISO();
  const nextDueDate = computeNextReviewDueDate(input.reviewDate);
  const caregiverName = sanitizeCaregiverName(input.caregiverName);
  const caregiverEmail = sanitizeCaregiverEmail(input.caregiverEmail);
  await upsertCarePlanCore({
    carePlanId: input.carePlanId,
    memberId: String(existing.member_id),
    track,
    enrollmentDate: String(existing.enrollment_date),
    reviewDate: input.reviewDate,
    lastCompletedDate: input.reviewDate,
    nextDueDate,
    status: computeCarePlanStatus(nextDueDate),
    careTeamNotes: input.careTeamNotes,
    noChangesNeeded: input.noChangesNeeded,
    modificationsRequired: input.modificationsRequired,
    modificationsDescription: input.modificationsDescription,
    caregiverName,
    caregiverEmail,
    actor: {
      id: input.actor.id,
      fullName: input.actor.fullName
    },
    now,
    sections: normalizedSections
  });

  const signedState = await signCarePlanNurseEsign({
    carePlanId: input.carePlanId,
    actor: {
      id: input.actor.id,
      fullName: input.actor.fullName,
      role: input.actor.role,
      signoffName: input.actor.signatureName
    },
    attested: input.signatureAttested,
    signatureImageDataUrl: input.signatureImageDataUrl,
    metadata: {
      module: "care-plan",
      signedFrom: "reviewCarePlan"
    }
  });

  try {
    await createCarePlanVersionSnapshot({
      carePlanId: input.carePlanId,
      snapshotType: "review",
      snapshotDate: input.reviewDate,
      reviewedBy: signedState.signedByName ?? input.actor.signatureName,
      status: computeCarePlanStatus(nextDueDate),
      nextDueDate,
      noChangesNeeded: input.noChangesNeeded,
      modificationsRequired: input.modificationsRequired,
      modificationsDescription: input.modificationsDescription,
      careTeamNotes: input.careTeamNotes,
      sections: normalizedSections,
      reviewHistory: {
        reviewDate: input.reviewDate,
        reviewedBy: signedState.signedByName ?? input.actor.signatureName,
        summary: input.modificationsRequired
          ? input.modificationsDescription || "Reviewed with modifications."
          : "Reviewed without required modifications.",
        changesMade: input.modificationsRequired
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to persist care plan review history.";
    throw buildCarePlanWorkflowError(
      `Care Plan review was saved and signed, but version/review history persistence failed (${message}). Open the saved care plan before retrying downstream actions.`,
      input.carePlanId
    );
  }

  await recordWorkflowEvent({
    eventType: "care_plan_reviewed",
    entityType: "care_plan",
    entityId: input.carePlanId,
    actorType: "user",
    actorUserId: input.actor.id,
    status: "completed",
    severity: "low",
    metadata: {
      member_id: String(existing.member_id),
      track,
      review_date: input.reviewDate,
      next_due_date: nextDueDate
    }
  });
  await recordWorkflowMilestone({
    event: {
      eventType: "care_plan_reviewed",
      entityType: "care_plan",
      entityId: input.carePlanId,
      actorType: "user",
      actorUserId: input.actor.id,
      status: "completed",
      severity: "low",
      metadata: {
        member_id: String(existing.member_id),
        track,
        review_date: input.reviewDate,
        next_due_date: nextDueDate
      }
    }
  });

  try {
    return await finalizeCaregiverDispatchAfterNurseSignature({
      carePlanId: input.carePlanId,
      actor: {
        id: input.actor.id,
        fullName: input.actor.fullName,
        signatureName: input.actor.signatureName
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to complete caregiver dispatch.";
    throw buildCarePlanWorkflowError(
      `Care Plan review was saved and signed, but caregiver dispatch failed (${message}). Open the saved care plan to retry sending the caregiver link.`,
      input.carePlanId
    );
  }
}

export async function signCarePlanAsNurseAdmin(input: {
  carePlanId: string;
  actor: { id: string; fullName: string; signatureName: string; role: string };
  attested: boolean;
  signatureImageDataUrl: string;
}) {
  await signCarePlanNurseEsign({
    carePlanId: input.carePlanId,
    actor: {
      id: input.actor.id,
      fullName: input.actor.fullName,
      role: input.actor.role,
      signoffName: input.actor.signatureName
    },
    attested: input.attested,
    signatureImageDataUrl: input.signatureImageDataUrl,
    metadata: {
      module: "care-plan",
      signedFrom: "signCarePlanAsNurseAdmin"
    }
  });
  try {
    return await finalizeCaregiverDispatchAfterNurseSignature({
      carePlanId: input.carePlanId,
      actor: {
        id: input.actor.id,
        fullName: input.actor.fullName,
        signatureName: input.actor.signatureName
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to complete caregiver dispatch.";
    throw buildCarePlanWorkflowError(
      `Care Plan nurse/admin signature was saved, but caregiver dispatch failed (${message}). Open the saved care plan to retry sending the caregiver link.`,
      input.carePlanId
    );
  }
}

export async function updateCarePlanCaregiverContact(input: {
  carePlanId: string;
  caregiverName: string;
  caregiverEmail: string;
  actor: { id: string; fullName: string };
}) {
  const caregiverName = sanitizeCaregiverName(input.caregiverName);
  const caregiverEmail = sanitizeCaregiverEmail(input.caregiverEmail);
  if (!caregiverName) throw new Error("Caregiver name is required.");
  if (!caregiverEmail) throw new Error("Caregiver email is required.");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("care_plans")
    .update({
      caregiver_name: caregiverName,
      caregiver_email: caregiverEmail,
      updated_by_user_id: input.actor.id,
      updated_by_name: input.actor.fullName,
      updated_at: toEasternISO()
    })
    .eq("id", input.carePlanId)
    .select("*, member:members!care_plans_member_id_fkey(display_name)")
    .single();
  if (error) throw new Error(error.message);
  return toCarePlan(data as DbCarePlan);
}

export function getCarePlanDocumentBlueprint(track: CarePlanTrack) {
  return {
    definition: getCarePlanTrackDefinition(track),
    labels: {
      shortTerm: CARE_PLAN_SHORT_TERM_LABEL,
      longTerm: CARE_PLAN_LONG_TERM_LABEL,
      reviewUpdates: CARE_PLAN_REVIEW_UPDATES_LABEL,
      reviewOptions: [...CARE_PLAN_REVIEW_OPTIONS],
      careTeamNotes: CARE_PLAN_CARE_TEAM_NOTES_LABEL,
      separatorLine: CARE_PLAN_SEPARATOR_LINE,
      signatureLabels: CARE_PLAN_SIGNATURE_LABELS,
      signatures: CARE_PLAN_SIGNATURE_LINE_TEMPLATES
    }
  };
}
