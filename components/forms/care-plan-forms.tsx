"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  createCarePlanAction,
  reviewCarePlanAction
} from "@/app/care-plan-actions";
import { CarePlanSignatureBlock } from "@/components/care-plans/care-plan-signature-block";
import { EsignaturePad } from "@/components/signature/esignature-pad";
import { Button } from "@/components/ui/button";
import {
  CARE_PLAN_LONG_TERM_LABEL,
  CARE_PLAN_REVIEW_OPTIONS,
  CARE_PLAN_REVIEW_UPDATES_LABEL,
  CARE_PLAN_SHORT_TERM_LABEL,
  type CarePlanSectionType,
  type CarePlanTrack,
  getCarePlanTrackDefinition,
  isCarePlanTrack
} from "@/lib/services/care-plan-track-definitions";
import { toEasternDate } from "@/lib/timezone";

type MemberOption = {
  id: string;
  display_name: string;
  enrollment_date?: string | null;
  latest_assessment_track?: string | null;
};

type CarePlanSectionDraft = {
  sectionType: CarePlanSectionType;
  shortTermGoals: string;
  longTermGoals: string;
};

function stripGoalPrefix(value: string) {
  return value.replace(/^\s*(\d+[.):-]|[-*])\s*/, "").trim();
}

function toNumberedGoalText(lines: string[]) {
  return lines.map((line, index) => `${index + 1}. ${stripGoalPrefix(line)}`).join("\n");
}

function toGoalLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => stripGoalPrefix(line))
    .filter(Boolean);
}

function buildTrackSectionDrafts(track: CarePlanTrack): CarePlanSectionDraft[] {
  const definition = getCarePlanTrackDefinition(track);
  return definition.sections.map((section) => ({
    sectionType: section.sectionType,
    shortTermGoals: toNumberedGoalText([...section.shortTermGoals]),
    longTermGoals: toNumberedGoalText([...section.longTermGoals])
  }));
}

function normalizeSectionDrafts(sections: CarePlanSectionDraft[]) {
  return sections.map((section) => ({
    ...section,
    shortTermGoals: toNumberedGoalText(toGoalLines(section.shortTermGoals)),
    longTermGoals: toNumberedGoalText(toGoalLines(section.longTermGoals))
  }));
}

function resolveMemberCarePlanTrack(member: MemberOption | undefined, fallbackTrack: CarePlanTrack) {
  return isCarePlanTrack(member?.latest_assessment_track) ? member.latest_assessment_track : fallbackTrack;
}

function TrackSectionEditor({
  sections,
  onChange
}: {
  sections: CarePlanSectionDraft[];
  onChange: (next: CarePlanSectionDraft[]) => void;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <p className="text-sm font-semibold">Care Plan Sections</p>
      {sections.map((section) => (
        <div key={section.sectionType} className="space-y-2 rounded-lg border border-border p-3">
          <p className="text-sm font-semibold">{section.sectionType}</p>
          <label className="space-y-1 text-sm">
            <span className="text-xs font-semibold text-muted">{CARE_PLAN_SHORT_TERM_LABEL}</span>
            <textarea
              className="min-h-24 w-full rounded-lg border border-border p-2 text-sm"
              value={section.shortTermGoals}
              onChange={(event) =>
                onChange(
                  sections.map((entry) =>
                    entry.sectionType === section.sectionType
                      ? { ...entry, shortTermGoals: event.target.value }
                      : entry
                  )
                )
              }
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-xs font-semibold text-muted">{CARE_PLAN_LONG_TERM_LABEL}</span>
            <textarea
              className="min-h-24 w-full rounded-lg border border-border p-2 text-sm"
              value={section.longTermGoals}
              onChange={(event) =>
                onChange(
                  sections.map((entry) =>
                    entry.sectionType === section.sectionType
                      ? { ...entry, longTermGoals: event.target.value }
                      : entry
                  )
                )
              }
            />
          </label>
        </div>
      ))}
      <p className="text-xs text-muted">Items are saved as numbered lists and remain fully editable.</p>
    </div>
  );
}

export function NewCarePlanForm({
  members,
  tracks,
  initialMemberId,
  signerNameDefault
}: {
  members: MemberOption[];
  tracks: CarePlanTrack[];
  initialMemberId?: string;
  signerNameDefault: string;
}) {
  const router = useRouter();
  const today = useMemo(() => toEasternDate(), []);
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);

  const fallbackTrack = tracks[0] ?? "Track 1";
  const initialMember = (initialMemberId && members.find((member) => member.id === initialMemberId)) || members[0];
  const initialTrack = resolveMemberCarePlanTrack(initialMember, fallbackTrack);
  const initialEnrollmentDate = initialMember?.enrollment_date || today;

  const [form, setForm] = useState({
    memberId: initialMember?.id ?? "",
    track: initialTrack,
    sections: buildTrackSectionDrafts(initialTrack),
    enrollmentDate: initialEnrollmentDate,
    reviewDate: today,
    noChangesNeeded: true,
    modificationsRequired: false,
    modificationsDescription: "",
    careTeamNotes: "",
    caregiverName: "",
    caregiverEmail: "",
    signatureAttested: false,
    signatureImageDataUrl: ""
  });

  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-lg border border-border p-3">
        <p className="text-sm font-semibold">Member Information</p>
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
                const nextTrack = resolveMemberCarePlanTrack(selectedMember, fallbackTrack);
                setForm((current) => ({
                  ...current,
                  memberId: nextMemberId,
                  track: nextTrack,
                  sections: buildTrackSectionDrafts(nextTrack),
                  enrollmentDate
                }));
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
            <select
              className="h-11 w-full rounded-lg border border-border px-3"
              value={form.track}
              onChange={(event) =>
                setForm((current) => {
                  const nextTrack = event.target.value as CarePlanTrack;
                  return {
                    ...current,
                    track: nextTrack,
                    sections: buildTrackSectionDrafts(nextTrack)
                  };
                })
              }
            >
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
              onChange={(event) => setForm((current) => ({ ...current, enrollmentDate: event.target.value }))}
            />
          </label>

          <label className="space-y-1 text-sm">
            <span className="font-semibold">Care Plan Review Date</span>
            <input
              type="date"
              className="h-11 w-full rounded-lg border border-border px-3"
              value={form.reviewDate}
              onChange={(event) => setForm((current) => ({ ...current, reviewDate: event.target.value }))}
            />
          </label>
        </div>
      </div>

      <TrackSectionEditor
        sections={form.sections}
        onChange={(next) => setForm((current) => ({ ...current, sections: next }))}
      />

      <div className="space-y-2 rounded-lg border border-border p-3">
        <p className="text-sm font-semibold">{CARE_PLAN_REVIEW_UPDATES_LABEL}</p>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.noChangesNeeded}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  noChangesNeeded: event.target.checked,
                  modificationsRequired: event.target.checked ? false : current.modificationsRequired
                }))
              }
            />
            {CARE_PLAN_REVIEW_OPTIONS[0]}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.modificationsRequired}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  modificationsRequired: event.target.checked,
                  noChangesNeeded: event.target.checked ? false : current.noChangesNeeded
                }))
              }
            />
            {CARE_PLAN_REVIEW_OPTIONS[1]}
          </label>
        </div>
        {form.modificationsRequired ? (
          <textarea
            className="min-h-20 w-full rounded-lg border border-border p-2"
            value={form.modificationsDescription}
            onChange={(event) => setForm((current) => ({ ...current, modificationsDescription: event.target.value }))}
          />
        ) : null}
      </div>

      <div className="space-y-2 rounded-lg border border-border p-3">
        <p className="text-sm font-semibold">Care Team Notes</p>
        <textarea
          className="min-h-20 w-full rounded-lg border border-border p-2"
          value={form.careTeamNotes}
          onChange={(event) => setForm((current) => ({ ...current, careTeamNotes: event.target.value }))}
        />
      </div>

      <div className="space-y-2 rounded-lg border border-border p-3">
        <p className="text-sm font-semibold">Caregiver Contact</p>
        <div className="grid gap-3 md:grid-cols-2">
          <input
            className="h-11 w-full rounded-lg border border-border px-3"
            placeholder="Caregiver Name"
            value={form.caregiverName}
            onChange={(event) => setForm((current) => ({ ...current, caregiverName: event.target.value }))}
          />
          <input
            type="email"
            className="h-11 w-full rounded-lg border border-border px-3"
            placeholder="Caregiver Email"
            value={form.caregiverEmail}
            onChange={(event) => setForm((current) => ({ ...current, caregiverEmail: event.target.value }))}
          />
        </div>
      </div>

      <div className="space-y-1 rounded-lg border border-border p-3">
        <p className="text-sm font-semibold">Signoff</p>
        <CarePlanSignatureBlock
          completedBy={signerNameDefault}
          dateOfCompletion={form.reviewDate}
          responsiblePartySignature={null}
          responsiblePartySignatureDate={null}
          administratorSignature={signerNameDefault}
          administratorSignatureDate={form.reviewDate}
        />
        <label className="mt-3 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.signatureAttested}
            onChange={(event) => setForm((current) => ({ ...current, signatureAttested: event.target.checked }))}
          />
          <span>I attest this is my electronic signature and I am the authorized clinical signer for this Care Plan.</span>
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
        <p className="text-xs text-muted">Signer identity is resolved server-side from the active authenticated nurse/admin session.</p>
      </div>

      <Button
        type="button"
        disabled={
          isPending ||
          !form.memberId ||
          !form.enrollmentDate ||
          !form.reviewDate ||
          !form.caregiverName.trim() ||
          !form.caregiverEmail.trim() ||
          form.sections.some((section) => !section.shortTermGoals.trim() || !section.longTermGoals.trim()) ||
          !form.signatureAttested ||
          !form.signatureImageDataUrl ||
          (!form.noChangesNeeded && !form.modificationsRequired) ||
          (form.modificationsRequired && !form.modificationsDescription.trim())
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
              caregiverName: form.caregiverName,
              caregiverEmail: form.caregiverEmail,
              sections: normalizeSectionDrafts(form.sections),
              signatureAttested: form.signatureAttested,
              signatureImageDataUrl: form.signatureImageDataUrl
            });
            if (response.error) {
              if (response.id) {
                router.push(`/health/care-plans/${response.id}?followUp=required&sourceAction=create`);
                return;
              }
              setStatus(`Error: ${response.error}`);
              return;
            }
            setStatus("Care plan created.");
            if (response.id) router.push(`/health/care-plans/${response.id}`);
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
  track,
  reviewedByDefault,
  careTeamNotes,
  caregiverName,
  caregiverEmail,
  sections,
  returnTo
}: {
  carePlanId: string;
  track: CarePlanTrack;
  reviewedByDefault: string;
  careTeamNotes: string;
  caregiverName: string | null;
  caregiverEmail: string | null;
  sections: Array<{
    sectionType: CarePlanSectionType;
    shortTermGoals: string;
    longTermGoals: string;
  }>;
  returnTo?: string;
}) {
  const router = useRouter();
  const today = useMemo(() => toEasternDate(), []);
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [form, setForm] = useState({
    reviewDate: today,
    sections: sections.length > 0 ? sections : buildTrackSectionDrafts(track),
    noChangesNeeded: true,
    modificationsRequired: false,
    modificationsDescription: "",
    careTeamNotes,
    caregiverName: caregiverName ?? "",
    caregiverEmail: caregiverEmail ?? "",
    signatureAttested: false,
    signatureImageDataUrl: ""
  });

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="font-semibold">Care Plan Review Date</span>
          <input
            type="date"
            className="h-11 w-full rounded-lg border border-border px-3"
            value={form.reviewDate}
            onChange={(event) => setForm((current) => ({ ...current, reviewDate: event.target.value }))}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-semibold">Authenticated Clinical Signer</span>
          <input className="h-11 w-full rounded-lg border border-border px-3" value={reviewedByDefault} readOnly />
        </label>
      </div>

      <TrackSectionEditor
        sections={form.sections}
        onChange={(next) => setForm((current) => ({ ...current, sections: next }))}
      />

      <div className="space-y-2 rounded-lg border border-border p-3">
        <p className="text-sm font-semibold">{CARE_PLAN_REVIEW_UPDATES_LABEL}</p>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.noChangesNeeded}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  noChangesNeeded: event.target.checked,
                  modificationsRequired: event.target.checked ? false : current.modificationsRequired
                }))
              }
            />
            {CARE_PLAN_REVIEW_OPTIONS[0]}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.modificationsRequired}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  modificationsRequired: event.target.checked,
                  noChangesNeeded: event.target.checked ? false : current.noChangesNeeded
                }))
              }
            />
            {CARE_PLAN_REVIEW_OPTIONS[1]}
          </label>
        </div>
        {form.modificationsRequired ? (
          <textarea
            className="min-h-20 w-full rounded-lg border border-border p-2"
            value={form.modificationsDescription}
            onChange={(event) => setForm((current) => ({ ...current, modificationsDescription: event.target.value }))}
          />
        ) : null}
      </div>

      <div className="space-y-2 rounded-lg border border-border p-3">
        <p className="text-sm font-semibold">Care Team Notes</p>
        <textarea
          className="min-h-20 w-full rounded-lg border border-border p-2"
          value={form.careTeamNotes}
          onChange={(event) => setForm((current) => ({ ...current, careTeamNotes: event.target.value }))}
        />
      </div>

      <div className="space-y-2 rounded-lg border border-border p-3">
        <p className="text-sm font-semibold">Caregiver Contact</p>
        <div className="grid gap-3 md:grid-cols-2">
          <input
            className="h-11 w-full rounded-lg border border-border px-3"
            placeholder="Caregiver Name"
            value={form.caregiverName}
            onChange={(event) => setForm((current) => ({ ...current, caregiverName: event.target.value }))}
          />
          <input
            type="email"
            className="h-11 w-full rounded-lg border border-border px-3"
            placeholder="Caregiver Email"
            value={form.caregiverEmail}
            onChange={(event) => setForm((current) => ({ ...current, caregiverEmail: event.target.value }))}
          />
        </div>
      </div>

      <div className="space-y-1 rounded-lg border border-border p-3">
        <p className="text-sm font-semibold">Signoff</p>
        <CarePlanSignatureBlock
          completedBy={reviewedByDefault}
          dateOfCompletion={form.reviewDate}
          responsiblePartySignature={null}
          responsiblePartySignatureDate={null}
          administratorSignature={reviewedByDefault}
          administratorSignatureDate={form.reviewDate}
        />
        <label className="mt-3 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.signatureAttested}
            onChange={(event) => setForm((current) => ({ ...current, signatureAttested: event.target.checked }))}
          />
          <span>I attest this is my electronic signature and I am the authorized clinical signer for this Care Plan review.</span>
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
        <p className="text-xs text-muted">Signer identity is resolved server-side from the active authenticated nurse/admin session.</p>
      </div>

      <Button
        type="button"
        disabled={
          isPending ||
          !form.reviewDate ||
          !form.caregiverName.trim() ||
          !form.caregiverEmail.trim() ||
          form.sections.some((section) => !section.shortTermGoals.trim() || !section.longTermGoals.trim()) ||
          !form.signatureAttested ||
          !form.signatureImageDataUrl ||
          (!form.noChangesNeeded && !form.modificationsRequired) ||
          (form.modificationsRequired && !form.modificationsDescription.trim())
        }
        onClick={() =>
          startTransition(async () => {
            const response = await reviewCarePlanAction({
              carePlanId,
              reviewDate: form.reviewDate,
              noChangesNeeded: form.noChangesNeeded,
              modificationsRequired: form.modificationsRequired,
              modificationsDescription: form.modificationsDescription,
              careTeamNotes: form.careTeamNotes,
              caregiverName: form.caregiverName,
              caregiverEmail: form.caregiverEmail,
              sections: normalizeSectionDrafts(form.sections),
              signatureAttested: form.signatureAttested,
              signatureImageDataUrl: form.signatureImageDataUrl
            });
            if (response.error) {
              if (response.id) {
                router.push(`/health/care-plans/${response.id}?followUp=required&sourceAction=review`);
                return;
              }
              setStatus(`Error: ${response.error}`);
              return;
            }
            setStatus("Care plan review saved.");
            if (returnTo && returnTo.startsWith("/")) {
              router.push(returnTo);
              return;
            }
            router.push(`/health/care-plans/${carePlanId}`);
          })
        }
      >
        Save Review
      </Button>

      {status ? <p className="text-sm text-muted">{status}</p> : null}
    </div>
  );
}
