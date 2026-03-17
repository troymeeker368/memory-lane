"use client";

import { useMemo, useState } from "react";

import { saveUnscheduledAttendanceAction } from "@/app/(portal)/operations/attendance/actions";
import type { AttendanceMutationRecord } from "@/components/forms/attendance-member-cell";
import { useScopedMutation } from "@/components/forms/use-scoped-mutation";
import { MutationNotice } from "@/components/ui/mutation-notice";

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

export function UnscheduledAttendanceForm({
  selectedDate,
  members,
  onSaved
}: {
  selectedDate: string;
  members: Array<{ id: string; displayName: string; makeupBalance: number }>;
  onSaved?: (payload: {
    record: AttendanceMutationRecord;
    member: { id: string; displayName: string; makeupBalance: number };
  }) => void;
}) {
  const [memberId, setMemberId] = useState(members[0]?.id ?? "");
  const [useMakeupDay, setUseMakeupDay] = useState<"yes" | "no">("no");
  const [checkInTime, setCheckInTime] = useState(currentTimeString());
  const [status, setStatus] = useState<string | null>(null);
  const { isSaving, run } = useScopedMutation();

  const selectedMember = useMemo(
    () => members.find((member) => member.id === memberId) ?? null,
    [members, memberId]
  );
  const currentBalance = selectedMember?.makeupBalance ?? 0;
  const projectedBalance = useMakeupDay === "yes" ? Math.max(0, currentBalance - 1) : currentBalance;

  return (
    <div className="mt-3 grid gap-2 rounded-lg border border-border p-3">
      <div className="grid gap-2 md:grid-cols-4">
        <label className="space-y-1 text-sm md:col-span-2">
          <span className="text-xs font-semibold text-muted">Member</span>
          <select
            value={memberId}
            onChange={(event) => setMemberId(event.target.value)}
            className="h-10 w-full rounded-lg border border-border px-3"
          >
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.displayName}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-sm">
          <span className="text-xs font-semibold text-muted">Use makeup day?</span>
          <select
            value={useMakeupDay}
            onChange={(event) => setUseMakeupDay(event.target.value === "yes" ? "yes" : "no")}
            className="h-10 w-full rounded-lg border border-border px-3"
          >
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </select>
        </label>

        <label className="space-y-1 text-sm">
          <span className="text-xs font-semibold text-muted">Check-In Time</span>
          <input
            type="time"
            value={checkInTime}
            onChange={(event) => setCheckInTime(event.target.value)}
            className="h-10 w-full rounded-lg border border-border px-3"
          />
        </label>
      </div>

      <p className="text-xs text-muted">
        Makeup balance effect: {currentBalance} {">"} {projectedBalance}
      </p>

      <div>
        <button
          type="button"
          disabled={isSaving || !memberId}
          onClick={() =>
            void run(
              async () => {
                const payload = new FormData();
                payload.set("memberId", memberId);
                payload.set("attendanceDate", selectedDate);
                payload.set("checkInTime", checkInTime || currentTimeString());
                payload.set("useMakeupDay", useMakeupDay);
                return saveUnscheduledAttendanceAction(payload);
              },
              {
                successMessage: "Unscheduled attendance saved.",
                fallbackData: {
                  record: {
                    memberId,
                    attendanceDate: selectedDate,
                    attendanceRecordId: null,
                    attendanceStatus: "Present" as const,
                    recordStatus: "present" as const,
                    absentReason: null,
                    absentReasonOther: null,
                    checkInAt: null,
                    checkOutAt: null
                  }
                },
                onSuccess: async (result) => {
                  if (selectedMember) {
                    onSaved?.({
                      record: result.data.record,
                      member: {
                        id: selectedMember.id,
                        displayName: selectedMember.displayName,
                        makeupBalance: projectedBalance
                      }
                    });
                  }
                  setStatus(result.message);
                },
                onError: async (result) => {
                  setStatus(`Error: ${result.error}`);
                }
              }
            )
          }
          className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white disabled:opacity-70"
        >
          {isSaving ? "Saving..." : "Save Unscheduled Attendance"}
        </button>
      </div>
      <MutationNotice kind={status?.startsWith("Error") ? "error" : "success"} message={status} />
    </div>
  );
}
