"use client";

import { type ChangeEvent } from "react";

import { saveMhpOverviewAction } from "@/app/(portal)/health/member-health-profiles/actions";
import { SegmentedChoiceGroup } from "@/components/forms/segmented-choice-group";
import { usePropSyncedState } from "@/components/forms/use-prop-synced-state";
import { formatPhoneInput } from "@/lib/phone";

function Field({
  label,
  name,
  value,
  defaultValue,
  onChange,
  type = "text",
  disabled = false
}: {
  label: string;
  name: string;
  value?: string;
  defaultValue?: string;
  onChange?: (next: string) => void;
  type?: "text" | "date";
  disabled?: boolean;
}) {
  const inputValueProps =
    typeof value === "string"
      ? {
          value,
          onChange: onChange ? (event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value) : undefined
        }
      : {
          defaultValue
        };

  return (
    <label className="space-y-1 text-sm">
      <span className="text-xs font-semibold text-muted">{label}</span>
      <input
        name={name}
        type={type}
        {...inputValueProps}
        disabled={disabled}
        className="h-10 w-full rounded-lg border border-border px-3 disabled:bg-slate-50 disabled:text-muted"
      />
    </label>
  );
}

function TextAreaField({
  label,
  name,
  defaultValue
}: {
  label: string;
  name: string;
  defaultValue: string;
}) {
  return (
    <label className="space-y-1 text-sm md:col-span-2">
      <span className="text-xs font-semibold text-muted">{label}</span>
      <textarea
        name={name}
        defaultValue={defaultValue}
        className="min-h-20 w-full rounded-lg border border-border p-3 text-sm"
      />
    </label>
  );
}

export function MhpOverviewForm(props: {
  memberId: string;
  memberDob: string;
  genderDefault: string;
  payor: string;
  originalReferralSource: string;
  photoConsent: boolean | null;
  primaryCaregiverName: string;
  primaryCaregiverPhone: string;
  responsiblePartyName: string;
  responsiblePartyPhone: string;
  importantAlerts: string;
}) {
  const syncDeps = [
    props.memberId,
    props.primaryCaregiverName,
    props.primaryCaregiverPhone,
    props.responsiblePartyName,
    props.responsiblePartyPhone
  ];
  const [primaryCaregiverName, setPrimaryCaregiverName] = usePropSyncedState(props.primaryCaregiverName, syncDeps);
  const [primaryCaregiverPhone, setPrimaryCaregiverPhone] = usePropSyncedState(formatPhoneInput(props.primaryCaregiverPhone), syncDeps);
  const [responsiblePartyName, setResponsiblePartyName] = usePropSyncedState(props.responsiblePartyName, syncDeps);
  const [responsiblePartyPhone, setResponsiblePartyPhone] = usePropSyncedState(formatPhoneInput(props.responsiblePartyPhone), syncDeps);
  const [sameAsPrimary, setSameAsPrimary] = usePropSyncedState(false, syncDeps);

  const handlePrimaryNameChange = (next: string) => {
    setPrimaryCaregiverName(next);
    if (sameAsPrimary) setResponsiblePartyName(next);
  };

  const handlePrimaryPhoneChange = (next: string) => {
    const formatted = formatPhoneInput(next);
    setPrimaryCaregiverPhone(formatted);
    if (sameAsPrimary) setResponsiblePartyPhone(formatted);
  };

  const handleSameAsPrimaryChange = (checked: boolean) => {
    setSameAsPrimary(checked);
    if (checked) {
      setResponsiblePartyName(primaryCaregiverName);
      setResponsiblePartyPhone(primaryCaregiverPhone);
    }
  };

  const photoConsentValue =
    props.photoConsent == null ? "" : props.photoConsent ? "true" : "false";

  return (
    <form action={saveMhpOverviewAction} className="mt-3 grid gap-3 md:grid-cols-2">
      <input type="hidden" name="memberId" value={props.memberId} />

      <SegmentedChoiceGroup
        label="Gender"
        name="gender"
        defaultValue={props.genderDefault}
        options={[
          { label: "M", value: "M" },
          { label: "F", value: "F" }
        ]}
        selectedClassByValue={{
          M: "border-blue-500 bg-blue-100 text-blue-700",
          F: "border-pink-500 bg-pink-100 text-pink-700"
        }}
      />

      <Field label="DOB" name="memberDob" type="date" defaultValue={props.memberDob} />
      <Field
        label="Primary Caregiver Name"
        name="primaryCaregiverName"
        value={primaryCaregiverName}
        onChange={handlePrimaryNameChange}
      />
      <Field
        label="Primary Caregiver Phone"
        name="primaryCaregiverPhone"
        value={primaryCaregiverPhone}
        onChange={handlePrimaryPhoneChange}
      />

      <Field
        label="Responsible Party Name"
        name="responsiblePartyName"
        value={responsiblePartyName}
        onChange={setResponsiblePartyName}
        disabled={sameAsPrimary}
      />
      <Field
        label="Responsible Party Phone"
        name="responsiblePartyPhone"
        value={responsiblePartyPhone}
        onChange={(next) => setResponsiblePartyPhone(formatPhoneInput(next))}
        disabled={sameAsPrimary}
      />

      <label className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm md:col-span-2">
        <input
          type="checkbox"
          name="sameAsPrimary"
          value="true"
          checked={sameAsPrimary}
          onChange={(event) => handleSameAsPrimaryChange(event.target.checked)}
        />
        Same as Primary Caregiver (auto-fills Responsible Party fields in real time)
      </label>

      <Field
        label="Original Referral Source"
        name="originalReferralSource"
        defaultValue={props.originalReferralSource}
      />

      <label className="space-y-1 text-sm">
        <span className="text-xs font-semibold text-muted">Photo Consent</span>
        <select name="photoConsent" defaultValue={photoConsentValue} className="h-10 rounded-lg border border-border px-3">
          <option value="">Not recorded</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      </label>
      <Field label="Payor" name="payor" defaultValue={props.payor} />

      <TextAreaField label="Important Alerts" name="importantAlerts" defaultValue={props.importantAlerts} />

      <div className="md:col-span-2">
        <button type="submit" className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white">
          Save Overview
        </button>
      </div>
    </form>
  );
}
