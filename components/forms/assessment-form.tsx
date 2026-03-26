"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createAssessmentAction } from "@/app/intake-actions";
import { EsignaturePad } from "@/components/signature/esignature-pad";
import { Button } from "@/components/ui/button";
import { toEasternDate } from "@/lib/timezone";
import { ASSESSMENT_SCORE_OPTIONS, calculateAssessmentTotal, getAssessmentTrack } from "@/lib/assessment";
import {
  SHARED_ASSISTIVE_DEVICE_OPTIONS,
  SHARED_DIET_OPTIONS,
  SHARED_MEDICATION_ASSIST_OPTIONS,
  SHARED_TRANSFER_ASSIST_OPTIONS
} from "@/lib/services/intake-pof-shared";
import type { CanonicalPersonRef } from "@/types/identity";

type AssessmentMemberOption = CanonicalPersonRef;

function useToday() {
  return useMemo(() => toEasternDate(), []);
}

export function AssessmentForm({
  members,
  initialMemberId,
  initialStaffName
}: {
  members: AssessmentMemberOption[];
  initialMemberId?: string;
  initialStaffName?: string;
}) {
  const router = useRouter();
  const today = useToday();
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const selectableMembers = members.filter((member) => Boolean(member.memberId));
  const selectedInitialMember =
    (initialMemberId
      ? selectableMembers.find((member) => member.memberId === initialMemberId || member.leadId === initialMemberId)
      : null) ??
    selectableMembers[0] ??
    null;

  const CODE_STATUS_OPTIONS = ["Full Code", "DNR"] as const;
  const MEDICATION_MANAGEMENT_OPTIONS = SHARED_MEDICATION_ASSIST_OPTIONS;
  const DRESSING_SUPPORT_OPTIONS = ["Independent", "Setup only", "Needs partial assistance", "Needs full assistance"] as const;
  const ASSISTIVE_DEVICE_OPTIONS = SHARED_ASSISTIVE_DEVICE_OPTIONS;
  const INCONTINENCE_PRODUCT_OPTIONS = ["Briefs", "Pads", "None", "Other"] as const;
  const DIET_OPTIONS = SHARED_DIET_OPTIONS;
  const MOBILITY_AID_OPTIONS = ["Walker", "Cane", "Wheelchair", "None", "Other"] as const;
  const TRANSPORT_ENTER_EXIT_OPTIONS = ["Independent", "Standby Assist", "1-Person Assist", "2-Person Assist", "Wheelchair Transfer"] as const;
  const TRANSPORT_ASSISTANCE_OPTIONS = SHARED_TRANSFER_ASSIST_OPTIONS;
  const TRANSPORT_AID_OPTIONS = ["Walker", "Cane", "Wheelchair", "Gait Belt", "None", "Other"] as const;
  const TRANSPORT_BEHAVIOR_OPTIONS = ["None", "Unbuckles seatbelt", "Exit-seeking", "Agitation", "Verbal aggression", "Other"] as const;

  const [form, setForm] = useState({
    sourceType: selectedInitialMember?.sourceType ?? "member",
    selectedRefId: selectedInitialMember?.memberId ?? selectedInitialMember?.leadId ?? "",
    memberId: selectedInitialMember?.memberId ?? "",
    leadId: selectedInitialMember?.leadId ?? "",
    leadStage: selectedInitialMember?.leadStage ?? "",
    leadStatus: selectedInitialMember?.leadStatus ?? "",
    assessmentDate: today,
    completedBy: initialStaffName ?? "",
    signatureAttested: false,
    signatureImageDataUrl: "",
    complete: true,

    feelingToday: "",
    healthLately: "",
    allergyType: "NKA" as "NKA" | "Other",
    allergyOther: "",
    codeStatus: "Full Code" as (typeof CODE_STATUS_OPTIONS)[number],
    orientationDobVerified: false,
    orientationCityVerified: false,
    orientationYearVerified: false,
    orientationOccupationVerified: false,
    orientationNotes: "",

    medicationManagementStatus: "",
    dressingSupportStatus: "",
    assistiveDevicesSelected: [] as string[],
    assistiveDevicesOther: "",
    incontinenceProductsSelected: [] as string[],
    incontinenceProductsOther: "",
    onSiteMedicationUse: false,
    onSiteMedicationList: "",
    independenceNotes: "",

    dietTypesSelected: ["Regular"] as string[],
    dietOther: "",
    dietRestrictionsNotes: "",

    mobilitySteadiness: "",
    fallsHistory: "",
    mobilityAidsSelected: [] as string[],
    mobilityAidsOther: "",
    mobilitySafetyNotes: "",

    overwhelmedByNoise: false,
    socialTriggers: "",
    emotionalWellnessNotes: "",

    joySparks: "",
    personalNotes: "",

    scoreOrientationGeneralHealth: 10 as 15 | 10 | 5,
    scoreDailyRoutinesIndependence: 10 as 15 | 10 | 5,
    scoreNutritionDietaryNeeds: 10 as 15 | 10 | 5,
    scoreMobilitySafety: 10 as 15 | 10 | 5,
    scoreSocialEmotionalWellness: 10 as 15 | 10 | 5,

    transportCanEnterExitVehicle: "",
    transportAssistanceLevel: "",
    transportMobilityAidSelected: [] as string[],
    transportMobilityAidOther: "",
    transportCanRemainSeatedBuckled: true,
    transportBehaviorConcernSelected: ["None"] as string[],
    transportBehaviorConcernOther: "",
    transportAppropriate: true,
    transportNotes: "",
    vitalsHr: "",
    vitalsBp: "",
    vitalsO2Percent: "",
    vitalsRr: "",

    notes: ""
  });

  const toggleWithNone = (current: string[], option: string) => {
    if (option === "None") {
      return current.includes("None") ? [] : ["None"];
    }

    const base = current.filter((item) => item !== "None");
    return base.includes(option) ? base.filter((item) => item !== option) : [...base, option];
  };

  const toggleMulti = (current: string[], option: string) =>
    current.includes(option) ? current.filter((item) => item !== option) : [...current, option];

  const OVERLAPPING_DEVICE_OPTIONS = ["Walker", "Cane", "Wheelchair", "Gait Belt", "None"] as const;
  const overlappingOptionSet = new Set<string>(OVERLAPPING_DEVICE_OPTIONS);

  const syncOverlappingDeviceSelections = (current: typeof form) => {
    const selectedAcrossSections = [
      ...current.assistiveDevicesSelected,
      ...current.mobilityAidsSelected,
      ...current.transportMobilityAidSelected
    ].filter((value) => overlappingOptionSet.has(value));
    const concreteSelections = new Set<string>(
      selectedAcrossSections.filter((value) => value !== "None")
    );
    const hasConcreteSelection = concreteSelections.size > 0;
    const hasNoneOnlySelection = !hasConcreteSelection && selectedAcrossSections.includes("None");

    const projectSelection = (allowed: readonly string[], existing: string[]) => {
      const next = allowed.filter((value) => {
        if (value === "None") return hasNoneOnlySelection;
        return concreteSelections.has(value);
      });
      if (existing.includes("Other")) next.push("Other");
      return next;
    };

    const assistiveDevicesSelected = projectSelection(ASSISTIVE_DEVICE_OPTIONS, current.assistiveDevicesSelected);
    const mobilityAidsSelected = projectSelection(MOBILITY_AID_OPTIONS, current.mobilityAidsSelected);
    const transportMobilityAidSelected = projectSelection(TRANSPORT_AID_OPTIONS, current.transportMobilityAidSelected);

    return {
      ...current,
      assistiveDevicesSelected,
      mobilityAidsSelected,
      transportMobilityAidSelected,
      assistiveDevicesOther: assistiveDevicesSelected.includes("Other") ? current.assistiveDevicesOther : "",
      mobilityAidsOther: mobilityAidsSelected.includes("Other") ? current.mobilityAidsOther : "",
      transportMobilityAidOther: transportMobilityAidSelected.includes("Other") ? current.transportMobilityAidOther : ""
    };
  };

  const singleChoiceCheckboxGroup = (
    label: string,
    value: string,
    options: readonly string[],
    onChange: (next: string) => void
  ) => (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-muted">{label}</p>
      <div className="grid gap-2 md:grid-cols-2">
        {options.map((option) => (
          <label key={option} className="flex items-center gap-2 rounded border border-border px-3 py-2 text-sm">
            <input type="checkbox" checked={value === option} onChange={() => onChange(value === option ? "" : option)} />
            {option}
          </label>
        ))}
      </div>
    </div>
  );

  const multiChoiceCheckboxGroup = (
    label: string,
    selected: string[],
    options: readonly string[],
    onToggle: (option: string) => void
  ) => (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-muted">{label}</p>
      <div className="grid gap-2 md:grid-cols-2">
        {options.map((option) => (
          <label key={option} className="flex items-center gap-2 rounded border border-border px-3 py-2 text-sm">
            <input type="checkbox" checked={selected.includes(option)} onChange={() => onToggle(option)} />
            {option}
          </label>
        ))}
      </div>
    </div>
  );

  const textareaField = (label: string, key: keyof typeof form, placeholder?: string) => (
    <label className="space-y-1 text-sm">
      <span className="text-xs font-semibold text-muted">{label}</span>
      <textarea
        className="min-h-20 w-full rounded-lg border border-border p-3 text-sm"
        placeholder={placeholder ?? ""}
        value={String(form[key] ?? "")}
        onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
      />
    </label>
  );

  const scoreSelect = (label: string, value: 15 | 10 | 5, onChange: (next: 15 | 10 | 5) => void) => (
    <label className="space-y-1 text-sm">
      <span className="text-xs font-semibold text-muted">{label}</span>
      <select className="h-11 rounded-lg border border-border px-3" value={String(value)} onChange={(event) => onChange(Number(event.target.value) as 15 | 10 | 5)}>
        {ASSESSMENT_SCORE_OPTIONS.map((score) => (
          <option key={score} value={score}>{score}</option>
        ))}
      </select>
    </label>
  );

  const asCsv = (selected: string[], otherValue: string) => {
    const normalized = selected.filter((item) => item !== "Other");
    if (selected.includes("Other") && otherValue.trim()) {
      normalized.push(otherValue.trim());
    }
    return normalized.join(", ");
  };

  const allergiesValue = form.allergyType === "NKA" ? "NKA" : form.allergyOther.trim();
  const assistiveDevicesValue = asCsv(form.assistiveDevicesSelected, form.assistiveDevicesOther);
  const incontinenceProductsValue = asCsv(form.incontinenceProductsSelected, form.incontinenceProductsOther);
  const dietTypeValue = form.dietTypesSelected.filter((item) => item !== "Other").join(", ");
  const dietOtherValue = form.dietTypesSelected.includes("Other") ? form.dietOther.trim() : "";
  const mobilityAidsValue = asCsv(form.mobilityAidsSelected, form.mobilityAidsOther);
  const transportMobilityAidValue = asCsv(form.transportMobilityAidSelected, form.transportMobilityAidOther);
  const transportBehaviorConcernValue = asCsv(form.transportBehaviorConcernSelected, form.transportBehaviorConcernOther);
  const onSiteMedicationUseValue = form.onSiteMedicationUse ? "Yes" : "No";
  const onSiteMedicationListValue = form.onSiteMedicationUse ? form.onSiteMedicationList.trim() : "";
  const completedBy = initialStaffName?.trim() || form.completedBy.trim();

  const totalScore = useMemo(
    () =>
      calculateAssessmentTotal({
        orientationGeneralHealth: form.scoreOrientationGeneralHealth,
        dailyRoutinesIndependence: form.scoreDailyRoutinesIndependence,
        nutritionDietaryNeeds: form.scoreNutritionDietaryNeeds,
        mobilitySafety: form.scoreMobilitySafety,
        socialEmotionalWellness: form.scoreSocialEmotionalWellness
      }),
    [
      form.scoreOrientationGeneralHealth,
      form.scoreDailyRoutinesIndependence,
      form.scoreNutritionDietaryNeeds,
      form.scoreMobilitySafety,
      form.scoreSocialEmotionalWellness
    ]
  );

  const trackResult = useMemo(() => getAssessmentTrack(totalScore), [totalScore]);

  const hasAllergyValidationError = form.allergyType === "Other" && !form.allergyOther.trim();
  const hasAssistiveOtherError = form.assistiveDevicesSelected.includes("Other") && !form.assistiveDevicesOther.trim();
  const hasIncontinenceOtherError = form.incontinenceProductsSelected.includes("Other") && !form.incontinenceProductsOther.trim();
  const hasDietOtherError = form.dietTypesSelected.includes("Other") && !form.dietOther.trim();
  const hasMobilityOtherError = form.mobilityAidsSelected.includes("Other") && !form.mobilityAidsOther.trim();
  const hasTransportAidOtherError = form.transportMobilityAidSelected.includes("Other") && !form.transportMobilityAidOther.trim();
  const hasTransportBehaviorOtherError = form.transportBehaviorConcernSelected.includes("Other") && !form.transportBehaviorConcernOther.trim();
  const hasOnSiteMedicationListError = form.onSiteMedicationUse && !form.onSiteMedicationList.trim();
  const hasVitalsBpFormatError = Boolean(form.vitalsBp.trim()) && !/^\d{2,3}\s*\/\s*\d{2,3}$/.test(form.vitalsBp.trim());

  const getAssessmentValidationErrors = () => {
    const errors: string[] = [];
    if (!form.memberId) errors.push("Linked Supabase Member");
    if (!form.leadId) errors.push("Linked Lead (Tour/EIP)");
    if (!completedBy) errors.push("Completed By");
    if (!form.signatureAttested) errors.push("Nurse E-Sign Attestation");
    if (!form.signatureImageDataUrl) errors.push("Nurse E-Sign Capture");
    if (!form.assessmentDate.trim()) errors.push("Assessment Date");
    if (!form.feelingToday.trim()) errors.push("How member is feeling today");
    if (!form.healthLately.trim()) errors.push("Health lately");
    if (!allergiesValue) errors.push("Allergies");
    if (!form.codeStatus) errors.push("Code Status");
    if (!form.medicationManagementStatus) errors.push("Medication Management Support");
    if (!form.dressingSupportStatus) errors.push("Dressing Support");
    if (!dietTypeValue) errors.push("Diet Type / Restrictions");
    if (!form.mobilitySteadiness.trim()) errors.push("Steadiness / mobility");
    if (!form.transportCanEnterExitVehicle) errors.push("Can enter/exit vehicle");
    if (!form.transportAssistanceLevel) errors.push("Transport assistance level");
    if (!form.vitalsHr.trim()) errors.push("Vital Signs - HR");
    if (!form.vitalsBp.trim()) errors.push("Vital Signs - BP");
    if (!form.vitalsO2Percent.trim()) errors.push("Vital Signs - O2 %");
    if (!form.vitalsRr.trim()) errors.push("Vital Signs - RR");

    if (hasAllergyValidationError) errors.push("Allergy Details (required when Allergies = Other)");
    if (hasAssistiveOtherError) errors.push("Assistive Device Other (required when Assistive Devices includes Other)");
    if (hasIncontinenceOtherError) errors.push("Incontinence Product Other (required when Incontinence Products includes Other)");
    if (hasDietOtherError) errors.push("Diet Other (required when Diet includes Other)");
    if (hasMobilityOtherError) errors.push("Mobility Aid Other (required when Mobility Aids includes Other)");
    if (hasTransportAidOtherError) errors.push("Transport Mobility Aid Other (required when transport mobility aid includes Other)");
    if (hasTransportBehaviorOtherError) errors.push("Behavior Concern Other (required when behavior concerns includes Other)");
    if (hasOnSiteMedicationListError) errors.push("On-site Meds List (required when On-site medication use = Yes)");
    if (hasVitalsBpFormatError) errors.push("Vital Signs - BP must use format systolic/diastolic (e.g., 120/80)");

    return errors;
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <label className="space-y-1 text-sm">
          <span className="text-xs font-semibold text-muted">Lead / Prospect (Tour or EIP)</span>
          <select
            className="h-11 rounded-lg border border-border px-3"
            value={form.memberId}
            disabled={selectableMembers.length === 0}
            onChange={(event) => {
              const selected = selectableMembers.find((member) => member.memberId === event.target.value);
              setForm((current) => ({
                ...current,
                sourceType: selected?.sourceType ?? "member",
                selectedRefId: selected?.memberId ?? selected?.leadId ?? "",
                memberId: selected?.memberId ?? "",
                leadId: selected?.leadId ?? "",
                leadStage: selected?.leadStage ?? "",
                leadStatus: selected?.leadStatus ?? ""
              }));
            }}
          >
            {selectableMembers.length === 0 ? <option value="">No Supabase-linked members available</option> : null}
            {selectableMembers.map((member) => (
              <option key={`${member.memberId ?? "memberless"}-${member.leadId ?? "leadless"}`} value={member.memberId ?? ""}>
                {member.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-xs font-semibold text-muted">Assessment Date</span>
          <input type="date" className="h-11 rounded-lg border border-border px-3" value={form.assessmentDate} onChange={(event) => setForm((current) => ({ ...current, assessmentDate: event.target.value }))} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-xs font-semibold text-muted">Completed By</span>
          <input className="h-11 rounded-lg border border-border bg-slate-50 px-3" value={completedBy} readOnly />
        </label>
      </div>
      {selectableMembers.length === 0 ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          Intake Assessment can only be saved for members that exist in Supabase. Link or enroll this lead first.
        </div>
      ) : null}

      <div>
        <label className="flex w-fit items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
          <input type="checkbox" checked={form.complete} onChange={(event) => setForm((current) => ({ ...current, complete: event.target.checked }))} />
          Assessment Complete
        </label>
      </div>

      <div className="rounded-lg border border-border p-3">
        <p className="mb-2 text-sm font-semibold">Vital Signs</p>
        <div className="grid gap-3 md:grid-cols-4">
          <label className="space-y-1 text-sm">
            <span className="text-xs font-semibold text-muted">HR</span>
            <input
              type="number"
              min={1}
              max={250}
              className="h-11 rounded-lg border border-border px-3"
              value={form.vitalsHr}
              onChange={(event) => setForm((current) => ({ ...current, vitalsHr: event.target.value }))}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-xs font-semibold text-muted">BP</span>
            <input
              className="h-11 rounded-lg border border-border px-3"
              placeholder="120/80"
              value={form.vitalsBp}
              onChange={(event) => setForm((current) => ({ ...current, vitalsBp: event.target.value }))}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-xs font-semibold text-muted">O2 %</span>
            <input
              type="number"
              min={1}
              max={100}
              className="h-11 rounded-lg border border-border px-3"
              value={form.vitalsO2Percent}
              onChange={(event) => setForm((current) => ({ ...current, vitalsO2Percent: event.target.value }))}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-xs font-semibold text-muted">RR</span>
            <input
              type="number"
              min={1}
              max={80}
              className="h-11 rounded-lg border border-border px-3"
              value={form.vitalsRr}
              onChange={(event) => setForm((current) => ({ ...current, vitalsRr: event.target.value }))}
            />
          </label>
        </div>
      </div>

      <div className="rounded-lg border border-border p-3">
        <p className="mb-2 text-sm font-semibold">Orientation & General Health</p>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">How member is feeling today</span><input className="h-11 rounded-lg border border-border px-3" value={form.feelingToday} onChange={(event) => setForm((current) => ({ ...current, feelingToday: event.target.value }))} /></label>
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Health lately</span><input className="h-11 rounded-lg border border-border px-3" value={form.healthLately} onChange={(event) => setForm((current) => ({ ...current, healthLately: event.target.value }))} /></label>

          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted">Allergies</p>
            <div className="flex flex-wrap gap-2">
              <label className="flex items-center gap-2 rounded border border-border px-3 py-2 text-sm"><input type="checkbox" checked={form.allergyType === "NKA"} onChange={() => setForm((current) => ({ ...current, allergyType: current.allergyType === "NKA" ? "Other" : "NKA", allergyOther: current.allergyType === "NKA" ? current.allergyOther : "" }))} /> NKA</label>
              <label className="flex items-center gap-2 rounded border border-border px-3 py-2 text-sm"><input type="checkbox" checked={form.allergyType === "Other"} onChange={() => setForm((current) => ({ ...current, allergyType: current.allergyType === "Other" ? "NKA" : "Other" }))} /> Other</label>
            </div>
          </div>

          {form.allergyType === "Other" ? (
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold text-muted">Allergy Details</span>
              <input className="h-11 rounded-lg border border-border px-3" value={form.allergyOther} onChange={(event) => setForm((current) => ({ ...current, allergyOther: event.target.value }))} />
            </label>
          ) : null}

          <label className="space-y-1 text-sm">
            <span className="text-xs font-semibold text-muted">Code Status</span>
            <select
              className="h-11 rounded-lg border border-border px-3"
              value={form.codeStatus}
              onChange={(event) => setForm((current) => ({ ...current, codeStatus: event.target.value as (typeof CODE_STATUS_OPTIONS)[number] }))}
            >
              {CODE_STATUS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.orientationDobVerified} onChange={(event) => setForm((current) => ({ ...current, orientationDobVerified: event.target.checked }))} /> DOB oriented</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.orientationCityVerified} onChange={(event) => setForm((current) => ({ ...current, orientationCityVerified: event.target.checked }))} /> Town/City oriented</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.orientationYearVerified} onChange={(event) => setForm((current) => ({ ...current, orientationYearVerified: event.target.checked }))} /> Current year oriented</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.orientationOccupationVerified} onChange={(event) => setForm((current) => ({ ...current, orientationOccupationVerified: event.target.checked }))} /> Former occupation oriented</label>
        </div>
        <div className="mt-3">{textareaField("Orientation Notes", "orientationNotes")}</div>
      </div>

      <div className="rounded-lg border border-border p-3">
        <p className="mb-2 text-sm font-semibold">Independence & Daily Routines</p>
        <div className="space-y-3">
          {singleChoiceCheckboxGroup("Medication Management Support", form.medicationManagementStatus, MEDICATION_MANAGEMENT_OPTIONS, (next) => setForm((current) => ({ ...current, medicationManagementStatus: next })))}
          {singleChoiceCheckboxGroup("Dressing Support", form.dressingSupportStatus, DRESSING_SUPPORT_OPTIONS, (next) => setForm((current) => ({ ...current, dressingSupportStatus: next })))}

          {multiChoiceCheckboxGroup("Assistive Devices", form.assistiveDevicesSelected, ASSISTIVE_DEVICE_OPTIONS, (option) =>
            setForm((current) => {
              const assistiveDevicesSelected = toggleWithNone(current.assistiveDevicesSelected, option);
              return syncOverlappingDeviceSelections({
                ...current,
                assistiveDevicesSelected,
                assistiveDevicesOther: assistiveDevicesSelected.includes("Other") ? current.assistiveDevicesOther : ""
              });
            })
          )}
          {form.assistiveDevicesSelected.includes("Other") ? (
            <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Assistive Device Other</span><input className="h-11 rounded-lg border border-border px-3" value={form.assistiveDevicesOther} onChange={(event) => setForm((current) => ({ ...current, assistiveDevicesOther: event.target.value }))} /></label>
          ) : null}

          {multiChoiceCheckboxGroup("Incontinence Products", form.incontinenceProductsSelected, INCONTINENCE_PRODUCT_OPTIONS, (option) =>
            setForm((current) => ({ ...current, incontinenceProductsSelected: toggleWithNone(current.incontinenceProductsSelected, option), incontinenceProductsOther: option === "Other" || current.incontinenceProductsSelected.includes("Other") ? current.incontinenceProductsOther : "" }))
          )}
          {form.incontinenceProductsSelected.includes("Other") ? (
            <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Incontinence Product Other</span><input className="h-11 rounded-lg border border-border px-3" value={form.incontinenceProductsOther} onChange={(event) => setForm((current) => ({ ...current, incontinenceProductsOther: event.target.value }))} /></label>
          ) : null}

          <label className="flex items-center gap-2 text-sm rounded border border-border px-3 py-2 w-fit">
            <input
              type="checkbox"
              checked={form.onSiteMedicationUse}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  onSiteMedicationUse: event.target.checked,
                  onSiteMedicationList: event.target.checked ? current.onSiteMedicationList : ""
                }))
              }
            />
            On-site medication use
          </label>
          {form.onSiteMedicationUse ? (
            <label className="space-y-1 text-sm md:col-span-2">
              <span className="text-xs font-semibold text-muted">On-site Meds List</span>
              <textarea
                className="min-h-20 w-full rounded-lg border border-border p-3 text-sm"
                placeholder="Enter medication names (e.g., Donepezil 10mg AM; Metformin 500mg PM)"
                value={form.onSiteMedicationList}
                onChange={(event) => setForm((current) => ({ ...current, onSiteMedicationList: event.target.value }))}
              />
            </label>
          ) : null}
        </div>
        <div className="mt-3">{textareaField("Independence Notes", "independenceNotes")}</div>
      </div>

      <div className="rounded-lg border border-border p-3">
        <p className="mb-2 text-sm font-semibold">Diet & Nutrition</p>
        <div className="space-y-3">
          {multiChoiceCheckboxGroup("Diet Type / Restrictions", form.dietTypesSelected, DIET_OPTIONS, (option) =>
            setForm((current) => ({ ...current, dietTypesSelected: toggleMulti(current.dietTypesSelected, option), dietOther: option === "Other" || current.dietTypesSelected.includes("Other") ? current.dietOther : "" }))
          )}
          {form.dietTypesSelected.includes("Other") ? (
            <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Diet Other</span><input className="h-11 rounded-lg border border-border px-3" value={form.dietOther} onChange={(event) => setForm((current) => ({ ...current, dietOther: event.target.value }))} /></label>
          ) : null}
        </div>
        <div className="mt-3">{textareaField("Diet Restrictions / Notes", "dietRestrictionsNotes")}</div>
      </div>

      <div className="rounded-lg border border-border p-3">
        <p className="mb-2 text-sm font-semibold">Mobility & Safety</p>
        <div className="space-y-3">
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Steadiness / mobility</span><input className="h-11 rounded-lg border border-border px-3" value={form.mobilitySteadiness} onChange={(event) => setForm((current) => ({ ...current, mobilitySteadiness: event.target.value }))} /></label>
          <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Falls history</span><input className="h-11 rounded-lg border border-border px-3" value={form.fallsHistory} onChange={(event) => setForm((current) => ({ ...current, fallsHistory: event.target.value }))} /></label>

          {multiChoiceCheckboxGroup("Mobility Aids", form.mobilityAidsSelected, MOBILITY_AID_OPTIONS, (option) =>
            setForm((current) => {
              const mobilityAidsSelected = toggleWithNone(current.mobilityAidsSelected, option);
              return syncOverlappingDeviceSelections({
                ...current,
                mobilityAidsSelected,
                mobilityAidsOther: mobilityAidsSelected.includes("Other") ? current.mobilityAidsOther : ""
              });
            })
          )}
          {form.mobilityAidsSelected.includes("Other") ? (
            <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Mobility Aid Other</span><input className="h-11 rounded-lg border border-border px-3" value={form.mobilityAidsOther} onChange={(event) => setForm((current) => ({ ...current, mobilityAidsOther: event.target.value }))} /></label>
          ) : null}
        </div>
        <div className="mt-3">{textareaField("Mobility / Safety Notes", "mobilitySafetyNotes")}</div>
      </div>

      <div className="rounded-lg border border-border p-3">
        <p className="mb-2 text-sm font-semibold">Social Engagement & Emotional Wellness</p>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.overwhelmedByNoise} onChange={(event) => setForm((current) => ({ ...current, overwhelmedByNoise: event.target.checked }))} /> Overwhelmed by noise/busyness</label>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {textareaField("Known triggers / upsetting situations", "socialTriggers")}
          {textareaField("Emotional wellness notes", "emotionalWellnessNotes")}
        </div>
      </div>

      <div className="rounded-lg border border-border p-3">
        <p className="mb-2 text-sm font-semibold">Personal Notes & Joy Sparks</p>
        <div className="grid gap-3 md:grid-cols-2">
          {textareaField("Joy Sparks", "joySparks")}
          {textareaField("Personal Notes", "personalNotes")}
        </div>
      </div>

      <div className="rounded-lg border border-border p-3">
        <p className="mb-2 text-sm font-semibold">Scoring</p>
        <p className="mb-2 text-xs text-muted">15 = High Functioning, 10 = Mid Functioning, 5 = Low Functioning</p>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {scoreSelect("Orientation & General Health", form.scoreOrientationGeneralHealth, (next) => setForm((current) => ({ ...current, scoreOrientationGeneralHealth: next })))}
          {scoreSelect("Daily Routines & Independence", form.scoreDailyRoutinesIndependence, (next) => setForm((current) => ({ ...current, scoreDailyRoutinesIndependence: next })))}
          {scoreSelect("Nutrition & Dietary Needs", form.scoreNutritionDietaryNeeds, (next) => setForm((current) => ({ ...current, scoreNutritionDietaryNeeds: next })))}
          {scoreSelect("Mobility & Safety", form.scoreMobilitySafety, (next) => setForm((current) => ({ ...current, scoreMobilitySafety: next })))}
          {scoreSelect("Social Engagement & Emotional Wellness", form.scoreSocialEmotionalWellness, (next) => setForm((current) => ({ ...current, scoreSocialEmotionalWellness: next })))}
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Total Score</p><p className="text-lg font-semibold">{totalScore}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Recommended Track</p><p className="text-lg font-semibold">{trackResult.recommendedTrack}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Admission Review</p><p className="text-lg font-semibold">{trackResult.admissionReviewRequired ? "Required" : "No"}</p></div>
        </div>
      </div>

      <div className="rounded-lg border border-border p-3">
        <p className="mb-2 text-sm font-semibold">Transportation Screening</p>
        <div className="space-y-3">
          {singleChoiceCheckboxGroup("Can enter/exit vehicle", form.transportCanEnterExitVehicle, TRANSPORT_ENTER_EXIT_OPTIONS, (next) => setForm((current) => ({ ...current, transportCanEnterExitVehicle: next })))}
          {singleChoiceCheckboxGroup("Transport assistance level", form.transportAssistanceLevel, TRANSPORT_ASSISTANCE_OPTIONS, (next) => setForm((current) => ({ ...current, transportAssistanceLevel: next })))}

          {multiChoiceCheckboxGroup("Mobility aid during transport", form.transportMobilityAidSelected, TRANSPORT_AID_OPTIONS, (option) =>
            setForm((current) => {
              const transportMobilityAidSelected = toggleWithNone(current.transportMobilityAidSelected, option);
              return syncOverlappingDeviceSelections({
                ...current,
                transportMobilityAidSelected,
                transportMobilityAidOther: transportMobilityAidSelected.includes("Other") ? current.transportMobilityAidOther : ""
              });
            })
          )}
          {form.transportMobilityAidSelected.includes("Other") ? (
            <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Transport Mobility Aid Other</span><input className="h-11 rounded-lg border border-border px-3" value={form.transportMobilityAidOther} onChange={(event) => setForm((current) => ({ ...current, transportMobilityAidOther: event.target.value }))} /></label>
          ) : null}

          {multiChoiceCheckboxGroup("Behavior concerns during transport", form.transportBehaviorConcernSelected, TRANSPORT_BEHAVIOR_OPTIONS, (option) =>
            setForm((current) => ({ ...current, transportBehaviorConcernSelected: toggleWithNone(current.transportBehaviorConcernSelected, option), transportBehaviorConcernOther: option === "Other" || current.transportBehaviorConcernSelected.includes("Other") ? current.transportBehaviorConcernOther : "" }))
          )}
          {form.transportBehaviorConcernSelected.includes("Other") ? (
            <label className="space-y-1 text-sm"><span className="text-xs font-semibold text-muted">Behavior Concern Other</span><input className="h-11 rounded-lg border border-border px-3" value={form.transportBehaviorConcernOther} onChange={(event) => setForm((current) => ({ ...current, transportBehaviorConcernOther: event.target.value }))} /></label>
          ) : null}

          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.transportCanRemainSeatedBuckled} onChange={(event) => setForm((current) => ({ ...current, transportCanRemainSeatedBuckled: event.target.checked }))} /> Can remain seated and buckled</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.transportAppropriate} onChange={(event) => setForm((current) => ({ ...current, transportAppropriate: event.target.checked }))} /> Appropriate for center transportation</label>
        </div>
        <div className="mt-3">{textareaField("Transport Notes", "transportNotes")}</div>
      </div>

      {textareaField("Overall Notes", "notes")}
      <div className="rounded-lg border border-border p-3">
        <p className="mb-2 text-sm font-semibold">Nurse E-Signature</p>
        <label className="space-y-1 text-sm">
          <span className="text-xs font-semibold text-muted">Authenticated Clinical Signer</span>
          <input
            className="h-11 rounded-lg border border-border bg-slate-50 px-3"
            value={initialStaffName ?? "Resolved from signed-in nurse/admin session"}
            readOnly
            aria-readonly="true"
          />
        </label>
        <div className="mt-3">
          <EsignaturePad
            disabled={isPending}
            onSignatureChange={(dataUrl) =>
              setForm((current) => ({
                ...current,
                signatureImageDataUrl: dataUrl ?? ""
              }))
            }
          />
        </div>
        <label className="mt-3 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.signatureAttested}
            onChange={(event) => setForm((current) => ({ ...current, signatureAttested: event.target.checked }))}
          />
          <span>
            I attest this is my electronic signature and I am the authorized clinical signer for this Intake Assessment.
          </span>
        </label>
        <p className="mt-2 text-xs text-muted">Signer identity is resolved server-side from the active authenticated nurse/admin session.</p>
      </div>

      <Button
        type="button"
        disabled={isPending || !form.memberId}
        onClick={() =>
          startTransition(async () => {
            const errors = getAssessmentValidationErrors();
            if (errors.length > 0) {
              setValidationErrors(errors);
              setStatus(`Please complete ${errors.length} required field${errors.length === 1 ? "" : "s"} before saving.`);
              return;
            }

            setValidationErrors([]);
            const res = await createAssessmentAction({
              sourceType: form.sourceType,
              selectedRefId: form.selectedRefId,
              memberId: form.memberId,
              leadId: form.leadId,
              leadStage: form.leadStage,
              leadStatus: form.leadStatus,
              assessmentDate: form.assessmentDate,
              completedBy,
              signatureAttested: form.signatureAttested,
              signatureImageDataUrl: form.signatureImageDataUrl,
              complete: form.complete,
              feelingToday: form.feelingToday,
              healthLately: form.healthLately,
              allergies: allergiesValue,
              codeStatus: form.codeStatus,
              orientationDobVerified: form.orientationDobVerified,
              orientationCityVerified: form.orientationCityVerified,
              orientationYearVerified: form.orientationYearVerified,
              orientationOccupationVerified: form.orientationOccupationVerified,
              orientationNotes: form.orientationNotes,
              medicationManagementStatus: form.medicationManagementStatus,
              dressingSupportStatus: form.dressingSupportStatus,
              assistiveDevices: assistiveDevicesValue,
              incontinenceProducts: incontinenceProductsValue,
              onSiteMedicationUse: onSiteMedicationUseValue,
              onSiteMedicationList: onSiteMedicationListValue,
              independenceNotes: form.independenceNotes,
              dietType: dietTypeValue,
              dietOther: dietOtherValue,
              dietRestrictionsNotes: form.dietRestrictionsNotes,
              mobilitySteadiness: form.mobilitySteadiness,
              fallsHistory: form.fallsHistory,
              mobilityAids: mobilityAidsValue,
              mobilitySafetyNotes: form.mobilitySafetyNotes,
              overwhelmedByNoise: form.overwhelmedByNoise,
              socialTriggers: form.socialTriggers,
              emotionalWellnessNotes: form.emotionalWellnessNotes,
              joySparks: form.joySparks,
              personalNotes: form.personalNotes,
              scoreOrientationGeneralHealth: form.scoreOrientationGeneralHealth,
              scoreDailyRoutinesIndependence: form.scoreDailyRoutinesIndependence,
              scoreNutritionDietaryNeeds: form.scoreNutritionDietaryNeeds,
              scoreMobilitySafety: form.scoreMobilitySafety,
              scoreSocialEmotionalWellness: form.scoreSocialEmotionalWellness,
              transportCanEnterExitVehicle: form.transportCanEnterExitVehicle,
              transportAssistanceLevel: form.transportAssistanceLevel,
              transportMobilityAid: transportMobilityAidValue,
              transportCanRemainSeatedBuckled: form.transportCanRemainSeatedBuckled,
              transportBehaviorConcern: transportBehaviorConcernValue,
              transportAppropriate: form.transportAppropriate,
              transportNotes: form.transportNotes,
              vitalsHr: Number(form.vitalsHr),
              vitalsBp: form.vitalsBp.trim(),
              vitalsO2Percent: Number(form.vitalsO2Percent),
              vitalsRr: Number(form.vitalsRr),
              notes: form.notes
            });

            if (!res.ok) {
              setStatus(`Error: ${res.error}`);
              return;
            }

            if (res.actionNeeded) {
              setStatus(res.actionNeededMessage ?? "Assessment was committed, but follow-up is still required.");
              if ("assessmentId" in res && res.assessmentId) {
                const retryPath =
                  "followUpTaskType" in res && res.followUpTaskType === "member_file_pdf_persistence"
                    ? `/health/assessment/${res.assessmentId}?pdfSave=failed`
                    : `/health/assessment/${res.assessmentId}`;
                router.push(retryPath);
              }
              return;
            }

            setValidationErrors([]);
            setStatus("Assessment saved. Intake Assessment PDF saved to member files.");
            if ("assessmentId" in res && res.assessmentId) {
              router.push(`/health/assessment/${res.assessmentId}`);
            }
          })
        }
      >
        Save Intake Assessment
      </Button>

      {validationErrors.length > 0 ? (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          <p className="font-semibold">Required fields still missing:</p>
          <ul className="mt-1 list-disc pl-5">
            {validationErrors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {status ? <p className="text-sm text-muted">{status}</p> : null}
      <p className="text-xs text-muted">Saving creates an Intake Assessment PDF and adds it to member files.</p>
    </div>
  );
}
