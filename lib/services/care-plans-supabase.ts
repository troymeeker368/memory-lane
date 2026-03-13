import { createClient } from "@/lib/supabase/server";
import { toEasternDate, toEasternISO } from "@/lib/timezone";
import {
  parseCarePlanNurseSignatureStatus,
  type CarePlanNurseSignatureStatus
} from "@/lib/services/care-plan-nurse-esign-core";
import {
  getCarePlanNurseSignatureState,
  signCarePlanNurseEsign
} from "@/lib/services/care-plan-nurse-esign";
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
  created_at: string;
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

function toCanonicalSections(carePlanId: string, track: CarePlanTrack): CarePlanSection[] {
  return getCanonicalTrackSections(track).map((section, index) => ({
    id: `${carePlanId}-${section.sectionType}`,
    carePlanId,
    sectionType: section.sectionType,
    shortTermGoals: section.shortTermGoals,
    longTermGoals: section.longTermGoals,
    displayOrder: index + 1
  }));
}

function toCarePlanVersion(row: DbCarePlanVersion, track: CarePlanTrack): CarePlanVersion {
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
    sections: toCanonicalSections(row.care_plan_id, track).map((section) => ({
      sectionType: section.sectionType,
      shortTermGoals: section.shortTermGoals,
      longTermGoals: section.longTermGoals,
      displayOrder: section.displayOrder
    })),
    createdAt: row.created_at
  };
}

function serializeSectionsSnapshot(track: CarePlanTrack) {
  return getCanonicalTrackSections(track).map((section) => ({
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
    defaultShortTermGoals: section.shortTermGoals.join("\n"),
    defaultLongTermGoals: section.longTermGoals.join("\n")
  }))
);

export function getCarePlanTemplates(track?: CarePlanTrack) {
  return templates.filter((template) => (track ? template.track === track : true));
}

async function getNextCarePlanVersionNumber(carePlanId: string, serviceRole = false) {
  const supabase = await createClient({ serviceRole });
  const { data, error } = await supabase
    .from("care_plan_versions")
    .select("version_number")
    .eq("care_plan_id", carePlanId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const current = Number(data?.version_number ?? 0);
  return Number.isFinite(current) && current > 0 ? current + 1 : 1;
}

async function createCarePlanVersionSnapshot(input: {
  carePlanId: string;
  track: CarePlanTrack;
  snapshotType: "initial" | "review";
  snapshotDate: string;
  reviewedBy: string | null;
  status: CarePlanStatus;
  nextDueDate: string;
  noChangesNeeded: boolean;
  modificationsRequired: boolean;
  modificationsDescription: string;
  careTeamNotes: string;
  serviceRole?: boolean;
}) {
  const supabase = await createClient({ serviceRole: Boolean(input.serviceRole) });
  const versionNumber = await getNextCarePlanVersionNumber(input.carePlanId, Boolean(input.serviceRole));
  const { data, error } = await supabase
    .from("care_plan_versions")
    .insert({
      care_plan_id: input.carePlanId,
      version_number: versionNumber,
      snapshot_type: input.snapshotType,
      snapshot_date: input.snapshotDate,
      reviewed_by: input.reviewedBy,
      status: input.status,
      next_due_date: input.nextDueDate,
      no_changes_needed: input.noChangesNeeded,
      modifications_required: input.modificationsRequired,
      modifications_description: input.modificationsDescription,
      care_team_notes: input.careTeamNotes,
      sections_snapshot: serializeSectionsSnapshot(input.track),
      created_at: toEasternISO()
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return { versionId: String(data.id), versionNumber };
}

async function syncCarePlanSectionsToCanonical(carePlanId: string, track: CarePlanTrack, serviceRole = false) {
  const supabase = await createClient({ serviceRole });
  const sections = getCanonicalTrackSections(track).map((section) => ({
    care_plan_id: carePlanId,
    section_type: section.sectionType,
    short_term_goals: section.shortTermGoals,
    long_term_goals: section.longTermGoals,
    display_order: section.displayOrder,
    updated_at: toEasternISO()
  }));
  const { error } = await supabase
    .from("care_plan_sections")
    .upsert(sections, { onConflict: "care_plan_id,section_type" });
  if (error) throw new Error(error.message);
}

export async function getCarePlanParticipationSummary(memberId: string): Promise<CarePlanParticipationSummary> {
  const supabase = await createClient();
  const windowEndDate = toEasternDate();
  const windowStartDate = addDays(windowEndDate, -180);
  const [{ data: attendanceRows, error: attendanceError }, { data: activityRows, error: activityError }] =
    await Promise.all([
      supabase
        .from("attendance_records")
        .select("attendance_date")
        .eq("member_id", memberId)
        .gte("attendance_date", windowStartDate)
        .lte("attendance_date", windowEndDate),
      supabase
        .from("daily_activity_logs")
        .select("activity_date")
        .eq("member_id", memberId)
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
  let query = supabase
    .from("care_plans")
    .select("*, member:members!care_plans_member_id_fkey(display_name)")
    .order("next_due_date", { ascending: true });
  if (filters?.carePlanId) query = query.eq("id", filters.carePlanId);
  if (filters?.memberId) query = query.eq("member_id", filters.memberId);
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

export async function getCarePlans(filters?: {
  memberId?: string;
  track?: string;
  status?: string;
  query?: string;
}): Promise<CarePlanListRow[]> {
  const rows = await listCarePlanRows(filters);
  return rows.map((plan) => ({
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
  const [{ data: historyRows, error: historyError }, { data: versionRows, error: versionsError }] = await Promise.all([
    supabase
      .from("care_plan_review_history")
      .select("*")
      .eq("care_plan_id", id)
      .order("review_date", { ascending: false }),
    supabase
      .from("care_plan_versions")
      .select("*")
      .eq("care_plan_id", id)
      .order("version_number", { ascending: false })
  ]);
  if (historyError) throw new Error(historyError.message);
  if (versionsError) throw new Error(versionsError.message);
  return {
    carePlan,
    sections: toCanonicalSections(carePlan.id, carePlan.track),
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

export async function getCarePlanDashboard() {
  const plans = await getCarePlans();
  const dueSoon = plans.filter((row) => row.status === "Due Soon");
  const dueNow = plans.filter((row) => row.status === "Due Now");
  const overdue = plans.filter((row) => row.status === "Overdue");
  return {
    summary: { total: plans.length, dueSoon: dueSoon.length, dueNow: dueNow.length, overdue: overdue.length, completedRecently: 0 },
    dueSoon,
    dueNow,
    overdue,
    recentlyCompleted: [] as Array<CarePlanReviewHistory & { memberId: string; memberName: string; track: CarePlanTrack }>,
    plans
  };
}

export async function getCarePlansForMember(memberId: string) {
  return await listCarePlanRows({ memberId });
}

export async function getLatestCarePlanForMember(memberId: string) {
  const rows = await listCarePlanRows({ memberId });
  return (
    rows.sort((a, b) => {
      if (a.reviewDate === b.reviewDate) return a.updatedAt < b.updatedAt ? 1 : -1;
      return a.reviewDate < b.reviewDate ? 1 : -1;
    })[0] ?? null
  );
}

export async function getMemberCarePlanSummary(memberId: string): Promise<MemberCarePlanSummary> {
  const latest = await getLatestCarePlanForMember(memberId);
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
    actionHref: `/health/care-plans/new?memberId=${memberId}`,
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

export async function createCarePlan(input: {
  memberId: string;
  track: CarePlanTrack;
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
  const supabase = await createClient();
  const now = toEasternISO();
  const completionDate = input.reviewDate;
  const nextDueDate = computeNextReviewDueDate(completionDate);
  const caregiverName = sanitizeCaregiverName(input.caregiverName);
  const caregiverEmail = sanitizeCaregiverEmail(input.caregiverEmail);

  const { data, error } = await supabase
    .from("care_plans")
    .insert({
      member_id: input.memberId,
      track: input.track,
      enrollment_date: input.enrollmentDate,
      review_date: input.reviewDate,
      last_completed_date: completionDate,
      next_due_date: nextDueDate,
      status: computeCarePlanStatus(nextDueDate),
      completed_by: null,
      date_of_completion: null,
      responsible_party_signature: null,
      responsible_party_signature_date: null,
      administrator_signature: null,
      administrator_signature_date: null,
      care_team_notes: input.careTeamNotes,
      no_changes_needed: Boolean(input.noChangesNeeded),
      modifications_required: Boolean(input.modificationsRequired),
      modifications_description: input.modificationsDescription ?? "",
      nurse_designee_user_id: null,
      nurse_designee_name: null,
      nurse_signed_at: null,
      nurse_signature_status: "unsigned",
      nurse_signed_by_user_id: null,
      nurse_signed_by_name: null,
      nurse_signature_artifact_storage_path: null,
      nurse_signature_artifact_member_file_id: null,
      nurse_signature_metadata: {},
      caregiver_name: caregiverName,
      caregiver_email: caregiverEmail,
      caregiver_signature_status: "not_requested",
      caregiver_sent_at: null,
      caregiver_sent_by_user_id: null,
      caregiver_viewed_at: null,
      caregiver_signed_at: null,
      caregiver_signature_request_token: null,
      caregiver_signature_expires_at: null,
      caregiver_signature_request_url: null,
      caregiver_signed_name: null,
      caregiver_signature_image_url: null,
      caregiver_signature_ip: null,
      caregiver_signature_user_agent: null,
      final_member_file_id: null,
      legacy_cleanup_flag: false,
      created_by_user_id: input.actor.id,
      created_by_name: input.actor.fullName,
      updated_by_user_id: input.actor.id,
      updated_by_name: input.actor.fullName,
      created_at: now,
      updated_at: now
    })
    .select("*, member:members!care_plans_member_id_fkey(display_name)")
    .single();
  if (error) throw new Error(error.message);

  const createdCarePlanId = String(data.id);
  await syncCarePlanSectionsToCanonical(createdCarePlanId, input.track);

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
    const { error: rollbackError } = await supabase.from("care_plans").delete().eq("id", createdCarePlanId);
    if (rollbackError) {
      const signError = error instanceof Error ? error.message : "Unknown signature persistence error.";
      throw new Error(
        `Unable to persist Care Plan nurse e-signature (${signError}). Rollback failed: ${rollbackError.message}`
      );
    }
    throw error;
  }

  await createCarePlanVersionSnapshot({
    carePlanId: createdCarePlanId,
    track: input.track,
    snapshotType: "initial",
    snapshotDate: input.reviewDate,
    reviewedBy: signedState.signedByName ?? input.actor.signatureName,
    status: computeCarePlanStatus(nextDueDate),
    nextDueDate,
    noChangesNeeded: Boolean(input.noChangesNeeded),
    modificationsRequired: Boolean(input.modificationsRequired),
    modificationsDescription: input.modificationsDescription ?? "",
    careTeamNotes: input.careTeamNotes
  });

  const refreshed = await listCarePlanRows({ carePlanId: createdCarePlanId });
  const signedCarePlan = refreshed[0];
  if (!signedCarePlan) throw new Error("Care plan could not be reloaded after signature.");
  return signedCarePlan;
}

export async function reviewCarePlan(input: {
  carePlanId: string;
  reviewDate: string;
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
    .select("id, track")
    .eq("id", input.carePlanId)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (!existing) throw new Error("Care plan not found.");

  const track = assertCarePlanTrack(existing.track);
  await syncCarePlanSectionsToCanonical(input.carePlanId, track);
  const now = toEasternISO();
  const nextDueDate = computeNextReviewDueDate(input.reviewDate);
  const caregiverName = sanitizeCaregiverName(input.caregiverName);
  const caregiverEmail = sanitizeCaregiverEmail(input.caregiverEmail);

  const { error } = await supabase
    .from("care_plans")
    .update({
      review_date: input.reviewDate,
      last_completed_date: input.reviewDate,
      next_due_date: nextDueDate,
      status: computeCarePlanStatus(nextDueDate),
      completed_by: null,
      date_of_completion: null,
      no_changes_needed: input.noChangesNeeded,
      modifications_required: input.modificationsRequired,
      modifications_description: input.modificationsDescription,
      care_team_notes: input.careTeamNotes,
      administrator_signature: null,
      administrator_signature_date: null,
      nurse_designee_user_id: null,
      nurse_designee_name: null,
      nurse_signed_at: null,
      nurse_signature_status: "unsigned",
      nurse_signed_by_user_id: null,
      nurse_signed_by_name: null,
      nurse_signature_artifact_storage_path: null,
      nurse_signature_artifact_member_file_id: null,
      nurse_signature_metadata: {},
      caregiver_name: caregiverName,
      caregiver_email: caregiverEmail,
      caregiver_signature_status: "not_requested",
      caregiver_sent_at: null,
      caregiver_sent_by_user_id: null,
      caregiver_viewed_at: null,
      caregiver_signed_at: null,
      caregiver_signature_request_token: null,
      caregiver_signature_expires_at: null,
      caregiver_signature_request_url: null,
      caregiver_signed_name: null,
      caregiver_signature_image_url: null,
      caregiver_signature_ip: null,
      caregiver_signature_user_agent: null,
      final_member_file_id: null,
      responsible_party_signature: null,
      responsible_party_signature_date: null,
      legacy_cleanup_flag: false,
      updated_by_user_id: input.actor.id,
      updated_by_name: input.actor.fullName,
      updated_at: now
    })
    .eq("id", input.carePlanId)
    .select("id")
    .single();
  if (error) throw new Error(error.message);

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

  const snapshot = await createCarePlanVersionSnapshot({
    carePlanId: input.carePlanId,
    track,
    snapshotType: "review",
    snapshotDate: input.reviewDate,
    reviewedBy: signedState.signedByName ?? input.actor.signatureName,
    status: computeCarePlanStatus(nextDueDate),
    nextDueDate,
    noChangesNeeded: input.noChangesNeeded,
    modificationsRequired: input.modificationsRequired,
    modificationsDescription: input.modificationsDescription,
    careTeamNotes: input.careTeamNotes
  });
  const { error: historyError } = await supabase.from("care_plan_review_history").insert({
    care_plan_id: input.carePlanId,
    review_date: input.reviewDate,
    reviewed_by: signedState.signedByName ?? input.actor.signatureName,
    summary: input.modificationsRequired
      ? input.modificationsDescription || "Reviewed with modifications."
      : "Reviewed without required modifications.",
    changes_made: input.modificationsRequired,
    next_due_date: nextDueDate,
    version_id: snapshot.versionId,
    created_at: now
  });
  if (historyError) throw new Error(historyError.message);

  const refreshed = await listCarePlanRows({ carePlanId: input.carePlanId });
  const signedCarePlan = refreshed[0];
  if (!signedCarePlan) throw new Error("Care plan could not be reloaded after review signature.");
  return signedCarePlan;
}

export async function signCarePlanAsNurseAdmin(input: {
  carePlanId: string;
  actor: { id: string; fullName: string; signatureName: string; role: string };
  attested: boolean;
  signatureImageDataUrl: string;
}) {
  const supabase = await createClient();
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

  const now = toEasternISO();
  const { error: touchError } = await supabase
    .from("care_plans")
    .update({
      updated_by_user_id: input.actor.id,
      updated_by_name: input.actor.fullName,
      updated_at: now
    })
    .eq("id", input.carePlanId);
  if (touchError) throw new Error(touchError.message);

  const refreshed = await listCarePlanRows({ carePlanId: input.carePlanId });
  const signedCarePlan = refreshed[0];
  if (!signedCarePlan) throw new Error("Care plan could not be reloaded after nurse/admin signature.");
  return signedCarePlan;
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
