import { canAccessClinicalDocumentationForRole, normalizeRoleKey } from "@/lib/permissions";
import {
  MEMBER_DETAIL_ANCILLARY_SELECT,
  MEMBER_DETAIL_ASSESSMENT_SELECT,
  MEMBER_DETAIL_BLOOD_SUGAR_SELECT,
  MEMBER_DETAIL_DAILY_ACTIVITY_SELECT,
  MEMBER_DETAIL_PHOTO_SELECT,
  MEMBER_DETAIL_SHOWER_SELECT,
  MEMBER_DETAIL_TOILET_SELECT,
  MEMBER_DETAIL_TRANSPORTATION_SELECT
} from "@/lib/services/activity-detail-selects";
import { canAccessCarePlansForRole } from "@/lib/services/care-plan-authorization";
import { resolveCanonicalMemberId } from "@/lib/services/canonical-person-ref";
import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";
import { createClient } from "@/lib/supabase/server";
import type { AppRole } from "@/types/app";

type MemberDetailMember = {
  id: string;
  display_name: string;
  status: "active" | "inactive";
  discharge_date: string | null;
  discharge_reason: string | null;
  discharge_disposition: string | null;
  discharged_by: string | null;
  latest_assessment_id: string | null;
  latest_assessment_date: string | null;
  latest_assessment_score: number | string | null;
  latest_assessment_track: string | null;
};

type MemberDetailDailyActivityRow = {
  id: string;
  activity_date: string;
  activity_1_level: string | number | null;
  activity_2_level: string | number | null;
  activity_3_level: string | number | null;
  activity_4_level: string | number | null;
  activity_5_level: string | number | null;
  staff_name: string | null;
};

type MemberDetailToiletRow = {
  id: string;
  event_at: string;
  use_type: string | null;
  staff_name: string | null;
};

type MemberDetailShowerRow = {
  id: string;
  event_at: string;
  laundry: boolean | null;
  staff_name: string | null;
};

type MemberDetailTransportationRow = {
  id: string;
  service_date: string;
  pick_up_drop_off: string | null;
  transport_type: string | null;
  staff_name: string | null;
};

type MemberDetailBloodSugarRow = {
  id: string;
  checked_at: string;
  reading_mg_dl: number | string | null;
  nurse_name: string | null;
};

type MemberDetailAncillaryRow = {
  id: string;
  service_date: string;
  category_name: string | null;
  amount_cents: number;
  staff_name: string | null;
};

type MemberDetailAssessmentRow = {
  id: string;
  assessment_date: string;
  total_score: number | string | null;
  recommended_track: string | null;
  completed_by: string | null;
  reviewer_name: string | null;
  admission_review_required: boolean | null;
  created_at: string | null;
};

type MemberDetailPhotoRow = {
  id: string;
  uploaded_at: string;
  uploaded_by_name: string | null;
  photo_url: string;
};

type MemberDetailCountsRpcRow = {
  daily_activities: number | string | null;
  toilets: number | string | null;
  showers: number | string | null;
  transportation: number | string | null;
  blood_sugar: number | string | null;
  ancillary: number | string | null;
  assessments: number | string | null;
  photos: number | string | null;
};

const MEMBER_DETAIL_PREVIEW_LIMIT = 50;
const MEMBER_DETAIL_COUNTS_RPC = "rpc_get_member_detail_counts";
const MEMBER_DETAIL_COUNTS_MIGRATION = "0122_member_detail_and_care_plan_performance_hardening.sql";

function isStackDepthLimitError(message: string | null | undefined) {
  return /stack depth limit exceeded/i.test(String(message ?? ""));
}

function memberDetailRlsBoundaryError() {
  return new Error(
    "Member detail read hit a recursive RLS path. Fix the underlying Supabase policy/current_role boundary instead of retrying with service_role."
  );
}

function toCount(value: number | string | null | undefined) {
  return Number(value ?? 0);
}

export async function getMemberDetail(
  memberId: string,
  scope?: {
    role?: AppRole;
    staffUserId?: string | null;
  }
) {
  const canonicalMemberId = await resolveCanonicalMemberId(memberId, {
    actionLabel: "getMemberDetail"
  });
  const supabase = await createClient();
  const { data: member, error } = await supabase
    .from("members")
    .select(
      "id, display_name, status, discharge_date, discharge_reason, discharge_disposition, discharged_by, latest_assessment_id, latest_assessment_date, latest_assessment_score, latest_assessment_track"
    )
    .eq("id", canonicalMemberId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!member) return null;

  const normalizedRole = scope?.role ? normalizeRoleKey(scope.role) : null;
  const isStaffViewer = Boolean(normalizedRole === "program-assistant" && !!scope?.staffUserId);
  const canViewCarePlans = canAccessCarePlansForRole(normalizedRole);
  const canViewAssessments = canAccessClinicalDocumentationForRole(normalizedRole);
  const staffUserId = scope?.staffUserId ?? null;
  const emptyRelationResult = { data: [] as Record<string, unknown>[], error: null, count: 0 };

  // Supabase query builders here are heterogeneous across tables; keep the helper loose and local.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const withOptionalStaffFilter = (query: any, column: string) =>
    isStaffViewer && staffUserId ? query.eq(column, staffUserId) : query;

  const loadMemberRelations = async (client: Awaited<ReturnType<typeof createClient>>) =>
    Promise.all([
      withOptionalStaffFilter(
        client.from("daily_activity_logs").select(MEMBER_DETAIL_DAILY_ACTIVITY_SELECT).eq("member_id", canonicalMemberId).order("created_at", { ascending: false }),
        "staff_user_id"
      ).limit(MEMBER_DETAIL_PREVIEW_LIMIT),
      withOptionalStaffFilter(
        client
          .from("toilet_logs")
          .select(MEMBER_DETAIL_TOILET_SELECT)
          .eq("member_id", canonicalMemberId)
          .order("event_at", { ascending: false }),
        "staff_user_id"
      ).limit(MEMBER_DETAIL_PREVIEW_LIMIT),
      withOptionalStaffFilter(
        client
          .from("shower_logs")
          .select(MEMBER_DETAIL_SHOWER_SELECT)
          .eq("member_id", canonicalMemberId)
          .order("event_at", { ascending: false }),
        "staff_user_id"
      ).limit(MEMBER_DETAIL_PREVIEW_LIMIT),
      withOptionalStaffFilter(
        client
          .from("transportation_logs")
          .select(MEMBER_DETAIL_TRANSPORTATION_SELECT)
          .eq("member_id", canonicalMemberId)
          .order("service_date", { ascending: false }),
        "staff_user_id"
      ).limit(MEMBER_DETAIL_PREVIEW_LIMIT),
      withOptionalStaffFilter(
        client
          .from("blood_sugar_logs")
          .select(MEMBER_DETAIL_BLOOD_SUGAR_SELECT)
          .eq("member_id", canonicalMemberId)
          .order("checked_at", { ascending: false }),
        "nurse_user_id"
      ).limit(MEMBER_DETAIL_PREVIEW_LIMIT),
      withOptionalStaffFilter(
        client
          .from("ancillary_charge_logs")
          .select(MEMBER_DETAIL_ANCILLARY_SELECT)
          .eq("member_id", canonicalMemberId)
          .order("created_at", { ascending: false }),
        "staff_user_id"
      ).limit(MEMBER_DETAIL_PREVIEW_LIMIT),
      canViewAssessments
        ? withOptionalStaffFilter(
            client
              .from("intake_assessments")
              .select(MEMBER_DETAIL_ASSESSMENT_SELECT)
              .eq("member_id", canonicalMemberId)
              .order("created_at", { ascending: false }),
            "completed_by_user_id"
          ).limit(MEMBER_DETAIL_PREVIEW_LIMIT)
        : Promise.resolve(emptyRelationResult),
      withOptionalStaffFilter(
        client
          .from("member_photo_uploads")
          .select(MEMBER_DETAIL_PHOTO_SELECT)
          .eq("member_id", canonicalMemberId)
          .order("uploaded_at", { ascending: false }),
        "uploaded_by"
      ).limit(MEMBER_DETAIL_PREVIEW_LIMIT)
    ]);

  let [
    dailyActivitiesResult,
    toiletsResult,
    showersResult,
    transportationResult,
    bloodSugarResult,
    ancillaryResult,
    assessmentsResult,
    photosResult
  ] = await loadMemberRelations(supabase);

  const hasStackDepthResult = [
    dailyActivitiesResult.error?.message,
    toiletsResult.error?.message,
    showersResult.error?.message,
    transportationResult.error?.message,
    bloodSugarResult.error?.message,
    ancillaryResult.error?.message,
    assessmentsResult.error?.message,
    photosResult.error?.message
  ].some((message) => isStackDepthLimitError(message));

  if (hasStackDepthResult) {
    throw memberDetailRlsBoundaryError();
  }

  if (dailyActivitiesResult.error) throw new Error(dailyActivitiesResult.error.message);
  if (toiletsResult.error) throw new Error(toiletsResult.error.message);
  if (showersResult.error) throw new Error(showersResult.error.message);
  if (transportationResult.error) throw new Error(transportationResult.error.message);
  if (bloodSugarResult.error) throw new Error(bloodSugarResult.error.message);
  if (ancillaryResult.error) throw new Error(ancillaryResult.error.message);
  if (assessmentsResult.error) throw new Error(assessmentsResult.error.message);
  if (photosResult.error) throw new Error(photosResult.error.message);

  let countRows: MemberDetailCountsRpcRow[];
  try {
    countRows = await invokeSupabaseRpcOrThrow<MemberDetailCountsRpcRow[]>(supabase, MEMBER_DETAIL_COUNTS_RPC, {
      p_member_id: canonicalMemberId,
      p_staff_user_id: isStaffViewer ? staffUserId : null
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load member detail counts.";
    if (message.includes(MEMBER_DETAIL_COUNTS_RPC)) {
      throw new Error(
        `Member detail counts RPC is not available. Apply Supabase migration ${MEMBER_DETAIL_COUNTS_MIGRATION} and refresh PostgREST schema cache.`
      );
    }
    throw error;
  }
  const countRow = countRows?.[0];

  const dailyActivities = (dailyActivitiesResult.data ?? []) as MemberDetailDailyActivityRow[];
  const toilets = (toiletsResult.data ?? []) as MemberDetailToiletRow[];
  const showers = (showersResult.data ?? []) as MemberDetailShowerRow[];
  const transportation = (transportationResult.data ?? []) as MemberDetailTransportationRow[];
  const bloodSugar = (bloodSugarResult.data ?? []) as MemberDetailBloodSugarRow[];
  const ancillary = (ancillaryResult.data ?? []) as MemberDetailAncillaryRow[];
  const assessments = canViewAssessments ? ((assessmentsResult.data ?? []) as MemberDetailAssessmentRow[]) : [];
  const photos = (photosResult.data ?? []) as MemberDetailPhotoRow[];

  const carePlans =
    isStaffViewer || !canViewCarePlans
      ? null
      : await (await import("@/lib/services/care-plans-read")).getMemberCarePlanSnapshot(canonicalMemberId, {
          canonicalInput: true
        });

  return {
    member: member as MemberDetailMember,
    counts: {
      dailyActivities: toCount(countRow?.daily_activities),
      toilets: toCount(countRow?.toilets),
      showers: toCount(countRow?.showers),
      transportation: toCount(countRow?.transportation),
      bloodSugar: toCount(countRow?.blood_sugar),
      ancillary: toCount(countRow?.ancillary),
      assessments: canViewAssessments ? toCount(countRow?.assessments) : 0,
      photos: toCount(countRow?.photos)
    },
    dailyActivities,
    toilets,
    showers,
    transportation,
    bloodSugar,
    ancillary,
    assessments,
    photos,
    carePlans: carePlans?.rows ?? [],
    latestCarePlan: carePlans?.latest ?? null,
    marToday: [] as Array<{
      id: string;
      date: string;
      medication: string;
      dose: string;
      route: string;
      frequency: string;
      scheduled_time: string;
      action: string;
      staff: string;
    }>
  };
}
