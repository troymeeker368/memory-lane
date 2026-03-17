"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { AttendanceMemberCell, type AttendanceMutationRecord } from "@/components/forms/attendance-member-cell";
import { UnscheduledAttendanceForm } from "@/components/forms/unscheduled-attendance-form";
import type { DailyAttendanceRow, DailyAttendanceView } from "@/lib/services/attendance";
import { EASTERN_TIME_ZONE } from "@/lib/timezone";
import { formatDate } from "@/lib/utils";

type DailyAttendanceClientRow = DailyAttendanceRow & {
  isUnscheduledRow?: boolean;
  makeupBalance?: number;
};

type UnscheduledMemberOption = {
  id: string;
  displayName: string;
  makeupBalance: number;
};

const WEEKDAY_LABELS: Record<string, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday"
};

function statusPillClass(status: string) {
  if (status === "Present") return "bg-green-100 text-green-800";
  if (status === "Checked Out") return "bg-blue-100 text-blue-800";
  if (status === "Absent") return "bg-red-100 text-red-700";
  if (status === "Not Scheduled") return "bg-slate-100 text-slate-600";
  return "bg-amber-100 text-amber-800";
}

function renderBusNumber(row: DailyAttendanceRow) {
  if (!row.transportRequired) return "-";
  if (!row.transportBusNumber) return "Unassigned";
  return `Bus ${row.transportBusNumber}`;
}

function formatTimeOnly(value: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: EASTERN_TIME_ZONE
  }).format(parsed);
}

function toTimeInputValue(value: string | null) {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: EASTERN_TIME_ZONE
  })
    .formatToParts(parsed)
    .reduce<Record<string, string>>((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});
  return `${parts.hour ?? "08"}:${parts.minute ?? "00"}`;
}

function filterRowsByQuery<T extends { memberName: string; lockerNumber: string | null }>(rows: T[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return rows;
  return rows.filter((row) => {
    return row.memberName.toLowerCase().includes(normalized) || String(row.lockerNumber ?? "").toLowerCase().includes(normalized);
  });
}

function deriveSummary(rows: DailyAttendanceClientRow[], onHoldExcludedMembers: number) {
  const presentMembers = rows.filter((row) => row.recordStatus === "present").length;
  const absentMembers = rows.filter((row) => row.recordStatus === "absent").length;
  const pendingMembers = rows.filter((row) => row.recordStatus == null).length;
  const missingCheckOutMembers = rows.filter((row) => row.recordStatus === "present" && row.checkInAt && !row.checkOutAt).length;
  const missingCheckInMembers = rows.filter((row) => row.recordStatus === "present" && row.checkOutAt && !row.checkInAt).length;

  return {
    scheduledMembers: rows.length,
    presentMembers,
    absentMembers,
    pendingMembers,
    transportMembers: rows.filter((row) => row.transportRequired).length,
    missingCheckOutMembers,
    missingCheckInMembers,
    incompleteMembers: pendingMembers + missingCheckOutMembers + missingCheckInMembers,
    onHoldExcludedMembers
  };
}

function mapAttendanceRecordOntoRow(row: DailyAttendanceClientRow, record: AttendanceMutationRecord): DailyAttendanceClientRow {
  return {
    ...row,
    attendanceRecordId: record.attendanceRecordId,
    attendanceStatus: record.attendanceStatus,
    recordStatus: record.recordStatus,
    absentReason: record.absentReason,
    absentReasonOther: record.absentReasonOther,
    checkInAt: record.checkInAt,
    checkOutAt: record.checkOutAt
  };
}

export function DailyAttendancePanel({
  dailyAttendance,
  query,
  unscheduledMembers,
  canEdit
}: {
  dailyAttendance: DailyAttendanceView;
  query: string;
  unscheduledMembers: UnscheduledMemberOption[];
  canEdit: boolean;
}) {
  const [rows, setRows] = useState<DailyAttendanceClientRow[]>(dailyAttendance.rows);
  const [unscheduledOptions, setUnscheduledOptions] = useState(unscheduledMembers);

  useEffect(() => {
    setRows(dailyAttendance.rows);
  }, [dailyAttendance.rows]);

  useEffect(() => {
    setUnscheduledOptions(unscheduledMembers);
  }, [unscheduledMembers]);

  const summary = useMemo(
    () => deriveSummary(rows, dailyAttendance.summary.onHoldExcludedMembers),
    [dailyAttendance.summary.onHoldExcludedMembers, rows]
  );
  const visibleRows = useMemo(() => filterRowsByQuery(rows, query), [query, rows]);

  function handleRowSaved(record: AttendanceMutationRecord) {
    setRows((current) => {
      const existingRow = current.find((row) => row.memberId === record.memberId);
      if (!existingRow) {
        return current;
      }
      if (record.recordStatus == null && existingRow.isUnscheduledRow) {
        return current.filter((row) => row.memberId !== record.memberId);
      }
      return current.map((row) => (row.memberId === record.memberId ? mapAttendanceRecordOntoRow(row, record) : row));
    });

    setUnscheduledOptions((current) => {
      const existingOption = current.find((member) => member.id === record.memberId);
      const unscheduledRow = rows.find((row) => row.memberId === record.memberId && row.isUnscheduledRow);
      if (record.recordStatus == null && unscheduledRow && !existingOption) {
        return [
          ...current,
          {
            id: unscheduledRow.memberId,
            displayName: unscheduledRow.memberName,
            makeupBalance: unscheduledRow.makeupBalance ?? 0
          }
        ].sort((left, right) => left.displayName.localeCompare(right.displayName));
      }
      return current;
    });
  }

  function handleUnscheduledSaved(payload: { record: AttendanceMutationRecord; member: UnscheduledMemberOption }) {
    setRows((current) => {
      const existingIndex = current.findIndex((row) => row.memberId === payload.member.id);
      if (existingIndex >= 0) {
        return current.map((row) =>
          row.memberId === payload.member.id
            ? {
                ...mapAttendanceRecordOntoRow(row, payload.record),
                isUnscheduledRow: true,
                makeupBalance: payload.member.makeupBalance
              }
            : row
        );
      }

      return [
        ...current,
        {
          memberId: payload.member.id,
          memberName: payload.member.displayName,
          photoUrl: null,
          lockerNumber: null,
          trackLabel: "Unassigned",
          scheduledDays: "Unscheduled",
          attendanceRecordId: payload.record.attendanceRecordId,
          attendanceStatus: payload.record.attendanceStatus,
          recordStatus: payload.record.recordStatus,
          absentReason: payload.record.absentReason,
          absentReasonOther: payload.record.absentReasonOther,
          checkInAt: payload.record.checkInAt,
          checkOutAt: payload.record.checkOutAt,
          transportRequired: false,
          transportType: null,
          transportBusNumber: null,
          transportLocation: null,
          isUnscheduledRow: true,
          makeupBalance: payload.member.makeupBalance
        }
      ];
    });

    setUnscheduledOptions((current) => current.filter((member) => member.id !== payload.member.id));
  }

  return (
    <>
      <div className="mt-3 grid gap-2 text-xs text-muted md:grid-cols-3">
        <p>Date: {formatDate(dailyAttendance.selectedDate)} ({WEEKDAY_LABELS[dailyAttendance.weekday]})</p>
        <p>Scheduled: {summary.scheduledMembers}</p>
        <p>Present: {summary.presentMembers}</p>
        <p>Absent: {summary.absentMembers}</p>
        <p>Not Checked In Yet: {summary.pendingMembers}</p>
        <p>Missing Check-Out: {summary.missingCheckOutMembers}</p>
        <p>Missing Check-In: {summary.missingCheckInMembers}</p>
        <p>Incomplete Total: {summary.incompleteMembers}</p>
        <p>Transportation Needed: {summary.transportMembers}</p>
        <p>On-Hold Excluded: {summary.onHoldExcludedMembers}</p>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        <Link
          href={`/operations/transportation-station?date=${dailyAttendance.selectedDate}&shift=Both&bus=all`}
          className="font-semibold text-brand"
        >
          Open Transportation Station for This Date
        </Link>
        {canEdit ? <p className="text-xs text-muted">Click a member name to check in, check out, or mark absent.</p> : null}
      </div>

      {canEdit ? (
        <div className="mt-3">
          <p className="text-sm font-semibold text-primary-text">Unscheduled Day Add</p>
          {unscheduledOptions.length === 0 ? (
            <p className="mt-1 text-xs text-muted">All active members are already scheduled (or on hold) for this date.</p>
          ) : (
            <UnscheduledAttendanceForm selectedDate={dailyAttendance.selectedDate} members={unscheduledOptions} onSaved={handleUnscheduledSaved} />
          )}
        </div>
      ) : null}

      <table className="mt-3">
        <thead>
          <tr>
            <th>Member</th>
            <th>Attendance Status</th>
            <th>Check-In</th>
            <th>Check-Out</th>
            <th>Bus #</th>
            <th>Absent Reason</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.length === 0 ? (
            <tr>
              <td colSpan={6} className="text-sm text-muted">No scheduled members match this date/filter.</td>
            </tr>
          ) : (
            visibleRows.map((row) => (
              <tr key={`${row.memberId}:${dailyAttendance.selectedDate}`}>
                <td>
                  <AttendanceMemberCell
                    memberId={row.memberId}
                    memberName={row.memberName}
                    memberPhotoUrl={row.photoUrl}
                    attendanceDate={dailyAttendance.selectedDate}
                    canEdit={canEdit}
                    defaultCheckInTime={toTimeInputValue(row.checkInAt)}
                    defaultCheckOutTime={toTimeInputValue(row.checkOutAt)}
                    defaultAbsentReason={row.recordStatus === "absent" ? row.absentReason : null}
                    defaultAbsentReasonOther={row.recordStatus === "absent" ? row.absentReasonOther : null}
                    onSaved={handleRowSaved}
                  />
                </td>
                <td>
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${statusPillClass(row.attendanceStatus)}`}>
                    {row.attendanceStatus}
                  </span>
                </td>
                <td>{formatTimeOnly(row.checkInAt)}</td>
                <td>{formatTimeOnly(row.checkOutAt)}</td>
                <td>{renderBusNumber(row)}</td>
                <td>
                  {row.recordStatus === "absent"
                    ? row.absentReason === "Other"
                      ? row.absentReasonOther || "Other"
                      : row.absentReason || "-"
                    : "-"}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </>
  );
}
