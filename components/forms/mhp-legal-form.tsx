"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { saveMhpLegalAction } from "@/app/(portal)/health/member-health-profiles/profile-actions";
import { usePropSyncedState } from "@/components/forms/use-prop-synced-state";

function boolToSelectValue(value: boolean | null | undefined) {
  if (value == null) return "";
  return value ? "true" : "false";
}

function BoolSelect({
  name,
  value,
  onChange
}: {
  name: string;
  value?: string;
  onChange?: (next: string) => void;
}) {
  if (onChange) {
    return (
      <select
        name={name}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 rounded-lg border border-border px-3"
      >
        <option value="">Not recorded</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  }

  return (
    <select name={name} defaultValue={value ?? ""} className="h-10 rounded-lg border border-border px-3">
      <option value="">Not recorded</option>
      <option value="true">Yes</option>
      <option value="false">No</option>
    </select>
  );
}

function Field({
  label,
  name,
  defaultValue
}: {
  label: string;
  name: string;
  defaultValue?: string;
}) {
  return (
    <label className="space-y-1 text-sm">
      <span className="text-xs font-semibold text-muted">{label}</span>
      <input name={name} defaultValue={defaultValue ?? ""} className="h-10 w-full rounded-lg border border-border px-3" />
    </label>
  );
}

function Area({
  label,
  name,
  defaultValue
}: {
  label: string;
  name: string;
  defaultValue?: string;
}) {
  return (
    <label className="space-y-1 text-sm md:col-span-2">
      <span className="text-xs font-semibold text-muted">{label}</span>
      <textarea name={name} defaultValue={defaultValue ?? ""} className="min-h-20 w-full rounded-lg border border-border p-3 text-sm" />
    </label>
  );
}

function HospitalPreferenceTypeahead({
  value,
  onChange,
  onSelect,
  options
}: {
  value: string;
  onChange: (next: string) => void;
  onSelect: (next: string) => void;
  options: string[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const filteredOptions = useMemo(() => {
    const query = value.trim().toLowerCase();
    if (query.length < 2) return [];

    const startsWith = options.filter((option) => option.toLowerCase().startsWith(query));
    const includes = options.filter(
      (option) => option.toLowerCase().includes(query) && !option.toLowerCase().startsWith(query)
    );
    return [...startsWith, ...includes].slice(0, 8);
  }, [options, value]);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (!containerRef.current) return;
      if (containerRef.current.contains(event.target as Node)) return;
      setIsOpen(false);
    };

    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <input
        name="hospitalPreference"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        onBlur={() =>
          window.setTimeout(() => {
            setIsOpen(false);
          }, 120)
        }
        placeholder="Hospital preference"
        className="h-10 w-full rounded-lg border border-border px-3"
      />
      {isOpen && filteredOptions.length > 0 ? (
        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-border bg-white shadow-lg">
          {filteredOptions.map((option) => (
            <button
              key={option}
              type="button"
              className="block w-full px-3 py-2 text-left text-sm text-primary-text hover:bg-brandSoft"
              onMouseDown={(event) => {
                event.preventDefault();
                onSelect(option);
                setIsOpen(false);
              }}
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function MhpLegalForm({
  memberId,
  codeStatus,
  dnr,
  dni,
  polst,
  hospice,
  advancedDirectivesObtained,
  powerOfAttorney,
  hospitalPreferenceDirectory,
  hospitalPreference,
  legalComments
}: {
  memberId: string;
  codeStatus: string | null | undefined;
  dnr: boolean | null | undefined;
  dni: boolean | null | undefined;
  polst: string | null | undefined;
  hospice: boolean | null | undefined;
  advancedDirectivesObtained: boolean | null | undefined;
  powerOfAttorney: string | null | undefined;
  hospitalPreferenceDirectory: Array<{ id: string; hospital_name: string; updated_at: string }>;
  hospitalPreference: string | null | undefined;
  legalComments: string | null | undefined;
}) {
  const syncDeps = [memberId, codeStatus, dnr, hospitalPreference];
  const [codeStatusValue, setCodeStatusValue] = usePropSyncedState(codeStatus ?? "", syncDeps);
  const [dnrValue, setDnrValue] = usePropSyncedState(boolToSelectValue(dnr), syncDeps);
  const [hospitalPreferenceValue, setHospitalPreferenceValue] = usePropSyncedState(hospitalPreference ?? "", syncDeps);

  const hospitalOptions = useMemo(
    () =>
      Array.from(
        new Set(
          hospitalPreferenceDirectory
            .map((entry) => entry.hospital_name.trim())
            .filter((name) => name.length > 0)
        )
      ).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" })),
    [hospitalPreferenceDirectory]
  );

  const handleCodeStatusChange = (next: string) => {
    setCodeStatusValue(next);
    if (next === "DNR") {
      setDnrValue("true");
    } else if (next === "Full Code") {
      setDnrValue("false");
    }
  };

  const handleDnrChange = (next: string) => {
    setDnrValue(next);
    if (next === "true") {
      setCodeStatusValue("DNR");
    } else if (next === "false") {
      setCodeStatusValue("Full Code");
    }
  };

  return (
    <form action={saveMhpLegalAction} className="mt-3 grid gap-3 md:grid-cols-2">
      <input type="hidden" name="memberId" value={memberId} />

      <label className="space-y-1 text-sm">
        <span className="text-xs font-semibold text-muted">Code Status</span>
        <select
          name="codeStatus"
          value={codeStatusValue}
          onChange={(event) => handleCodeStatusChange(event.target.value)}
          className="h-10 rounded-lg border border-border px-3"
        >
          <option value="">Select</option>
          <option value="Full Code">Full Code</option>
          <option value="DNR">DNR</option>
        </select>
      </label>

      <label className="space-y-1 text-sm">
        <span className="text-xs font-semibold text-muted">DNR</span>
        <BoolSelect name="dnr" value={dnrValue} onChange={handleDnrChange} />
      </label>

      <label className="space-y-1 text-sm">
        <span className="text-xs font-semibold text-muted">DNI</span>
        <BoolSelect name="dni" value={boolToSelectValue(dni)} />
      </label>

      <Field label="POLST / MOLST / COLST" name="polst" defaultValue={polst ?? ""} />

      <label className="space-y-1 text-sm">
        <span className="text-xs font-semibold text-muted">Hospice</span>
        <BoolSelect name="hospice" value={boolToSelectValue(hospice)} />
      </label>

      <label className="space-y-1 text-sm">
        <span className="text-xs font-semibold text-muted">Advanced Directives Obtained</span>
        <BoolSelect name="advancedDirectivesObtained" value={boolToSelectValue(advancedDirectivesObtained)} />
      </label>

      <Field label="Power of Attorney" name="powerOfAttorney" defaultValue={powerOfAttorney ?? ""} />
      <label className="space-y-1 text-sm">
        <span className="text-xs font-semibold text-muted">Hospital Preference</span>
        <HospitalPreferenceTypeahead
          value={hospitalPreferenceValue}
          onChange={setHospitalPreferenceValue}
          onSelect={setHospitalPreferenceValue}
          options={hospitalOptions}
        />
      </label>
      <Area label="Comments" name="legalComments" defaultValue={legalComments ?? ""} />

      <div className="md:col-span-2">
        <button type="submit" className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white">
          Save Legal
        </button>
      </div>
    </form>
  );
}
