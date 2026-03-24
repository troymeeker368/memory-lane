import Link from "next/link";

import { AssessmentFormBoundary } from "@/components/forms/assessment-form-boundary";
import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import { getAssessmentMembers } from "@/lib/services/documentation";
import { getDocumentationWorkflows } from "@/lib/services/documentation-workflows";
import { getManagedUserSignatureName } from "@/lib/services/user-management";
import { formatDate } from "@/lib/utils";

type AssessmentWorkflowRow = Awaited<ReturnType<typeof getDocumentationWorkflows>>["assessments"][number];

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

export default async function HealthAssessmentPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const profile = await requireModuleAccess("health");
  const params = await searchParams;
  const initialMemberId =
    typeof params.leadId === "string"
      ? params.leadId
      : typeof params.memberId === "string"
        ? params.memberId
        : undefined;

  const [members, workflows, signerName] = await Promise.all([
    getAssessmentMembers(),
    getDocumentationWorkflows(),
    getManagedUserSignatureName(profile.id, profile.full_name)
  ]);

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Intake Assessment</CardTitle>
        <p className="mt-1 text-sm text-muted">
          Structured intake assessment for Tour/EIP leads with score-based track recommendation and member profile writeback.
        </p>
        <div className="mt-3">
          <AssessmentFormBoundary members={members} initialMemberId={initialMemberId} initialStaffName={signerName} />
        </div>
      </Card>

      <Card className="table-wrap">
        <CardTitle>Assessment History</CardTitle>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Member</th>
              <th>Total Score</th>
              <th>Track</th>
              <th>Admission Review</th>
              <th>Transport Appropriate</th>
              <th>Completed By</th>
              <th>E-Sign Status</th>
                <th>Post-Sign Readiness</th>
                <th>Draft POF Readiness</th>
                <th>Signed By</th>
                <th>Operationally Ready</th>
                <th>Open</th>
              </tr>
            </thead>
            <tbody>
            {workflows.assessments.map((row: AssessmentWorkflowRow) => (
              <tr key={row.id}>
                <td>{formatDate(row.assessment_date)}</td>
                <td>{row.member_name}</td>
                <td>{row.total_score ?? "-"}</td>
                <td>{row.recommended_track ?? "-"}</td>
                <td>{row.admission_review_required ? "Required" : "No"}</td>
                <td>{row.transport_appropriate == null ? "-" : row.transport_appropriate ? "Yes" : "No"}</td>
                <td>{row.completed_by ?? row.reviewer_name ?? row.created_by_name ?? "-"}</td>
                <td>{row.signature_status ?? "unsigned"}</td>
                <td>{postSignReadinessLabel(row.post_sign_readiness_status)}</td>
                <td>{draftPofReadinessLabel(row.draft_pof_readiness_status)}</td>
                <td>{row.signed_by ?? "-"}</td>
                <td>{row.complete ? "Yes" : "No"}</td>
                <td>
                  <Link className="font-semibold text-brand" href={`/health/assessment/${row.id}`}>
                    Detail
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card>
        <CardTitle>Workflow Status</CardTitle>
        <p className="text-sm text-muted">
          Intake Assessment signatures are captured through the canonical authenticated nurse/admin e-sign workflow and stored in Supabase.
        </p>
      </Card>
    </div>
  );
}
