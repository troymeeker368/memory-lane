"use client";

import { useMemo, useState } from "react";

export function MhpMedicalDietFields({
  dietTypeDefault,
  dietTypeOtherDefault,
  textureDefault,
  dietTypeOptions,
  dietTextureOptions
}: {
  dietTypeDefault: string;
  dietTypeOtherDefault: string;
  textureDefault: string;
  dietTypeOptions: readonly string[];
  dietTextureOptions: readonly string[];
}) {
  const initialDiet = useMemo(() => dietTypeDefault || "Regular", [dietTypeDefault]);
  const [dietType, setDietType] = useState(initialDiet);

  return (
    <>
      <label className="space-y-1 text-sm">
        <span className="text-xs font-semibold text-muted">Diet Type</span>
        <select
          name="dietType"
          value={dietType}
          onChange={(event) => setDietType(event.target.value)}
          className="h-10 w-full rounded-lg border border-border px-3"
        >
          {dietTypeOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>

      {dietType === "Other" ? (
        <label className="space-y-1 text-sm">
          <span className="text-xs font-semibold text-muted">Diet Type - Custom</span>
          <input
            name="dietTypeOther"
            defaultValue={dietTypeOtherDefault}
            className="h-10 w-full rounded-lg border border-border px-3"
            required
          />
        </label>
      ) : (
        <input type="hidden" name="dietTypeOther" value="" />
      )}

      <label className="space-y-1 text-sm">
        <span className="text-xs font-semibold text-muted">Texture</span>
        <select name="dietTexture" defaultValue={textureDefault || "Regular"} className="h-10 w-full rounded-lg border border-border px-3">
          {dietTextureOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
