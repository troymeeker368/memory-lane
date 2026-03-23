import { notFound } from "next/navigation";

import { AssessmentPdfActions } from "@/components/assessment/assessment-pdf-actions";
import { DocumentBrandHeader } from "@/components/documents/document-brand-header";
import { Card, CardTitle } from "@/components/ui/card";
import { requireRoles } from "@/lib/auth";
import { CLINICAL_DOCUMENTATION_ACCESS_ROLES } from "@/lib/permissions";
import { getAssessmentDetail } from "@/lib/services/relations";
import { toEasternISO } from "@/lib/timezone";
import { formatDate, formatDateTime } from "@/lib/utils";

type AssessmentDetail = NonNullable<Awaited<ReturnType<typeof getAssessmentDetail>>>;
type AssessmentRecord = AssessmentDetail["assessment"];
type AssessmentResponseRow = AssessmentDetail["responses"][number];

function yesNo(value: boolean) {
  return value ? "Yes" : "No";
}

function orientedStatus(value: boolean) {
  return value ? "oriented" : "not oriented";
}

function firstString(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function draftPofReadinessLabel(status: "not_signed" | "signed_pending_draft_pof" | "draft_pof_failed" | "draft_pof_ready") {
  if (status === "draft_pof_ready") return "Ready";
  if (status === "draft_pof_failed") return "Failed";
  if (status === "signed_pending_draft_pof") return "Pending";
  return "Not signed";
}

function postSignReadinessLabel(
  status:
    | "not_signed"
    | "signed_pending_draft_pof"
    | "draft_pof_failed"
    | "signed_pending_member_file_pdf"
    | "post_sign_ready"
) {
  if (status === "post_sign_ready") return "Operationally Ready";
  if (status === "signed_pending_member_file_pdf") return "PDF Follow-up Needed";
  if (status === "draft_pof_failed") return "Draft POF Failed";
  if (status === "signed_pending_draft_pof") return "Draft POF Pending";
  return "Not signed";
}

export default async function HealthAssessmentDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ assessmentId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRoles(CLINICAL_DOCUMENTATION_ACCESS_ROLES);
  const { assessmentId } = await params;
  const query = (await searchParams) ?? {};
  const detail = await getAssessmentDetail(assessmentId);

  if (!detail) notFound();

  const assessment: AssessmentRecord = detail.assessment;
  const generatedAt = toEasternISO();
  const pdfSaveFailed = firstString(query?.pdfSave) === "failed";
  const openFollowUpTasks = detail.followUpTasks.filter((task) => task.status === "action_required");
  const filteredResponses = detail.responses.filter((response) => {
    if (response.section_type === "Lead Intake Context") return false;
    if (response.field_key === "admissionReviewRequired") return false;
    if (response.field_key === "assessmentId") return false;
    if (response.field_key === "complete" || response.field_key === "completed") return false;
    if (response.field_key === "signerUserId") return false;
    if (response.field_key === "signatureArtifactStoragePath") return false;
    if (response.field_key === "createdBy" || response.field_key === "createdAt") return false;
    return true;
  });
  const responsesBySection = filteredResponses.reduce((acc, response) => {
    if (!acc[response.section_type]) {
      acc[response.section_type] = [];
    }
    acc[response.section_type].push(response);
    return acc;
  }, {} as Record<string, typeof detail.responses>);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-white p-4">
        <DocumentBrandHeader
          title="Intake Assessment"
          metaLines={[
            `Generated: ${formatDateTime(generatedAt)} (ET)`
          ]}
        />
        <div className="mt-3">
          <AssessmentPdfActions
            assessmentId={assessment.id}
            canRetryDraftPof={assessment.draft_pof_readiness_status === "draft_pof_failed"}
          />
        </div>
      </div>

      {pdfSaveFailed ? (
        <Card>
          <p className="text-sm font-semibold text-amber-700">Intake Assessment was created, but its PDF was not saved to member files.</p>
          <p className="mt-1 text-xs text-muted">Use Download PDF to retry member-files persistence after resolving the underlying issue.</p>
        </Card>
      ) : null}

      <Card>
        <CardTitle>Intake Assessment Detail</CardTitle>
        <div className="mt-2 grid gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Member</p><p className="font-semibold">{assessment.member_name}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Assessment Date</p><p className="font-semibold">{formatDate(assessment.assessment_date)}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Total Score</p><p className="font-semibold">{assessment.total_score ?? "-"}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Recommended Track</p><p className="font-semibold">{assessment.recommended_track ?? "-"}</p></div>
        </div>
        <div className="mt-2 grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Completed By</p><p className="font-semibold">{assessment.completed_by ?? assessment.reviewer_name ?? "-"}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">E-Sign Status</p><p className="font-semibold">{assessment.signature_status ?? "unsigned"}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Signed By</p><p className="font-semibold">{assessment.signed_by ?? "-"}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Signed At</p><p className="font-semibold">{assessment.signed_at ? formatDateTime(assessment.signed_at) : "-"}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Post-Sign Readiness</p><p className="font-semibold">{postSignReadinessLabel(assessment.post_sign_readiness_status)}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Draft POF Readiness</p><p className="font-semibold">{draftPofReadinessLabel(assessment.draft_pof_readiness_status)}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Draft POF Status</p><p className="font-semibold">{assessment.draft_pof_status ?? "pending"}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Draft POF Attempted</p><p className="font-semibold">{assessment.draft_pof_attempted_at ? formatDateTime(assessment.draft_pof_attempted_at) : "-"}</p></div>
        </div>
        {assessment.post_sign_readiness_status === "signed_pending_member_file_pdf" ? (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Intake Assessment is signed and draft POF is ready, but the branded PDF still needs to be saved to Member Files before this intake is operationally complete.
          </div>
        ) : null}
        {assessment.draft_pof_readiness_status === "draft_pof_failed" ? (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            Draft POF creation failed after intake signature.
            {assessment.draft_pof_error ? ` ${assessment.draft_pof_error}` : ""}
          </div>
        ) : null}
        {openFollowUpTasks.length > 0 ? (
          <div className="mt-3 space-y-2">
            {openFollowUpTasks.map((task) => (
              <div key={task.id} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-semibold">{task.title}</p>
                <p className="mt-1">{task.message}</p>
                {task.lastError ? <p className="mt-1 text-xs text-amber-800">Last error: {task.lastError}</p> : null}
                <p className="mt-1 text-xs text-amber-800">
                  Attempts: {task.attemptCount}
                  {task.lastAttemptedAt ? ` • Last attempted ${formatDateTime(task.lastAttemptedAt)}` : ""}
                </p>
              </div>
            ))}
          </div>
        ) : null}
      </Card>

      <Card>
        <CardTitle>Orientation & General Health</CardTitle>
        <div className="mt-2 grid gap-3 md:grid-cols-2 text-sm">
          <div className="rounded-lg border border-border p-3"><p className="font-semibold">How feeling today</p><p>{assessment.feeling_today || "-"}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="font-semibold">Health lately</p><p>{assessment.health_lately || "-"}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="font-semibold">Allergies</p><p>{assessment.allergies || "-"}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="font-semibold">Code Status</p><p>{assessment.code_status || "-"}</p></div>
          <div className="rounded-lg border border-border p-3">
            <p className="font-semibold">Orientation Checks</p>
            <p>
              DOB: {orientedStatus(Boolean(assessment.orientation_dob_verified))}, City:{" "}
              {orientedStatus(Boolean(assessment.orientation_city_verified))}, Year:{" "}
              {orientedStatus(Boolean(assessment.orientation_year_verified))}, Occupation:{" "}
              {orientedStatus(Boolean(assessment.orientation_occupation_verified))}
            </p>
          </div>
          <div className="rounded-lg border border-border p-3"><p className="font-semibold">Orientation Notes</p><p>{assessment.orientation_notes || "-"}</p></div>
        </div>
      </Card>

      <Card>
        <CardTitle>Daily Routines, Nutrition, Mobility, Social</CardTitle>
        <div className="mt-2 grid gap-3 md:grid-cols-2 text-sm">
          <div className="rounded-lg border border-border p-3"><p className="font-semibold">Medication Management</p><p>{assessment.medication_management_status || "-"}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="font-semibold">Dressing Support</p><p>{assessment.dressing_support_status || "-"}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="font-semibold">Assistive Devices</p><p>{assessment.assistive_devices || "-"}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="font-semibold">Incontinence Products</p><p>{assessment.incontinence_products || "-"}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="font-semibold">On-site Medication Use</p><p>{assessment.on_site_medication_use || "-"}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="font-semibold">On-site Meds List</p><p>{assessment.on_site_medication_list || "-"}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="font-semibold">Diet</p><p>{assessment.diet_type || "-"}{assessment.diet_other ? ` (${assessment.diet_other})` : ""}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="font-semibold">Diet Notes</p><p>{assessment.diet_restrictions_notes || "-"}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="font-semibold">Mobility Steadiness</p><p>{assessment.mobility_steadiness || "-"}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="font-semibold">Falls History</p><p>{assessment.falls_history || "-"}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="font-semibold">Social Triggers</p><p>{assessment.social_triggers || "-"}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="font-semibold">Joy Sparks / Notes</p><p>{assessment.joy_sparks || "-"}</p><p className="mt-1 text-muted">{assessment.personal_notes || "-"}</p></div>
        </div>
      </Card>

      <Card>
        <CardTitle>Score Summary</CardTitle>
        <div className="mt-2 grid gap-3 md:grid-cols-3 text-sm">
          <div className="rounded-lg border border-border p-3"><p className="font-semibold">Orientation & General Health</p><p>{assessment.score_orientation_general_health ?? "-"}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="font-semibold">Daily Routines & Independence</p><p>{assessment.score_daily_routines_independence ?? "-"}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="font-semibold">Nutrition & Dietary Needs</p><p>{assessment.score_nutrition_dietary_needs ?? "-"}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="font-semibold">Mobility & Safety</p><p>{assessment.score_mobility_safety ?? "-"}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="font-semibold">Social & Emotional Wellness</p><p>{assessment.score_social_emotional_wellness ?? "-"}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="font-semibold">Total / Track</p><p>{assessment.total_score ?? "-"} / {assessment.recommended_track ?? "-"}</p></div>
        </div>
      </Card>

      <Card>
        <CardTitle>Transportation Screening</CardTitle>
        <div className="mt-2 grid gap-3 md:grid-cols-2 text-sm">
          <div className="rounded-lg border border-border p-3"><p className="font-semibold">Enter/Exit Vehicle</p><p>{assessment.transport_can_enter_exit_vehicle || "-"}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="font-semibold">Assistance Level</p><p>{assessment.transport_assistance_level || "-"}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="font-semibold">Mobility Aid</p><p>{assessment.transport_mobility_aid || "-"}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="font-semibold">Seated & Buckled</p><p>{yesNo(Boolean(assessment.transport_can_remain_seated_buckled))}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="font-semibold">Behavior Concern</p><p>{assessment.transport_behavior_concern || "-"}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="font-semibold">Appropriate for Center Transport</p><p>{yesNo(Boolean(assessment.transport_appropriate))}</p></div>
        </div>
      </Card>

      <Card>
        <CardTitle>Vital Signs</CardTitle>
        <div className="mt-2 grid gap-3 md:grid-cols-4 text-sm">
          <div className="rounded-lg border border-border p-3"><p className="font-semibold">HR</p><p>{assessment.vitals_hr ?? "-"}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="font-semibold">BP</p><p>{assessment.vitals_bp || "-"}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="font-semibold">O2 %</p><p>{assessment.vitals_o2_percent ?? "-"}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="font-semibold">RR</p><p>{assessment.vitals_rr ?? "-"}</p></div>
        </div>
      </Card>

      <Card>
        <CardTitle>Structured Response Snapshot</CardTitle>
        <p className="mt-1 text-xs text-muted">Canonical field-level values saved for reporting/export mapping.</p>
        <div className="mt-3 space-y-3">
          {Object.entries(responsesBySection).map(([section, rows]) => (
            <div key={section} className="rounded-lg border border-border p-3">
              <p className="text-sm font-semibold">{section}</p>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                {(rows as AssessmentResponseRow[]).map((row) => (
                  <div key={row.id} className="rounded border border-border px-2 py-1 text-xs">
                    <p className="font-semibold">{row.field_label}</p>
                    <p className="text-muted">{row.field_value || "-"}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}


