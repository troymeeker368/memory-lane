import { normalizeRoleKey } from "@/lib/permissions";
import { type IntakeAssessmentSignatureState, listIntakeAssessmentSignatureStatesByAssessmentIds } from "@/lib/services/intake-assessment-esign";
import { resolveIntakeDraftPofReadiness, toIntakeDraftPofStatus } from "@/lib/services/intake-draft-pof-readiness";
import { listIntakePostSignFollowUpTasksByAssessmentIds } from "@/lib/services/intake-post-sign-follow-up";
import { isIntakePostSignReady, resolveIntakePostSignReadiness } from "@/lib/services/intake-post-sign-readiness";
import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";
import { createClient } from "@/lib/supabase/server";
import type { AppRole } from "@/types/app";

interface DocumentationWorkflowScope {
  role?: AppRole;
  staffUserId?: string | null;
}

type DocumentationWorkflowSourceKind =
  | "daily_activity"
  | "toilet_log"
  | "shower_log"
  | "transportation"
  | "photo_upload"
  | "assessment";

type DocumentationWorkflowRpcRow = {
  id: string;
  source_kind: DocumentationWorkflowSourceKind;
  occurred_at: string | null;
  member_name: string | null;
  staff_name: string | null;
  payload: Record<string, unknown> | null;
};

export type DocumentationDailyActivityRow = {
  id: string;
  activity_date: string;
  created_at: string;
  activity_1_level: number;
  activity_2_level: number;
  activity_3_level: number;
  activity_4_level: number;
  activity_5_level: number;
  member_name: string;
  staff_name: string;
  reason_missing_activity_1: string | null;
  reason_missing_activity_2: string | null;
  reason_missing_activity_3: string | null;
  reason_missing_activity_4: string | null;
  reason_missing_activity_5: string | null;
  participation: number;
  notes: string | null;
};

export type ToiletWorkflowRow = {
  id: string;
  event_at: string;
  briefs: boolean;
  member_name: string;
  staff_name: string;
  use_type: string;
  notes: string | null;
  member_supplied: boolean;
};

export type ShowerWorkflowRow = {
  id: string;
  event_at: string;
  laundry: boolean;
  briefs: boolean;
  member_name: string;
  staff_name: string;
  notes: string | null;
};

export type TransportationWorkflowRow = {
  id: string;
  service_date: string;
  period: string | null;
  transport_type: string | null;
  member_name: string;
  staff_name: string;
};

export type PhotoWorkflowRow = {
  id: string;
  uploaded_at: string;
  photo_url: string | null;
  uploaded_by_name: string;
  file_name: string;
  file_type: string;
};

export type AssessmentWorkflowRow = {
  id: string;
  assessment_date: string;
  total_score: number | null;
  recommended_track: string | null;
  admission_review_required: boolean | null;
  transport_appropriate: boolean | null;
  complete: boolean | null;
  completed_by: string | null;
  signature_status: "unsigned" | "signed" | "voided" | null;
  signed_by: string | null;
  signed_at: string | null;
  draft_pof_status: "none" | "ready" | "missing_staff_signature" | "pof_not_ready" | "error" | "not_applicable";
  draft_pof_readiness_status: "not_signed" | "signed_pending_draft_pof" | "draft_pof_failed" | "draft_pof_ready";
  draft_pof_ready: boolean;
  post_sign_readiness_status:
    | "not_signed"
    | "signed_pending_draft_pof"
    | "draft_pof_failed"
    | "signed_pending_member_file_pdf"
    | "post_sign_ready";
  post_sign_ready: boolean;
  member_name: string;
  created_at: string;
  reviewer_name: string | null;
  created_by_name: string | null;
};

const DEFAULT_WORKFLOW_MEMBER_NAME = "Unknown Member";
const DEFAULT_WORKFLOW_STAFF_NAME = "Unknown Staff";
const DOCUMENTATION_WORKFLOW_LIMIT = 50;

function isStaffScoped(scope?: DocumentationWorkflowScope) {
  return Boolean(scope?.role && normalizeRoleKey(scope.role) === "program-assistant" && !!scope.staffUserId);
}

function asText(value: unknown, fallback: string | null = null): string | null {
  if (value == null) return fallback;
  const text = String(value).trim();
  return text.length ? text : fallback;
}

function asTextValue(value: unknown, fallback = ""): string {
  return asText(value, fallback) ?? fallback;
}

function asNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asBoolean(value: unknown) {
  return Boolean(value);
}

function asPayload(row: DocumentationWorkflowRpcRow | null | undefined) {
  return row?.payload && typeof row.payload === "object" ? (row.payload as Record<string, unknown>) : {};
}

function buildDailyRow(row: DocumentationWorkflowRpcRow): DocumentationDailyActivityRow {
  const payload = asPayload(row);
  return {
    id: row.id,
    activity_date: asTextValue(payload.activity_date),
    created_at: asTextValue(payload.created_at),
    activity_1_level: asNumber(payload.activity_1_level, 0),
    activity_2_level: asNumber(payload.activity_2_level, 0),
    activity_3_level: asNumber(payload.activity_3_level, 0),
    activity_4_level: asNumber(payload.activity_4_level, 0),
    activity_5_level: asNumber(payload.activity_5_level, 0),
    member_name: asTextValue(row.member_name, DEFAULT_WORKFLOW_MEMBER_NAME),
    staff_name: asTextValue(row.staff_name, DEFAULT_WORKFLOW_STAFF_NAME),
    reason_missing_activity_1: asText(payload.missing_reason_1),
    reason_missing_activity_2: asText(payload.missing_reason_2),
    reason_missing_activity_3: asText(payload.missing_reason_3),
    reason_missing_activity_4: asText(payload.missing_reason_4),
    reason_missing_activity_5: asText(payload.missing_reason_5),
    participation: Math.round(
      (asNumber(payload.activity_1_level, 0) +
        asNumber(payload.activity_2_level, 0) +
        asNumber(payload.activity_3_level, 0) +
        asNumber(payload.activity_4_level, 0) +
        asNumber(payload.activity_5_level, 0)) /
        5
    ),
    notes: asText(payload.notes)
  };
}

function buildToiletRow(row: DocumentationWorkflowRpcRow): ToiletWorkflowRow {
  const payload = asPayload(row);
  return {
    id: row.id,
    event_at: asTextValue(payload.event_at),
    briefs: asBoolean(payload.briefs),
    member_name: asTextValue(row.member_name, DEFAULT_WORKFLOW_MEMBER_NAME),
    staff_name: asTextValue(row.staff_name, DEFAULT_WORKFLOW_STAFF_NAME),
    use_type: asTextValue(payload.use_type, "Toilet"),
    notes: asText(payload.notes),
    member_supplied: asBoolean(payload.member_supplied)
  };
}

function buildShowerRow(row: DocumentationWorkflowRpcRow): ShowerWorkflowRow {
  const payload = asPayload(row);
  return {
    id: row.id,
    event_at: asTextValue(payload.event_at),
    laundry: asBoolean(payload.laundry),
    briefs: asBoolean(payload.briefs),
    member_name: asTextValue(row.member_name, DEFAULT_WORKFLOW_MEMBER_NAME),
    staff_name: asTextValue(row.staff_name, DEFAULT_WORKFLOW_STAFF_NAME),
    notes: asText(payload.notes)
  };
}

function buildTransportationRow(row: DocumentationWorkflowRpcRow): TransportationWorkflowRow {
  const payload = asPayload(row);
  return {
    id: row.id,
    service_date: asTextValue(payload.service_date),
    period: asText(payload.period),
    transport_type: asText(payload.transport_type),
    member_name: asTextValue(row.member_name, DEFAULT_WORKFLOW_MEMBER_NAME),
    staff_name: asTextValue(row.staff_name, DEFAULT_WORKFLOW_STAFF_NAME)
  };
}

function buildPhotoRow(row: DocumentationWorkflowRpcRow): PhotoWorkflowRow {
  const payload = asPayload(row);
  const uploadedAt = asTextValue(payload.uploaded_at);
  const photoUrl = asText(payload.photo_url);
  const mime =
    typeof photoUrl === "string" && photoUrl.startsWith("data:")
      ? photoUrl.slice(5, photoUrl.indexOf(";")) || "image/*"
      : "image/*";
  return {
    id: row.id,
    uploaded_at: uploadedAt,
    photo_url: photoUrl,
    uploaded_by_name: asTextValue(row.staff_name, DEFAULT_WORKFLOW_STAFF_NAME),
    file_name: uploadedAt ? `Photo Upload - ${uploadedAt.slice(0, 10)}.img` : "Photo Upload",
    file_type: mime
  };
}

function buildAssessmentRows(
  rows: DocumentationWorkflowRpcRow[],
  signatureByAssessmentId: Record<string, IntakeAssessmentSignatureState>,
  followUpTasksByAssessmentId: Map<string, Awaited<ReturnType<typeof listIntakePostSignFollowUpTasksByAssessmentIds>> extends Map<string, infer T> ? T : never>
) {
  return rows.map((row) => {
    const payload = asPayload(row);
    const signature = signatureByAssessmentId[row.id] ?? null;
    const signatureStatus = signature?.status ?? "unsigned";
    const draftPofStatus = toIntakeDraftPofStatus(asText(payload.draft_pof_status));
    const draftPofReadiness = resolveIntakeDraftPofReadiness({
      signatureStatus,
      draftPofStatus
    });
    const openFollowUpTaskTypes = (followUpTasksByAssessmentId.get(row.id) ?? []).map((task) => task.taskType);
    const postSignReadiness = resolveIntakePostSignReadiness({
      signatureStatus,
      draftPofStatus,
      openFollowUpTaskTypes
    });
    return {
      id: row.id,
      assessment_date: asTextValue(payload.assessment_date),
      total_score: payload.total_score == null ? null : asNumber(payload.total_score, 0),
      recommended_track: asText(payload.recommended_track),
      admission_review_required: payload.admission_review_required == null ? null : Boolean(payload.admission_review_required),
      transport_appropriate: payload.transport_appropriate == null ? null : Boolean(payload.transport_appropriate),
      complete: payload.complete == null ? null : Boolean(payload.complete),
      completed_by: asText(payload.completed_by),
      signature_status: signatureStatus,
      signed_by: signature?.signedByName ?? null,
      signed_at: signature?.signedAt ?? null,
      draft_pof_status: draftPofStatus,
      draft_pof_readiness_status: draftPofReadiness,
      draft_pof_ready: draftPofReadiness === "draft_pof_ready",
      post_sign_readiness_status: postSignReadiness,
      post_sign_ready: isIntakePostSignReady({
        signatureStatus,
        draftPofStatus,
        openFollowUpTaskTypes
      }),
      member_name: asTextValue(row.member_name, DEFAULT_WORKFLOW_MEMBER_NAME),
      created_at: asTextValue(payload.created_at),
      reviewer_name: null,
      created_by_name: null
    };
  });
}

function buildSignatureIndex(rows: DocumentationWorkflowRpcRow[]) {
  return rows
    .map((row) => row.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

export async function getDocumentationWorkflows(scope?: DocumentationWorkflowScope) {
  const staffScoped = isStaffScoped(scope);
  const supabase = await createClient();
  const rpcRows = await invokeSupabaseRpcOrThrow<DocumentationWorkflowRpcRow[]>(supabase, "rpc_get_documentation_workflows", {
    p_staff_user_id: (staffScoped && scope?.staffUserId) || null,
    p_staff_only: staffScoped,
    p_limit: DOCUMENTATION_WORKFLOW_LIMIT
  });

  const rows = rpcRows ?? [];
  const dailyRows: DocumentationDailyActivityRow[] = [];
  const toiletRows: ToiletWorkflowRow[] = [];
  const showerRows: ShowerWorkflowRow[] = [];
  const transportationRows: TransportationWorkflowRow[] = [];
  const photoRows: PhotoWorkflowRow[] = [];
  const assessmentRows: DocumentationWorkflowRpcRow[] = [];

  for (const row of rows) {
    if (row.source_kind === "daily_activity") {
      dailyRows.push(buildDailyRow(row));
      continue;
    }
    if (row.source_kind === "toilet_log") {
      toiletRows.push(buildToiletRow(row));
      continue;
    }
    if (row.source_kind === "shower_log") {
      showerRows.push(buildShowerRow(row));
      continue;
    }
    if (row.source_kind === "transportation") {
      transportationRows.push(buildTransportationRow(row));
      continue;
    }
    if (row.source_kind === "photo_upload") {
      photoRows.push(buildPhotoRow(row));
      continue;
    }
    if (row.source_kind === "assessment") {
      assessmentRows.push(row);
    }
  }

  const signatureByAssessmentId =
    assessmentRows.length === 0
      ? ({} as Record<string, IntakeAssessmentSignatureState>)
      : await listIntakeAssessmentSignatureStatesByAssessmentIds(buildSignatureIndex(assessmentRows));
  const followUpTasksByAssessmentId =
    assessmentRows.length === 0
      ? new Map<string, []>()
      : await listIntakePostSignFollowUpTasksByAssessmentIds({
          assessmentIds: buildSignatureIndex(assessmentRows)
        });

  const assessments = buildAssessmentRows(assessmentRows, signatureByAssessmentId, followUpTasksByAssessmentId);

  return {
    dailyActivities: dailyRows,
    toilets: toiletRows,
    showers: showerRows,
    transportation: transportationRows,
    photos: photoRows,
    ancillary: [],
    assessments
  };
}
