"use server";

import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/auth";
import { resolveCanonicalMemberId } from "@/lib/services/canonical-person-ref";
import {
  saveAttendanceStatusWorkflowSupabase,
  saveUnscheduledAttendanceWorkflowSupabase,
  type AttendanceRecordRow
} from "@/lib/services/attendance-workflow-supabase";
import { normalizeOperationalDateOnly } from "@/lib/services/operations-calendar";

function asString(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

async function resolveAttendanceMemberId(rawMemberId: string, actionLabel: string) {
  return resolveCanonicalMemberId(rawMemberId, { actionLabel });
}

async function requireAttendanceEditor() {
  const profile = await getCurrentProfile();
  if (profile.role !== "admin" && profile.role !== "manager") {
    throw new Error("Only Admin/Manager can update attendance records.");
  }
  return profile;
}

function revalidateAttendanceViews(memberId: string) {
  revalidatePath("/");
  revalidatePath("/operations/attendance");
  revalidatePath("/operations/member-command-center");
  revalidatePath(`/operations/member-command-center/${memberId}`);
}

function toAttendanceStatusLabel(record: AttendanceRecordRow | null) {
  if (!record) return "Not Checked In Yet" as const;
  if (record.status === "absent") return "Absent" as const;
  if (record.check_out_at) return "Checked Out" as const;
  return "Present" as const;
}

function toAttendanceMutationPayload(record: AttendanceRecordRow | null, memberId: string, attendanceDate: string) {
  return {
    memberId,
    attendanceDate,
    attendanceRecordId: record?.id ?? null,
    attendanceStatus: toAttendanceStatusLabel(record),
    recordStatus: record?.status ?? null,
    absentReason: record?.absent_reason ?? null,
    absentReasonOther: record?.absent_reason_other ?? null,
    checkInAt: record?.check_in_at ?? null,
    checkOutAt: record?.check_out_at ?? null
  };
}

export async function saveAttendanceStatusAction(formData: FormData) {
  try {
    const actor = await requireAttendanceEditor();
    const memberId = await resolveAttendanceMemberId(asString(formData, "memberId"), "saveAttendanceStatusAction");
    const attendanceDate = normalizeOperationalDateOnly(asString(formData, "attendanceDate"));
    const record = await saveAttendanceStatusWorkflowSupabase({
      memberId,
      attendanceDate,
      requestedStatus: asString(formData, "status"),
      absentReason: asString(formData, "absentReason"),
      absentReasonOther: asString(formData, "absentReasonOther"),
      checkInAtLocal: asString(formData, "checkInAtLocal"),
      checkOutAtLocal: asString(formData, "checkOutAtLocal"),
      checkInTime: asString(formData, "checkInTime"),
      checkOutTime: asString(formData, "checkOutTime"),
      actor
    });

    revalidateAttendanceViews(memberId);
    return {
      ok: true as const,
      record: toAttendanceMutationPayload(record, memberId, attendanceDate)
    };
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
    const memberId = await resolveAttendanceMemberId(asString(formData, "memberId"), "saveUnscheduledAttendanceAction");
    const attendanceDate = normalizeOperationalDateOnly(asString(formData, "attendanceDate"));
    const record = await saveUnscheduledAttendanceWorkflowSupabase({
      memberId,
      attendanceDate,
      useMakeupDay: asString(formData, "useMakeupDay").toLowerCase() === "yes",
      checkInTime: asString(formData, "checkInTime"),
      actor
    });

    revalidateAttendanceViews(memberId);
    return {
      ok: true as const,
      record: toAttendanceMutationPayload(record, memberId, attendanceDate)
    };
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
