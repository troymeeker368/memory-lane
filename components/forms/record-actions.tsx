"use client";

import { type ReactNode, useEffect, useState, useTransition } from "react";

import {
  deleteWorkflowRecordAction,
  reviewDocumentationAction,
  reviewTimeCardAction,
  updateAncillaryAction,
  updateBloodSugarAction,
  updateDailyActivityAction,
  updateLeadDetailsAction,
  updateShowerLogAction,
  updateToiletLogAction,
  updateTransportationLogAction
} from "@/app/actions";
import { Button } from "@/components/ui/button";
import { LEAD_STATUS_OPTIONS, PARTICIPATION_MISSING_REASONS, TOILET_USE_TYPE_OPTIONS, TRANSPORT_TYPE_OPTIONS } from "@/lib/canonical";

const TRANSPORT_OPTIONS = TRANSPORT_TYPE_OPTIONS;
type TransportOption = (typeof TRANSPORT_OPTIONS)[number];

function EditModal({
  open,
  title,
  onClose,
  children
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-4xl overflow-auto rounded-xl border border-border bg-white p-4 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between border-b border-border pb-2">
          <h3 className="text-base font-semibold text-foreground">{title}</h3>
          <button type="button" className="text-sm font-medium text-muted hover:text-foreground" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="space-y-3">{children}</div>
      </div>
    </div>
  );
}

function InlineEditActions({
  entity,
  id,
  onEdit
}: {
  entity: string;
  id: string;
  onEdit: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" className="h-9 px-3 text-xs" onClick={onEdit}>
        Edit
      </Button>
      <DeleteRecordButton entity={entity} id={id} />
    </div>
  );
}

export function DeleteRecordButton({ entity, id }: { entity: string; id: string }) {
  const [isPending, startTransition] = useTransition();
  const confirmDelete = () => window.confirm("Are you sure you want to delete this entry?");

  return (
    <Button
      type="button"
      className="bg-slate-700"
      disabled={isPending}
      onClick={() => {
        if (!confirmDelete()) return;
        startTransition(async () => {
          await deleteWorkflowRecordAction({ entity, id });
        });
      }}
    >
      Delete
    </Button>
  );
}

export function TimeReviewButtons({ staffName, payPeriod }: { staffName: string; payPeriod: string }) {
  const [isPending, startTransition] = useTransition();
  return (
    <div className="flex gap-2">
      <Button type="button" disabled={isPending} onClick={() => startTransition(async () => { await reviewTimeCardAction({ staffName, payPeriod, status: "Reviewed", notes: "Manager reviewed" }); })}>Review</Button>
      <Button type="button" className="bg-slate-700" disabled={isPending} onClick={() => startTransition(async () => { await reviewTimeCardAction({ staffName, payPeriod, status: "Needs Follow-up", notes: "Follow-up needed" }); })}>Flag</Button>
    </div>
  );
}

export function DocumentationReviewButtons({ staffName, periodLabel }: { staffName: string; periodLabel: string }) {
  const [isPending, startTransition] = useTransition();
  return (
    <div className="flex gap-2">
      <Button type="button" disabled={isPending} onClick={() => startTransition(async () => { await reviewDocumentationAction({ staffName, periodLabel, status: "Reviewed", notes: "Reviewed" }); })}>Review</Button>
      <Button type="button" className="bg-slate-700" disabled={isPending} onClick={() => startTransition(async () => { await reviewDocumentationAction({ staffName, periodLabel, status: "Needs Follow-up", notes: "Needs correction" }); })}>Flag</Button>
    </div>
  );
}

const TOILET_USE_OPTIONS = TOILET_USE_TYPE_OPTIONS;
const NO_ACTIVITY_REASONS = PARTICIPATION_MISSING_REASONS;
type ParticipationMissingReason = "" | (typeof PARTICIPATION_MISSING_REASONS)[number];
type DailyActivityLevelKey = "a1" | "a2" | "a3" | "a4" | "a5";
type DailyActivityReasonKey = "r1" | "r2" | "r3" | "r4" | "r5";
type QuickDailyActivityValues = {
  a1: number;
  a2: number;
  a3: number;
  a4: number;
  a5: number;
  r1: ParticipationMissingReason;
  r2: ParticipationMissingReason;
  r3: ParticipationMissingReason;
  r4: ParticipationMissingReason;
  r5: ParticipationMissingReason;
  notes: string;
};
const DAILY_ACTIVITY_LEVEL_KEYS = ["a1", "a2", "a3", "a4", "a5"] as const;
const DAILY_ACTIVITY_REASON_KEYS = ["r1", "r2", "r3", "r4", "r5"] as const;

function toParticipationMissingReason(value: string | null | undefined): ParticipationMissingReason {
  return NO_ACTIVITY_REASONS.includes(value as (typeof NO_ACTIVITY_REASONS)[number])
    ? (value as ParticipationMissingReason)
    : "";
}

export function QuickEditToilet({ id, useType, briefs, memberSupplied, notes }: { id: string; useType: string; briefs: boolean; memberSupplied?: boolean; notes: string | null }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [localUseType, setLocalUseType] = useState<string>(
    TOILET_USE_OPTIONS.includes(useType as (typeof TOILET_USE_OPTIONS)[number]) ? useType : "Bladder"
  );
  const [localBriefs, setLocalBriefs] = useState(briefs);
  const [localMemberSupplied, setLocalMemberSupplied] = useState(memberSupplied ?? false);
  const [localNotes, setLocalNotes] = useState(notes ?? "");

  useEffect(() => {
    setLocalUseType(TOILET_USE_OPTIONS.includes(useType as (typeof TOILET_USE_OPTIONS)[number]) ? useType : "Bladder");
    setLocalBriefs(briefs);
    setLocalMemberSupplied(memberSupplied ?? false);
    setLocalNotes(notes ?? "");
    setIsOpen(false);
  }, [id, useType, briefs, memberSupplied, notes]);

  return (
    <>
      <InlineEditActions entity="toiletLogs" id={id} onEdit={() => setIsOpen(true)} />
      <EditModal open={isOpen} title="Edit Toilet Log" onClose={() => setIsOpen(false)}>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-muted">Toileting Type</span>
            <select className="h-10 w-full rounded border border-border px-2 text-sm" value={localUseType} onChange={(e) => setLocalUseType(e.target.value)}>
              {TOILET_USE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted">Notes</span>
            <input className="h-10 w-full rounded border border-border px-2 text-sm" value={localNotes} onChange={(e) => setLocalNotes(e.target.value)} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={localBriefs} onChange={(e) => setLocalBriefs(e.target.checked)} />
            Briefs Changed
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={localMemberSupplied} onChange={(e) => setLocalMemberSupplied(e.target.checked)} />
            Member Supplied
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" className="bg-slate-200 text-slate-800" onClick={() => setIsOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                await updateToiletLogAction({ id, useType: localUseType, briefs: localBriefs, memberSupplied: localMemberSupplied, notes: localNotes });
                setIsOpen(false);
              })
            }
          >
            Save
          </Button>
        </div>
      </EditModal>
    </>
  );
}

export function QuickEditShower({ id, laundry, briefs, notes }: { id: string; laundry: boolean; briefs: boolean; notes: string | null }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [localLaundry, setLocalLaundry] = useState(laundry);
  const [localBriefs, setLocalBriefs] = useState(briefs);
  const [localNotes, setLocalNotes] = useState(notes ?? "");

  useEffect(() => {
    setLocalLaundry(laundry);
    setLocalBriefs(briefs);
    setLocalNotes(notes ?? "");
    setIsOpen(false);
  }, [id, laundry, briefs, notes]);

  return (
    <>
      <InlineEditActions entity="showerLogs" id={id} onEdit={() => setIsOpen(true)} />
      <EditModal open={isOpen} title="Edit Shower Log" onClose={() => setIsOpen(false)}>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={localLaundry} onChange={(e) => setLocalLaundry(e.target.checked)} />
            Laundry
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={localBriefs} onChange={(e) => setLocalBriefs(e.target.checked)} />
            Briefs
          </label>
          <label className="space-y-1 text-sm md:col-span-2">
            <span className="text-muted">Notes</span>
            <input className="h-10 w-full rounded border border-border px-2 text-sm" value={localNotes} onChange={(e) => setLocalNotes(e.target.value)} />
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" className="bg-slate-200 text-slate-800" onClick={() => setIsOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                await updateShowerLogAction({ id, laundry: localLaundry, briefs: localBriefs, notes: localNotes });
                setIsOpen(false);
              })
            }
          >
            Save
          </Button>
        </div>
      </EditModal>
    </>
  );
}

export function QuickEditTransportation({ id, period, transportType }: { id: string; period: "AM" | "PM"; transportType: string; notes?: string | null }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [localPeriod, setLocalPeriod] = useState<"AM" | "PM">(period);
  const [localType, setLocalType] = useState<TransportOption>(
    TRANSPORT_OPTIONS.includes(transportType as TransportOption) ? (transportType as TransportOption) : TRANSPORT_OPTIONS[0]
  );

  useEffect(() => {
    setLocalPeriod(period);
    setLocalType(
      TRANSPORT_OPTIONS.includes(transportType as TransportOption)
        ? (transportType as TransportOption)
        : TRANSPORT_OPTIONS[0]
    );
    setIsOpen(false);
  }, [id, period, transportType]);

  return (
    <>
      <InlineEditActions entity="transportationLogs" id={id} onEdit={() => setIsOpen(true)} />
      <EditModal open={isOpen} title="Edit Transportation Log" onClose={() => setIsOpen(false)}>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-muted">Period</span>
            <select className="h-10 w-full rounded border border-border px-2 text-sm" value={localPeriod} onChange={(e) => setLocalPeriod(e.target.value as "AM" | "PM")}>
              <option>AM</option>
              <option>PM</option>
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted">Transport Type</span>
            <select className="h-10 w-full rounded border border-border px-2 text-sm" value={localType} onChange={(e) => setLocalType(e.target.value as TransportOption)}>
              {TRANSPORT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" className="bg-slate-200 text-slate-800" onClick={() => setIsOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                await updateTransportationLogAction({ id, period: localPeriod, transportType: localType });
                setIsOpen(false);
              })
            }
          >
            Save
          </Button>
        </div>
      </EditModal>
    </>
  );
}

export function QuickEditBloodSugar({ id, reading, notes }: { id: string; reading: number; notes: string | null }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [localReading, setLocalReading] = useState(reading);
  const [localNotes, setLocalNotes] = useState(notes ?? "");

  useEffect(() => {
    setLocalReading(reading);
    setLocalNotes(notes ?? "");
    setIsOpen(false);
  }, [id, reading, notes]);

  return (
    <>
      <InlineEditActions entity="bloodSugarLogs" id={id} onEdit={() => setIsOpen(true)} />
      <EditModal open={isOpen} title="Edit Blood Sugar Entry" onClose={() => setIsOpen(false)}>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-muted">Reading (mg/dL)</span>
            <input type="number" className="h-10 w-full rounded border border-border px-2 text-sm" value={localReading} onChange={(e) => setLocalReading(Number(e.target.value))} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted">Notes</span>
            <input className="h-10 w-full rounded border border-border px-2 text-sm" value={localNotes} onChange={(e) => setLocalNotes(e.target.value)} />
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" className="bg-slate-200 text-slate-800" onClick={() => setIsOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                await updateBloodSugarAction({ id, readingMgDl: localReading, notes: localNotes });
                setIsOpen(false);
              })
            }
          >
            Save
          </Button>
        </div>
      </EditModal>
    </>
  );
}

export function QuickEditDailyActivity({
  id,
  a1,
  a2,
  a3,
  a4,
  a5,
  r1,
  r2,
  r3,
  r4,
  r5,
  notes
}: {
  id: string;
  a1: number;
  a2: number;
  a3: number;
  a4: number;
  a5: number;
  r1?: string | null;
  r2?: string | null;
  r3?: string | null;
  r4?: string | null;
  r5?: string | null;
  notes: string | null;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [vals, setVals] = useState<QuickDailyActivityValues>({
    a1,
    a2,
    a3,
    a4,
    a5,
    r1: toParticipationMissingReason(r1),
    r2: toParticipationMissingReason(r2),
    r3: toParticipationMissingReason(r3),
    r4: toParticipationMissingReason(r4),
    r5: toParticipationMissingReason(r5),
    notes: notes ?? ""
  });

  useEffect(() => {
    setVals({
      a1,
      a2,
      a3,
      a4,
      a5,
      r1: toParticipationMissingReason(r1),
      r2: toParticipationMissingReason(r2),
      r3: toParticipationMissingReason(r3),
      r4: toParticipationMissingReason(r4),
      r5: toParticipationMissingReason(r5),
      notes: notes ?? ""
    });
    setIsOpen(false);
  }, [id, a1, a2, a3, a4, a5, r1, r2, r3, r4, r5, notes]);

  const reasonRequired = [
    vals.a1 === 0 && !vals.r1,
    vals.a2 === 0 && !vals.r2,
    vals.a3 === 0 && !vals.r3,
    vals.a4 === 0 && !vals.r4,
    vals.a5 === 0 && !vals.r5
  ].some(Boolean);

  return (
    <>
      <InlineEditActions entity="dailyActivities" id={id} onEdit={() => setIsOpen(true)} />
      <EditModal open={isOpen} title="Edit Participation Log" onClose={() => setIsOpen(false)}>
        <div className="grid gap-3 md:grid-cols-5">
          {DAILY_ACTIVITY_LEVEL_KEYS.map((levelKey, index) => (
            <label key={levelKey} className="space-y-1 text-sm">
              <span className="text-muted">Activity {index + 1}</span>
              <input
                type="number"
                min={0}
                max={100}
                className="h-10 w-full rounded border border-border px-2 text-sm"
                value={vals[levelKey]}
                onChange={(e) => setVals((v) => ({ ...v, [levelKey]: Number(e.target.value) }))}
              />
            </label>
          ))}
        </div>

        <div className="grid gap-2 md:grid-cols-5">
          {[1, 2, 3, 4, 5].map((i, index) => {
            const levelKey: DailyActivityLevelKey = DAILY_ACTIVITY_LEVEL_KEYS[index];
            const reasonKey: DailyActivityReasonKey = DAILY_ACTIVITY_REASON_KEYS[index];
            const required = vals[levelKey] === 0;

            return required ? (
              <select
                key={reasonKey}
                className="h-10 rounded border border-border px-2 text-sm"
                value={vals[reasonKey]}
                onChange={(e) => setVals((v) => ({ ...v, [reasonKey]: e.target.value as ParticipationMissingReason }))}
              >
                <option value="">Reason A{i}</option>
                {NO_ACTIVITY_REASONS.map((reason) => (
                  <option key={`${reason}-${i}`} value={reason}>
                    {reason}
                  </option>
                ))}
              </select>
            ) : (
              <div key={reasonKey} className="h-10 rounded border border-border px-2 text-sm leading-10 text-muted">
                A{i}: No reason needed
              </div>
            );
          })}
        </div>

        <label className="space-y-1 text-sm">
          <span className="text-muted">Notes</span>
          <input className="h-10 w-full rounded border border-border px-2 text-sm" value={vals.notes} onChange={(e) => setVals((v) => ({ ...v, notes: e.target.value }))} />
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" className="bg-slate-200 text-slate-800" onClick={() => setIsOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={isPending || reasonRequired}
            onClick={() =>
              startTransition(async () => {
                await updateDailyActivityAction({
                  id,
                  activity1: vals.a1,
                  reasonMissing1: vals.r1,
                  activity2: vals.a2,
                  reasonMissing2: vals.r2,
                  activity3: vals.a3,
                  reasonMissing3: vals.r3,
                  activity4: vals.a4,
                  reasonMissing4: vals.r4,
                  activity5: vals.a5,
                  reasonMissing5: vals.r5,
                  notes: vals.notes
                });
                setIsOpen(false);
              })
            }
          >
            Save
          </Button>
        </div>
      </EditModal>
    </>
  );
}

export function QuickEditAncillary({ id, notes }: { id: string; notes: string | null }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [localNotes, setLocalNotes] = useState(notes ?? "");

  useEffect(() => {
    setLocalNotes(notes ?? "");
    setIsOpen(false);
  }, [id, notes]);

  return (
    <>
      <InlineEditActions entity="ancillaryLogs" id={id} onEdit={() => setIsOpen(true)} />
      <EditModal open={isOpen} title="Edit Ancillary Charge Entry" onClose={() => setIsOpen(false)}>
        <label className="space-y-1 text-sm">
          <span className="text-muted">Notes</span>
          <input className="h-10 w-full rounded border border-border px-2 text-sm" value={localNotes} onChange={(e) => setLocalNotes(e.target.value)} />
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" className="bg-slate-200 text-slate-800" onClick={() => setIsOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                await updateAncillaryAction({ id, notes: localNotes });
                setIsOpen(false);
              })
            }
          >
            Save
          </Button>
        </div>
      </EditModal>
    </>
  );
}

export function QuickEditLead({ id, stage, status, notes }: { id: string; stage: string; status: (typeof LEAD_STATUS_OPTIONS)[number]; notes: string | null }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [localStage, setLocalStage] = useState(stage);
  const [localStatus, setLocalStatus] = useState<(typeof LEAD_STATUS_OPTIONS)[number]>(status);
  const [localNotes, setLocalNotes] = useState(notes ?? "");

  useEffect(() => {
    setLocalStage(stage);
    setLocalStatus(status);
    setLocalNotes(notes ?? "");
    setIsOpen(false);
  }, [id, stage, status, notes]);

  return (
    <>
      <InlineEditActions entity="leads" id={id} onEdit={() => setIsOpen(true)} />
      <EditModal open={isOpen} title="Edit Lead" onClose={() => setIsOpen(false)}>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="space-y-1 text-sm">
            <span className="text-muted">Stage</span>
            <input className="h-10 w-full rounded border border-border px-2 text-sm" value={localStage} onChange={(e) => setLocalStage(e.target.value)} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted">Status</span>
            <select className="h-10 w-full rounded border border-border px-2 text-sm" value={localStatus} onChange={(e) => setLocalStatus(e.target.value as (typeof LEAD_STATUS_OPTIONS)[number])}>
              {LEAD_STATUS_OPTIONS.map((statusOption) => (
                <option key={statusOption} value={statusOption}>
                  {statusOption}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted">Notes</span>
            <input className="h-10 w-full rounded border border-border px-2 text-sm" value={localNotes} onChange={(e) => setLocalNotes(e.target.value)} />
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" className="bg-slate-200 text-slate-800" onClick={() => setIsOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                await updateLeadDetailsAction({ id, stage: localStage, status: localStatus, notes: localNotes });
                setIsOpen(false);
              })
            }
          >
            Save
          </Button>
        </div>
      </EditModal>
    </>
  );
}






