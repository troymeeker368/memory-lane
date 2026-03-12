import { CARE_PLAN_SIGNATURE_LABELS } from "@/lib/services/care-plan-track-definitions";
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

  return (
    <div className="space-y-3">
      {nurseSignatureStatus ? (
        <p className="text-xs text-muted">
          Nurse/Admin E-Sign Status: {nurseSignatureStatus} | Signed By: {canonicalSignerName ?? "-"} | Signed At:{" "}
          {formatOptionalDate(canonicalSignedAt ?? null)}
        </p>
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
        <p className="text-xs text-muted">
          Caregiver signature status: {caregiverSignatureStatus} | Sent: {formatOptionalDate(caregiverSentAt ?? null)} | Viewed:{" "}
          {formatOptionalDate(caregiverViewedAt ?? null)} | Signed: {formatOptionalDate(caregiverSignedAt ?? null)}
        </p>
      ) : null}
    </div>
  );
}
