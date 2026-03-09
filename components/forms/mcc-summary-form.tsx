"use client";

import { FormEvent, useEffect, useState, useTransition } from "react";

import { saveMemberCommandCenterSummaryAction } from "@/app/(portal)/operations/member-command-center/actions";

export function MccSummaryForm({
  memberId,
  lockerNumber,
  lockerOptions,
  payor,
  originalReferralSource,
  photoConsent
}: {
  memberId: string;
  lockerNumber: string;
  lockerOptions: string[];
  payor: string;
  originalReferralSource: string;
  photoConsent: boolean | null;
}) {
  const [photoConsentValue, setPhotoConsentValue] = useState(
    photoConsent == null ? "" : photoConsent ? "true" : "false"
  );
  const [status, setStatus] = useState("");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const mapped = photoConsentValue === "true" ? true : photoConsentValue === "false" ? false : null;
    window.dispatchEvent(
      new CustomEvent("mcc:header-update", {
        detail: {
          photoConsent: mapped
        }
      })
    );
  }, [photoConsentValue]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("");
    const payload = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await saveMemberCommandCenterSummaryAction(payload);
      if (!result?.ok) {
        setStatus(result?.error ?? "Unable to save member summary.");
        return;
      }
      setStatus("Member summary saved.");
    });
  };

  return (
    <form onSubmit={onSubmit} className="mt-3 grid gap-2 md:grid-cols-3">
      <input type="hidden" name="memberId" value={memberId} />
      <label className="space-y-1 text-sm">
        <span className="text-xs font-semibold text-muted">Locker #</span>
        <select name="lockerNumber" defaultValue={lockerNumber} className="h-10 w-full rounded-lg border border-border px-3">
          <option value="">Unassigned</option>
          {lockerOptions.map((locker) => (
            <option key={locker} value={locker}>
              {locker}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Payor</span><input name="payor" defaultValue={payor} className="h-10 w-full rounded-lg border border-border px-3" /></label>
      <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Original Referral Source</span><input name="originalReferralSource" defaultValue={originalReferralSource} className="h-10 w-full rounded-lg border border-border px-3" /></label>
      <label className="space-y-1 text-sm">
        <span className="text-xs font-semibold text-muted">Photo Consent</span>
        <select
          name="photoConsent"
          value={photoConsentValue}
          onChange={(event) => setPhotoConsentValue(event.target.value)}
          className="h-10 w-full rounded-lg border border-border px-3"
        >
          <option value="">-</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      </label>
      <div className="md:col-span-3">
        <button type="submit" disabled={isPending} className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white disabled:opacity-70">
          {isPending ? "Saving..." : "Save Member Summary"}
        </button>
      </div>
      {status ? <p className="md:col-span-3 text-xs text-muted">{status}</p> : null}
    </form>
  );
}
