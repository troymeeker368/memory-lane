"use client";

import { FormEvent, useEffect } from "react";

import { saveMemberCommandCenterSummaryAction } from "@/app/(portal)/operations/member-command-center/summary-actions";
import { useScopedMutation } from "@/components/forms/use-scoped-mutation";
import { usePropSyncedState, usePropSyncedStatus } from "@/components/forms/use-prop-synced-state";
import { MutationNotice } from "@/components/ui/mutation-notice";
import { emitClientMutationEvent } from "@/lib/mutations/client-events";

export function MccSummaryForm({
  memberId,
  lockerNumber,
  billingPayorDisplay,
  originalReferralSource,
  photoConsent
}: {
  memberId: string;
  lockerNumber: string;
  billingPayorDisplay: string;
  originalReferralSource: string;
  photoConsent: boolean | null;
}) {
  const [photoConsentValue, setPhotoConsentValue] = usePropSyncedState(
    photoConsent == null ? "" : photoConsent ? "true" : "false"
    ,
    [memberId, photoConsent]
  );
  const [status, setStatus] = usePropSyncedStatus([memberId, photoConsent]);
  const { isSaving, run } = useScopedMutation();

  useEffect(() => {
    const mapped = photoConsentValue === "true" ? true : photoConsentValue === "false" ? false : null;
    emitClientMutationEvent("mcc:header-update", {
      photoConsent: mapped
    });
  }, [photoConsentValue]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("");
    const payload = new FormData(event.currentTarget);
    void run(() => saveMemberCommandCenterSummaryAction(payload), {
      successMessage: "Member summary saved.",
      errorMessage: "Unable to save member summary.",
      onSuccess: () => {
        setStatus("Member summary saved.");
      },
      onError: (result) => {
        setStatus(`Error: ${result.error}`);
      }
    });
  };

  return (
    <form onSubmit={onSubmit} className="mt-3 grid gap-2 md:grid-cols-3">
      <input type="hidden" name="memberId" value={memberId} />
      <input type="hidden" name="lockerNumber" value={lockerNumber} />
      <label className="space-y-1 text-sm">
        <span className="text-xs font-semibold text-muted">Locker #</span>
        <input value={lockerNumber || "Unassigned"} readOnly className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-muted" />
        <p className="text-[11px] text-muted">Manage locker assignment from the MCC Locker Assignments tab.</p>
      </label>
      <label className="space-y-1 text-sm">
        <span className="text-xs font-semibold text-muted">Billing Payor Contact</span>
        <input value={billingPayorDisplay} readOnly className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-muted" />
      </label>
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
        <button type="submit" disabled={isSaving} className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white disabled:opacity-70">
          {isSaving ? "Saving..." : "Save Member Summary"}
        </button>
      </div>
      <MutationNotice kind={status?.startsWith("Error") ? "error" : "success"} message={status} className="md:col-span-3" />
    </form>
  );
}
