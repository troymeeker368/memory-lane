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
import { listMemberSearchLookupSupabase } from "@/lib/services/shared-lookups-supabase";
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

type LatestCarePlanSummaryRow = {
  id: string;
  next_due_date: string | null;
  post_sign_readiness_status: string | null;
  post_sign_readiness_reason: string | null;
};

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

type CarePlanListReadModelRpcRow = {
  total_count: number | null;
  due_soon_count: number | null;
  due_now_count: number | null;
  overdue_count: number | null;
  completed_recently_count: number | null;
  total_rows: number | null;
  page_rows: unknown;
};

type CarePlanListPageRow = {
  id?: unknown;
  member_id?: unknown;
  member_name?: unknown;
  track?: unknown;
  enrollment_date?: unknown;
  review_date?: unknown;
  last_completed_date?: unknown;
  next_due_date?: unknown;
  status?: unknown;
  completed_by?: unknown;
  post_sign_readiness_status?: unknown;
  post_sign_readiness_reason?: unknown;
};

function clean(value: string | null | undefined) {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function toListPostSignReadinessStatus(
  value: string | null | undefined
): "not_started" | "signed_pending_snapshot" | "signed_pending_caregiver_dispatch" | "ready" {
  if (
    value === "not_started" ||
    value === "signed_pending_snapshot" ||
    value === "signed_pending_caregiver_dispatch" ||
    value === "ready"
  ) {
    return value;
  }
  return "not_started";
}

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function loadCarePlanNurseEsignService() {
  return import("@/lib/services/care-plan-nurse-esign");
}

type ResolveCarePlanMemberOptions = {
  canonicalInput?: boolean;
  serviceRole?: boolean;
};

async function resolveCarePlanMemberId(
  memberId: string,
  actionLabel: string,
  options?: ResolveCarePlanMemberOptions
) {
  if (options?.canonicalInput) return memberId;
  return resolveCanonicalMemberId(memberId, {
    actionLabel,
    serviceRole: options?.serviceRole
  });
}

export async function getCarePlanParticipationSummary(
  memberId: string,
  options?: ResolveCarePlanMemberOptions
): Promise<CarePlanParticipationSummary> {
  const canonicalMemberId = await resolveCarePlanMemberId(memberId, "getCarePlanParticipationSummary", options);
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
  canonicalInput?: boolean;
}) {
  const supabase = await createClient({ serviceRole: Boolean(filters?.serviceRole) });
  const canonicalMemberId = filters?.memberId
    ? await resolveCarePlanMemberId(filters.memberId, "listCarePlanRows", {
        canonicalInput: filters.canonicalInput,
        serviceRole: filters.serviceRole
      })
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
  const members = await listMemberSearchLookupSupabase({
    q: query,
    status: "all",
    limit: 25,
    minQueryLength: 1
  });
  return members.map((row) => row.id);
}

function mapCarePlanListRows(payload: unknown) {
  const rows = Array.isArray(payload) ? (payload as CarePlanListPageRow[]) : [];
  return rows.map((plan) => ({
    id: String(plan.id ?? ""),
    memberId: String(plan.member_id ?? ""),
    memberName: clean(typeof plan.member_name === "string" ? plan.member_name : null) ?? "Unknown Member",
    track: String(plan.track ?? "") as CarePlanTrack,
    enrollmentDate: String(plan.enrollment_date ?? ""),
    reviewDate: String(plan.review_date ?? ""),
    lastCompletedDate: typeof plan.last_completed_date === "string" ? plan.last_completed_date : null,
    nextDueDate: String(plan.next_due_date ?? ""),
    status: String(plan.status ?? "Completed") as CarePlanStatus,
    completedBy: clean(typeof plan.completed_by === "string" ? plan.completed_by : null),
    postSignReadinessStatus: toListPostSignReadinessStatus(
      typeof plan.post_sign_readiness_status === "string" ? plan.post_sign_readiness_status : null
    ),
    postSignReadinessReason: clean(typeof plan.post_sign_readiness_reason === "string" ? plan.post_sign_readiness_reason : null),
    hasExistingPlan: true,
    actionHref: `/health/care-plans/${String(plan.id ?? "")}?view=review`,
    openHref: `/health/care-plans/${String(plan.id ?? "")}`
  }));
}

export async function getCarePlans(filters?: {
  memberId?: string;
  track?: string;
  status?: string;
  query?: string;
  page?: number;
  pageSize?: number;
  canonicalInput?: boolean;
  serviceRole?: boolean;
}): Promise<CarePlanListResult> {
  const supabase = await createClient({ serviceRole: Boolean(filters?.serviceRole) });
  const page = Number.isFinite(filters?.page) && Number(filters?.page) > 0 ? Math.floor(Number(filters?.page)) : 1;
  const pageSize =
    Number.isFinite(filters?.pageSize) && Number(filters?.pageSize) > 0 ? Math.floor(Number(filters?.pageSize)) : 25;
  const canonicalMemberId = filters?.memberId
    ? await resolveCarePlanMemberId(filters.memberId, "getCarePlans", {
        canonicalInput: filters.canonicalInput,
        serviceRole: filters.serviceRole
      })
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
  const rows = await invokeSupabaseRpcOrThrow<CarePlanListReadModelRpcRow[]>(supabase, "rpc_get_care_plan_list", {
    p_member_id: canonicalMemberId,
    p_track: filters?.track && filters.track !== "All" ? filters.track : null,
    p_query_member_ids: queryMemberIds ?? null,
    p_status_filter: filters?.status ?? "All",
    p_page: page,
    p_page_size: pageSize,
    p_today: toEasternDate()
  });
  const row = rows?.[0] ?? null;
  const summary = {
    total: Number(row?.total_count ?? 0),
    dueSoon: Number(row?.due_soon_count ?? 0),
    dueNow: Number(row?.due_now_count ?? 0),
    overdue: Number(row?.overdue_count ?? 0),
    completedRecently: Number(row?.completed_recently_count ?? 0)
  };
  const mappedRows = mapCarePlanListRows(row?.page_rows);
  const totalRows = Number(row?.total_rows ?? 0);
  return {
    rows: mappedRows,
    page,
    pageSize,
    totalRows,
    totalPages: Math.max(1, Math.ceil(totalRows / pageSize)),
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
    participationSummary: await getCarePlanParticipationSummary(carePlan.memberId, { canonicalInput: true })
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
      postSignReadinessStatus: latest.postSignReadinessStatus,
      postSignReadinessReason: latest.postSignReadinessReason,
      actionHref: `/health/care-plans/${latest.id}?view=review`,
      actionLabel: "Review Care Plan",
      planId: latest.id
    };
  }

  return {
    hasExistingPlan: false,
    nextDueDate: null,
    status: null,
    postSignReadinessStatus: null,
    postSignReadinessReason: null,
    actionHref: `/health/care-plans/new?memberId=${canonicalMemberId}`,
    actionLabel: "New Care Plan",
    planId: null
  };
}

function buildMemberCarePlanSummaryFromLatestRow(
  canonicalMemberId: string,
  latest: LatestCarePlanSummaryRow | null
): MemberCarePlanSummary {
  if (!latest) {
    return buildMemberCarePlanSummary(canonicalMemberId, null);
  }

  return {
    hasExistingPlan: true,
    nextDueDate: latest.next_due_date,
    status: latest.next_due_date ? computeCarePlanStatus(latest.next_due_date) : null,
    postSignReadinessStatus: latest.post_sign_readiness_status
      ? toListPostSignReadinessStatus(latest.post_sign_readiness_status)
      : null,
    postSignReadinessReason: clean(latest.post_sign_readiness_reason),
    actionHref: `/health/care-plans/${latest.id}?view=review`,
    actionLabel: "Review Care Plan",
    planId: latest.id
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
      postSignReadinessStatus: null,
      postSignReadinessReason: null,
      actionHref: `/health/care-plans/${latest.id}?view=review`,
      actionLabel: "Review Care Plan",
      planId: latest.id
    }
  };
}

export async function getMemberCarePlanOverview(
  memberId: string,
  options?: ResolveCarePlanMemberOptions
): Promise<MemberCarePlanOverview> {
  const canonicalMemberId = await resolveCarePlanMemberId(memberId, "getMemberCarePlanOverview", options);
  const supabase = await createClient({ serviceRole: Boolean(options?.serviceRole) });
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

export async function getMemberCarePlanSnapshot(
  memberId: string,
  options?: ResolveCarePlanMemberOptions
): Promise<MemberCarePlanSnapshot> {
  const canonicalMemberId = await resolveCarePlanMemberId(memberId, "getMemberCarePlanSnapshot", options);
  const rows = await listCarePlanRows({
    memberId: canonicalMemberId,
    canonicalInput: true,
    serviceRole: options?.serviceRole
  });
  const latest = getLatestCarePlanFromRows(rows);

  return {
    rows,
    latest,
    summary: buildMemberCarePlanSummary(canonicalMemberId, latest)
  };
}

export async function getLatestCarePlanIdForMember(
  memberId: string,
  options?: ResolveCarePlanMemberOptions
): Promise<string | null> {
  const canonicalMemberId = await resolveCarePlanMemberId(memberId, "getLatestCarePlanIdForMember", options);
  const supabase = await createClient({ serviceRole: Boolean(options?.serviceRole) });
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

export async function getCarePlansForMember(memberId: string, options?: ResolveCarePlanMemberOptions) {
  return (await getMemberCarePlanSnapshot(memberId, options)).rows;
}

export async function getLatestCarePlanForMember(memberId: string, options?: ResolveCarePlanMemberOptions) {
  return (await getMemberCarePlanSnapshot(memberId, options)).latest;
}

export async function getMemberCarePlanSummary(
  memberId: string,
  options?: ResolveCarePlanMemberOptions
): Promise<MemberCarePlanSummary> {
  const canonicalMemberId = await resolveCarePlanMemberId(memberId, "getMemberCarePlanSummary", options);
  const supabase = await createClient({ serviceRole: Boolean(options?.serviceRole) });
  const { data, error } = await supabase
    .from("care_plans")
    .select("id, next_due_date, post_sign_readiness_status, post_sign_readiness_reason")
    .eq("member_id", canonicalMemberId)
    .order("review_date", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);

  return buildMemberCarePlanSummaryFromLatestRow(
    canonicalMemberId,
    (data as LatestCarePlanSummaryRow | null) ?? null
  );
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
