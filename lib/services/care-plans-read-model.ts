import { createClient } from "@/lib/supabase/server";
import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";
import { resolveCanonicalMemberId } from "@/lib/services/canonical-person-ref";
import { toEasternDate } from "@/lib/timezone";
import {
  computeCarePlanStatus,
  resolveCarePlanSections,
  toCarePlan,
  toCarePlanVersion
} from "@/lib/services/care-plan-model";
import { listMemberLookupSupabase } from "@/lib/services/shared-lookups-supabase";
import type {
  CarePlan,
  CarePlanListResult,
  CarePlanParticipationSummary,
  CarePlanReviewHistory,
  CarePlanStatus,
  DbCarePlan,
  DbCarePlanSection,
  DbCarePlanVersion,
  MemberCarePlanSnapshot,
  MemberCarePlanSummary
} from "@/lib/services/care-plan-types";
import type { CarePlanTrack } from "@/lib/services/care-plan-track-definitions";

export interface MemberCarePlanOverview {
  carePlanCount: number;
  carePlanSummary: MemberCarePlanSummary;
}

const CARE_PLAN_BASE_SELECT = [
  "id",
  "member_id",
  "track",
  "enrollment_date",
  "review_date",
  "last_completed_date",
  "next_due_date",
  "completed_by",
  "date_of_completion",
  "responsible_party_signature",
  "responsible_party_signature_date",
  "administrator_signature",
  "administrator_signature_date",
  "care_team_notes",
  "no_changes_needed",
  "modifications_required",
  "modifications_description",
  "nurse_designee_user_id",
  "nurse_designee_name",
  "nurse_signed_at",
  "nurse_signature_status",
  "nurse_signed_by_user_id",
  "nurse_signed_by_name",
  "nurse_signature_artifact_storage_path",
  "nurse_signature_artifact_member_file_id",
  "nurse_signature_metadata",
  "caregiver_name",
  "caregiver_email",
  "caregiver_signature_status",
  "caregiver_sent_at",
  "caregiver_sent_by_user_id",
  "caregiver_viewed_at",
  "caregiver_signed_at",
  "caregiver_signature_expires_at",
  "caregiver_signature_request_url",
  "caregiver_signed_name",
  "final_member_file_id",
  "post_sign_readiness_status",
  "post_sign_readiness_reason",
  "legacy_cleanup_flag",
  "created_at",
  "updated_at",
  "member:members!care_plans_member_id_fkey(display_name)"
].join(", ");

const CARE_PLAN_HISTORY_SELECT =
  "id, care_plan_id, review_date, reviewed_by, summary, changes_made, next_due_date, version_id";
const CARE_PLAN_VERSION_SELECT =
  "id, care_plan_id, version_number, snapshot_type, snapshot_date, reviewed_by, status, next_due_date, no_changes_needed, modifications_required, modifications_description, care_team_notes, sections_snapshot, created_at";
const CARE_PLAN_SECTION_SELECT =
  "id, care_plan_id, section_type, short_term_goals, long_term_goals, display_order";

function clean(value: string | null | undefined) {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function loadCarePlanNurseEsignService() {
  return import("@/lib/services/care-plan-nurse-esign");
}

export async function getCarePlanParticipationSummary(memberId: string): Promise<CarePlanParticipationSummary> {
  const canonicalMemberId = await resolveCanonicalMemberId(memberId, {
    actionLabel: "getCarePlanParticipationSummary"
  });
  const supabase = await createClient();
  const windowEndDate = toEasternDate();
  const windowStartDate = addDays(windowEndDate, -180);
  const rows = await invokeSupabaseRpcOrThrow<
    Array<{ attendance_days: number | string | null; participation_days: number | string | null }>
  >(supabase, "rpc_get_care_plan_participation_summary", {
    p_member_id: canonicalMemberId,
    p_window_start_date: windowStartDate,
    p_window_end_date: windowEndDate
  });
  const row = rows?.[0];
  const attendanceDays = Number(row?.attendance_days ?? 0);
  const participationDays = Number(row?.participation_days ?? 0);
  return {
    attendanceDays,
    participationDays,
    participationRate: attendanceDays === 0 ? null : Math.round((participationDays / attendanceDays) * 100),
    windowStartDate,
    windowEndDate
  };
}

export async function listCarePlanRows(filters?: {
  memberId?: string;
  track?: string;
  status?: string;
  query?: string;
  carePlanId?: string;
  serviceRole?: boolean;
}) {
  const supabase = await createClient({ serviceRole: Boolean(filters?.serviceRole) });
  const canonicalMemberId = filters?.memberId
    ? await resolveCanonicalMemberId(filters.memberId, { actionLabel: "listCarePlanRows" })
    : null;
  let query = supabase
    .from("care_plans")
    .select(CARE_PLAN_BASE_SELECT)
    .order("next_due_date", { ascending: true });
  if (filters?.carePlanId) query = query.eq("id", filters.carePlanId);
  if (canonicalMemberId) query = query.eq("member_id", canonicalMemberId);
  if (filters?.track && filters.track !== "All") query = query.eq("track", filters.track);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const plans = ((data ?? []) as unknown) as DbCarePlan[];
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
  const members = await listMemberLookupSupabase({ q: query });
  return members.map((row) => row.id);
}

function applyCarePlanStatusFilter<T extends {
  lt: (column: string, value: string) => T;
  eq: (column: string, value: string) => T;
  gt: (column: string, value: string) => T;
  lte: (column: string, value: string) => T;
}>(query: T, status: string | undefined) {
  if (!status || status === "All") return query;
  const today = toEasternDate();
  const dueSoonEnd = addDays(today, 14);
  if (status === "Overdue") return query.lt("next_due_date", today);
  if (status === "Due Now") return query.eq("next_due_date", today);
  if (status === "Due Soon") return query.gt("next_due_date", today).lte("next_due_date", dueSoonEnd);
  if (status === "Completed") return query.gt("next_due_date", dueSoonEnd);
  return query;
}

async function getCarePlanSummaryCounts(filters?: {
  memberId?: string;
  track?: string;
  query?: string;
}) {
  const supabase = await createClient();
  const canonicalMemberId = filters?.memberId
    ? await resolveCanonicalMemberId(filters.memberId, { actionLabel: "getCarePlanSummaryCounts" })
    : null;
  const queryMemberIds = await resolveCarePlanQueryMemberIds(filters?.query);
  if (queryMemberIds && queryMemberIds.length === 0) {
    return {
      total: 0,
      dueSoon: 0,
      dueNow: 0,
      overdue: 0,
      completedRecently: 0
    };
  }

  const { data, error } = await supabase.rpc("rpc_get_care_plan_summary_counts", {
    p_member_id: canonicalMemberId,
    p_track: filters?.track && filters.track !== "All" ? filters.track : null,
    p_query_member_ids: queryMemberIds ?? null,
    p_today: toEasternDate()
  });
  if (error) {
    const message = error.message ?? "Unable to load care plan summary counts.";
    if (message.includes("rpc_get_care_plan_summary_counts")) {
      throw new Error(
        "Care plan summary counts RPC is not available. Apply Supabase migration 0098_false_failure_read_path_hardening.sql and refresh PostgREST schema cache."
      );
    }
    throw new Error(message);
  }
  const row = (Array.isArray(data) ? data[0] : null) as {
    total_count: number | null;
    due_soon_count: number | null;
    due_now_count: number | null;
    overdue_count: number | null;
    completed_recently_count: number | null;
  } | null;
  return {
    total: Number(row?.total_count ?? 0),
    dueSoon: Number(row?.due_soon_count ?? 0),
    dueNow: Number(row?.due_now_count ?? 0),
    overdue: Number(row?.overdue_count ?? 0),
    completedRecently: Number(row?.completed_recently_count ?? 0)
  };
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
    ? await resolveCanonicalMemberId(filters.memberId, { actionLabel: "getCarePlans" })
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

  let query = supabase
    .from("care_plans")
    .select(
      "id, member_id, track, enrollment_date, review_date, last_completed_date, next_due_date, status, completed_by, member:members!care_plans_member_id_fkey(display_name)",
      { count: "exact" }
    )
    .order("next_due_date", { ascending: true })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (canonicalMemberId) query = query.eq("member_id", canonicalMemberId);
  if (filters?.track && filters.track !== "All") query = query.eq("track", filters.track);
  if (queryMemberIds) query = query.in("member_id", queryMemberIds);
  query = applyCarePlanStatusFilter(query, filters?.status);
  const { data, error, count } = await query;
  if (error) throw new Error(error.message);
  const rows = ((data ?? []) as Array<{
    id: string;
    member_id: string;
    track: CarePlanTrack;
    enrollment_date: string;
    review_date: string;
    last_completed_date: string | null;
    next_due_date: string;
    status: CarePlanStatus;
    completed_by: string | null;
    member: { display_name: string | null } | Array<{ display_name: string | null }> | null;
  }>).map((plan) => {
    const memberRow = Array.isArray(plan.member) ? plan.member[0] ?? null : plan.member;
    const memberName = clean(memberRow?.display_name) ?? "Unknown Member";
    return {
      id: plan.id,
      memberId: plan.member_id,
      memberName,
      track: plan.track,
      enrollmentDate: plan.enrollment_date,
      reviewDate: plan.review_date,
      lastCompletedDate: plan.last_completed_date,
      nextDueDate: plan.next_due_date,
      status: plan.status,
      completedBy: plan.completed_by,
      hasExistingPlan: true,
      actionHref: `/health/care-plans/${plan.id}?view=review`,
      openHref: `/health/care-plans/${plan.id}`
    };
  });
  const summary = await getCarePlanSummaryCounts({
    memberId: filters?.memberId,
    track: filters?.track,
    query: filters?.query
  });
  return {
    rows,
    page,
    pageSize,
    totalRows: count ?? rows.length,
    totalPages: Math.max(1, Math.ceil((count ?? rows.length) / pageSize)),
    summary
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
      .select(CARE_PLAN_HISTORY_SELECT)
      .eq("care_plan_id", id)
      .order("review_date", { ascending: false }),
    supabase
      .from("care_plan_versions")
      .select(CARE_PLAN_VERSION_SELECT)
      .eq("care_plan_id", id)
      .order("version_number", { ascending: false }),
    supabase
      .from("care_plan_sections")
      .select(CARE_PLAN_SECTION_SELECT)
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
      (row) =>
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

export async function getCarePlanDispatchState(carePlanId: string, options?: { serviceRole?: boolean }) {
  const supabase = await createClient({ serviceRole: Boolean(options?.serviceRole) });
  const { data, error } = await supabase
    .from("care_plans")
    .select("id, member_id, caregiver_name, caregiver_email, caregiver_signature_status")
    .eq("id", carePlanId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: String(data.id),
    memberId: String(data.member_id),
    caregiverName: clean(String(data.caregiver_name ?? "")),
    caregiverEmail: clean(String(data.caregiver_email ?? "")),
    caregiverSignatureStatus: clean(String(data.caregiver_signature_status ?? "")) ?? "pending"
  };
}

function getLatestCarePlanFromRows(rows: CarePlan[]) {
  return (
    [...rows].sort((a, b) => {
      if (a.reviewDate === b.reviewDate) return a.updatedAt < b.updatedAt ? 1 : -1;
      return a.reviewDate < b.reviewDate ? 1 : -1;
    })[0] ?? null
  );
}

function buildMemberCarePlanSummary(canonicalMemberId: string, latest: CarePlan | null): MemberCarePlanSummary {
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

function buildMemberCarePlanOverviewFromLatest(
  canonicalMemberId: string,
  latest: { id: string; next_due_date: string | null } | null
): MemberCarePlanOverview {
  if (!latest) {
    return {
      carePlanCount: 0,
      carePlanSummary: buildMemberCarePlanSummary(canonicalMemberId, null)
    };
  }

  return {
    carePlanCount: 1,
    carePlanSummary: {
      hasExistingPlan: true,
      nextDueDate: latest.next_due_date,
      status: latest.next_due_date ? computeCarePlanStatus(latest.next_due_date) : null,
      actionHref: `/health/care-plans/${latest.id}?view=review`,
      actionLabel: "Review Care Plan",
      planId: latest.id
    }
  };
}

export async function getMemberCarePlanOverview(memberId: string): Promise<MemberCarePlanOverview> {
  const canonicalMemberId = await resolveCanonicalMemberId(memberId, {
    actionLabel: "getMemberCarePlanOverview"
  });
  const supabase = await createClient();
  const [{ data: latestRows, error: latestError }, { count, error: countError }] = await Promise.all([
    supabase
      .from("care_plans")
      .select("id, next_due_date, review_date, updated_at")
      .eq("member_id", canonicalMemberId)
      .order("review_date", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(1),
    supabase.from("care_plans").select("id", { count: "exact", head: true }).eq("member_id", canonicalMemberId)
  ]);
  if (latestError) throw new Error(latestError.message);
  if (countError) throw new Error(countError.message);

  const latest = (latestRows ?? [])[0] as { id: string; next_due_date: string | null } | null;
  return {
    ...buildMemberCarePlanOverviewFromLatest(canonicalMemberId, latest),
    carePlanCount: Number(count ?? 0)
  };
}

export async function getMemberCarePlanSnapshot(memberId: string): Promise<MemberCarePlanSnapshot> {
  const canonicalMemberId = await resolveCanonicalMemberId(memberId, {
    actionLabel: "getMemberCarePlanSnapshot"
  });
  const rows = await listCarePlanRows({ memberId: canonicalMemberId });
  const latest = getLatestCarePlanFromRows(rows);

  return {
    rows,
    latest,
    summary: buildMemberCarePlanSummary(canonicalMemberId, latest)
  };
}

export async function getLatestCarePlanIdForMember(memberId: string): Promise<string | null> {
  const canonicalMemberId = await resolveCanonicalMemberId(memberId, {
    actionLabel: "getLatestCarePlanIdForMember"
  });
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("care_plans")
    .select("id")
    .eq("member_id", canonicalMemberId)
    .order("review_date", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.id ? String(data.id) : null;
}

export async function getCarePlansForMember(memberId: string) {
  return (await getMemberCarePlanSnapshot(memberId)).rows;
}

export async function getLatestCarePlanForMember(memberId: string) {
  return (await getMemberCarePlanSnapshot(memberId)).latest;
}

export async function getMemberCarePlanSummary(memberId: string): Promise<MemberCarePlanSummary> {
  return (await getMemberCarePlanSnapshot(memberId)).summary;
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
