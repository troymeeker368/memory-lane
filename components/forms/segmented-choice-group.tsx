"use client";

import { useMemo, useState } from "react";

type SegmentedChoiceOption = {
  label: string;
  value: string;
};

export function SegmentedChoiceGroup({
  label,
  name,
  defaultValue,
  options,
  selectedClassByValue
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
  options: readonly SegmentedChoiceOption[];
  selectedClassByValue?: Record<string, string>;
}) {
  const initialValue = useMemo(() => defaultValue ?? "", [defaultValue]);
  const [value, setValue] = useState(initialValue);

  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-semibold text-muted">{label}</legend>
      <input type="hidden" name={name} value={value} />
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {options.map((option) => {
          const isSelected = value === option.value;
          const selectedClass = selectedClassByValue?.[option.value] ?? "border-[#1B3E93] bg-[#1B3E93] text-white";
          return (
            <button
              key={`${name}-${option.value}`}
              type="button"
              onClick={() => setValue(option.value)}
              className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                isSelected ? selectedClass : "border-border text-primary-text"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
