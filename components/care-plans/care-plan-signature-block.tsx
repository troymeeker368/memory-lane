import { CARE_PLAN_SIGNATURE_LABELS } from "@/lib/services/care-plan-track-definitions";
import { getCaregiverSignatureStatusLabel } from "@/lib/services/care-plan-esign-rules";
import type { CaregiverSignatureStatus } from "@/lib/services/care-plans";
import { formatOptionalDate } from "@/lib/utils";

function SignatureRow({
  leftLabel,
  leftValue,
  rightLabel,
  rightValue
}: {
  leftLabel: string;
  leftValue: string | null | undefined;
  rightLabel: string;
  rightValue: string | null | undefined;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-[1fr_220px]">
      <div>
        <p className="text-xs font-semibold">{leftLabel}</p>
        <p className="mt-1 rounded-lg border border-border px-2 py-2 text-sm">{leftValue ?? "-"}</p>
      </div>
      <div>
        <p className="text-xs font-semibold">{rightLabel}</p>
        <p className="mt-1 rounded-lg border border-border px-2 py-2 text-sm">{formatOptionalDate(rightValue ?? null)}</p>
      </div>
    </div>
  );
}

export function CarePlanSignatureBlock({
  completedBy,
  dateOfCompletion,
  responsiblePartySignature,
  responsiblePartySignatureDate,
  administratorSignature,
  administratorSignatureDate,
  nurseSignatureStatus,
  nurseSignedByName,
  nurseSignedAt,
  caregiverSignatureStatus,
  caregiverSentAt,
  caregiverViewedAt,
  caregiverSignedAt
}: {
  completedBy: string | null;
  dateOfCompletion: string | null;
  responsiblePartySignature: string | null;
  responsiblePartySignatureDate: string | null;
  administratorSignature: string | null;
  administratorSignatureDate: string | null;
  nurseSignatureStatus?: string | null;
  nurseSignedByName?: string | null;
  nurseSignedAt?: string | null;
  caregiverSignatureStatus?: string | null;
  caregiverSentAt?: string | null;
  caregiverViewedAt?: string | null;
  caregiverSignedAt?: string | null;
}) {
  const canonicalSignerName = nurseSignedByName ?? completedBy ?? administratorSignature;
  const canonicalSignedAt = nurseSignedAt ?? dateOfCompletion ?? administratorSignatureDate;
  const nurseStatusLabel =
    nurseSignatureStatus === "signed"
      ? "Signed by Nurse/Admin"
      : nurseSignatureStatus === "unsigned"
        ? "Awaiting Nurse/Admin signature"
        : nurseSignatureStatus ?? "Unknown";
  const caregiverStatusLabel = caregiverSignatureStatus
    ? getCaregiverSignatureStatusLabel(caregiverSignatureStatus as CaregiverSignatureStatus)
    : null;

  return (
    <div className="space-y-3">
      {nurseSignatureStatus ? (
        <div className="space-y-1 text-xs text-muted">
          <p>Nurse/Admin E-Sign Status: {nurseStatusLabel}</p>
          <p>Signed By: {canonicalSignerName ?? "-"}</p>
          <p>Signed At: {formatOptionalDate(canonicalSignedAt ?? null)}</p>
        </div>
      ) : null}
      <SignatureRow
        leftLabel={CARE_PLAN_SIGNATURE_LABELS.completedBy}
        leftValue={canonicalSignerName}
        rightLabel={CARE_PLAN_SIGNATURE_LABELS.completedByDate}
        rightValue={canonicalSignedAt}
      />
      <SignatureRow
        leftLabel={CARE_PLAN_SIGNATURE_LABELS.responsibleParty}
        leftValue={responsiblePartySignature}
        rightLabel={CARE_PLAN_SIGNATURE_LABELS.responsiblePartyDate}
        rightValue={responsiblePartySignatureDate}
      />
      <SignatureRow
        leftLabel={CARE_PLAN_SIGNATURE_LABELS.administratorDesignee}
        leftValue={canonicalSignerName}
        rightLabel={CARE_PLAN_SIGNATURE_LABELS.administratorDesigneeDate}
        rightValue={canonicalSignedAt}
      />
      {caregiverSignatureStatus ? (
        <div className="space-y-1 text-xs text-muted">
          <p>Responsible Party Signature Status: {caregiverStatusLabel}</p>
          <p>Sent: {formatOptionalDate(caregiverSentAt ?? null)}</p>
          <p>Opened: {formatOptionalDate(caregiverViewedAt ?? null)}</p>
          <p>Signed: {formatOptionalDate(caregiverSignedAt ?? null)}</p>
        </div>
      ) : null}
    </div>
  );
}
