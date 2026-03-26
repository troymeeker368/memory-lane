import { DocumentBrandHeader } from "@/components/documents/document-brand-header";
import { Card, CardTitle } from "@/components/ui/card";
import { buildEnrollmentPacketLegalText } from "@/lib/services/enrollment-packet-legal-text";
import { normalizeStoredIntakePayload } from "@/lib/services/enrollment-packet-core";
import { formatEnrollmentPacketRecreationInterests } from "@/lib/services/enrollment-packet-recreation";

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
  const followUpRequired =
    (Array.isArray(statusParam) ? statusParam[0] : statusParam) === "follow-up-required";
  const wasReplayed = (Array.isArray(replayedParam) ? replayedParam[0] : replayedParam) === "1";
  const { getPublicEnrollmentPacketContext } = await import("@/lib/services/enrollment-packets-public");
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
  const legalText = buildEnrollmentPacketLegalText({
    caregiverName,
    photoConsentChoice: intakePayload?.photoConsentChoice ?? null
  });

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <DocumentBrandHeader title="Enrollment Packet Confirmation" />
      <Card>
        <CardTitle>Enrollment Packet Submitted</CardTitle>
        <div className="mt-3 space-y-2 text-sm">
          <p><span className="font-semibold">Member:</span> {memberName}</p>
          <p><span className="font-semibold">Caregiver:</span> {caregiverName}</p>
          <p><span className="font-semibold">Recreation interests:</span> {formatEnrollmentPacketRecreationInterests(intakePayload?.recreationInterests)}</p>
        </div>
        {followUpRequired ? (
          <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            Memory Lane received the enrollment packet. Some staff follow-up is still needed before downstream
            setup is fully operational, and the care team has been signaled to review it.
          </div>
        ) : null}
        {wasReplayed ? (
          <p className="mt-3 text-xs text-muted">
            This confirmation reflects an already-filed enrollment packet, so the original submission was not duplicated.
          </p>
        ) : null}
      </Card>
      <Card>
        <CardTitle>First Day Welcome Letter</CardTitle>
        <div className="mt-3 space-y-3 text-sm text-slate-700">
          {legalText.firstDayWelcome.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
      </Card>
    </div>
  );
}
