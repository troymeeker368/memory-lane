import { headers } from "next/headers";

import { CarePlanSignatureBlock } from "@/components/care-plans/care-plan-signature-block";
import { CarePlanPublicSignForm } from "@/components/care-plans/care-plan-public-sign-form";
import { DocumentBrandHeader } from "@/components/documents/document-brand-header";
import { Card, CardTitle } from "@/components/ui/card";
import {
  CARE_PLAN_LONG_TERM_LABEL,
  CARE_PLAN_REVIEW_UPDATES_LABEL,
  CARE_PLAN_SHORT_TERM_LABEL,
  getGoalListItems
} from "@/lib/services/care-plans";
import { getPublicCarePlanSigningContext } from "@/lib/services/care-plan-esign-public";
import { formatDate, formatDateTime } from "@/lib/utils";

function GoalList({ value }: { value: string }) {
  const items = getGoalListItems(value);
  return (
    <ol className="list-decimal space-y-1 pl-5">
      {items.map((item, idx) => (
        <li key={`${idx}-${item}`} className="text-sm">{item}</li>
      ))}
    </ol>
  );
}

export default async function PublicCarePlanSigningPage({
  params
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const headersList = await headers();
  const forwardedFor = headersList.get("x-forwarded-for");
  const caregiverIp = forwardedFor ? forwardedFor.split(",")[0].trim() : null;
  const caregiverUserAgent = headersList.get("user-agent");
  const context = await getPublicCarePlanSigningContext(token, {
    ip: caregiverIp,
    userAgent: caregiverUserAgent
  });

  if (context.state === "invalid") {
    return (
      <div className="mx-auto max-w-3xl p-4">
        <Card>
          <CardTitle>Invalid Signature Link</CardTitle>
          <p className="mt-2 text-sm text-muted">This care plan signing link is invalid. Contact your care team for a new link.</p>
        </Card>
      </div>
    );
  }

  if (context.state === "expired") {
    return (
      <div className="mx-auto max-w-3xl p-4">
        <Card>
          <CardTitle>Signature Link Expired</CardTitle>
          <p className="mt-2 text-sm text-muted">This signing request expired. Contact your care team for a new link.</p>
        </Card>
      </div>
    );
  }

  if (context.state === "completed") {
    return (
      <div className="mx-auto max-w-3xl p-4">
        <Card>
          <CardTitle>Already Signed</CardTitle>
          <p className="mt-2 text-sm text-muted">
            This care plan was already signed on {context.carePlan.caregiverSignedAt ? formatDateTime(context.carePlan.caregiverSignedAt) : "a previous date"}.
          </p>
        </Card>
      </div>
    );
  }

  const { detail } = context;

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <Card>
        <DocumentBrandHeader
          title={`Member Care Plan: ${detail.carePlan.track}`}
          metaLines={[
            `Member: ${detail.carePlan.memberName}`,
            `Review Date: ${formatDate(detail.carePlan.reviewDate)}`
          ]}
        />
        <CardTitle className="mt-4">Care Plan Signature</CardTitle>
      </Card>

      <Card>
        <CardTitle>Care Plan Review</CardTitle>
        <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
          <p><span className="font-semibold">Enrollment Date:</span> {formatDate(detail.carePlan.enrollmentDate)}</p>
          <p><span className="font-semibold">Care Plan Review Date:</span> {formatDate(detail.carePlan.reviewDate)}</p>
          <p><span className="font-semibold">Completed By (Nurse Name):</span> {detail.carePlan.completedBy ?? "-"}</p>
          <p><span className="font-semibold">{CARE_PLAN_REVIEW_UPDATES_LABEL}:</span> {detail.carePlan.modificationsRequired ? "Modifications required" : "No changes needed"}</p>
        </div>

        <div className="mt-3 space-y-3">
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
        </div>

        <div className="mt-4 rounded-lg border border-border p-3">
          <p className="text-sm font-semibold">Signoff</p>
          <div className="mt-2">
            <CarePlanSignatureBlock
              completedBy={detail.carePlan.completedBy}
              dateOfCompletion={detail.carePlan.dateOfCompletion}
              responsiblePartySignature={detail.carePlan.responsiblePartySignature ?? detail.carePlan.caregiverSignedName}
              responsiblePartySignatureDate={detail.carePlan.responsiblePartySignatureDate ?? detail.carePlan.caregiverSignedAt}
              administratorSignature={detail.carePlan.administratorSignature ?? detail.carePlan.nurseDesigneeName}
              administratorSignatureDate={detail.carePlan.administratorSignatureDate}
              caregiverSignatureStatus={detail.carePlan.caregiverSignatureStatus}
              caregiverSentAt={detail.carePlan.caregiverSentAt}
              caregiverViewedAt={detail.carePlan.caregiverViewedAt}
              caregiverSignedAt={detail.carePlan.caregiverSignedAt}
            />
          </div>
        </div>
      </Card>

      <Card>
        <CardTitle>Sign Care Plan</CardTitle>
        <div className="mt-3">
          <CarePlanPublicSignForm token={token} caregiverNameDefault={detail.carePlan.caregiverName ?? ""} />
        </div>
      </Card>
    </div>
  );
}
