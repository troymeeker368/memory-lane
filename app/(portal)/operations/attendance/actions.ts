"use server";

import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/auth";
import { ATTENDANCE_ABSENCE_REASON_OPTIONS } from "@/lib/canonical";
import { addMockRecord, getMockDb, removeMockRecord, updateMockRecord } from "@/lib/mock-repo";
import { normalizeOperationalDateOnly } from "@/lib/services/operations-calendar";
import { easternDateTimeLocalToISO, toEasternISO } from "@/lib/timezone";

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

    if (requestedStatus === "clear") {
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
