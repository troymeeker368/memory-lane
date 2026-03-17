"use client";

import { FormEvent, useEffect, useState } from "react";

import { saveMemberCommandCenterDietAction } from "@/app/(portal)/operations/member-command-center/summary-actions";
import { useScopedMutation } from "@/components/forms/use-scoped-mutation";
import { MhpMedicalDietFields } from "@/components/forms/mhp-medical-diet-fields";
import { MutationNotice } from "@/components/ui/mutation-notice";

export function MccDietForm({
  memberId,
  dietCardHref,
  dietTypeDefault,
  dietTypeOtherDefault,
  textureDefault,
  dietTypeOptions,
  dietTextureOptions,
  swallowingDifficulty,
  supplements,
  dietaryPreferencesRestrictions,
  foodDislikes,
  foodsToOmit,
  commandCenterNotes
}: {
  memberId: string;
  dietCardHref: string;
  dietTypeDefault: string;
  dietTypeOtherDefault: string;
  textureDefault: string;
  dietTypeOptions: readonly string[];
  dietTextureOptions: readonly string[];
  swallowingDifficulty: string;
  supplements: string;
  dietaryPreferencesRestrictions: string;
  foodDislikes: string;
  foodsToOmit: string;
  commandCenterNotes: string;
}) {
  const [status, setStatus] = useState("");
  const { isSaving, run } = useScopedMutation();

  useEffect(() => {
    setStatus("");
  }, [memberId]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("");
    const payload = new FormData(event.currentTarget);
    void run(() => saveMemberCommandCenterDietAction(payload), {
      successMessage: "Diet / allergies saved.",
      errorMessage: "Unable to save diet/allergies.",
      onSuccess: () => {
        setStatus("Diet / allergies saved.");
      },
      onError: (result) => {
        setStatus(`Error: ${result.error}`);
      }
    });
  };

  return (
    <form onSubmit={onSubmit} className="mt-3 grid gap-3 md:grid-cols-2">
      <input type="hidden" name="memberId" value={memberId} />
      <MhpMedicalDietFields
        dietTypeDefault={dietTypeDefault}
        dietTypeOtherDefault={dietTypeOtherDefault}
        textureDefault={textureDefault}
        dietTypeOptions={dietTypeOptions}
        dietTextureOptions={dietTextureOptions}
      />
      <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Difficulty Swallowing</span><input name="swallowingDifficulty" defaultValue={swallowingDifficulty} className="h-10 w-full rounded-lg border border-border px-3" /></label>
      <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Supplements</span><input name="supplements" defaultValue={supplements} className="h-10 w-full rounded-lg border border-border px-3" /></label>
      <label className="space-y-1 text-sm md:col-span-2"><span className="text-xs font-semibold text-muted">Dietary Preferences / Restrictions</span><textarea name="dietaryPreferencesRestrictions" defaultValue={dietaryPreferencesRestrictions} className="min-h-20 w-full rounded-lg border border-border p-3 text-sm" /></label>
      <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Food Dislikes</span><input name="foodDislikes" defaultValue={foodDislikes} className="h-10 w-full rounded-lg border border-border px-3" /></label>
      <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Foods to Omit</span><input name="foodsToOmit" defaultValue={foodsToOmit} className="h-10 w-full rounded-lg border border-border px-3" /></label>
      <label className="space-y-1 text-sm md:col-span-2"><span className="text-xs font-semibold text-muted">Notes</span><textarea name="commandCenterNotes" defaultValue={commandCenterNotes} className="min-h-20 w-full rounded-lg border border-border p-3 text-sm" /></label>
      <div className="md:col-span-2 flex flex-wrap items-center gap-2">
        <button type="submit" disabled={isSaving} className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white disabled:opacity-70">
          {isSaving ? "Saving..." : "Save Diet / Allergies"}
        </button>
        <a
          href={dietCardHref}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg border border-border px-3 py-2 text-sm font-semibold"
        >
          Print Diet Card
        </a>
      </div>
      <MutationNotice kind={status?.startsWith("Error") ? "error" : "success"} message={status} className="md:col-span-2" />
    </form>
  );
}
