import Link from "next/link";
import { redirect } from "next/navigation";

import { CarePlanCaregiverEsignActions } from "@/components/care-plans/care-plan-caregiver-esign-actions";
import { CarePlanPdfActions } from "@/components/care-plans/care-plan-pdf-actions";
import { DocumentBrandHeader } from "@/components/documents/document-brand-header";
import { CarePlanReviewForm } from "@/components/forms/care-plan-forms";
import { Card, CardTitle } from "@/components/ui/card";
import { requireCarePlanAuthorizedUser } from "@/lib/services/care-plan-authorization";
import {
  CARE_PLAN_LONG_TERM_LABEL,
  CARE_PLAN_REVIEW_OPTIONS,
  CARE_PLAN_REVIEW_UPDATES_LABEL,
  CARE_PLAN_SHORT_TERM_LABEL,
  getCarePlanById,
  getGoalListItems
} from "@/lib/services/care-plans";
import { formatDate, formatOptionalDate } from "@/lib/utils";

function GoalList({ value }: { value: string }) {
  const items = getGoalListItems(value);
  return (
    <div className="space-y-1">
      {items.map((item, idx) => (
        <p key={`${idx}-${item}`} className="text-sm">
          {item}
        </p>
      ))}
    </div>
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
  const authorizedUser = await requireCarePlanAuthorizedUser();
  const { carePlanId } = await params;
  const query = searchParams ? await searchParams : {};
  const detail = await getCarePlanById(carePlanId);
  if (!detail) redirect("/health/care-plans/list");

  const reviewMode = typeof query.view === "string" && query.view === "review";
  const requestedReturnTo = typeof query.returnTo === "string" ? query.returnTo : null;
  const returnTo = requestedReturnTo && requestedReturnTo.startsWith("/") ? requestedReturnTo : null;

  const reviewForm = (
    <Card id="review-update">
      <CardTitle>{reviewMode ? "New Care Plan Review" : "Review / Update Care Plan"}</CardTitle>
      <CarePlanReviewForm
        carePlanId={detail.carePlan.id}
        track={detail.carePlan.track}
        reviewedByDefault={authorizedUser.signatureName}
        careTeamNotes={detail.carePlan.careTeamNotes}
        caregiverName={detail.carePlan.caregiverName}
        caregiverEmail={detail.carePlan.caregiverEmail}
        returnTo={returnTo ?? undefined}
      />
    </Card>
  );

  return (
    <div className="space-y-4">
      <Card>
        <DocumentBrandHeader
          title={`Member Care Plan: ${detail.carePlan.track}`}
          metaLines={[
            `Member: ${detail.carePlan.memberName}`,
            `Review Date: ${formatDate(detail.carePlan.reviewDate)}`
          ]}
        />
        <div className="mt-3">
          <CarePlanPdfActions carePlanId={detail.carePlan.id} />
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Enrollment Date</p><p className="font-semibold">{formatDate(detail.carePlan.enrollmentDate)}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Care Plan Review Date</p><p className="font-semibold">{formatDate(detail.carePlan.reviewDate)}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Last Completed</p><p className="font-semibold">{formatOptionalDate(detail.carePlan.lastCompletedDate)}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Next Due</p><p className="font-semibold">{formatDate(detail.carePlan.nextDueDate)}</p></div>
        </div>
        <div className="mt-3 text-sm">
          <Link href={`/members/${detail.carePlan.memberId}`} className="font-semibold text-brand">Open Member Detail</Link>
        </div>
        {detail.carePlan.designeeCleanupRequired ? (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Legacy designee/user linkage is invalid and requires cleanup before this record is fully compliant.
          </p>
        ) : null}
      </Card>

      <Card className="space-y-3">
        <CardTitle>Care Plan Sections</CardTitle>
        {detail.sections.map((section) => (
          <div key={section.id} className="rounded-lg border border-border p-3">
            <p className="text-sm font-semibold">{section.sectionType}</p>
            <div className="mt-2 space-y-1">
              <p className="text-xs font-semibold">{CARE_PLAN_SHORT_TERM_LABEL}</p>
              <GoalList value={section.shortTermGoals} />
            </div>
            <div className="mt-2 space-y-1">
              <p className="text-xs font-semibold">{CARE_PLAN_LONG_TERM_LABEL}</p>
              <GoalList value={section.longTermGoals} />
            </div>
          </div>
        ))}
      </Card>

      <Card>
        <CardTitle>{CARE_PLAN_REVIEW_UPDATES_LABEL}</CardTitle>
        <p className="text-sm">{detail.carePlan.noChangesNeeded ? "☑" : "☐"} {CARE_PLAN_REVIEW_OPTIONS[0].replace(/^☐\s*/, "")}</p>
        <p className="text-sm">{detail.carePlan.modificationsRequired ? "☑" : "☐"} {CARE_PLAN_REVIEW_OPTIONS[1].replace(/^☐\s*/, "")}</p>
        <p className="text-sm">Modifications description: {detail.carePlan.modificationsDescription || "-"}</p>
      </Card>

      <Card>
        <CardTitle>Care Team Notes</CardTitle>
        <p className="text-sm whitespace-pre-line text-muted">{detail.carePlan.careTeamNotes || "-"}</p>
      </Card>

      <Card className="space-y-1">
        <CardTitle>Signoff</CardTitle>
        <p className="text-sm">Completed By (Nurse Name): {detail.carePlan.completedBy ?? "-"}</p>
        <p className="text-sm">Date of Completion: {formatOptionalDate(detail.carePlan.dateOfCompletion)}</p>
        <p className="text-sm">Responsible Party Signature: {detail.carePlan.responsiblePartySignature ?? detail.carePlan.caregiverSignedName ?? "-"}</p>
        <p className="text-sm">Date: {formatOptionalDate(detail.carePlan.responsiblePartySignatureDate ?? detail.carePlan.caregiverSignedAt)}</p>
        <p className="text-sm">Administrator/Designee Signature: {detail.carePlan.administratorSignature ?? detail.carePlan.nurseDesigneeName ?? "-"}</p>
        <p className="text-sm">Date: {formatOptionalDate(detail.carePlan.administratorSignatureDate)}</p>
      </Card>

      <Card>
        <CarePlanCaregiverEsignActions
          carePlanId={detail.carePlan.id}
          nurseSignedAt={detail.carePlan.nurseSignedAt}
          caregiverName={detail.carePlan.caregiverName}
          caregiverEmail={detail.carePlan.caregiverEmail}
          caregiverSignatureStatus={detail.carePlan.caregiverSignatureStatus}
          caregiverSentAt={detail.carePlan.caregiverSentAt}
          caregiverSignedAt={detail.carePlan.caregiverSignedAt}
        />
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
    </div>
  );
}
