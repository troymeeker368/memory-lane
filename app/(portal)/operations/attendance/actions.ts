"use server";

import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/auth";
import { ATTENDANCE_ABSENCE_REASON_OPTIONS } from "@/lib/canonical";
import { syncAttendanceBillingForDate } from "@/lib/services/billing-supabase";
import { isMemberScheduledForDate } from "@/lib/services/member-schedule-selectors";
import { normalizeOperationalDateOnly } from "@/lib/services/operations-calendar";
import { createClient } from "@/lib/supabase/server";
import { easternDateTimeLocalToISO, toEasternISO } from "@/lib/timezone";
import type { AppRole } from "@/types/app";

function asString(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function isUuid(value: string | null | undefined) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value ?? ""));
}

function actorUserIdOrNull(value: string | null | undefined) {
  return isUuid(value) ? String(value) : null;
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

type AttendanceRecordRow = {
  id: string;
  member_id: string;
  attendance_date: string;
  status: "present" | "absent";
  absent_reason: string | null;
  absent_reason_other: string | null;
  check_in_at: string | null;
  check_out_at: string | null;
  linked_adjustment_id: string | null;
};

type AttendanceScheduleRow = {
  id: string;
  member_id: string;
  monday: boolean;
  tuesday: boolean;
  wednesday: boolean;
  thursday: boolean;
  friday: boolean;
  make_up_days_available: number | null;
};

async function getAttendanceRecord(memberId: string, attendanceDate: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("attendance_records")
    .select("id, member_id, attendance_date, status, absent_reason, absent_reason_other, check_in_at, check_out_at, linked_adjustment_id")
    .eq("member_id", memberId)
    .eq("attendance_date", attendanceDate)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as AttendanceRecordRow | null) ?? null;
}

async function getMemberAttendanceSchedule(memberId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("member_attendance_schedules")
    .select("id, member_id, monday, tuesday, wednesday, thursday, friday, make_up_days_available")
    .eq("member_id", memberId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as AttendanceScheduleRow | null) ?? null;
}

async function isMemberOnHoldOnDate(memberId: string, attendanceDate: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("member_holds")
    .select("id")
    .eq("member_id", memberId)
    .eq("status", "active")
    .lte("start_date", attendanceDate)
    .or(`end_date.is.null,end_date.gte.${attendanceDate}`)
    .limit(1);
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

async function recordMakeupAuditLog(input: {
  memberId: string;
  attendanceDate: string;
  deltaDays: number;
  source: string;
  actorUserId: string | null;
  actorRole: AppRole;
}) {
  const supabase = await createClient();
  const { error } = await supabase.from("audit_logs").insert({
    actor_user_id: input.actorUserId,
    actor_role: input.actorRole,
    action: "manager_review",
    entity_type: "makeup_day",
    entity_id: input.memberId,
    details: {
      attendanceDate: input.attendanceDate,
      deltaDays: input.deltaDays,
      source: input.source
    }
  });
  if (error) {
    console.warn("[Attendance] Unable to write makeup audit log", {
      message: error.message,
      memberId: input.memberId,
      attendanceDate: input.attendanceDate
    });
  }
}

async function applyScheduledAbsenceMakeupDelta(input: {
  memberId: string;
  attendanceDate: string;
  deltaDays: number;
  actor: { id: string; full_name: string; role: AppRole };
  source: string;
}) {
  const schedule = await getMemberAttendanceSchedule(input.memberId);
  if (!schedule || !isMemberScheduledForDate(schedule as any, input.attendanceDate)) return;
  if (await isMemberOnHoldOnDate(input.memberId, input.attendanceDate)) return;

  const currentBalance = Math.max(0, Number(schedule.make_up_days_available ?? 0));
  const nextBalance = Math.max(0, currentBalance + input.deltaDays);
  if (nextBalance === currentBalance) return;

  const now = toEasternISO();
  const supabase = await createClient();
  const { error } = await supabase
    .from("member_attendance_schedules")
    .update({
      make_up_days_available: nextBalance,
      updated_by_user_id: actorUserIdOrNull(input.actor.id),
      updated_by_name: input.actor.full_name,
      updated_at: now
    })
    .eq("id", schedule.id);
  if (error) throw new Error(error.message);

  await recordMakeupAuditLog({
    memberId: input.memberId,
    attendanceDate: input.attendanceDate,
    deltaDays: input.deltaDays,
    source: input.source,
    actorUserId: actorUserIdOrNull(input.actor.id),
    actorRole: input.actor.role
  });
}

async function upsertAttendanceRecord(input: {
  existing: AttendanceRecordRow | null;
  memberId: string;
  attendanceDate: string;
  status: "present" | "absent";
  absentReason: string | null;
  absentReasonOther: string | null;
  checkInAt: string | null;
  checkOutAt: string | null;
  notes: string | null;
  actor: { id: string; full_name: string };
  at: string;
}) {
  const supabase = await createClient();
  if (input.existing) {
    const { data, error } = await supabase
      .from("attendance_records")
      .update({
        status: input.status,
        absent_reason: input.absentReason,
        absent_reason_other: input.absentReasonOther,
        check_in_at: input.checkInAt,
        check_out_at: input.checkOutAt,
        notes: input.notes,
        recorded_by_user_id: actorUserIdOrNull(input.actor.id),
        recorded_by_name: input.actor.full_name,
        updated_at: input.at
      })
      .eq("id", input.existing.id)
      .select("id, member_id, attendance_date, status, absent_reason, absent_reason_other, check_in_at, check_out_at, linked_adjustment_id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as AttendanceRecordRow | null) ?? null;
  }

  const { data, error } = await supabase
    .from("attendance_records")
    .insert({
      member_id: input.memberId,
      attendance_date: input.attendanceDate,
      status: input.status,
      absent_reason: input.absentReason,
      absent_reason_other: input.absentReasonOther,
      check_in_at: input.checkInAt,
      check_out_at: input.checkOutAt,
      notes: input.notes,
      recorded_by_user_id: actorUserIdOrNull(input.actor.id),
      recorded_by_name: input.actor.full_name,
      created_at: input.at,
      updated_at: input.at
    })
    .select("id, member_id, attendance_date, status, absent_reason, absent_reason_other, check_in_at, check_out_at, linked_adjustment_id")
    .single();
  if (error) throw new Error(error.message);
  return data as AttendanceRecordRow;
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

    const existing = await getAttendanceRecord(memberId, attendanceDate);
    const existingStatus = existing?.status ?? null;

    if (requestedStatus === "clear") {
      const now = toEasternISO();
      if (existing?.linked_adjustment_id) {
        const supabase = await createClient();
        const { error } = await supabase
          .from("billing_adjustments")
          .update({
            billing_status: "Excluded",
            invoice_id: null,
            updated_at: now
          })
          .eq("id", existing.linked_adjustment_id);
        if (error) throw new Error(error.message);
      }

      if (existingStatus === "absent") {
        await applyScheduledAbsenceMakeupDelta({
          memberId,
          attendanceDate,
          deltaDays: -1,
          actor,
          source: "attendance-clear-absence"
        });
      }

      if (existing) {
        const supabase = await createClient();
        const { error } = await supabase.from("attendance_records").delete().eq("id", existing.id);
        if (error) throw new Error(error.message);
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
      await upsertAttendanceRecord({
        existing,
        memberId,
        attendanceDate,
        status: "present",
        absentReason: null,
        absentReasonOther: null,
        checkInAt: resolvedCheckInAt,
        checkOutAt: existing?.check_out_at ?? null,
        notes: existing ? null : null,
        actor,
        at: now
      });

      if (existingStatus === "absent") {
        await applyScheduledAbsenceMakeupDelta({
          memberId,
          attendanceDate,
          deltaDays: -1,
          actor,
          source: "attendance-check-in-reversal"
        });
      }

      await syncAttendanceBillingForDate({
        memberId,
        attendanceDate,
        actorName: actor.full_name
      });

      revalidateAttendanceViews();
      return { ok: true as const };
    }

    if (requestedStatus === "check-out") {
      await upsertAttendanceRecord({
        existing,
        memberId,
        attendanceDate,
        status: "present",
        absentReason: null,
        absentReasonOther: null,
        checkInAt: existing?.check_in_at ?? null,
        checkOutAt: resolvedCheckOutAt,
        notes: existing ? null : null,
        actor,
        at: now
      });

      if (existingStatus === "absent") {
        await applyScheduledAbsenceMakeupDelta({
          memberId,
          attendanceDate,
          deltaDays: -1,
          actor,
          source: "attendance-check-out-reversal"
        });
      }

      await syncAttendanceBillingForDate({
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

    await upsertAttendanceRecord({
      existing,
      memberId,
      attendanceDate,
      status: requestedStatus,
      absentReason: requestedStatus === "absent" ? absentReason : null,
      absentReasonOther: requestedStatus === "absent" && absentReason === "Other" ? absentReasonOther.trim() : null,
      checkInAt: requestedStatus === "present" ? existing?.check_in_at ?? now : null,
      checkOutAt: requestedStatus === "present" ? existing?.check_out_at ?? null : null,
      notes: existing?.status === "present" ? null : existing?.status === "absent" ? null : null,
      actor,
      at: now
    });

    if (requestedStatus === "absent" && existingStatus !== "absent") {
      await applyScheduledAbsenceMakeupDelta({
        memberId,
        attendanceDate,
        deltaDays: 1,
        actor,
        source: "attendance-absence-accrual"
      });
    } else if (requestedStatus === "present" && existingStatus === "absent") {
      await applyScheduledAbsenceMakeupDelta({
        memberId,
        attendanceDate,
        deltaDays: -1,
        actor,
        source: "attendance-present-reversal"
      });
    }

    await syncAttendanceBillingForDate({
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

    const supabase = await createClient();
    const { data: member, error: memberError } = await supabase
      .from("members")
      .select("id, status")
      .eq("id", memberId)
      .eq("status", "active")
      .maybeSingle();
    if (memberError) throw new Error(memberError.message);
    if (!member) {
      throw new Error("Active member not found.");
    }

    if (await isMemberOnHoldOnDate(memberId, attendanceDate)) {
      throw new Error("Member is on hold for this date.");
    }

    const schedule = await getMemberAttendanceSchedule(memberId);
    if (schedule && isMemberScheduledForDate(schedule as any, attendanceDate)) {
      throw new Error("Member is already scheduled on this date. Use the Daily Attendance roster.");
    }

    const now = toEasternISO();
    const resolvedCheckInAt = resolveAttendanceTimestamp({
      attendanceDate,
      localDateTime: "",
      localTime: checkInTime,
      fallbackIso: now
    });

    const existing = await getAttendanceRecord(memberId, attendanceDate);
    await upsertAttendanceRecord({
      existing,
      memberId,
      attendanceDate,
      status: "present",
      absentReason: null,
      absentReasonOther: null,
      checkInAt: existing?.check_in_at ?? resolvedCheckInAt,
      checkOutAt: existing?.check_out_at ?? null,
      notes: "Unscheduled attendance",
      actor,
      at: now
    });

    if (useMakeupDay) {
      if (!schedule) {
        throw new Error("No attendance schedule found to apply makeup day balance.");
      }

      const currentBalance = Math.max(0, Number(schedule.make_up_days_available ?? 0));
      if (currentBalance < 1) {
        throw new Error("No makeup days are currently available for this member.");
      }

      const { error: scheduleError } = await supabase
        .from("member_attendance_schedules")
        .update({
          make_up_days_available: currentBalance - 1,
          updated_by_user_id: actorUserIdOrNull(actor.id),
          updated_by_name: actor.full_name,
          updated_at: now
        })
        .eq("id", schedule.id);
      if (scheduleError) throw new Error(scheduleError.message);

      await recordMakeupAuditLog({
        memberId,
        attendanceDate,
        deltaDays: -1,
        source: "unscheduled-attendance",
        actorUserId: actorUserIdOrNull(actor.id),
        actorRole: actor.role
      });
    }

    await syncAttendanceBillingForDate({
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
