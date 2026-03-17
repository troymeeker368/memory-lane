"use client";

import { FormEvent } from "react";

import { saveMemberCommandCenterDemographicsAction } from "@/app/(portal)/operations/member-command-center/summary-actions";
import { SegmentedChoiceGroup } from "@/components/forms/segmented-choice-group";
import { useScopedMutation } from "@/components/forms/use-scoped-mutation";
import { usePropSyncedState, usePropSyncedStatus } from "@/components/forms/use-prop-synced-state";
import { MutationNotice } from "@/components/ui/mutation-notice";
import {
  MEMBER_STATE_OPTIONS,
  MEMBER_ETHNICITY_OPTIONS,
  MEMBER_MARITAL_STATUS_OPTIONS,
  VETERAN_BRANCH_OPTIONS
} from "@/lib/canonical";

export function MccDemographicsForm({
  memberId,
  memberDisplayName,
  memberDob,
  gender,
  streetAddress,
  city,
  state,
  zip,
  maritalStatus,
  primaryLanguage,
  secondaryLanguage,
  religion,
  ethnicity,
  isVeteran,
  veteranBranch
}: {
  memberId: string;
  memberDisplayName: string;
  memberDob: string;
  gender: string;
  streetAddress: string;
  city: string;
  state: string;
  zip: string;
  maritalStatus: string;
  primaryLanguage: string;
  secondaryLanguage: string;
  religion: string;
  ethnicity: string;
  isVeteran: boolean | null;
  veteranBranch: string;
}) {
  const [veteranValue, setVeteranValue] = usePropSyncedState(
    isVeteran == null ? "" : isVeteran ? "true" : "false",
    [memberId, isVeteran]
  );
  const [status, setStatus] = usePropSyncedStatus([memberId, isVeteran]);
  const { isSaving, run } = useScopedMutation();

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("");
    const payload = new FormData(event.currentTarget);
    void run(() => saveMemberCommandCenterDemographicsAction(payload), {
      successMessage: "Demographics saved.",
      errorMessage: "Unable to save demographics.",
      onSuccess: () => {
        setStatus("Demographics saved.");
      },
      onError: (result) => {
        setStatus(`Error: ${result.error}`);
      }
    });
  };

  return (
    <form onSubmit={onSubmit} className="mt-3 grid gap-2 md:grid-cols-3">
      <input type="hidden" name="memberId" value={memberId} />
      <label className="space-y-1 text-sm md:col-span-2">
        <span className="text-xs font-semibold text-muted">Member Name</span>
        <input name="memberDisplayName" defaultValue={memberDisplayName} required className="h-10 w-full rounded-lg border border-border px-3" />
      </label>
      <label className="space-y-1 text-sm">
        <span className="text-xs font-semibold text-muted">DOB</span>
        <input name="memberDob" type="date" defaultValue={memberDob} className="h-10 w-full rounded-lg border border-border px-3" />
      </label>
      <SegmentedChoiceGroup
        label="Gender"
        name="gender"
        defaultValue={gender}
        options={[
          { label: "M", value: "M" },
          { label: "F", value: "F" }
        ]}
        selectedClassByValue={{
          M: "border-blue-500 bg-blue-100 text-blue-700",
          F: "border-pink-500 bg-pink-100 text-pink-700"
        }}
      />
      <label className="space-y-1 text-sm md:col-span-3"><span className="text-xs font-semibold text-muted">Street Address</span><input name="streetAddress" defaultValue={streetAddress} className="h-10 w-full rounded-lg border border-border px-3" /></label>
      <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">City</span><input name="city" defaultValue={city} className="h-10 w-full rounded-lg border border-border px-3" /></label>
      <label className="space-y-1 text-sm">
        <span className="text-xs font-semibold text-muted">State</span>
        <select name="state" defaultValue={state || "SC"} className="h-10 w-full rounded-lg border border-border px-3">
          {MEMBER_STATE_OPTIONS.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      </label>
      <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">ZIP</span><input name="zip" defaultValue={zip} className="h-10 w-full rounded-lg border border-border px-3" /></label>
      <label className="space-y-1 text-sm">
        <span className="text-xs font-semibold text-muted">Marital Status</span>
        <select name="maritalStatus" defaultValue={maritalStatus} className="h-10 w-full rounded-lg border border-border px-3">
          <option value="">-</option>
          {MEMBER_MARITAL_STATUS_OPTIONS.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      </label>
      <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Primary Language</span><input name="primaryLanguage" defaultValue={primaryLanguage || "English"} className="h-10 w-full rounded-lg border border-border px-3" /></label>
      <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Secondary Language</span><input name="secondaryLanguage" defaultValue={secondaryLanguage} className="h-10 w-full rounded-lg border border-border px-3" /></label>
      <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Religion</span><input name="religion" defaultValue={religion} className="h-10 w-full rounded-lg border border-border px-3" /></label>
      <label className="space-y-1 text-sm">
        <span className="text-xs font-semibold text-muted">Ethnicity</span>
        <select name="ethnicity" defaultValue={ethnicity} className="h-10 w-full rounded-lg border border-border px-3">
          <option value="">-</option>
          {MEMBER_ETHNICITY_OPTIONS.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      </label>
      <label className="space-y-1 text-sm">
        <span className="text-xs font-semibold text-muted">Veteran</span>
        <select
          name="isVeteran"
          value={veteranValue}
          onChange={(event) => setVeteranValue(event.target.value)}
          className="h-10 w-full rounded-lg border border-border px-3"
        >
          <option value="">-</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      </label>
      {veteranValue === "true" ? (
        <label className="space-y-1 text-sm">
          <span className="text-xs font-semibold text-muted">Branch</span>
          <select
            name="veteranBranch"
            defaultValue={veteranBranch}
            required
            className="h-10 w-full rounded-lg border border-border px-3"
          >
            <option value="">Select branch</option>
            {VETERAN_BRANCH_OPTIONS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
      ) : (
        <input type="hidden" name="veteranBranch" value="" />
      )}
      <div className="md:col-span-3">
        <button type="submit" disabled={isSaving} className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white disabled:opacity-70">
          {isSaving ? "Saving..." : "Save Demographics"}
        </button>
      </div>
      <MutationNotice kind={status?.startsWith("Error") ? "error" : "success"} message={status} className="md:col-span-3" />
    </form>
  );
}
