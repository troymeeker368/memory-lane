"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { saveAttendanceStatusAction } from "@/app/(portal)/operations/attendance/actions";
import { usePropSyncedState } from "@/components/forms/use-prop-synced-state";
import { ATTENDANCE_ABSENCE_REASON_OPTIONS } from "@/lib/canonical";

type ActionMode = "check-in" | "check-out" | "absent" | null;

function initialsFromName(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
}

function currentTimeString() {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/New_York"
  })
    .formatToParts(new Date())
    .reduce<Record<string, string>>((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});
  return `${parts.hour ?? "08"}:${parts.minute ?? "00"}`;
}

export function AttendanceMemberCell({
  memberId,
  memberName,
  memberPhotoUrl,
  attendanceDate,
  canEdit,
  defaultCheckInTime,
  defaultCheckOutTime,
  defaultAbsentReason,
  defaultAbsentReasonOther
}: {
  memberId: string;
  memberName: string;
  memberPhotoUrl: string | null;
  attendanceDate: string;
  canEdit: boolean;
  defaultCheckInTime?: string;
  defaultCheckOutTime?: string;
  defaultAbsentReason?: string | null;
  defaultAbsentReasonOther?: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ActionMode>(null);
  const syncDeps = [attendanceDate, defaultAbsentReason, defaultAbsentReasonOther, defaultCheckInTime, defaultCheckOutTime, memberId];
  const [checkInTime, setCheckInTime] = usePropSyncedState(defaultCheckInTime ?? currentTimeString(), syncDeps);
  const [checkOutTime, setCheckOutTime] = usePropSyncedState(defaultCheckOutTime ?? currentTimeString(), syncDeps);
  const [absentReason, setAbsentReason] = usePropSyncedState(defaultAbsentReason ?? "", syncDeps);
  const [absentReasonOther, setAbsentReasonOther] = usePropSyncedState(defaultAbsentReasonOther ?? "", syncDeps);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const profileHref = useMemo(
    () => `/operations/member-command-center/${memberId}`,
    [memberId]
  );

  useEffect(() => {
    setOpen(false);
    setMode(null);
    setError(null);
  }, syncDeps);

  function runAction() {
    if (!mode) return;
    setError(null);
    startTransition(async () => {
      try {
        const payload = new FormData();
        payload.set("memberId", memberId);
        payload.set("attendanceDate", attendanceDate);
        payload.set("status", mode);

        if (mode === "check-in") {
          payload.set("checkInTime", checkInTime || currentTimeString());
        } else if (mode === "check-out") {
          payload.set("checkOutTime", checkOutTime || currentTimeString());
        } else if (mode === "absent") {
          if (!absentReason) {
            setError("Absent reason is required.");
            return;
          }
          payload.set("absentReason", absentReason);
          if (absentReason === "Other") {
            if (!absentReasonOther.trim()) {
              setError("Custom absent reason is required.");
              return;
            }
            payload.set("absentReasonOther", absentReasonOther.trim());
          }
        }

        const result = await saveAttendanceStatusAction(payload);
        if (result?.ok === false) {
          setError(result.error ?? "Unable to save attendance action.");
          return;
        }
        setOpen(false);
        setMode(null);
        router.refresh();
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : "Unable to save attendance action.";
        setError(message);
      }
    });
  }

  function clearRecord() {
    setError(null);
    startTransition(async () => {
      try {
        const payload = new FormData();
        payload.set("memberId", memberId);
        payload.set("attendanceDate", attendanceDate);
        payload.set("status", "clear");
        const result = await saveAttendanceStatusAction(payload);
        if (result?.ok === false) {
          setError(result.error ?? "Unable to clear attendance.");
          return;
        }
        setOpen(false);
        setMode(null);
        router.refresh();
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : "Unable to clear attendance.";
        setError(message);
      }
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {memberPhotoUrl ? (
          <img src={memberPhotoUrl} alt={`${memberName} profile`} className="h-9 w-9 rounded-full border border-border object-cover" />
        ) : (
          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-slate-100 text-xs font-semibold text-slate-700">
            {initialsFromName(memberName)}
          </div>
        )}
        {canEdit ? (
          <button
            type="button"
            onClick={() => setOpen((current) => !current)}
            className="text-left font-semibold text-brand underline-offset-2 hover:underline"
          >
            {memberName}
          </button>
        ) : (
          <Link href={profileHref} className="font-semibold text-brand">
            {memberName}
          </Link>
        )}
      </div>

      {canEdit && open ? (
        <div className="rounded-lg border border-border bg-white p-2 text-xs shadow-sm">
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              className={`rounded-md border px-2 py-1 font-semibold ${mode === "check-in" ? "border-brand bg-brand text-white" : "border-green-600 text-green-700"}`}
              onClick={() => setMode("check-in")}
              disabled={isPending}
            >
              Check In
            </button>
            <button
              type="button"
              className={`rounded-md border px-2 py-1 font-semibold ${mode === "check-out" ? "border-brand bg-brand text-white" : "border-red-500 text-red-600"}`}
              onClick={() => setMode("check-out")}
              disabled={isPending}
            >
              Check Out
            </button>
            <button
              type="button"
              className={`rounded-md border px-2 py-1 font-semibold ${mode === "absent" ? "border-brand bg-brand text-white" : "border-amber-500 text-amber-700"}`}
              onClick={() => setMode("absent")}
              disabled={isPending}
            >
              Absent
            </button>
            <button
              type="button"
              className="rounded-md border border-border px-2 py-1 font-semibold"
              onClick={clearRecord}
              disabled={isPending}
            >
              Clear
            </button>
          </div>

          {mode === "check-in" ? (
            <div className="mt-2 flex items-center gap-2">
              <label className="font-semibold text-muted">Check-in time</label>
              <input
                type="time"
                value={checkInTime}
                onChange={(event) => setCheckInTime(event.target.value)}
                className="h-8 rounded-md border border-border px-2"
                disabled={isPending}
              />
            </div>
          ) : null}

          {mode === "check-out" ? (
            <div className="mt-2 flex items-center gap-2">
              <label className="font-semibold text-muted">Check-out time</label>
              <input
                type="time"
                value={checkOutTime}
                onChange={(event) => setCheckOutTime(event.target.value)}
                className="h-8 rounded-md border border-border px-2"
                disabled={isPending}
              />
            </div>
          ) : null}

          {mode === "absent" ? (
            <div className="mt-2 grid gap-2">
              <label className="grid gap-1">
                <span className="font-semibold text-muted">Absent reason</span>
                <select
                  value={absentReason}
                  onChange={(event) => setAbsentReason(event.target.value)}
                  className="h-8 rounded-md border border-border px-2"
                  disabled={isPending}
                >
                  <option value="">Select reason</option>
                  {ATTENDANCE_ABSENCE_REASON_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              {absentReason === "Other" ? (
                <label className="grid gap-1">
                  <span className="font-semibold text-muted">Custom reason</span>
                  <input
                    value={absentReasonOther}
                    onChange={(event) => setAbsentReasonOther(event.target.value)}
                    className="h-8 rounded-md border border-border px-2"
                    disabled={isPending}
                  />
                </label>
              ) : null}
            </div>
          ) : null}

          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              className="rounded-md bg-brand px-2 py-1 font-semibold text-white disabled:opacity-70"
              onClick={runAction}
              disabled={isPending || mode == null}
            >
              {isPending ? "Saving..." : "Save"}
            </button>
            <Link href={profileHref} className="font-semibold text-brand">
              Open Member Record
            </Link>
          </div>
          {error ? <p className="mt-1 text-xs font-semibold text-red-600">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
