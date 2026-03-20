import { canAccessClinicalDocumentationForRole, normalizeRoleKey } from "@/lib/permissions";
import { canAccessCarePlansForRole } from "@/lib/services/care-plan-authorization";
import { resolveCanonicalMemberId } from "@/lib/services/canonical-person-ref";
import { createClient } from "@/lib/supabase/server";
import type { AppRole } from "@/types/app";

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
  const { data: member, error } = await supabase.from("members").select("*").eq("id", canonicalMemberId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!member) return null;

  const normalizedRole = scope?.role ? normalizeRoleKey(scope.role) : null;
  const isStaffViewer = Boolean(normalizedRole === "program-assistant" && !!scope?.staffUserId);
  const canViewCarePlans = canAccessCarePlansForRole(normalizedRole);
  const canViewAssessments = canAccessClinicalDocumentationForRole(normalizedRole);
  const staffUserId = scope?.staffUserId ?? null;
  const emptyRelationResult = { data: [] as Record<string, unknown>[], error: null };

  const loadMemberRelations = async (client: Awaited<ReturnType<typeof createClient>>) =>
    Promise.all([
      client.from("daily_activity_logs").select("*").eq("member_id", canonicalMemberId).order("created_at", { ascending: false }),
      client.from("toilet_logs").select("*").eq("member_id", canonicalMemberId).order("event_at", { ascending: false }),
      client.from("shower_logs").select("*").eq("member_id", canonicalMemberId).order("event_at", { ascending: false }),
      client.from("transportation_logs").select("*").eq("member_id", canonicalMemberId).order("service_date", { ascending: false }),
      client.from("blood_sugar_logs").select("*").eq("member_id", canonicalMemberId).order("checked_at", { ascending: false }),
      client.from("ancillary_charge_logs").select("*").eq("member_id", canonicalMemberId).order("created_at", { ascending: false }),
      canViewAssessments
        ? client.from("intake_assessments").select("*").eq("member_id", canonicalMemberId).order("created_at", { ascending: false })
        : Promise.resolve(emptyRelationResult),
      client.from("member_photo_uploads").select("*").eq("member_id", canonicalMemberId).order("uploaded_at", { ascending: false })
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

  const filterByStaff = <T extends Record<string, unknown>>(rows: T[], field: string) =>
    !isStaffViewer || !staffUserId ? rows : rows.filter((row) => String(row[field] ?? "") === staffUserId);

  const dailyActivities = filterByStaff(dailyActivitiesResult.data ?? [], "staff_user_id");
  const toilets = filterByStaff(toiletsResult.data ?? [], "staff_user_id");
  const showers = filterByStaff(showersResult.data ?? [], "staff_user_id");
  const transportation = filterByStaff(transportationResult.data ?? [], "staff_user_id");
  const bloodSugar = filterByStaff(bloodSugarResult.data ?? [], "nurse_user_id");
  const ancillary = filterByStaff(ancillaryResult.data ?? [], "staff_user_id");
  const assessments = canViewAssessments ? filterByStaff(assessmentsResult.data ?? [], "created_by_user_id") : [];
  const photos = filterByStaff(photosResult.data ?? [], "uploaded_by");

  const carePlans =
    isStaffViewer || !canViewCarePlans
      ? []
      : await (await import("@/lib/services/care-plans")).getCarePlansForMember(canonicalMemberId);
  const latestCarePlan = [...carePlans].sort((a, b) => {
    if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
    return a.reviewDate < b.reviewDate ? 1 : -1;
  })[0] ?? null;

  return {
    member,
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
