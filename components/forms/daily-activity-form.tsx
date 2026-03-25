"use client";

import { useMemo, useState, useTransition } from "react";

import { runDocumentationCreateAction } from "@/app/documentation-create-actions";
import { Button } from "@/components/ui/button";
import { MemberSearchPicker } from "@/components/ui/member-search-picker";
import { PARTICIPATION_LEVEL_OPTIONS, PARTICIPATION_MISSING_REASONS } from "@/lib/canonical";
import { toEasternDate } from "@/lib/timezone";

type ParticipationMissingReason = "" | (typeof PARTICIPATION_MISSING_REASONS)[number];
type ActivityFieldKey = "activity1" | "activity2" | "activity3" | "activity4" | "activity5";
type ReasonFieldKey = "reasonMissing1" | "reasonMissing2" | "reasonMissing3" | "reasonMissing4" | "reasonMissing5";
type DailyActivityFormState = {
  memberId: string;
  activityDate: string;
  activity1: number;
  activity2: number;
  activity3: number;
  activity4: number;
  activity5: number;
  reasonMissing1: ParticipationMissingReason;
  reasonMissing2: ParticipationMissingReason;
  reasonMissing3: ParticipationMissingReason;
  reasonMissing4: ParticipationMissingReason;
  reasonMissing5: ParticipationMissingReason;
  notes: string;
};
const ACTIVITY_FIELD_KEYS = ["activity1", "activity2", "activity3", "activity4", "activity5"] as const;
const REASON_FIELD_KEYS = ["reasonMissing1", "reasonMissing2", "reasonMissing3", "reasonMissing4", "reasonMissing5"] as const;

function useTodayDate() {
  return useMemo(() => toEasternDate(), []);
}

export function DailyActivityForm() {
  const today = useTodayDate();
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [form, setForm] = useState<DailyActivityFormState>({
    memberId: "",
    activityDate: today,
    activity1: 100,
    reasonMissing1: "",
    activity2: 100,
    reasonMissing2: "",
    activity3: 100,
    reasonMissing3: "",
    activity4: 100,
    reasonMissing4: "",
    activity5: 100,
    reasonMissing5: "",
    notes: ""
  });

  function update<K extends keyof DailyActivityFormState>(key: K, value: DailyActivityFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const participation = Math.round((form.activity1 + form.activity2 + form.activity3 + form.activity4 + form.activity5) / 5);

  const requiresReason = [
    form.activity1 === 0 && !form.reasonMissing1,
    form.activity2 === 0 && !form.reasonMissing2,
    form.activity3 === 0 && !form.reasonMissing3,
    form.activity4 === 0 && !form.reasonMissing4,
    form.activity5 === 0 && !form.reasonMissing5
  ].some(Boolean);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-3">
        <MemberSearchPicker value={form.memberId} onChange={(memberId) => update("memberId", memberId)} />

        <label className="space-y-1 text-sm">
          <span className="font-semibold">Date</span>
          <input type="date" className="h-11 w-full rounded-lg border border-border bg-white px-3" value={form.activityDate} onChange={(e) => update("activityDate", e.target.value)} />
        </label>

        <label className="space-y-1 text-sm">
          <span className="font-semibold">Participation (auto)</span>
          <input readOnly className="h-11 w-full rounded-lg border border-border bg-slate-50 px-3" value={`${participation}%`} />
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-5">
        {[1, 2, 3, 4, 5].map((i, index) => {
          const levelKey: ActivityFieldKey = ACTIVITY_FIELD_KEYS[index];
          const reasonKey: ReasonFieldKey = REASON_FIELD_KEYS[index];
          const needsReason = form[levelKey] === 0;

          return (
            <div key={i} className="space-y-2 rounded-lg border border-border p-2">
              <label className="space-y-1 text-sm">
                <span className="font-semibold">Activity {i}</span>
                <select
                  className="h-11 w-full rounded-lg border border-border bg-white px-3"
                  value={String(form[levelKey])}
                  onChange={(e) => update(levelKey, Number(e.target.value))}
                >
                  {PARTICIPATION_LEVEL_OPTIONS.map((level) => (
                    <option key={level} value={level}>{level}%</option>
                  ))}
                </select>
              </label>

              {needsReason ? (
                <label className="space-y-1 text-sm">
                  <span className="font-semibold">Reason (required)</span>
                  <select
                    className="h-11 w-full rounded-lg border border-border bg-white px-3"
                    value={form[reasonKey]}
                    onChange={(e) => update(reasonKey, e.target.value as ParticipationMissingReason)}
                  >
                    <option value="">Select reason</option>
                    {PARTICIPATION_MISSING_REASONS.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
          );
        })}
      </div>

      <textarea className="min-h-24 w-full rounded-lg border border-border p-3 text-sm" placeholder="Additional staff notes" value={form.notes} onChange={(e) => update("notes", e.target.value)} />

      <Button
        type="button"
        disabled={isPending || !form.memberId || requiresReason}
        onClick={() =>
          startTransition(async () => {
            const res = await runDocumentationCreateAction({
              kind: "createDailyActivity",
              payload: form
            });
            setStatus(res.error ? `Error: ${res.error}` : "Participation log saved.");
          })
        }
      >
        Save Activity Log
      </Button>

      {status ? <p className="text-sm text-muted">{status}</p> : null}
    </div>
  );
}


