import Link from "next/link";
import { redirect } from "next/navigation";

import { CarePlanReviewForm } from "@/components/forms/care-plan-forms";
import { Card, CardTitle } from "@/components/ui/card";
import { getCurrentProfile, requireRoles } from "@/lib/auth";
import { CARE_PLAN_LONG_TERM_LABEL, CARE_PLAN_SHORT_TERM_LABEL, getCarePlanById, getGoalListItems } from "@/lib/services/care-plans";
import { getManagedUserSignatureName } from "@/lib/services/user-management";
import { formatDate, formatOptionalDate } from "@/lib/utils";

function GoalList({ value }: { value: string }) {
  const items = getGoalListItems(value);
  return (
    <ol className="list-decimal space-y-1 pl-5">
      {items.map((item, idx) => (
        <li key={`${idx}-${item}`}>{item}</li>
      ))}
    </ol>
  );
}

function participationRateLabel(rate: number | null) {
  if (rate == null) return "N/A";
  return `${rate}%`;
}

export default async function CarePlanDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ carePlanId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRoles(["admin", "manager", "nurse"]);
  const profile = await getCurrentProfile();
  const signerName = getManagedUserSignatureName(profile.id, profile.full_name);
  const { carePlanId } = await params;
  const query = searchParams ? await searchParams : {};
  const detail = getCarePlanById(carePlanId);

  if (!detail) redirect("/health/care-plans/list");

  const canEdit = profile.role === "admin" || profile.role === "manager" || profile.role === "nurse";
  const reviewMode = typeof query.view === "string" && query.view === "review";
  const requestedReturnTo = typeof query.returnTo === "string" ? query.returnTo : null;
  const returnTo = requestedReturnTo && requestedReturnTo.startsWith("/") ? requestedReturnTo : null;

  const reviewForm = canEdit ? (
    <Card id="review-update">
      <CardTitle>{reviewMode ? "New Care Plan Review" : "Review / Update Care Plan"}</CardTitle>
      <CarePlanReviewForm
        carePlanId={detail.carePlan.id}
        reviewedByDefault={signerName}
        sections={detail.sections.map((section) => ({ id: section.id, sectionType: section.sectionType, shortTermGoals: section.shortTermGoals, longTermGoals: section.longTermGoals }))}
        careTeamNotes={detail.carePlan.careTeamNotes}
        responsiblePartySignature={detail.carePlan.responsiblePartySignature}
        responsiblePartySignatureDate={detail.carePlan.responsiblePartySignatureDate}
        administratorSignature={detail.carePlan.administratorSignature}
        administratorSignatureDate={detail.carePlan.administratorSignatureDate}
        returnTo={returnTo ?? undefined}
      />
    </Card>
  ) : null;

  if (reviewMode) {
    return (
      <div className="space-y-4">
        <Card>
          <CardTitle>{detail.carePlan.memberName} - Care Plan Review ({detail.carePlan.track})</CardTitle>
          <p className="mt-1 text-sm text-muted">Review history is shown first. Submit the next review below.</p>
          <div className="mt-3 grid gap-3 md:grid-cols-4">
            <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Enrollment Date</p><p className="font-semibold">{formatDate(detail.carePlan.enrollmentDate)}</p></div>
            <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Last Completed</p><p className="font-semibold">{formatOptionalDate(detail.carePlan.lastCompletedDate)}</p></div>
            <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Next Due</p><p className="font-semibold">{formatDate(detail.carePlan.nextDueDate)}</p></div>
            <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Status</p><p className="font-semibold">{detail.carePlan.status}</p></div>
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-sm">
            <Link href={`/members/${detail.carePlan.memberId}`} className="font-semibold text-brand">Open Member Detail</Link>
            <Link href={`/health/care-plans/${detail.carePlan.id}`} className="font-semibold text-brand">View Full Current Care Plan</Link>
          </div>
        </Card>

        <Card className="table-wrap">
          <CardTitle>Review History</CardTitle>
          <table>
            <thead><tr><th>Care Plan Review Date</th><th>Completed By (Nurse Name)</th><th>Summary</th><th>Changes Made</th><th>Next Due</th></tr></thead>
            <tbody>
              {detail.history.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center text-sm text-muted">No prior reviews yet.</td>
                </tr>
              ) : (
                detail.history.map((row) => (
                  <tr key={row.id}>
                    <td>
                      {row.versionId ? (
                        <Link className="font-semibold text-brand" href={`/health/care-plans/${detail.carePlan.id}/versions/${row.versionId}`}>
                          {formatDate(row.reviewDate)}
                        </Link>
                      ) : (
                        formatDate(row.reviewDate)
                      )}
                    </td>
                    <td>{row.reviewedBy}</td>
                    <td>{row.summary}</td>
                    <td>{row.changesMade ? "Yes" : "No"}</td>
                    <td>{formatDate(row.nextDueDate)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>

        <Card>
          <CardTitle>Participation Summary (Last 180 Days)</CardTitle>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted">Attendance Days</p>
              <p className="font-semibold">{detail.participationSummary.attendanceDays}</p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted">Participation Days</p>
              <p className="font-semibold">{detail.participationSummary.participationDays}</p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted">Participation Rate</p>
              <p className="font-semibold">{participationRateLabel(detail.participationSummary.participationRate)}</p>
            </div>
          </div>
        </Card>

        {reviewForm}

        <p className="text-xs text-muted">TODO: Add print-friendly care plan view and PDF export/e-sign pipeline once document backend is connected.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>{detail.carePlan.memberName} - Member Care Plan ({detail.carePlan.track})</CardTitle>
        <div className="mt-3 space-y-2">
          <p className="text-sm font-semibold">Member Information</p>
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Enrollment Date</p><p className="font-semibold">{formatDate(detail.carePlan.enrollmentDate)}</p></div>
            <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Care Plan Review Date</p><p className="font-semibold">{formatDate(detail.carePlan.reviewDate)}</p></div>
            <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Last Completed</p><p className="font-semibold">{formatOptionalDate(detail.carePlan.lastCompletedDate)}</p></div>
            <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Next Due</p><p className="font-semibold">{formatDate(detail.carePlan.nextDueDate)}</p></div>
          </div>
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Status</p><p className="font-semibold">{detail.carePlan.status}</p></div>
        </div>
        <div className="mt-3 text-sm">
          <Link href={`/members/${detail.carePlan.memberId}`} className="font-semibold text-brand">Open Member Detail</Link>
        </div>
      </Card>

      <Card className="table-wrap">
        <CardTitle>Care Plan Sections</CardTitle>
        <table>
          <thead><tr><th>Section</th><th>{CARE_PLAN_SHORT_TERM_LABEL}</th><th>{CARE_PLAN_LONG_TERM_LABEL}</th></tr></thead>
          <tbody>
            {detail.sections.map((section) => (
              <tr key={section.id}><td>{section.sectionType}</td><td><GoalList value={section.shortTermGoals} /></td><td><GoalList value={section.longTermGoals} /></td></tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card>
        <CardTitle>Care Plan Review & Updates</CardTitle>
        <p className="text-sm">No changes needed: {detail.carePlan.noChangesNeeded ? "Yes" : "No"}</p>
        <p className="text-sm">Modifications required: {detail.carePlan.modificationsRequired ? "Yes" : "No"}</p>
        <p className="text-sm">Modifications description: {detail.carePlan.modificationsDescription || "-"}</p>
      </Card>

      <Card>
        <CardTitle>Care Team Notes</CardTitle>
        <p className="text-sm text-muted whitespace-pre-line">{detail.carePlan.careTeamNotes || "-"}</p>
      </Card>

      <Card className="table-wrap">
        <CardTitle>Signoff</CardTitle>
        <table>
          <thead><tr><th>Completed By (Nurse Name)</th><th>Date of Completion</th><th>Member/Responsible Party Signature</th><th>Signature Date</th><th>Administrator/Designee Signature</th><th>Admin Signature Date</th></tr></thead>
          <tbody>
            <tr>
              <td>{detail.carePlan.completedBy ?? "-"}</td>
              <td>{formatOptionalDate(detail.carePlan.dateOfCompletion)}</td>
              <td>{detail.carePlan.responsiblePartySignature ?? "-"}</td>
              <td>{formatOptionalDate(detail.carePlan.responsiblePartySignatureDate)}</td>
              <td>{detail.carePlan.administratorSignature ?? "-"}</td>
              <td>{formatOptionalDate(detail.carePlan.administratorSignatureDate)}</td>
            </tr>
          </tbody>
        </table>
      </Card>

      <Card className="table-wrap">
        <CardTitle>Review History</CardTitle>
        <table>
          <thead><tr><th>Care Plan Review Date</th><th>Completed By (Nurse Name)</th><th>Summary</th><th>Changes Made</th><th>Next Due</th></tr></thead>
          <tbody>
            {detail.history.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center text-sm text-muted">No prior reviews yet.</td>
              </tr>
            ) : (
              detail.history.map((row) => (
                <tr key={row.id}>
                  <td>
                    {row.versionId ? (
                      <Link className="font-semibold text-brand" href={`/health/care-plans/${detail.carePlan.id}/versions/${row.versionId}`}>
                        {formatDate(row.reviewDate)}
                      </Link>
                    ) : (
                      formatDate(row.reviewDate)
                    )}
                  </td>
                  <td>{row.reviewedBy}</td>
                  <td>{row.summary}</td>
                  <td>{row.changesMade ? "Yes" : "No"}</td>
                  <td>{formatDate(row.nextDueDate)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      <Card>
        <CardTitle>Participation Summary (Last 180 Days)</CardTitle>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted">Attendance Days</p>
            <p className="font-semibold">{detail.participationSummary.attendanceDays}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted">Participation Days</p>
            <p className="font-semibold">{detail.participationSummary.participationDays}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted">Participation Rate</p>
            <p className="font-semibold">{participationRateLabel(detail.participationSummary.participationRate)}</p>
          </div>
        </div>
      </Card>

      {reviewForm}

      <p className="text-xs text-muted">TODO: Add print-friendly care plan view and PDF export/e-sign pipeline once document backend is connected.</p>
    </div>
  );
}
