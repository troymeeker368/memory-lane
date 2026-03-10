"use client";

import { useEffect, useMemo, useState, useTransition } from "react";

import {
  createAssessmentAction,
  createBloodSugarLogAction,
  createLeadActivityAction,
  createPhotoUploadAction,
  createShowerLogAction,
  createToiletLogAction,
  createTransportationLogAction,
  updateLeadStatusAction
} from "@/app/actions";
import { Button } from "@/components/ui/button";
import { easternDateTimeLocalToISO, toEasternDate, toEasternDateTimeLocal } from "@/lib/timezone";
import {
  LEAD_ACTIVITY_OUTCOMES,
  LEAD_ACTIVITY_TYPES,
  LEAD_FOLLOW_UP_TYPES,
  LEAD_LOST_REASON_OPTIONS,
  TOILET_USE_TYPE_OPTIONS,
  TRANSPORT_TYPE_OPTIONS
} from "@/lib/canonical";
import { ASSESSMENT_SCORE_OPTIONS, calculateAssessmentTotal, getAssessmentTrack } from "@/lib/assessment";

type MemberOption = {
  id: string;
  display_name: string;
  lead_id?: string | null;
  lead_stage?: string | null;
  lead_status?: string | null;
  linked_member_id?: string | null;
};
type LeadOption = { id: string; member_name: string; stage: string; status: string };

const TOILET_OPTIONS = TOILET_USE_TYPE_OPTIONS;
const TRANSPORT_OPTIONS = TRANSPORT_TYPE_OPTIONS;
const LEAD_FOLLOWUP_TYPES = LEAD_FOLLOW_UP_TYPES;
const MAX_PHOTO_UPLOAD_BYTES = 5 * 1024 * 1024;
type LeadActivityType = (typeof LEAD_ACTIVITY_TYPES)[number];
type LeadActivityOutcome = (typeof LEAD_ACTIVITY_OUTCOMES)[number];
type LeadFollowUpType = (typeof LEAD_FOLLOW_UP_TYPES)[number];
type LeadLostReason = "" | (typeof LEAD_LOST_REASON_OPTIONS)[number];

function useNowIso() {
  return useMemo(() => toEasternDateTimeLocal(), []);
}

function useToday() {
  return useMemo(() => toEasternDate(), []);
}

export function ToiletLogForm({ members }: { members: MemberOption[] }) {
  const now = useNowIso();
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [form, setForm] = useState({
    memberId: members[0]?.id ?? "",
    eventAt: now,
    briefs: false,
    memberSupplied: true,
    useType: TOILET_OPTIONS[0] as (typeof TOILET_OPTIONS)[number],
    notes: ""
  });

  const willGenerateCharge = form.briefs && !form.memberSupplied;
  const saveToiletTooltip = willGenerateCharge
    ? "Saves toilet log and auto-generates a Briefs ancillary charge."
    : "Saves toilet log without auto-generating a Briefs ancillary charge.";

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-3">
        <select className="h-11 rounded-lg border border-border px-3" value={form.memberId} onChange={(e) => setForm((f) => ({ ...f, memberId: e.target.value }))}>
          {members.map((m) => (
            <option key={m.id} value={m.id}>{m.display_name}</option>
          ))}
        </select>
        <input type="datetime-local" className="h-11 rounded-lg border border-border px-3" value={form.eventAt} onChange={(e) => setForm((f) => ({ ...f, eventAt: e.target.value }))} />
        <select
          className="h-11 rounded-lg border border-border px-3"
          value={form.useType}
          onChange={(e) => setForm((f) => ({ ...f, useType: e.target.value as (typeof TOILET_OPTIONS)[number] }))}
        >
          {TOILET_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.briefs} onChange={(e) => setForm((f) => ({ ...f, briefs: e.target.checked }))} />
          Briefs Changed
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.memberSupplied} onChange={(e) => setForm((f) => ({ ...f, memberSupplied: e.target.checked }))} />
          Member Supplied
        </label>
      </div>

      <textarea className="min-h-20 w-full rounded-lg border border-border p-3 text-sm" placeholder="Additional notes (optional)" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />

      <Button type="button" title={saveToiletTooltip} disabled={isPending || !form.memberId} onClick={() => startTransition(async () => {
        const res = await createToiletLogAction({
          memberId: form.memberId,
          eventAt: easternDateTimeLocalToISO(form.eventAt),
          briefs: form.briefs,
          memberSupplied: form.memberSupplied,
          useType: form.useType,
          notes: form.notes
        });
        setStatus(res.error ? `Error: ${res.error}` : "Toilet log saved.");
      })}>Save Toilet Log</Button>
      {status ? <p className="text-sm text-muted">{status}</p> : null}
    </div>
  );
}

export function ShowerLogForm({ members }: { members: MemberOption[] }) {
  const now = useNowIso();
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [form, setForm] = useState({ memberId: members[0]?.id ?? "", eventAt: now, laundry: false, briefs: false, notes: "" });

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <select className="h-11 rounded-lg border border-border px-3" value={form.memberId} onChange={(e) => setForm((f) => ({ ...f, memberId: e.target.value }))}>
          {members.map((m) => (
            <option key={m.id} value={m.id}>{m.display_name}</option>
          ))}
        </select>
        <input type="datetime-local" className="h-11 rounded-lg border border-border px-3" value={form.eventAt} onChange={(e) => setForm((f) => ({ ...f, eventAt: e.target.value }))} />
      </div>
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={form.laundry} onChange={(e) => setForm((f) => ({ ...f, laundry: e.target.checked }))} /> Laundry</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={form.briefs} onChange={(e) => setForm((f) => ({ ...f, briefs: e.target.checked }))} /> Briefs changed</label>
      </div>
      <textarea className="min-h-20 w-full rounded-lg border border-border p-3 text-sm" placeholder="Notes" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
      <Button type="button" disabled={isPending || !form.memberId} onClick={() => startTransition(async () => {
        const res = await createShowerLogAction({ memberId: form.memberId, eventAt: easternDateTimeLocalToISO(form.eventAt), laundry: form.laundry, briefs: form.briefs, notes: form.notes });
        setStatus(res.error ? `Error: ${res.error}` : "Shower log saved.");
      })}>Save Shower Log</Button>
      {status ? <p className="text-sm text-muted">{status}</p> : null}
    </div>
  );
}

export function TransportationLogForm({ members }: { members: MemberOption[] }) {
  const today = useToday();
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [form, setForm] = useState({ memberId: members[0]?.id ?? "", period: "AM" as "AM" | "PM", transportType: "Door to door" as (typeof TRANSPORT_OPTIONS)[number], serviceDate: today });

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-4">
        <select className="h-11 rounded-lg border border-border px-3" value={form.memberId} onChange={(e) => setForm((f) => ({ ...f, memberId: e.target.value }))}>
          {members.map((m) => (
            <option key={m.id} value={m.id}>{m.display_name}</option>
          ))}
        </select>

        <select className="h-11 rounded-lg border border-border px-3" value={form.period} onChange={(e) => setForm((f) => ({ ...f, period: e.target.value as "AM" | "PM" }))}>
          <option value="AM">AM</option>
          <option value="PM">PM</option>
        </select>

        <select className="h-11 rounded-lg border border-border px-3" value={form.transportType} onChange={(e) => setForm((f) => ({ ...f, transportType: e.target.value as (typeof TRANSPORT_OPTIONS)[number] }))}>
          {TRANSPORT_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>

        <input type="date" className="h-11 rounded-lg border border-border px-3" value={form.serviceDate} onChange={(e) => setForm((f) => ({ ...f, serviceDate: e.target.value }))} />
      </div>

      <p className="text-xs text-muted">Notes are intentionally disabled to match AppSheet transportation flow.</p>

      <Button type="button" disabled={isPending || !form.memberId} onClick={() => startTransition(async () => {
        const res = await createTransportationLogAction(form);
        setStatus(res.error ? `Error: ${res.error}` : "Transportation log saved.");
      })}>Save Transportation Log</Button>
      {status ? <p className="text-sm text-muted">{status}</p> : null}
    </div>
  );
}

export function PhotoUploadForm() {
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);

  useEffect(() => {
    return () => {
      previewUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [previewUrls]);

  const onFilesSelect = (selectedList: FileList | null) => {
    previewUrls.forEach((url) => URL.revokeObjectURL(url));

    const selectedFiles = Array.from(selectedList ?? []);
    const validFiles = selectedFiles.filter((file) => file.size <= MAX_PHOTO_UPLOAD_BYTES);
    const oversizedFiles = selectedFiles.filter((file) => file.size > MAX_PHOTO_UPLOAD_BYTES);

    setFiles(validFiles);
    if (oversizedFiles.length > 0) {
      setStatus(
        `Skipped ${oversizedFiles.length} file(s) over 5MB. Max allowed per photo is 5MB.`
      );
    } else {
      setStatus(null);
    }

    const urls = validFiles.map((file) => URL.createObjectURL(file));
    setPreviewUrls(urls);
  };

  const fileToDataUrl = async (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          resolve(reader.result);
          return;
        }
        reject(new Error("Could not read file."));
      };
      reader.onerror = () => reject(new Error("Could not read file."));
      reader.readAsDataURL(file);
    });

  return (
    <div className="space-y-3">
      <div className="grid gap-3">
        <input
          type="file"
          multiple
          accept="image/*"
          className="h-11 rounded-lg border border-border bg-white px-3 py-2 text-fg"
          onChange={(e) => onFilesSelect(e.target.files)}
        />
      </div>

      {files.length > 0 ? (
        <div className="rounded-lg border border-border p-2">
          <p className="mb-2 text-xs font-semibold text-muted">Selected Files ({files.length})</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {files.map((file, index) => (
              <div key={`${file.name}-${file.size}-${index}`} className="rounded border border-border p-2">
                <img src={previewUrls[index]} alt={file.name} className="max-h-36 w-full rounded object-cover" />
                <p className="mt-2 truncate text-xs font-semibold">{file.name}</p>
                <p className="text-xs text-muted">{file.type || "image/*"}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <Button
        type="button"
        disabled={isPending || files.length === 0}
        onClick={() =>
          startTransition(async () => {
            let saved = 0;
            const failures: string[] = [];

            for (const file of files) {
              try {
                if (file.size > MAX_PHOTO_UPLOAD_BYTES) {
                  failures.push(`${file.name}: exceeds 5MB limit.`);
                  continue;
                }
                const fileDataUrl = await fileToDataUrl(file);
                const res = await createPhotoUploadAction({
                  fileName: file.name,
                  fileType: file.type || "image/*",
                  fileDataUrl
                });

                if (res.error) {
                  failures.push(`${file.name}: ${res.error}`);
                } else {
                  saved += 1;
                }
              } catch {
                failures.push(`${file.name}: Unable to process file.`);
              }
            }

            if (saved > 0 && failures.length === 0) {
              setStatus(`Saved ${saved} photo upload${saved === 1 ? "" : "s"}.`);
            } else if (saved > 0 && failures.length > 0) {
              setStatus(`Saved ${saved} file(s). ${failures.length} failed.`);
            } else {
              setStatus(`Error: ${failures[0] ?? "No files were saved."}`);
            }

            if (saved > 0) {
              previewUrls.forEach((url) => URL.revokeObjectURL(url));
              setFiles([]);
              setPreviewUrls([]);
            }
          })
        }
      >
        Save Photo Uploads
      </Button>

      {status ? <p className="text-sm text-muted">{status}</p> : null}
    </div>
  );
}

export function BloodSugarForm({ members }: { members: MemberOption[] }) {
  const now = useNowIso();
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [form, setForm] = useState({ memberId: members[0]?.id ?? "", checkedAt: now, readingMgDl: 110, notes: "" });

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-3">
        <select className="h-11 rounded-lg border border-border px-3" value={form.memberId} onChange={(e) => setForm((f) => ({ ...f, memberId: e.target.value }))}>
          {members.map((m) => (
            <option key={m.id} value={m.id}>{m.display_name}</option>
          ))}
        </select>
        <input type="datetime-local" className="h-11 rounded-lg border border-border px-3" value={form.checkedAt} onChange={(e) => setForm((f) => ({ ...f, checkedAt: e.target.value }))} />
        <input type="number" className="h-11 rounded-lg border border-border px-3" value={form.readingMgDl} onChange={(e) => setForm((f) => ({ ...f, readingMgDl: Number(e.target.value) }))} />
      </div>
      <textarea className="min-h-20 w-full rounded-lg border border-border p-3 text-sm" placeholder="Notes" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
      <Button type="button" disabled={isPending || !form.memberId} onClick={() => startTransition(async () => {
        const res = await createBloodSugarLogAction({ ...form, checkedAt: easternDateTimeLocalToISO(form.checkedAt) });
        setStatus(res.error ? `Error: ${res.error}` : "Blood sugar log saved.");
      })}>Save Blood Sugar</Button>
      {status ? <p className="text-sm text-muted">{status}</p> : null}
    </div>
  );
}

export function AssessmentForm({ members, initialMemberId, initialStaffName }: { members: MemberOption[]; initialMemberId?: string; initialStaffName?: string }) {
  const today = useToday();
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const selectedInitialMemberId =
    initialMemberId && members.some((member) => member.id === initialMemberId || member.lead_id === initialMemberId)
      ? members.find((member) => member.id === initialMemberId || member.lead_id === initialMemberId)?.id ?? members[0]?.id ?? ""
      : members[0]?.id ?? "";
  const selectedInitialMember = members.find((member) => member.id === selectedInitialMemberId);

  const CODE_STATUS_OPTIONS = ["Full Code", "DNR"] as const;
  const MEDICATION_MANAGEMENT_OPTIONS = ["Independent", "Needs reminders", "Needs cueing", "Needs full assistance"] as const;
  const DRESSING_SUPPORT_OPTIONS = ["Independent", "Setup only", "Needs partial assistance", "Needs full assistance"] as const;
  const ASSISTIVE_DEVICE_OPTIONS = ["Walker", "Cane", "Wheelchair", "Gait Belt", "None", "Other"] as const;
  const INCONTINENCE_PRODUCT_OPTIONS = ["Briefs", "Pads", "None", "Other"] as const;
  const DIET_OPTIONS = ["Regular", "Diabetic", "Low Sodium", "Pureed", "Mechanical Soft", "Other"] as const;
  const MOBILITY_AID_OPTIONS = ["Walker", "Cane", "Wheelchair", "None", "Other"] as const;
  const TRANSPORT_ENTER_EXIT_OPTIONS = ["Independent", "Standby Assist", "1-Person Assist", "2-Person Assist", "Wheelchair Transfer"] as const;
  const TRANSPORT_ASSISTANCE_OPTIONS = ["Independent", "Standby", "1:1 Assist", "2:1 Assist", "Lift Required"] as const;
  const TRANSPORT_AID_OPTIONS = ["Walker", "Cane", "Wheelchair", "Gait Belt", "None", "Other"] as const;
  const TRANSPORT_BEHAVIOR_OPTIONS = ["None", "Unbuckles seatbelt", "Exit-seeking", "Agitation", "Verbal aggression", "Other"] as const;

  const [form, setForm] = useState({
    memberId: selectedInitialMember?.linked_member_id ?? "",
    leadId: selectedInitialMember?.lead_id ?? selectedInitialMember?.id ?? "",
    leadStage: selectedInitialMember?.lead_stage ?? "",
    leadStatus: selectedInitialMember?.lead_status ?? "",
    assessmentDate: today,
    completedBy: initialStaffName ?? "",
    signedBy: initialStaffName ?? "",
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

  const getAssessmentOptionValue = (member: MemberOption) => member.lead_id?.trim() || member.id;

  useEffect(() => {
    if (!initialStaffName?.trim()) return;
    setForm((current) => ({
      ...current,
      completedBy: initialStaffName,
      signedBy: initialStaffName
    }));
  }, [initialStaffName]);

  const toggleWithNone = (current: string[], option: string) => {
    if (option === "None") {
      return current.includes("None") ? [] : ["None"];
    }

    const base = current.filter((item) => item !== "None");
    return base.includes(option) ? base.filter((item) => item !== option) : [...base, option];
  };

  const toggleMulti = (current: string[], option: string) =>
    current.includes(option) ? current.filter((item) => item !== option) : [...current, option];

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
    if (!form.leadId) errors.push("Linked Lead (Tour/EIP)");
    if (!form.completedBy.trim()) errors.push("Completed By");
    if (!form.signedBy.trim()) errors.push("Nurse Signature");
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
            value={form.leadId || form.memberId}
            onChange={(event) => {
              const selected = members.find((member) => getAssessmentOptionValue(member) === event.target.value);
              setForm((current) => ({
                ...current,
                memberId: selected?.linked_member_id ?? "",
                leadId: selected?.lead_id ?? selected?.id ?? "",
                leadStage: selected?.lead_stage ?? "",
                leadStatus: selected?.lead_status ?? ""
              }));
            }}
          >
            {members.map((member) => (
              <option key={`${member.id}-${member.lead_id ?? "leadless"}`} value={getAssessmentOptionValue(member)}>
                {member.display_name}
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
          <input className="h-11 rounded-lg border border-border bg-slate-50 px-3" value={form.completedBy} readOnly />
        </label>
      </div>

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
            setForm((current) => ({ ...current, assistiveDevicesSelected: toggleWithNone(current.assistiveDevicesSelected, option), assistiveDevicesOther: option === "Other" || current.assistiveDevicesSelected.includes("Other") ? current.assistiveDevicesOther : "" }))
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
            setForm((current) => ({ ...current, mobilityAidsSelected: toggleWithNone(current.mobilityAidsSelected, option), mobilityAidsOther: option === "Other" || current.mobilityAidsSelected.includes("Other") ? current.mobilityAidsOther : "" }))
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
            setForm((current) => ({ ...current, transportMobilityAidSelected: toggleWithNone(current.transportMobilityAidSelected, option), transportMobilityAidOther: option === "Other" || current.transportMobilityAidSelected.includes("Other") ? current.transportMobilityAidOther : "" }))
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
        <p className="mb-2 text-sm font-semibold">Signature</p>
        <label className="space-y-1 text-sm">
          <span className="text-xs font-semibold text-muted">Nurse Signature</span>
          <input
            className="h-11 rounded-lg border border-border px-3"
            value={form.signedBy}
            onChange={(event) => setForm((current) => ({ ...current, signedBy: event.target.value }))}
            placeholder="Type full legal name"
          />
        </label>
        <p className="mt-2 text-xs text-muted">TODO: Replace typed signature with e-signature workflow when PDF/e-sign integration is added.</p>
      </div>

      <Button
        type="button"
        disabled={isPending}
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
              memberId: form.memberId,
              leadId: form.leadId,
              leadStage: form.leadStage,
              leadStatus: form.leadStatus,
              assessmentDate: form.assessmentDate,
              completedBy: form.completedBy,
              signedBy: form.signedBy,
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

            if (res.error) {
              setStatus(`Error: ${res.error}`);
              return;
            }

            setValidationErrors([]);
            setStatus(res.warning ?? "Assessment saved. Intake Assessment PDF saved to member files.");
            if (res.assessmentId) {
              const query = res.warning ? "?pdfSave=failed" : "";
              window.location.href = `/health/assessment/${res.assessmentId}${query}`;
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

export function LeadActivityForm({ leads, initialLeadId }: { leads: LeadOption[]; initialLeadId?: string }) {
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [form, setForm] = useState<{
    leadId: string;
    activityType: LeadActivityType;
    outcome: LeadActivityOutcome;
    lostReason: LeadLostReason;
    nextFollowUpDate: string;
    nextFollowUpType: LeadFollowUpType;
    notes: string;
  }>({
    leadId: (initialLeadId && leads.some((l) => l.id === initialLeadId) ? initialLeadId : leads[0]?.id) ?? "",
    activityType: "Call",
    outcome: "Spoke with caregiver",
    lostReason: "",
    nextFollowUpDate: "",
    nextFollowUpType: "Call",
    notes: ""
  });

  const showLostReason = form.outcome === "Not a fit";

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-3">
        <select className="h-11 rounded-lg border border-border px-3" value={form.leadId} onChange={(e) => setForm((f) => ({ ...f, leadId: e.target.value }))}>
          {leads.map((l) => <option key={l.id} value={l.id}>{l.member_name} ({l.stage})</option>)}
        </select>
        <select
          className="h-11 rounded-lg border border-border px-3"
          value={form.activityType}
          onChange={(e) => setForm((f) => ({ ...f, activityType: e.target.value as LeadActivityType }))}
        >
          {LEAD_ACTIVITY_TYPES.map((activityType) => <option key={activityType} value={activityType}>{activityType}</option>)}
        </select>
        <select
          className="h-11 rounded-lg border border-border px-3"
          value={form.outcome}
          onChange={(e) => setForm((f) => ({ ...f, outcome: e.target.value as LeadActivityOutcome }))}
        >
          {LEAD_ACTIVITY_OUTCOMES.map((outcome) => <option key={outcome} value={outcome}>{outcome}</option>)}
        </select>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <input type="date" className="h-11 rounded-lg border border-border px-3" value={form.nextFollowUpDate} onChange={(e) => setForm((f) => ({ ...f, nextFollowUpDate: e.target.value }))} />
        <select
          className="h-11 rounded-lg border border-border px-3"
          value={form.nextFollowUpType}
          onChange={(e) => setForm((f) => ({ ...f, nextFollowUpType: e.target.value as LeadFollowUpType }))}
        >
          {LEAD_FOLLOWUP_TYPES.map((followupType) => <option key={followupType} value={followupType}>{followupType}</option>)}
        </select>
        {showLostReason ? (
          <select
            className="h-11 rounded-lg border border-border px-3"
            value={form.lostReason}
            onChange={(e) => setForm((f) => ({ ...f, lostReason: e.target.value as LeadLostReason }))}
          >
            <option value="">Lost Reason</option>
            {LEAD_LOST_REASON_OPTIONS.map((lostReason) => <option key={lostReason} value={lostReason}>{lostReason}</option>)}
          </select>
        ) : <div className="h-11 rounded-lg border border-border px-3 text-sm leading-[2.75rem] text-muted">Lost Reason not required</div>}
      </div>

      <textarea className="min-h-20 w-full rounded-lg border border-border p-3 text-sm" placeholder="Notes" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
      <Button type="button" disabled={isPending || !form.leadId || (showLostReason && !form.lostReason)} onClick={() => startTransition(async () => {
        const res = await createLeadActivityAction(form);
        setStatus(res.error ? `Error: ${res.error}` : "Lead activity logged.");
      })}>Save Activity</Button>
      {status ? <p className="text-sm text-muted">{status}</p> : null}
    </div>
  );
}

export function LeadStatusControls({ leads }: { leads: LeadOption[] }) {
  const [isPending, startTransition] = useTransition();

  return (
    <div className="space-y-2">
      {leads.map((lead) => (
        <div key={lead.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2">
          <p className="text-sm font-medium">{lead.member_name} - {lead.stage} ({lead.status})</p>
          <div className="space-x-2">
            <Button type="button" disabled={isPending} onClick={() => startTransition(async () => { await updateLeadStatusAction({ leadId: lead.id, status: "Won", stage: "Closed - Won" }); })}>Mark Won</Button>
            <Button type="button" disabled={isPending} className="bg-slate-700" onClick={() => startTransition(async () => { await updateLeadStatusAction({ leadId: lead.id, status: "Lost", stage: "Closed - Lost" }); })}>Mark Lost</Button>
          </div>
        </div>
      ))}
    </div>
  );
}





















