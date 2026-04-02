import type { ReactNode } from "react";

import { DocumentBrandHeader } from "@/components/documents/document-brand-header";
import { EnrollmentPacketConfirmationActions } from "@/components/enrollment-packets/enrollment-packet-confirmation-actions";
import { Card, CardTitle } from "@/components/ui/card";
import { buildEnrollmentPacketLegalText } from "@/lib/services/enrollment-packet-legal-text";
import { normalizeStoredIntakePayload } from "@/lib/services/enrollment-packet-core";
import { formatEnrollmentPacketRecreationInterests } from "@/lib/services/enrollment-packet-recreation";

const FIRST_DAY_WELCOME_BULLET_SECTIONS = [
  {
    heading: "Items to Submit Before the First Day",
    intro: "Please make sure the following documents are completed and submitted to the Enrollment Manager or Center Nurse:",
    itemCount: 4
  },
  {
    heading: "What to Bring on Your First Day",
    intro: "To help us provide the best care possible, please send the following items:",
    itemCount: 4
  }
] as const;

function renderFirstDayWelcomeLetter(paragraphs: readonly string[]) {
  const rendered: ReactNode[] = [];
  let index = 0;

  while (index < paragraphs.length) {
    const section = FIRST_DAY_WELCOME_BULLET_SECTIONS.find((candidate) => candidate.heading === paragraphs[index]);
    if (!section) {
      rendered.push(<p key={`${index}-${paragraphs[index]}`}>{paragraphs[index]}</p>);
      index += 1;
      continue;
    }

    const intro = paragraphs[index + 1] ?? section.intro;
    const items = paragraphs.slice(index + 2, index + 2 + section.itemCount);
    rendered.push(
      <section key={`${index}-${section.heading}`} className="space-y-3">
        <h3 className="font-semibold text-slate-900">{section.heading}</h3>
        <p>{intro}</p>
        <ul className="list-disc space-y-2 pl-5">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    );
    index += 2 + section.itemCount;
  }

  return rendered;
}

export default async function EnrollmentPacketConfirmationPage({
  params,
  searchParams
}: {
  params: Promise<{ token: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const statusParam = resolvedSearchParams?.status;
  const replayedParam = resolvedSearchParams?.replayed;
  const wasReplayed = (Array.isArray(replayedParam) ? replayedParam[0] : replayedParam) === "1";
  const { getPublicEnrollmentPacketContext, issuePublicCompletedEnrollmentPacketDownloadToken } = await import(
    "@/lib/services/enrollment-packets-public"
  );
  const context = await getPublicEnrollmentPacketContext(token);

  if (context.state !== "completed") {
    return (
      <div className="mx-auto max-w-4xl space-y-4 p-4">
        <DocumentBrandHeader title="Enrollment Packet Confirmation" />
        <Card>
          <CardTitle>Confirmation Not Available</CardTitle>
          <p className="mt-2 text-sm text-muted">
            This confirmation page is available after the enrollment packet is submitted.
          </p>
        </Card>
      </div>
    );
  }

  const queryIndicatesFollowUp =
    (Array.isArray(statusParam) ? statusParam[0] : statusParam) === "follow-up-required";
  const followUpRequired = queryIndicatesFollowUp || context.actionNeeded;

  const [{ getMemberById, loadPacketFields }] = await Promise.all([
    import("@/lib/services/enrollment-packet-mapping-runtime")
  ]);

  const [member, fields] = await Promise.all([
    getMemberById(context.request.memberId),
    loadPacketFields(context.request.id)
  ]);

  const intakePayload = fields ? normalizeStoredIntakePayload(fields) : null;
  const memberName = member?.display_name ?? "Member";
  const caregiverName =
    intakePayload?.membershipGuarantorSignatureName ??
    intakePayload?.primaryContactName ??
    fields?.caregiver_name ??
    "Caregiver";
  const { downloadToken } = await issuePublicCompletedEnrollmentPacketDownloadToken({ token });
  const completedPacketDownloadHref = `/sign/enrollment-packet/${encodeURIComponent(downloadToken)}/completed-packet`;
  const legalText = buildEnrollmentPacketLegalText({
    caregiverName,
    photoConsentChoice: intakePayload?.photoConsentChoice ?? null
  });

  return (
    <div className="enrollment-confirmation-shell mx-auto max-w-4xl space-y-4 p-4">
      <DocumentBrandHeader title="Enrollment Packet Confirmation" />
      <Card className="enrollment-confirmation-summary">
        <CardTitle>Enrollment Packet Submitted</CardTitle>
        <div className="mt-3 space-y-2 text-sm">
          <p><span className="font-semibold">Member:</span> {memberName}</p>
          <p><span className="font-semibold">Caregiver:</span> {caregiverName}</p>
          <p><span className="font-semibold">Recreation interests:</span> {formatEnrollmentPacketRecreationInterests(intakePayload?.recreationInterests)}</p>
        </div>
        {followUpRequired ? (
          <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            {context.actionNeededMessage ??
              "Memory Lane received the enrollment packet. Some staff follow-up is still needed before downstream setup is fully operational, and the care team has been signaled to review it."}
          </div>
        ) : null}
        {wasReplayed ? (
          <p className="mt-3 text-xs text-muted">
            This confirmation reflects an already-completed enrollment packet, so the original submission was not duplicated.
          </p>
        ) : null}
      </Card>
      <Card className="enrollment-confirmation-welcome">
        <CardTitle>First Day Welcome Letter</CardTitle>
        <EnrollmentPacketConfirmationActions downloadHref={completedPacketDownloadHref} />
        <div className="mt-3 space-y-3 text-sm text-slate-700">
          {renderFirstDayWelcomeLetter(legalText.firstDayWelcome)}
        </div>
      </Card>
    </div>
  );
}
