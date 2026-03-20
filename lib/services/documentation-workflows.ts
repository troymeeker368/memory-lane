import { normalizeRoleKey } from "@/lib/permissions";
import { listIntakeAssessmentSignatureStatesByAssessmentIds } from "@/lib/services/intake-assessment-esign";
import { resolveIntakeDraftPofReadiness, toIntakeDraftPofStatus } from "@/lib/services/intake-draft-pof-readiness";
import { createClient } from "@/lib/supabase/server";
import type { AppRole } from "@/types/app";

interface DocumentationWorkflowScope {
  role?: AppRole;
  staffUserId?: string | null;
}

type WorkflowRelation = { display_name?: string | null; full_name?: string | null } | Array<{ display_name?: string | null; full_name?: string | null }> | null;
type DailyWorkflowRow = {
  id: string;
  activity_date: string;
  created_at: string;
  activity_1_level: number;
  activity_2_level: number;
  activity_3_level: number;
  activity_4_level: number;
  activity_5_level: number;
  missing_reason_1: string | null;
  missing_reason_2: string | null;
  missing_reason_3: string | null;
  missing_reason_4: string | null;
  missing_reason_5: string | null;
  notes: string | null;
  member: WorkflowRelation;
  staff: WorkflowRelation;
};
type ToiletWorkflowQueryRow = {
  id: string;
  event_at: string;
  briefs: boolean | null;
  member_supplied: boolean | null;
  use_type: string;
  notes: string | null;
  member: WorkflowRelation;
  staff: WorkflowRelation;
};
type ShowerWorkflowQueryRow = {
  id: string;
  event_at: string;
  laundry: boolean | null;
  briefs: boolean | null;
  member: WorkflowRelation;
  staff: WorkflowRelation;
};
type TransportationWorkflowQueryRow = {
  id: string;
  service_date: string;
  period: string | null;
  transport_type: string | null;
  member: WorkflowRelation;
  staff: WorkflowRelation;
};
type PhotoWorkflowQueryRow = {
  id: string;
  uploaded_at: string;
  photo_url: string | null;
  uploader: WorkflowRelation;
};
type AssessmentWorkflowQueryRow = {
  id: string;
  assessment_date: string;
  total_score: number | null;
  recommended_track: string | null;
  admission_review_required: boolean | null;
  transport_appropriate: boolean | null;
  complete: boolean | null;
  completed_by: string | null;
  signature_status: string | null;
  signed_by: string | null;
  signed_at: string | null;
  draft_pof_status: string | null;
  created_at: string;
  member: WorkflowRelation;
};

function relationDisplayName(value: unknown, fallback: string) {
  if (Array.isArray(value)) {
    const first = value[0] as { display_name?: string; full_name?: string } | undefined;
    return first?.display_name ?? first?.full_name ?? fallback;
  }
  const row = value as { display_name?: string; full_name?: string } | null;
  return row?.display_name ?? row?.full_name ?? fallback;
}

function isStaffScoped(scope?: DocumentationWorkflowScope) {
  return Boolean(scope?.role && normalizeRoleKey(scope.role) === "program-assistant" && !!scope.staffUserId);
}

export async function getDocumentationWorkflows(scope?: DocumentationWorkflowScope) {
  const staffUserId = scope?.staffUserId ?? null;

  const supabase = await createClient();
  const staffScoped = isStaffScoped(scope);

  const dailyQuery = supabase
    .from("daily_activity_logs")
    .select("id, activity_date, created_at, activity_1_level, activity_2_level, activity_3_level, activity_4_level, activity_5_level, missing_reason_1, missing_reason_2, missing_reason_3, missing_reason_4, missing_reason_5, notes, member:members!daily_activity_logs_member_id_fkey(display_name), staff:profiles!daily_activity_logs_staff_user_id_fkey(full_name)")
    .order("created_at", { ascending: false })
    .limit(50);
  const toiletsQuery = supabase
    .from("toilet_logs")
    .select("id, event_at, briefs, member_supplied, use_type, notes, member:members!toilet_logs_member_id_fkey(display_name), staff:profiles!toilet_logs_staff_user_id_fkey(full_name)")
    .order("event_at", { ascending: false })
    .limit(50);
  const showersQuery = supabase
    .from("shower_logs")
    .select("id, event_at, laundry, briefs, member:members!shower_logs_member_id_fkey(display_name), staff:profiles!shower_logs_staff_user_id_fkey(full_name)")
    .order("event_at", { ascending: false })
    .limit(50);
  const transportationQuery = supabase
    .from("transportation_logs")
    .select("id, service_date, period, transport_type, member:members!transportation_logs_member_id_fkey(display_name), staff:profiles!transportation_logs_staff_user_id_fkey(full_name)")
    .order("created_at", { ascending: false })
    .limit(50);
  const photosQuery = supabase
    .from("member_photo_uploads")
    .select("id, uploaded_at, photo_url, uploaded_by, member:members!member_photo_uploads_member_id_fkey(display_name), uploader:profiles!member_photo_uploads_uploaded_by_fkey(full_name)")
    .order("uploaded_at", { ascending: false })
    .limit(50);

  const filteredDailyQuery = staffScoped ? dailyQuery.eq("staff_user_id", staffUserId as string) : dailyQuery;
  const filteredToiletsQuery = staffScoped ? toiletsQuery.eq("staff_user_id", staffUserId as string) : toiletsQuery;
  const filteredShowersQuery = staffScoped ? showersQuery.eq("staff_user_id", staffUserId as string) : showersQuery;
  const filteredTransportationQuery = staffScoped ? transportationQuery.eq("staff_user_id", staffUserId as string) : transportationQuery;
  const filteredPhotosQuery = staffScoped ? photosQuery.eq("uploaded_by", staffUserId as string) : photosQuery;

  const [
    { data: dailyRows, error: dailyError },
    { data: toiletRows, error: toiletError },
    { data: showerRows, error: showerError },
    { data: transportRows, error: transportError },
    { data: photoRows, error: photoError }
  ] =
    await Promise.all([
      filteredDailyQuery,
      filteredToiletsQuery,
      filteredShowersQuery,
      filteredTransportationQuery,
      filteredPhotosQuery
    ]);
  if (dailyError) throw new Error(`Unable to load daily activity workflows: ${dailyError.message}`);
  if (toiletError) throw new Error(`Unable to load toilet workflows: ${toiletError.message}`);
  if (showerError) throw new Error(`Unable to load shower workflows: ${showerError.message}`);
  if (transportError) throw new Error(`Unable to load transportation workflows: ${transportError.message}`);
  if (photoError) throw new Error(`Unable to load photo workflows: ${photoError.message}`);

  const dailyActivities = ((dailyRows ?? []) as DailyWorkflowRow[]).map((row) => {
    const participation = Math.round(
      ((Number(row.activity_1_level ?? 0) +
        Number(row.activity_2_level ?? 0) +
        Number(row.activity_3_level ?? 0) +
        Number(row.activity_4_level ?? 0) +
        Number(row.activity_5_level ?? 0)) /
        5)
    );
    return {
      id: row.id,
      activity_date: row.activity_date,
      created_at: row.created_at,
      member_name: relationDisplayName(row.member, "Unknown Member"),
      staff_name: relationDisplayName(row.staff, "Unknown Staff"),
      participation,
      activity_1_level: row.activity_1_level,
      activity_2_level: row.activity_2_level,
      activity_3_level: row.activity_3_level,
      activity_4_level: row.activity_4_level,
      activity_5_level: row.activity_5_level,
      reason_missing_activity_1: row.missing_reason_1,
      reason_missing_activity_2: row.missing_reason_2,
      reason_missing_activity_3: row.missing_reason_3,
      reason_missing_activity_4: row.missing_reason_4,
      reason_missing_activity_5: row.missing_reason_5,
      notes: row.notes ?? null
    };
  });

  const toilets = ((toiletRows ?? []) as ToiletWorkflowQueryRow[]).map((row) => ({
    id: row.id,
    event_at: row.event_at,
    member_name: relationDisplayName(row.member, "Unknown Member"),
    staff_name: relationDisplayName(row.staff, "Unknown Staff"),
    use_type: row.use_type,
    briefs: Boolean(row.briefs),
    member_supplied: Boolean(row.member_supplied),
    notes: row.notes ?? null
  }));

  const showers = ((showerRows ?? []) as ShowerWorkflowQueryRow[]).map((row) => ({
    id: row.id,
    event_at: row.event_at,
    member_name: relationDisplayName(row.member, "Unknown Member"),
    staff_name: relationDisplayName(row.staff, "Unknown Staff"),
    laundry: Boolean(row.laundry),
    briefs: Boolean(row.briefs),
    notes: null
  }));

  const transportation = ((transportRows ?? []) as TransportationWorkflowQueryRow[]).map((row) => ({
    id: row.id,
    service_date: row.service_date,
    period: row.period,
    transport_type: row.transport_type,
    member_name: relationDisplayName(row.member, "Unknown Member"),
    staff_name: relationDisplayName(row.staff, "Unknown Staff")
  }));

  const photos = ((photoRows ?? []) as PhotoWorkflowQueryRow[]).map((row) => {
    const mime =
      typeof row.photo_url === "string" && row.photo_url.startsWith("data:")
        ? row.photo_url.slice(5, row.photo_url.indexOf(";")) || "image/*"
        : "image/*";
    const uploadedAt = String(row.uploaded_at ?? "");
    const generatedName = uploadedAt ? `Photo Upload - ${uploadedAt.slice(0, 10)}.img` : "Photo Upload";
    return {
      id: row.id,
      uploaded_at: row.uploaded_at,
      uploaded_by_name: relationDisplayName(row.uploader, "Unknown Staff"),
      file_name: generatedName,
      file_type: mime,
      photo_url: row.photo_url
    };
  });

  return {
    dailyActivities,
    toilets,
    showers,
    transportation,
    photos,
    ancillary: [],
    assessments: await (async () => {
      const assessmentsQuery = supabase
        .from("intake_assessments")
        .select("id, assessment_date, total_score, recommended_track, admission_review_required, transport_appropriate, complete, completed_by, signature_status, signed_by, signed_at, draft_pof_status, created_at, member:members!intake_assessments_member_id_fkey(display_name)")
        .order("created_at", { ascending: false })
        .limit(50);
      const filteredAssessmentsQuery = staffScoped
        ? assessmentsQuery.eq("completed_by_user_id", staffUserId as string)
        : assessmentsQuery;
      const { data: assessmentRows, error: assessmentsError } = await filteredAssessmentsQuery;
      if (assessmentsError) throw new Error(`Unable to load intake assessment workflows: ${assessmentsError.message}`);
      const rows = assessmentRows ?? [];
      const signatureByAssessmentId = await listIntakeAssessmentSignatureStatesByAssessmentIds(
        rows.map((row) => String(row.id))
      );

      return (rows as AssessmentWorkflowQueryRow[]).map((row) => {
        const signature = signatureByAssessmentId[String(row.id)] ?? null;
        const signatureStatus = signature?.status ?? "unsigned";
        const draftPofStatus = toIntakeDraftPofStatus(row.draft_pof_status);
        const draftPofReadinessStatus = resolveIntakeDraftPofReadiness({
          signatureStatus,
          draftPofStatus
        });
        return {
          id: row.id,
          assessment_date: row.assessment_date,
          total_score: row.total_score,
          recommended_track: row.recommended_track,
          admission_review_required: Boolean(row.admission_review_required),
          transport_appropriate: row.transport_appropriate,
          complete: Boolean(row.complete),
          completed_by: row.completed_by,
          signature_status: signatureStatus,
          signed_by: signature?.signedByName ?? null,
          signed_at: signature?.signedAt ?? null,
          draft_pof_status: draftPofStatus,
          draft_pof_readiness_status: draftPofReadinessStatus,
          draft_pof_ready: draftPofReadinessStatus === "draft_pof_ready",
          member_name: relationDisplayName(row.member, "Unknown Member"),
          created_at: row.created_at,
          reviewer_name: null,
          created_by_name: null
        };
      });
    })()
  };
}
