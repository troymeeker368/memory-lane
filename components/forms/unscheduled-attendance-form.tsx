"use client";

import { useState } from "react";

import { saveUnscheduledAttendanceAction } from "@/app/(portal)/operations/attendance/actions";
import { UnscheduledAttendanceMemberSearchPicker } from "@/components/forms/unscheduled-attendance-member-search-picker";
import type { AttendanceMutationRecord } from "@/components/forms/attendance-member-cell";
import { useScopedMutation } from "@/components/forms/use-scoped-mutation";
import { MutationNotice } from "@/components/ui/mutation-notice";
import type { UnscheduledAttendanceMemberOption } from "@/lib/services/attendance";

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
  onSaved
}: {
  selectedDate: string;
  onSaved?: (payload: {
    record: AttendanceMutationRecord;
    member: UnscheduledAttendanceMemberOption;
  }) => void;
}) {
  const [memberId, setMemberId] = useState("");
  const [selectedMember, setSelectedMember] = useState<UnscheduledAttendanceMemberOption | null>(null);
  const [useMakeupDay, setUseMakeupDay] = useState<"yes" | "no">("no");
  const [checkInTime, setCheckInTime] = useState(currentTimeString());
  const [status, setStatus] = useState<string | null>(null);
  const { isSaving, run } = useScopedMutation();

  const currentBalance = selectedMember?.makeupBalance ?? 0;
  const projectedBalance = useMakeupDay === "yes" ? Math.max(0, currentBalance - 1) : currentBalance;

  return (
    <div className="mt-3 grid gap-2 rounded-lg border border-border p-3">
      <div className="grid gap-2 md:grid-cols-4">
        <div className="md:col-span-2">
          <UnscheduledAttendanceMemberSearchPicker
            selectedDate={selectedDate}
            value={memberId}
            onChange={(nextValue) => setMemberId(nextValue)}
            onSelectOption={(option) => setSelectedMember(option)}
          />
        </div>

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
                  setMemberId("");
                  setSelectedMember(null);
                  setUseMakeupDay("no");
                  setCheckInTime(currentTimeString());
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
