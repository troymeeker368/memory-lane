import { createClient } from "@/lib/supabase/server";
import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";
import { resolveCanonicalMemberRef } from "@/lib/services/canonical-person-ref";
import { toEasternDate, toEasternISO } from "@/lib/timezone";
import {
  buildNormalizedSectionsForTrack,
  computeCarePlanStatus,
  computeNextReviewDueDate,
  resolveCarePlanSections,
  serializeSectionsSnapshot,
  toCarePlan,
  toCarePlanVersion
} from "@/lib/services/care-plan-model";
import { getDefaultCaregiverSignatureExpiresOnDate } from "@/lib/services/care-plan-esign-rules";
import { recordWorkflowEvent } from "@/lib/services/workflow-observability";
import type {
  CarePlan,
  CarePlanListResult,
  CarePlanParticipationSummary,
  CarePlanReviewHistory,
  CarePlanSectionInput,
  CarePlanStatus,
  DbCarePlan,
  DbCarePlanSection,
  DbCarePlanVersion,
  MemberCarePlanSummary
} from "@/lib/services/care-plan-types";
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
export type {
  CaregiverSignatureStatus,
  CarePlan,
  CarePlanListResult,
  CarePlanListRow,
  CarePlanParticipationSummary,
  CarePlanReviewHistory,
  CarePlanSection,
  CarePlanSectionInput,
  CarePlanStatus,
  CarePlanTemplate,
  CarePlanVersion,
  MemberCarePlanSummary
} from "@/lib/services/care-plan-types";
export {
  CAREGIVER_SIGNATURE_STATUS_VALUES,
  computeCarePlanStatus,
  computeInitialDueDate,
  computeNextReviewDueDate,
  getCarePlanTemplates
} from "@/lib/services/care-plan-model";

const CARE_PLAN_CORE_RPC = "rpc_upsert_care_plan_core";
const CARE_PLAN_CORE_RPC_MIGRATION = "0085_care_plan_diagnosis_relation.sql";
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

async function loadCarePlanNurseEsignService() {
  return import("@/lib/services/care-plan-nurse-esign");
}

async function loadWorkflowMilestoneRecorder() {
  const { recordWorkflowMilestone } = await import("@/lib/services/lifecycle-milestones");
  return recordWorkflowMilestone;
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

function clean(value: string | null | undefined) {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function assertCarePlanTrack(value: string | null | undefined): CarePlanTrack {
  if (isCarePlanTrack(value)) return value;
  throw new Error(`Invalid care plan track value: ${value ?? "(null)"}`);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeDiagnosisIds(values: string[] | null | undefined) {
  return [
    ...new Set(
      (values ?? [])
        .map((value) => clean(value))
        .filter((value): value is string => value !== null && UUID_PATTERN.test(value))
    )
  ];
}

function isPostgresUniqueViolation(error: { code?: string | null; message?: string | null; details?: string | null } | null | undefined) {
  const text = [error?.message, error?.details].filter(Boolean).join(" ").toLowerCase();
  return error?.code === "23505" || text.includes("duplicate key value") || text.includes("unique constraint");
}

function isCarePlanRootUniqueViolation(error: { code?: string | null; message?: string | null; details?: string | null } | null | undefined) {
  const text = [error?.message, error?.details].filter(Boolean).join(" ").toLowerCase();
  return isPostgresUniqueViolation(error) && text.includes("idx_care_plans_member_track_unique");
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
  diagnosisIds?: string[];
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
      p_diagnosis_ids: normalizeDiagnosisIds(input.diagnosisIds),
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
  const { getCarePlanNurseSignatureState } = await loadCarePlanNurseEsignService();
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
  const caregiverName = clean(signedCarePlan.caregiverName);
  const caregiverEmail = clean(signedCarePlan.caregiverEmail);

  const hasCaregiverContact = Boolean(caregiverName) && Boolean(caregiverEmail);
  const shouldAutoSend = hasCaregiverContact && signedCarePlan.caregiverSignatureStatus !== "signed";

  if (shouldAutoSend && caregiverName && caregiverEmail) {
    const { sendCarePlanToCaregiverForSignature } = await import("@/lib/services/care-plan-esign");
    return sendCarePlanToCaregiverForSignature({
      carePlanId: signedCarePlan.id,
      caregiverName,
      caregiverEmail,
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
  diagnosisIds?: string[];
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
  const { signCarePlanNurseEsign } = await loadCarePlanNurseEsignService();
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
      diagnosisIds: input.diagnosisIds,
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
  const recordWorkflowMilestone = await loadWorkflowMilestoneRecorder();
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
  diagnosisIds?: string[];
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
  const { signCarePlanNurseEsign } = await loadCarePlanNurseEsignService();
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
    diagnosisIds: input.diagnosisIds,
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
  const recordWorkflowMilestone = await loadWorkflowMilestoneRecorder();
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
  const { signCarePlanNurseEsign } = await loadCarePlanNurseEsignService();
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
