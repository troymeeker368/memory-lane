import Link from "next/link";

import { AssessmentForm } from "@/components/forms/workflow-forms";
import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import { getAssessmentMembers } from "@/lib/services/documentation";
import { getDocumentationWorkflows } from "@/lib/services/documentation-workflows";
import { getManagedUserSignatureName } from "@/lib/services/user-management";
import { formatDate } from "@/lib/utils";

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

  const [members, workflows] = await Promise.all([getAssessmentMembers(), getDocumentationWorkflows()]);
  const signerName = await getManagedUserSignatureName(profile.id, profile.full_name);

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Intake Assessment</CardTitle>
        <p className="mt-1 text-sm text-muted">
          Structured intake assessment for Tour/EIP leads with score-based track recommendation and member profile writeback.
        </p>
        <div className="mt-3">
          <AssessmentForm members={members} initialMemberId={initialMemberId} initialStaffName={signerName} />
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
              <th>Complete</th>
              <th>Open</th>
            </tr>
          </thead>
          <tbody>
            {workflows.assessments.map((row: any) => (
              <tr key={row.id}>
                <td>{formatDate(row.assessment_date)}</td>
                <td>{row.member_name}</td>
                <td>{row.total_score ?? "-"}</td>
                <td>{row.recommended_track ?? "-"}</td>
                <td>{row.admission_review_required ? "Required" : "No"}</td>
                <td>{row.transport_appropriate == null ? "-" : row.transport_appropriate ? "Yes" : "No"}</td>
                <td>{row.completed_by ?? row.reviewer_name ?? row.created_by_name ?? "-"}</td>
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
        <CardTitle>Future Backend TODO</CardTitle>
        <p className="text-sm text-muted">
          TODO: Add locked revision workflow and e-signature validation when backend document storage is fully connected.
        </p>
      </Card>
    </div>
  );
}


