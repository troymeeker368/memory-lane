import { canAccessClinicalDocumentationForRole, normalizeRoleKey } from "@/lib/permissions";
import { canAccessCarePlansForRole } from "@/lib/services/care-plan-authorization";
import { resolveCanonicalMemberId } from "@/lib/services/canonical-person-ref";
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

function isStackDepthLimitError(message: string | null | undefined) {
  return /stack depth limit exceeded/i.test(String(message ?? ""));
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
  const emptyRelationResult = { data: [] as Record<string, unknown>[], error: null };

  const withOptionalStaffFilter = (query: any, column: string) =>
    isStaffViewer && staffUserId ? query.eq(column, staffUserId) : query;

  const loadMemberRelations = async (client: Awaited<ReturnType<typeof createClient>>) =>
    Promise.all([
      withOptionalStaffFilter(
        client
          .from("daily_activity_logs")
          .select("id, activity_date, activity_1_level, activity_2_level, activity_3_level, activity_4_level, activity_5_level, staff_name")
          .eq("member_id", canonicalMemberId)
          .order("created_at", { ascending: false }),
        "staff_user_id"
      ),
      withOptionalStaffFilter(
        client
          .from("toilet_logs")
          .select("id, event_at, use_type, staff_name")
          .eq("member_id", canonicalMemberId)
          .order("event_at", { ascending: false }),
        "staff_user_id"
      ),
      withOptionalStaffFilter(
        client
          .from("shower_logs")
          .select("id, event_at, laundry, staff_name")
          .eq("member_id", canonicalMemberId)
          .order("event_at", { ascending: false }),
        "staff_user_id"
      ),
      withOptionalStaffFilter(
        client
          .from("transportation_logs")
          .select("id, service_date, pick_up_drop_off, transport_type, staff_name")
          .eq("member_id", canonicalMemberId)
          .order("service_date", { ascending: false }),
        "staff_user_id"
      ),
      withOptionalStaffFilter(
        client
          .from("blood_sugar_logs")
          .select("id, checked_at, reading_mg_dl, nurse_name")
          .eq("member_id", canonicalMemberId)
          .order("checked_at", { ascending: false }),
        "nurse_user_id"
      ),
      withOptionalStaffFilter(
        client
          .from("ancillary_charge_logs")
          .select("id, service_date, category_name, amount_cents, staff_name")
          .eq("member_id", canonicalMemberId)
          .order("created_at", { ascending: false }),
        "staff_user_id"
      ),
      canViewAssessments
        ? withOptionalStaffFilter(
            client
              .from("intake_assessments")
              .select("id, assessment_date, total_score, recommended_track, completed_by, reviewer_name, admission_review_required, created_at")
              .eq("member_id", canonicalMemberId)
              .order("created_at", { ascending: false }),
            "created_by_user_id"
          )
        : Promise.resolve(emptyRelationResult),
      withOptionalStaffFilter(
        client
          .from("member_photo_uploads")
          .select("id, uploaded_at, uploaded_by_name, photo_url")
          .eq("member_id", canonicalMemberId)
          .order("uploaded_at", { ascending: false }),
        "uploaded_by"
      )
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
    const serviceSupabase = await createClient({ serviceRole: true });
    [
      dailyActivitiesResult,
      toiletsResult,
      showersResult,
      transportationResult,
      bloodSugarResult,
      ancillaryResult,
      assessmentsResult,
      photosResult
    ] = await loadMemberRelations(serviceSupabase);
  }

  if (dailyActivitiesResult.error) throw new Error(dailyActivitiesResult.error.message);
  if (toiletsResult.error) throw new Error(toiletsResult.error.message);
  if (showersResult.error) throw new Error(showersResult.error.message);
  if (transportationResult.error) throw new Error(transportationResult.error.message);
  if (bloodSugarResult.error) throw new Error(bloodSugarResult.error.message);
  if (ancillaryResult.error) throw new Error(ancillaryResult.error.message);
  if (assessmentsResult.error) throw new Error(assessmentsResult.error.message);
  if (photosResult.error) throw new Error(photosResult.error.message);

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
      ? []
      : await (await import("@/lib/services/care-plans")).getCarePlansForMember(canonicalMemberId);
  const latestCarePlan = [...carePlans].sort((a, b) => {
    if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
    return a.reviewDate < b.reviewDate ? 1 : -1;
  })[0] ?? null;

  return {
    member: member as MemberDetailMember,
    dailyActivities,
    toilets,
    showers,
    transportation,
    bloodSugar,
    ancillary,
    assessments,
    photos,
    carePlans,
    latestCarePlan,
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
