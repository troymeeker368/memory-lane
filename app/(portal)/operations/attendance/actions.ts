"use server";

import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/auth";
import { ATTENDANCE_ABSENCE_REASON_OPTIONS } from "@/lib/canonical";
import {
  addAuditLogEvent,
  addMemberMakeupLedgerEntry,
  addMockRecord,
  getMemberMakeupDayBalance,
  getMockDb,
  removeMockRecord,
  updateMockRecord
} from "@/lib/mock-repo";
import { isMemberOnHoldOnDate } from "@/lib/services/holds";
import { syncAttendanceBillingForDate } from "@/lib/services/billing";
import { isMemberScheduledForDate } from "@/lib/services/member-schedule-selectors";
import { normalizeOperationalDateOnly } from "@/lib/services/operations-calendar";
import { easternDateTimeLocalToISO, toEasternISO } from "@/lib/timezone";
import type { AppRole } from "@/types/app";

function asString(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

async function requireAttendanceEditor() {
  const profile = await getCurrentProfile();
  if (profile.role !== "admin" && profile.role !== "manager") {
    throw new Error("Only Admin/Manager can update attendance records.");
  }
  return profile;
}

function revalidateAttendanceViews() {
  revalidatePath("/");
  revalidatePath("/operations/attendance");
  revalidatePath("/operations/member-command-center");
}

function syncScheduleMakeupBalance(memberId: string, asOfDate?: string) {
  const db = getMockDb();
  const schedule = db.memberAttendanceSchedules.find((row) => row.member_id === memberId);
  if (!schedule) return;
  updateMockRecord("memberAttendanceSchedules", schedule.id, {
    make_up_days_available: getMemberMakeupDayBalance(memberId, asOfDate)
  });
}

function applyScheduledAbsenceMakeupDelta(input: {
  memberId: string;
  attendanceDate: string;
  deltaDays: number;
  actor: { id: string; full_name: string; role: AppRole };
  source: string;
  reason: string;
}) {
  const db = getMockDb();
  const schedule = db.memberAttendanceSchedules.find((row) => row.member_id === input.memberId) ?? null;
  if (!schedule || !isMemberScheduledForDate(schedule, input.attendanceDate)) return;
  if (isMemberOnHoldOnDate(input.memberId, input.attendanceDate)) return;

  // Makeup accrual/reversal is ledger-based so policy (30-day expiry vs running total) stays consistent.
  addMemberMakeupLedgerEntry({
    memberId: input.memberId,
    deltaDays: input.deltaDays,
    reason: input.reason,
    source: input.source,
    effectiveDate: input.attendanceDate,
    actorUserId: input.actor.id,
    actorName: input.actor.full_name
  });
  addAuditLogEvent({
    actorUserId: input.actor.id,
    actorName: input.actor.full_name,
    actorRole: input.actor.role,
    action: "manager_review",
    entityType: "makeup_day",
    entityId: input.memberId,
    details: {
      attendanceDate: input.attendanceDate,
      deltaDays: input.deltaDays,
      source: input.source
    }
  });
  syncScheduleMakeupBalance(input.memberId, input.attendanceDate);
}

function resolveAttendanceTimestamp(input: {
  attendanceDate: string;
  localDateTime: string;
  localTime: string;
  fallbackIso: string;
}) {
  if (input.localDateTime) {
    return easternDateTimeLocalToISO(input.localDateTime);
  }
  if (input.localTime) {
    return easternDateTimeLocalToISO(`${input.attendanceDate}T${input.localTime}`);
  }
  return input.fallbackIso;
}

export async function saveAttendanceStatusAction(formData: FormData) {
  try {
    const actor = await requireAttendanceEditor();
    const memberId = asString(formData, "memberId");
    const attendanceDate = normalizeOperationalDateOnly(asString(formData, "attendanceDate"));
    const requestedStatus = asString(formData, "status").toLowerCase();
    const absentReason = asString(formData, "absentReason");
    const absentReasonOther = asString(formData, "absentReasonOther");

    if (!memberId) {
      throw new Error("Member is required.");
    }

    if (
      requestedStatus !== "present" &&
      requestedStatus !== "absent" &&
      requestedStatus !== "clear" &&
      requestedStatus !== "check-in" &&
      requestedStatus !== "check-out"
    ) {
      throw new Error("Invalid attendance status.");
    }

    const db = getMockDb();
    const existing = db.attendanceRecords.find(
      (record) => record.member_id === memberId && record.attendance_date === attendanceDate
    );
    const existingStatus = existing?.status ?? null;

    if (requestedStatus === "clear") {
      if (existing?.linked_adjustment_id) {
        updateMockRecord("billingAdjustments", existing.linked_adjustment_id, {
          billing_status: "Excluded",
          invoice_id: null,
          updated_at: toEasternISO()
        });
      }
      if (existingStatus === "absent") {
        applyScheduledAbsenceMakeupDelta({
          memberId,
          attendanceDate,
          deltaDays: -1,
          actor,
          source: "attendance-clear-absence",
          reason: `Removed scheduled absence makeup accrual (${attendanceDate})`
        });
      }
      if (existing) {
        const removed = removeMockRecord("attendanceRecords", existing.id);
        if (!removed) {
          throw new Error("Unable to clear attendance record.");
        }
      }
      revalidateAttendanceViews();
      return { ok: true as const };
    }

    const now = toEasternISO();
    const checkInAtLocal = asString(formData, "checkInAtLocal");
    const checkOutAtLocal = asString(formData, "checkOutAtLocal");
    const checkInTime = asString(formData, "checkInTime");
    const checkOutTime = asString(formData, "checkOutTime");
    const resolvedCheckInAt = resolveAttendanceTimestamp({
      attendanceDate,
      localDateTime: checkInAtLocal,
      localTime: checkInTime,
      fallbackIso: now
    });
    const resolvedCheckOutAt = resolveAttendanceTimestamp({
      attendanceDate,
      localDateTime: checkOutAtLocal,
      localTime: checkOutTime,
      fallbackIso: now
    });

    if (requestedStatus === "check-in") {
      if (existing) {
        const updated = updateMockRecord("attendanceRecords", existing.id, {
          status: "present",
          absent_reason: null,
          absent_reason_other: null,
          check_in_at: resolvedCheckInAt,
          check_out_at: existing.check_out_at,
          updated_at: now,
          recorded_by_user_id: actor.id,
          recorded_by_name: actor.full_name
        });
        if (!updated) {
          throw new Error("Unable to save check-in.");
        }
      } else {
        const created = addMockRecord("attendanceRecords", {
          member_id: memberId,
          attendance_date: attendanceDate,
          status: "present",
          absent_reason: null,
          absent_reason_other: null,
          check_in_at: resolvedCheckInAt,
          check_out_at: null,
          notes: null,
          recorded_by_user_id: actor.id,
          recorded_by_name: actor.full_name,
          created_at: now,
          updated_at: now
        });
        if (!created) {
          throw new Error("Unable to save check-in.");
        }
      }

      if (existingStatus === "absent") {
        applyScheduledAbsenceMakeupDelta({
          memberId,
          attendanceDate,
          deltaDays: -1,
          actor,
          source: "attendance-check-in-reversal",
          reason: `Reversed scheduled absence makeup accrual (${attendanceDate})`
        });
      }

      syncAttendanceBillingForDate({
        memberId,
        attendanceDate,
        actorName: actor.full_name
      });

      revalidateAttendanceViews();
      return { ok: true as const };
    }

    if (requestedStatus === "check-out") {
      if (existing) {
        const updated = updateMockRecord("attendanceRecords", existing.id, {
          status: "present",
          absent_reason: null,
          absent_reason_other: null,
          check_in_at: existing.check_in_at,
          check_out_at: resolvedCheckOutAt,
          updated_at: now,
          recorded_by_user_id: actor.id,
          recorded_by_name: actor.full_name
        });
        if (!updated) {
          throw new Error("Unable to save check-out.");
        }
      } else {
        const created = addMockRecord("attendanceRecords", {
          member_id: memberId,
          attendance_date: attendanceDate,
          status: "present",
          absent_reason: null,
          absent_reason_other: null,
          check_in_at: null,
          check_out_at: resolvedCheckOutAt,
          notes: null,
          recorded_by_user_id: actor.id,
          recorded_by_name: actor.full_name,
          created_at: now,
          updated_at: now
        });
        if (!created) {
          throw new Error("Unable to save check-out.");
        }
      }

      if (existingStatus === "absent") {
        applyScheduledAbsenceMakeupDelta({
          memberId,
          attendanceDate,
          deltaDays: -1,
          actor,
          source: "attendance-check-out-reversal",
          reason: `Reversed scheduled absence makeup accrual (${attendanceDate})`
        });
      }

      syncAttendanceBillingForDate({
        memberId,
        attendanceDate,
        actorName: actor.full_name
      });

      revalidateAttendanceViews();
      return { ok: true as const };
    }

    if (requestedStatus === "absent") {
      if (!absentReason || !ATTENDANCE_ABSENCE_REASON_OPTIONS.includes(absentReason as (typeof ATTENDANCE_ABSENCE_REASON_OPTIONS)[number])) {
        throw new Error("Absent reason is required.");
      }
      if (absentReason === "Other" && !absentReasonOther.trim()) {
        throw new Error("Custom absent reason is required when Other is selected.");
      }
    }

    if (existing) {
      const updated = updateMockRecord("attendanceRecords", existing.id, {
        status: requestedStatus,
        absent_reason: requestedStatus === "absent" ? absentReason : null,
        absent_reason_other: requestedStatus === "absent" && absentReason === "Other" ? absentReasonOther.trim() : null,
        check_in_at: requestedStatus === "present" ? existing.check_in_at ?? now : null,
        check_out_at: requestedStatus === "present" ? existing.check_out_at : null,
        updated_at: now,
        recorded_by_user_id: actor.id,
        recorded_by_name: actor.full_name
      });
      if (!updated) {
        throw new Error("Unable to update attendance.");
      }
    } else {
      const created = addMockRecord("attendanceRecords", {
        member_id: memberId,
        attendance_date: attendanceDate,
        status: requestedStatus,
        absent_reason: requestedStatus === "absent" ? absentReason : null,
        absent_reason_other: requestedStatus === "absent" && absentReason === "Other" ? absentReasonOther.trim() : null,
        check_in_at: requestedStatus === "present" ? now : null,
        check_out_at: null,
        notes: null,
        recorded_by_user_id: actor.id,
        recorded_by_name: actor.full_name,
        created_at: now,
        updated_at: now
      });
      if (!created) {
        throw new Error("Unable to create attendance record.");
      }
    }

    if (requestedStatus === "absent" && existingStatus !== "absent") {
      applyScheduledAbsenceMakeupDelta({
        memberId,
        attendanceDate,
        deltaDays: 1,
        actor,
        source: "attendance-absence-accrual",
        reason: `Scheduled absence accrued makeup day (${attendanceDate})`
      });
    } else if (requestedStatus === "present" && existingStatus === "absent") {
      applyScheduledAbsenceMakeupDelta({
        memberId,
        attendanceDate,
        deltaDays: -1,
        actor,
        source: "attendance-present-reversal",
        reason: `Reversed scheduled absence makeup accrual (${attendanceDate})`
      });
    }

    syncAttendanceBillingForDate({
      memberId,
      attendanceDate,
      actorName: actor.full_name
    });

    revalidateAttendanceViews();
    return { ok: true as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save attendance.";
    console.error("[Attendance] saveAttendanceStatusAction failed", {
      message,
      memberId: asString(formData, "memberId"),
      attendanceDate: asString(formData, "attendanceDate"),
      status: asString(formData, "status")
    });
    return { ok: false as const, error: message };
  }
}

export async function saveUnscheduledAttendanceAction(formData: FormData) {
  try {
    const actor = await requireAttendanceEditor();
    const memberId = asString(formData, "memberId");
    const attendanceDate = normalizeOperationalDateOnly(asString(formData, "attendanceDate"));
    const useMakeupDay = asString(formData, "useMakeupDay").toLowerCase() === "yes";
    const checkInTime = asString(formData, "checkInTime");

    if (!memberId) {
      throw new Error("Member is required.");
    }

    const db = getMockDb();
    const member = db.members.find((row) => row.id === memberId);
    if (!member || member.status !== "active") {
      throw new Error("Active member not found.");
    }

    if (isMemberOnHoldOnDate(memberId, attendanceDate)) {
      throw new Error("Member is on hold for this date.");
    }

    const schedule = db.memberAttendanceSchedules.find((row) => row.member_id === memberId) ?? null;
    if (schedule && isMemberScheduledForDate(schedule, attendanceDate)) {
      throw new Error("Member is already scheduled on this date. Use the Daily Attendance roster.");
    }

    const now = toEasternISO();
    const resolvedCheckInAt = resolveAttendanceTimestamp({
      attendanceDate,
      localDateTime: "",
      localTime: checkInTime,
      fallbackIso: now
    });

    const existing = db.attendanceRecords.find(
      (record) => record.member_id === memberId && record.attendance_date === attendanceDate
    );
    if (existing) {
      const updated = updateMockRecord("attendanceRecords", existing.id, {
        status: "present",
        absent_reason: null,
        absent_reason_other: null,
        check_in_at: existing.check_in_at ?? resolvedCheckInAt,
        check_out_at: existing.check_out_at,
        updated_at: now,
        recorded_by_user_id: actor.id,
        recorded_by_name: actor.full_name
      });
      if (!updated) {
        throw new Error("Unable to update unscheduled attendance.");
      }
    } else {
      const created = addMockRecord("attendanceRecords", {
        member_id: memberId,
        attendance_date: attendanceDate,
        status: "present",
        absent_reason: null,
        absent_reason_other: null,
        check_in_at: resolvedCheckInAt,
        check_out_at: null,
        notes: "Unscheduled attendance",
        recorded_by_user_id: actor.id,
        recorded_by_name: actor.full_name,
        created_at: now,
        updated_at: now
      });
      if (!created) {
        throw new Error("Unable to save unscheduled attendance.");
      }
    }

    if (useMakeupDay) {
      const currentBalance = getMemberMakeupDayBalance(memberId, attendanceDate);
      if (currentBalance < 1) {
        throw new Error("No makeup days are currently available for this member.");
      }
      addMemberMakeupLedgerEntry({
        memberId,
        deltaDays: -1,
        reason: `Used makeup day for unscheduled attendance (${attendanceDate})`,
        source: "unscheduled-attendance",
        effectiveDate: attendanceDate,
        actorUserId: actor.id,
        actorName: actor.full_name
      });
      addAuditLogEvent({
        actorUserId: actor.id,
        actorName: actor.full_name,
        actorRole: actor.role,
        action: "manager_review",
        entityType: "makeup_day",
        entityId: memberId,
        details: {
          memberId,
          attendanceDate,
          deltaDays: -1,
          source: "unscheduled-attendance"
        }
      });
    }

    syncScheduleMakeupBalance(memberId, attendanceDate);
    syncAttendanceBillingForDate({
      memberId,
      attendanceDate,
      actorName: actor.full_name
    });
    revalidateAttendanceViews();
    return { ok: true as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save unscheduled attendance.";
    console.error("[Attendance] saveUnscheduledAttendanceAction failed", {
      message,
      memberId: asString(formData, "memberId"),
      attendanceDate: asString(formData, "attendanceDate")
    });
    return { ok: false as const, error: message };
  }
}
