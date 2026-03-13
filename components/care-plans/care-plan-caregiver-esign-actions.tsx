"use client";

import { useMemo, useState, useTransition } from "react";

import {
  sendCarePlanToCaregiverAction,
  signCarePlanAction
} from "@/app/care-plan-actions";
import { EsignaturePad } from "@/components/signature/esignature-pad";
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
  caregiverSignedAt
}: {
  carePlanId: string;
  nurseSignatureStatus: string;
  nurseSignedAt: string | null;
  caregiverName: string | null;
  caregiverEmail: string | null;
  caregiverSignatureStatus: string;
  caregiverSentAt: string | null;
  caregiverSignedAt: string | null;
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

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <p className="text-sm font-semibold">Caregiver E-Sign Workflow</p>
      <p className="text-xs text-muted">Do not implement caregiver signature as a separate disconnected doc flow; it must be part of the canonical care plan record lifecycle from nurse sign-off through caregiver completion and member-file archival.</p>
      <p className="text-sm">Current signing status: <span className="font-semibold">{caregiverSignatureStatus}</span></p>
      <p className="text-xs text-muted">Sent At: {caregiverSentAt ?? "-"} | Signed At: {caregiverSignedAt ?? "-"}</p>

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
                setStatus("Care plan signed by Nurse/Admin.");
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
            setStatus("Caregiver signature request sent.");
          })
        }
      >
        {isPending ? "Sending..." : "Send to Caregiver for Signature"}
      </button>

      {status ? <p className="text-sm text-muted">{status}</p> : null}
    </div>
  );
}
