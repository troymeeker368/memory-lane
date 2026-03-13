"use client";

import { useMemo, useState, useTransition } from "react";

import {
  sendCarePlanToCaregiverAction,
  signCarePlanAction
} from "@/app/care-plan-actions";
import { EsignaturePad } from "@/components/signature/esignature-pad";
import { getCaregiverSignatureStatusLabel } from "@/lib/services/care-plan-esign-rules";
import type { CaregiverSignatureStatus } from "@/lib/services/care-plans";
import { toEasternDate } from "@/lib/timezone";

function plusDays(baseDate: string, days: number) {
  const date = new Date(`${baseDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function CarePlanCaregiverEsignActions({
  carePlanId,
  nurseSignatureStatus,
  nurseSignedAt,
  caregiverName,
  caregiverEmail,
  caregiverSignatureStatus,
  caregiverSentAt,
  caregiverViewedAt,
  caregiverSignedAt,
  finalMemberFileId
}: {
  carePlanId: string;
  nurseSignatureStatus: string;
  nurseSignedAt: string | null;
  caregiverName: string | null;
  caregiverEmail: string | null;
  caregiverSignatureStatus: string;
  caregiverSentAt: string | null;
  caregiverViewedAt: string | null;
  caregiverSignedAt: string | null;
  finalMemberFileId: string | null;
}) {
  const today = useMemo(() => toEasternDate(), []);
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [nurseAttested, setNurseAttested] = useState(false);
  const [nurseSignatureImageDataUrl, setNurseSignatureImageDataUrl] = useState<string | null>(null);
  const [form, setForm] = useState({
    caregiverName: caregiverName ?? "",
    caregiverEmail: caregiverEmail ?? "",
    optionalMessage: "",
    expiresOnDate: plusDays(today, 14)
  });

  const nurseSignatureReady = nurseSignatureStatus === "signed" && Boolean(nurseSignedAt);
  const caregiverStatusLabel = getCaregiverSignatureStatusLabel(
    caregiverSignatureStatus as CaregiverSignatureStatus
  );
  const caregiverSigned = caregiverSignatureStatus === "signed" && Boolean(caregiverSignedAt);
  const sendInProgressState = caregiverSignatureStatus === "sent" || caregiverSignatureStatus === "viewed";
  const sendButtonLabel =
    caregiverSignatureStatus === "send_failed" || caregiverSignatureStatus === "expired"
      ? "Resend Caregiver Signature Request"
      : "Send to Caregiver for Signature";

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <p className="text-sm font-semibold">Caregiver E-Sign Workflow</p>
      <p className="text-sm">
        Current status: <span className="font-semibold">{caregiverStatusLabel}</span>
      </p>
      <div className="rounded-lg border border-border bg-slate-50 p-3 text-xs text-muted">
        <p>Nurse/Admin Signed: {nurseSignedAt ?? "-"}</p>
        <p>Request Sent: {caregiverSentAt ?? "-"}</p>
        <p>Responsible Party Opened: {caregiverViewedAt ?? "-"}</p>
        <p>Responsible Party Signed: {caregiverSignedAt ?? "-"}</p>
        <p>Filed to Member Files: {finalMemberFileId ?? "-"}</p>
      </div>

      {caregiverSigned ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-sm font-semibold text-emerald-700">
          Care plan signature workflow is complete and filed.
        </p>
      ) : null}

      {!nurseSignatureReady ? (
        <div className="space-y-2">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={nurseAttested}
              onChange={(event) => setNurseAttested(event.target.checked)}
            />
            <span>I attest this is my electronic signature and I am the authorized clinical signer for this Care Plan.</span>
          </label>
          <button
            type="button"
            className="rounded-lg border border-border px-3 py-2 text-sm font-semibold"
            disabled={isPending || !nurseAttested || !nurseSignatureImageDataUrl}
            onClick={() =>
              startTransition(async () => {
                const result = await signCarePlanAction({
                  carePlanId,
                  attested: nurseAttested,
                  signatureImageDataUrl: nurseSignatureImageDataUrl ?? ""
                });
                if (!result.ok) {
                  setStatus(result.error);
                  return;
                }
                setStatus("Nurse/Admin signature saved. Caregiver request is ready to send.");
              })
            }
          >
            {isPending ? "Signing..." : "Sign as Administrator/Designee"}
          </button>
          <EsignaturePad disabled={isPending} onSignatureChange={setNurseSignatureImageDataUrl} />
        </div>
      ) : (
        <p className="text-sm">Nurse/Admin signature completed at: {nurseSignedAt}</p>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <input
          className="h-11 w-full rounded-lg border border-border px-3"
          placeholder="Caregiver Name"
          value={form.caregiverName}
          onChange={(event) => setForm((current) => ({ ...current, caregiverName: event.target.value }))}
        />
        <input
          type="email"
          className="h-11 w-full rounded-lg border border-border px-3"
          placeholder="Caregiver Email"
          value={form.caregiverEmail}
          onChange={(event) => setForm((current) => ({ ...current, caregiverEmail: event.target.value }))}
        />
        <input
          type="date"
          className="h-11 w-full rounded-lg border border-border px-3"
          value={form.expiresOnDate}
          onChange={(event) => setForm((current) => ({ ...current, expiresOnDate: event.target.value }))}
        />
        <input
          className="h-11 w-full rounded-lg border border-border px-3"
          placeholder="Optional message"
          value={form.optionalMessage}
          onChange={(event) => setForm((current) => ({ ...current, optionalMessage: event.target.value }))}
        />
      </div>

      <button
        type="button"
        className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white disabled:opacity-70"
        disabled={
          isPending ||
          !nurseSignatureReady ||
          caregiverSigned ||
          sendInProgressState ||
          !form.caregiverName.trim() ||
          !form.caregiverEmail.trim() ||
          !form.expiresOnDate
        }
        onClick={() =>
          startTransition(async () => {
            const result = await sendCarePlanToCaregiverAction({
              carePlanId,
              caregiverName: form.caregiverName,
              caregiverEmail: form.caregiverEmail,
              optionalMessage: form.optionalMessage,
              expiresOnDate: form.expiresOnDate
            });
            if (!result.ok) {
              setStatus(result.error);
              return;
            }
            setStatus(
              `Caregiver signature request sent. Status: ${getCaregiverSignatureStatusLabel(
                result.status as CaregiverSignatureStatus
              )}.`
            );
          })
        }
      >
        {isPending ? "Sending..." : sendButtonLabel}
      </button>

      {status ? <p className="text-sm text-muted">{status}</p> : null}
    </div>
  );
}
