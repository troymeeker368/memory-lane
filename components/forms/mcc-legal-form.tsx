"use client";

import { FormEvent, useEffect } from "react";

import { saveMemberCommandCenterLegalAction } from "@/app/(portal)/operations/member-command-center/summary-actions";
import { useScopedMutation } from "@/components/forms/use-scoped-mutation";
import { usePropSyncedState, usePropSyncedStatus } from "@/components/forms/use-prop-synced-state";
import { MutationNotice } from "@/components/ui/mutation-notice";
import { emitClientMutationEvent } from "@/lib/mutations/client-events";

function boolToSelectValue(value: boolean | null | undefined) {
  if (value == null) return "";
  return value ? "true" : "false";
}

export function MccLegalForm({
  memberId,
  codeStatus,
  dnr,
  dni,
  polstMolstColst,
  hospice,
  advancedDirectivesObtained,
  powerOfAttorney,
  legalComments
}: {
  memberId: string;
  codeStatus: string;
  dnr: boolean | null | undefined;
  dni: boolean | null | undefined;
  polstMolstColst: string;
  hospice: boolean | null | undefined;
  advancedDirectivesObtained: boolean | null | undefined;
  powerOfAttorney: string;
  legalComments: string;
}) {
  const [codeStatusValue, setCodeStatusValue] = usePropSyncedState(codeStatus, [memberId, codeStatus, dnr]);
  const [dnrValue, setDnrValue] = usePropSyncedState(boolToSelectValue(dnr), [memberId, codeStatus, dnr]);
  const [status, setStatus] = usePropSyncedStatus([memberId, codeStatus, dnr]);
  const { isSaving, run } = useScopedMutation();

  useEffect(() => {
    emitClientMutationEvent("mcc:header-update", {
      codeStatus: codeStatusValue
    });
  }, [codeStatusValue]);

  const handleCodeStatusChange = (next: string) => {
    setCodeStatusValue(next);
    if (next === "DNR") setDnrValue("true");
    if (next === "Full Code") setDnrValue("false");
  };

  const handleDnrChange = (next: string) => {
    setDnrValue(next);
    if (next === "true") setCodeStatusValue("DNR");
    if (next === "false") setCodeStatusValue("Full Code");
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("");
    const payload = new FormData(event.currentTarget);
    void run(() => saveMemberCommandCenterLegalAction(payload), {
      successMessage: "Legal information saved.",
      errorMessage: "Unable to save legal information.",
      onSuccess: () => {
        setStatus("Legal information saved.");
      },
      onError: (result) => {
        setStatus(`Error: ${result.error}`);
      }
    });
  };

  return (
    <form onSubmit={onSubmit} className="mt-3 grid gap-2 md:grid-cols-3">
      <input type="hidden" name="memberId" value={memberId} />
      <label className="space-y-1 text-sm">
        <span className="text-xs font-semibold text-muted">Code Status</span>
        <select
          name="codeStatus"
          value={codeStatusValue}
          onChange={(event) => handleCodeStatusChange(event.target.value)}
          className="h-10 w-full rounded-lg border border-border px-3"
        >
          <option value="">-</option>
          <option value="Full Code">Full Code</option>
          <option value="DNR">DNR</option>
        </select>
      </label>
      <label className="space-y-1 text-sm">
        <span className="text-xs font-semibold text-muted">DNR</span>
        <select
          name="dnr"
          value={dnrValue}
          onChange={(event) => handleDnrChange(event.target.value)}
          className="h-10 w-full rounded-lg border border-border px-3"
        >
          <option value="">-</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      </label>
      <label className="space-y-1 text-sm">
        <span className="text-xs font-semibold text-muted">DNI</span>
        <select name="dni" defaultValue={boolToSelectValue(dni)} className="h-10 w-full rounded-lg border border-border px-3">
          <option value="">-</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      </label>
      <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">POLST / MOLST / COLST</span><input name="polstMolstColst" defaultValue={polstMolstColst} className="h-10 w-full rounded-lg border border-border px-3" /></label>
      <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Hospice</span><select name="hospice" defaultValue={boolToSelectValue(hospice)} className="h-10 w-full rounded-lg border border-border px-3"><option value="">-</option><option value="true">Yes</option><option value="false">No</option></select></label>
      <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Advanced Directives Obtained</span><select name="advancedDirectivesObtained" defaultValue={boolToSelectValue(advancedDirectivesObtained)} className="h-10 w-full rounded-lg border border-border px-3"><option value="">-</option><option value="true">Yes</option><option value="false">No</option></select></label>
      <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Power of Attorney</span><input name="powerOfAttorney" defaultValue={powerOfAttorney} className="h-10 w-full rounded-lg border border-border px-3" /></label>
      <label className="space-y-1 text-sm md:col-span-3"><span className="text-xs font-semibold text-muted">Comments</span><textarea name="legalComments" defaultValue={legalComments} className="min-h-20 w-full rounded-lg border border-border p-3 text-sm" /></label>
      <div className="md:col-span-3">
        <button type="submit" disabled={isSaving} className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white disabled:opacity-70">
          {isSaving ? "Saving..." : "Save Legal Information"}
        </button>
      </div>
      <MutationNotice kind={status?.startsWith("Error") ? "error" : "success"} message={status} className="md:col-span-3" />
    </form>
  );
}
