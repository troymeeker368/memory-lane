"use client";

import { FormEvent, useState, useTransition } from "react";

import { saveMemberCommandCenterAttendanceAction } from "@/app/(portal)/operations/member-command-center/actions";

export function MccAttendanceForm({
  memberId,
  enrollmentDate,
  makeUpDaysAvailable,
  attendanceNotes,
  monday,
  tuesday,
  wednesday,
  thursday,
  friday
}: {
  memberId: string;
  enrollmentDate: string;
  makeUpDaysAvailable: number | null;
  attendanceNotes: string | null;
  monday: boolean;
  tuesday: boolean;
  wednesday: boolean;
  thursday: boolean;
  friday: boolean;
}) {
  const [status, setStatus] = useState("");
  const [isPending, startTransition] = useTransition();

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("");
    const payload = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await saveMemberCommandCenterAttendanceAction(payload);
      if (!result?.ok) {
        setStatus(result?.error ?? "Unable to save attendance.");
        return;
      }
      setStatus("Attendance / enrollment saved.");
      window.dispatchEvent(
        new CustomEvent("mcc:header-update", {
          detail: { enrollment: String(payload.get("enrollmentDate") ?? "") }
        })
      );
    });
  };

  return (
    <form onSubmit={onSubmit} className="mt-3 space-y-3">
      <input type="hidden" name="memberId" value={memberId} />
      <div className="grid gap-2 md:grid-cols-3">
        <label className="space-y-1 text-sm">
          <span className="text-xs font-semibold text-muted">Enrollment Date</span>
          <input name="enrollmentDate" type="date" defaultValue={enrollmentDate} className="h-10 w-full rounded-lg border border-border px-3" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-xs font-semibold text-muted">Make-up Days Available</span>
          <input
            name="makeUpDaysAvailable"
            type="number"
            min={0}
            defaultValue={makeUpDaysAvailable ?? 0}
            className="h-10 w-full rounded-lg border border-border px-3"
          />
        </label>
      </div>
      <div className="grid gap-2 md:grid-cols-5 text-sm">
        <label className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
          <input type="checkbox" name="monday" defaultChecked={monday} /> Monday
        </label>
        <label className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
          <input type="checkbox" name="tuesday" defaultChecked={tuesday} /> Tuesday
        </label>
        <label className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
          <input type="checkbox" name="wednesday" defaultChecked={wednesday} /> Wednesday
        </label>
        <label className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
          <input type="checkbox" name="thursday" defaultChecked={thursday} /> Thursday
        </label>
        <label className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
          <input type="checkbox" name="friday" defaultChecked={friday} /> Friday
        </label>
      </div>
      <label className="space-y-1 text-sm">
        <span className="text-xs font-semibold text-muted">Attendance Notes</span>
        <textarea name="attendanceNotes" defaultValue={attendanceNotes ?? ""} className="min-h-20 w-full rounded-lg border border-border p-3 text-sm" />
      </label>
      <button type="submit" disabled={isPending} className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white disabled:opacity-70">
        {isPending ? "Saving..." : "Save Attendance / Enrollment"}
      </button>
      {status ? <p className="text-xs text-muted">{status}</p> : null}
    </form>
  );
}
