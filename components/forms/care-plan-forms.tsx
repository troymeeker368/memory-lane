"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createCarePlanAction, reviewCarePlanAction } from "@/app/care-plan-actions";
import { Button } from "@/components/ui/button";
import type { CarePlanSectionType, CarePlanTemplate, CarePlanTrack } from "@/lib/services/care-plans";
import { toEasternDate } from "@/lib/timezone";
const CARE_PLAN_SHORT_TERM_LABEL = "Short-Term Goals (within 60 days)";
const CARE_PLAN_LONG_TERM_LABEL = "Long-Term Goals (within 6 months)";

const GOAL_PREFIX_PATTERN = /^\s*(?:\d+[\.\)]|[-*])\s+/;

function normalizeGoalList(input: string) {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(GOAL_PREFIX_PATTERN, "").trim())
    .filter(Boolean);

  return lines.map((line, idx) => `${idx + 1}. ${line}`).join("\n");
}

type MemberOption = { id: string; display_name: string; enrollment_date?: string | null };



function sectionsForTrack(track: CarePlanTrack, templates: CarePlanTemplate[]) {
  return templates
    .filter((template) => template.track === track)
    .map((template, idx) => ({
      sectionType: template.sectionType,
      shortTermGoals: normalizeGoalList(template.defaultShortTermGoals),
      longTermGoals: normalizeGoalList(template.defaultLongTermGoals),
      displayOrder: idx + 1
    }));
}

export function NewCarePlanForm({
  members,
  templates,
  tracks,
  initialMemberId,
  signerNameDefault
}: {
  members: MemberOption[];
  templates: CarePlanTemplate[];
  tracks: CarePlanTrack[];
  initialMemberId?: string;
  signerNameDefault: string;
}) {
  const router = useRouter();
  const today = useMemo(() => toEasternDate(), []);
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);

  const initialTrack = tracks[0] ?? "Track 1";
  const initialMember = (initialMemberId && members.find((member) => member.id === initialMemberId)) || members[0];
  const initialEnrollmentDate = initialMember?.enrollment_date || today;

  const [form, setForm] = useState({
    memberId: initialMember?.id ?? "",
    track: initialTrack,
    enrollmentDate: initialEnrollmentDate,
    reviewDate: today,
    noChangesNeeded: true,
    modificationsRequired: false,
    modificationsDescription: "",
    careTeamNotes: "",
    completedBy: signerNameDefault,
    dateOfCompletion: today,
    responsiblePartySignature: "",
    responsiblePartySignatureDate: "",
    administratorSignature: signerNameDefault,
    administratorSignatureDate: today
  });

  const [sections, setSections] = useState(() => sectionsForTrack(initialTrack, templates));

  const onTrackChange = (track: CarePlanTrack) => {
    setForm((current) => ({ ...current, track }));
    setSections(sectionsForTrack(track, templates));
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-lg border border-border p-3">
        <p className="text-sm font-semibold">Member Information</p>
        <p className="text-xs text-muted">Enrollment Date auto-fills from member record when available; otherwise today&apos;s date is used.</p>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1 text-sm">
            <span className="font-semibold">Member</span>
            <select
              className="h-11 w-full rounded-lg border border-border px-3"
              value={form.memberId}
              onChange={(event) => {
                const nextMemberId = event.target.value;
                const selectedMember = members.find((member) => member.id === nextMemberId);
                const enrollmentDate = selectedMember?.enrollment_date || today;
                setForm((current) => ({ ...current, memberId: nextMemberId, enrollmentDate }));
              }}
            >
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.display_name}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-sm">
            <span className="font-semibold">Care Plan Track</span>
            <select className="h-11 w-full rounded-lg border border-border px-3" value={form.track} onChange={(event) => onTrackChange(event.target.value as CarePlanTrack)}>
              {tracks.map((track) => (
                <option key={track} value={track}>
                  {track}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-sm">
            <span className="font-semibold">Enrollment Date</span>
            <input
              type="date"
              className="h-11 w-full rounded-lg border border-border px-3"
              value={form.enrollmentDate}
              onChange={(event) => {
                const enrollmentDate = event.target.value;
                setForm((current) => ({ ...current, enrollmentDate }));
              }}
            />
          </label>

          <label className="space-y-1 text-sm">
            <span className="font-semibold">Care Plan Review Date</span>
            <input
            type="date"
            className="h-11 w-full rounded-lg border border-border px-3"
            value={form.reviewDate}
            onChange={(event) => {
              const reviewDate = event.target.value;
              setForm((current) => ({
                ...current,
                reviewDate,
                dateOfCompletion: reviewDate,
                administratorSignatureDate: !current.administratorSignatureDate || current.administratorSignatureDate === current.reviewDate ? reviewDate : current.administratorSignatureDate
              }));
            }}
          />
          </label>
        </div>
      </div>

      <div className="space-y-3 rounded-lg border border-border p-3">
        <p className="text-sm font-semibold">Track-Based Goal Sections</p>
        {sections.map((section, idx) => (
          <div key={`${section.sectionType}-${idx}`} className="space-y-2 rounded-lg border border-border p-3">
            <p className="text-sm font-semibold">{section.sectionType}</p>
            <label className="space-y-1 text-xs">
              <span className="font-semibold">{CARE_PLAN_SHORT_TERM_LABEL}</span>
              <textarea className="min-h-24 w-full rounded-lg border border-border p-2" value={section.shortTermGoals} onChange={(event) => setSections((rows) => rows.map((row, rowIdx) => (rowIdx === idx ? { ...row, shortTermGoals: event.target.value } : row)))} onBlur={() => setSections((rows) => rows.map((row, rowIdx) => (rowIdx === idx ? { ...row, shortTermGoals: normalizeGoalList(row.shortTermGoals) } : row)))} />
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-semibold">{CARE_PLAN_LONG_TERM_LABEL}</span>
              <textarea className="min-h-24 w-full rounded-lg border border-border p-2" value={section.longTermGoals} onChange={(event) => setSections((rows) => rows.map((row, rowIdx) => (rowIdx === idx ? { ...row, longTermGoals: event.target.value } : row)))} onBlur={() => setSections((rows) => rows.map((row, rowIdx) => (rowIdx === idx ? { ...row, longTermGoals: normalizeGoalList(row.longTermGoals) } : row)))} />
            </label>
          </div>
        ))}
      </div>

      <div className="space-y-2 rounded-lg border border-border p-3">
        <p className="text-sm font-semibold">Care Plan Review & Updates</p>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.noChangesNeeded} onChange={(event) => setForm((current) => ({ ...current, noChangesNeeded: event.target.checked, modificationsRequired: event.target.checked ? false : current.modificationsRequired }))} />No changes needed</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.modificationsRequired} onChange={(event) => setForm((current) => ({ ...current, modificationsRequired: event.target.checked, noChangesNeeded: event.target.checked ? false : current.noChangesNeeded }))} />Modifications required</label>
        </div>
        {form.modificationsRequired ? (
          <textarea className="min-h-20 w-full rounded-lg border border-border p-2" placeholder="Modifications required (describe below)" value={form.modificationsDescription} onChange={(event) => setForm((current) => ({ ...current, modificationsDescription: event.target.value }))} />
        ) : null}
      </div>

      <div className="space-y-2 rounded-lg border border-border p-3">
        <p className="text-sm font-semibold">Care Team Notes</p>
        <textarea className="min-h-20 w-full rounded-lg border border-border p-2" value={form.careTeamNotes} onChange={(event) => setForm((current) => ({ ...current, careTeamNotes: event.target.value }))} />
      </div>

      <div className="space-y-2 rounded-lg border border-border p-3">
        <p className="text-sm font-semibold">Signoff</p>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="space-y-1 text-sm">
            <span className="font-semibold">Completed By (Nurse Name)</span>
            <input
              className="h-11 w-full rounded-lg border border-border px-3"
              value={form.completedBy}
              readOnly
              aria-readonly="true"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-semibold">Date of Completion</span>
            <input
              type="date"
              className="h-11 w-full rounded-lg border border-border px-3"
              value={form.dateOfCompletion}
              readOnly
              aria-readonly="true"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-semibold">Member/Responsible Party Signature</span>
            <input className="h-11 w-full rounded-lg border border-border px-3" value={form.responsiblePartySignature} onChange={(event) => setForm((current) => ({ ...current, responsiblePartySignature: event.target.value }))} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-semibold">Member/Responsible Party Signature Date</span>
            <input type="date" className="h-11 w-full rounded-lg border border-border px-3" value={form.responsiblePartySignatureDate} onChange={(event) => setForm((current) => ({ ...current, responsiblePartySignatureDate: event.target.value }))} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-semibold">Administrator/Designee Signature (usually center nurse)</span>
            <input className="h-11 w-full rounded-lg border border-border px-3" value={form.administratorSignature} readOnly aria-readonly="true" />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-semibold">Administrator/Designee Signature Date</span>
            <input type="date" className="h-11 w-full rounded-lg border border-border px-3" value={form.administratorSignatureDate} onChange={(event) => setForm((current) => ({ ...current, administratorSignatureDate: event.target.value }))} />
          </label>
        </div>
      </div>

      <Button
        type="button"
        disabled={
          isPending ||
          !form.memberId ||
          !form.enrollmentDate ||
          !form.reviewDate ||
          (!form.noChangesNeeded && !form.modificationsRequired) ||
          (form.modificationsRequired && !form.modificationsDescription.trim()) ||
          sections.some((section) => !section.shortTermGoals || !section.longTermGoals)
        }
        onClick={() =>
          startTransition(async () => {
            const response = await createCarePlanAction({
              memberId: form.memberId,
              track: form.track,
              enrollmentDate: form.enrollmentDate,
              reviewDate: form.reviewDate,
              noChangesNeeded: form.noChangesNeeded,
              modificationsRequired: form.modificationsRequired,
              modificationsDescription: form.modificationsDescription,
              careTeamNotes: form.careTeamNotes,
              completedBy: form.completedBy || undefined,
              dateOfCompletion: form.dateOfCompletion || undefined,
              responsiblePartySignature: form.responsiblePartySignature || undefined,
              responsiblePartySignatureDate: form.responsiblePartySignatureDate || undefined,
              administratorSignature: form.administratorSignature || undefined,
              administratorSignatureDate: form.administratorSignatureDate || undefined,
              sections
            });

            if (response.error) {
              setStatus(`Error: ${response.error}`);
              return;
            }

            setStatus("Care plan created.");
            if (response.id) {
              router.push(`/health/care-plans/${response.id}`);
            }
          })
        }
      >
        Save Care Plan
      </Button>

      {status ? <p className="text-sm text-muted">{status}</p> : null}
    </div>
  );
}

export function CarePlanReviewForm({
  carePlanId,
  reviewedByDefault,
  sections,
  careTeamNotes,
  responsiblePartySignature,
  responsiblePartySignatureDate,
  administratorSignature,
  administratorSignatureDate,
  returnTo
}: {
  carePlanId: string;
  reviewedByDefault: string;
  sections: Array<{ id: string; sectionType: CarePlanSectionType; shortTermGoals: string; longTermGoals: string }>;
  careTeamNotes: string;
  responsiblePartySignature: string | null;
  responsiblePartySignatureDate: string | null;
  administratorSignature: string | null;
  administratorSignatureDate: string | null;
  returnTo?: string;
}) {
  const router = useRouter();
  const today = useMemo(() => toEasternDate(), []);
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [form, setForm] = useState({
    reviewDate: today,
    reviewedBy: reviewedByDefault,
    noChangesNeeded: true,
    modificationsRequired: false,
    modificationsDescription: "",
    careTeamNotes,
    responsiblePartySignature: responsiblePartySignature || "",
    responsiblePartySignatureDate: responsiblePartySignatureDate || "",
    administratorSignature: administratorSignature || reviewedByDefault || "",
    administratorSignatureDate: administratorSignatureDate || today
  });

  const [sectionRows, setSectionRows] = useState(() => sections.map((section) => ({ ...section })));

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="font-semibold">Care Plan Review Date</span>
          <input
            type="date"
            className="h-11 w-full rounded-lg border border-border px-3"
            value={form.reviewDate}
            onChange={(event) => {
              const reviewDate = event.target.value;
              setForm((current) => ({
                ...current,
                reviewDate,
                administratorSignatureDate: !current.administratorSignatureDate || current.administratorSignatureDate === current.reviewDate ? reviewDate : current.administratorSignatureDate
              }));
            }}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-semibold">Completed By (Nurse Name)</span>
          <input
            className="h-11 w-full rounded-lg border border-border px-3"
            value={form.reviewedBy}
            readOnly
            aria-readonly="true"
          />
        </label>
      </div>

      <div className="space-y-2 rounded-lg border border-border p-3">
        <p className="text-sm font-semibold">Care Plan Review & Updates</p>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.noChangesNeeded} onChange={(event) => setForm((current) => ({ ...current, noChangesNeeded: event.target.checked, modificationsRequired: event.target.checked ? false : current.modificationsRequired }))} />No changes needed</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.modificationsRequired} onChange={(event) => setForm((current) => ({ ...current, modificationsRequired: event.target.checked, noChangesNeeded: event.target.checked ? false : current.noChangesNeeded }))} />Modifications required</label>
        </div>

        {form.modificationsRequired ? (
          <textarea className="min-h-20 w-full rounded-lg border border-border p-2" placeholder="Modifications required (describe below)" value={form.modificationsDescription} onChange={(event) => setForm((current) => ({ ...current, modificationsDescription: event.target.value }))} />
        ) : null}
      </div>

      <div className="space-y-2 rounded-lg border border-border p-3">
        <p className="text-sm font-semibold">Update Goals</p>
        {sectionRows.map((section, idx) => (
          <div key={section.id} className="space-y-2 rounded-lg border border-border p-3">
            <p className="text-xs font-semibold">{section.sectionType}</p>
            <label className="space-y-1 text-xs">
              <span className="font-semibold">{CARE_PLAN_SHORT_TERM_LABEL}</span>
              <textarea className="min-h-16 w-full rounded-lg border border-border p-2 text-xs" value={section.shortTermGoals} onChange={(event) => setSectionRows((rows) => rows.map((row, rowIdx) => (rowIdx === idx ? { ...row, shortTermGoals: event.target.value } : row)))} onBlur={() => setSectionRows((rows) => rows.map((row, rowIdx) => (rowIdx === idx ? { ...row, shortTermGoals: normalizeGoalList(row.shortTermGoals) } : row)))} />
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-semibold">{CARE_PLAN_LONG_TERM_LABEL}</span>
              <textarea className="min-h-16 w-full rounded-lg border border-border p-2 text-xs" value={section.longTermGoals} onChange={(event) => setSectionRows((rows) => rows.map((row, rowIdx) => (rowIdx === idx ? { ...row, longTermGoals: event.target.value } : row)))} onBlur={() => setSectionRows((rows) => rows.map((row, rowIdx) => (rowIdx === idx ? { ...row, longTermGoals: normalizeGoalList(row.longTermGoals) } : row)))} />
            </label>
          </div>
        ))}
      </div>

      <div className="space-y-2 rounded-lg border border-border p-3">
        <p className="text-sm font-semibold">Care Team Notes</p>
        <textarea className="min-h-20 w-full rounded-lg border border-border p-2" value={form.careTeamNotes} onChange={(event) => setForm((current) => ({ ...current, careTeamNotes: event.target.value }))} />
      </div>

      <div className="space-y-2 rounded-lg border border-border p-3">
        <p className="text-sm font-semibold">Signoff</p>
        <div className="grid gap-3 md:grid-cols-2">
          <input className="h-11 w-full rounded-lg border border-border px-3" placeholder="Member/Responsible Party Signature" value={form.responsiblePartySignature} onChange={(event) => setForm((current) => ({ ...current, responsiblePartySignature: event.target.value }))} />
          <input type="date" className="h-11 w-full rounded-lg border border-border px-3" value={form.responsiblePartySignatureDate} onChange={(event) => setForm((current) => ({ ...current, responsiblePartySignatureDate: event.target.value }))} />
          <input className="h-11 w-full rounded-lg border border-border px-3" placeholder="Administrator/Designee Signature (defaults to nurse)" value={form.administratorSignature} readOnly aria-readonly="true" />
          <input type="date" className="h-11 w-full rounded-lg border border-border px-3" value={form.administratorSignatureDate} onChange={(event) => setForm((current) => ({ ...current, administratorSignatureDate: event.target.value }))} />
        </div>
      </div>

      <Button
        type="button"
        disabled={isPending || !form.reviewDate || !form.reviewedBy || (!form.noChangesNeeded && !form.modificationsRequired) || (form.modificationsRequired && !form.modificationsDescription.trim())}
        onClick={() =>
          startTransition(async () => {
            const response = await reviewCarePlanAction({
              carePlanId,
              reviewDate: form.reviewDate,
              reviewedBy: form.reviewedBy,
              noChangesNeeded: form.noChangesNeeded,
              modificationsRequired: form.modificationsRequired,
              modificationsDescription: form.modificationsDescription,
              careTeamNotes: form.careTeamNotes,
              responsiblePartySignature: form.responsiblePartySignature || undefined,
              responsiblePartySignatureDate: form.responsiblePartySignatureDate || undefined,
              administratorSignature: form.administratorSignature || undefined,
              administratorSignatureDate: form.administratorSignatureDate || undefined,
              sections: sectionRows.map((section) => ({ id: section.id, shortTermGoals: section.shortTermGoals, longTermGoals: section.longTermGoals }))
            });

            if (response.error) {
              setStatus(`Error: ${response.error}`);
              return;
            }

            setStatus("Care plan review saved.");
            if (returnTo && returnTo.startsWith("/")) {
              router.push(returnTo);
              return;
            }
            router.back();
          })
        }
      >
        Save Review
      </Button>

      {status ? <p className="text-sm text-muted">{status}</p> : null}
    </div>
  );
}










