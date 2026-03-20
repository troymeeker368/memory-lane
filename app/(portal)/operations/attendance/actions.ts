"use server";

import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/auth";
import { ATTENDANCE_ABSENCE_REASON_OPTIONS } from "@/lib/canonical";
import { resolveCanonicalMemberId } from "@/lib/services/canonical-person-ref";
import { syncAttendanceBillingForDate } from "@/lib/services/billing-workflows";
import {
  loadExpectedAttendanceSupabaseContext,
  resolveExpectedAttendanceFromSupabaseContext
} from "@/lib/services/expected-attendance-supabase";
import { ensureMemberAttendanceScheduleSupabase } from "@/lib/services/member-command-center-supabase";
import {
  applyMakeupBalanceDeltaWithAuditSupabase,
  deleteAttendanceRecordSupabase,
  getActiveMemberIdSupabase,
  getAttendanceRecordSupabase,
  setBillingAdjustmentExcludedSupabase,
  upsertAttendanceRecordSupabase,
  type AttendanceRecordRow
} from "@/lib/services/attendance-workflow-supabase";
import { normalizeOperationalDateOnly } from "@/lib/services/operations-calendar";
import { easternDateTimeLocalToISO, toEasternISO } from "@/lib/timezone";
import type { AppRole } from "@/types/app";

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
  return getAttendanceRecordSupabase(memberId, attendanceDate);
}

async function getMemberAttendanceSchedule(memberId: string) {
  const schedule = await ensureMemberAttendanceScheduleSupabase(memberId);
  if (!schedule) {
    throw new Error(`Unable to resolve attendance schedule for member ${memberId}.`);
  }
  return {
    id: schedule.id,
    member_id: schedule.member_id,
    monday: Boolean(schedule.monday),
    tuesday: Boolean(schedule.tuesday),
    wednesday: Boolean(schedule.wednesday),
    thursday: Boolean(schedule.thursday),
    friday: Boolean(schedule.friday),
    make_up_days_available: schedule.make_up_days_available ?? 0
  } satisfies AttendanceScheduleRow;
}

async function resolveMemberExpectedAttendanceForDate(input: {
  memberId: string;
  attendanceDate: string;
  hasUnscheduledAttendanceAddition?: boolean;
}) {
  const [schedule, context] = await Promise.all([
    getMemberAttendanceSchedule(input.memberId),
    loadExpectedAttendanceSupabaseContext({
      memberIds: [input.memberId],
      startDate: input.attendanceDate,
      endDate: input.attendanceDate,
      includeAttendanceRecords: false
    })
  ]);

  return {
    schedule,
    resolution: resolveExpectedAttendanceFromSupabaseContext({
      context,
      memberId: input.memberId,
      date: input.attendanceDate,
      baseScheduleOverride: schedule,
      hasUnscheduledAttendanceAddition: input.hasUnscheduledAttendanceAddition
    })
  };
}

async function applyScheduledAbsenceMakeupDelta(input: {
  memberId: string;
  attendanceDate: string;
  deltaDays: number;
  actor: { id: string; full_name: string; role: AppRole };
  source: string;
}) {
  const { schedule, resolution } = await resolveMemberExpectedAttendanceForDate({
    memberId: input.memberId,
    attendanceDate: input.attendanceDate
  });
  if (!resolution.isScheduled) return;

  await applyMakeupBalanceDeltaWithAuditSupabase({
    scheduleId: schedule.id,
    memberId: input.memberId,
    attendanceDate: input.attendanceDate,
    deltaDays: input.deltaDays,
    source: input.source,
    actor: input.actor,
    at: toEasternISO()
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
  return upsertAttendanceRecordSupabase(input);
}

export async function saveAttendanceStatusAction(formData: FormData) {
  try {
    const actor = await requireAttendanceEditor();
    const memberId = await resolveAttendanceMemberId(asString(formData, "memberId"), "saveAttendanceStatusAction");
    const attendanceDate = normalizeOperationalDateOnly(asString(formData, "attendanceDate"));
    const requestedStatus = asString(formData, "status").toLowerCase();
    const absentReason = asString(formData, "absentReason");
    const absentReasonOther = asString(formData, "absentReasonOther");

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
        await setBillingAdjustmentExcludedSupabase({
          id: existing.linked_adjustment_id,
          updatedAt: now
        });
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
        await deleteAttendanceRecordSupabase(existing.id);
      }

      revalidateAttendanceViews(memberId);
      return { ok: true as const, record: toAttendanceMutationPayload(null, memberId, attendanceDate) };
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
      const updated = await upsertAttendanceRecord({
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

      revalidateAttendanceViews(memberId);
      return { ok: true as const, record: toAttendanceMutationPayload(updated, memberId, attendanceDate) };
    }

    if (requestedStatus === "check-out") {
      const updated = await upsertAttendanceRecord({
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

      revalidateAttendanceViews(memberId);
      return { ok: true as const, record: toAttendanceMutationPayload(updated, memberId, attendanceDate) };
    }

    if (requestedStatus === "absent") {
      if (!absentReason || !ATTENDANCE_ABSENCE_REASON_OPTIONS.includes(absentReason as (typeof ATTENDANCE_ABSENCE_REASON_OPTIONS)[number])) {
        throw new Error("Absent reason is required.");
      }
      if (absentReason === "Other" && !absentReasonOther.trim()) {
        throw new Error("Custom absent reason is required when Other is selected.");
      }
    }

    const updated = await upsertAttendanceRecord({
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

    revalidateAttendanceViews(memberId);
    return { ok: true as const, record: toAttendanceMutationPayload(updated, memberId, attendanceDate) };
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
    const useMakeupDay = asString(formData, "useMakeupDay").toLowerCase() === "yes";
    const checkInTime = asString(formData, "checkInTime");

    const activeMemberId = await getActiveMemberIdSupabase(memberId);
    if (!activeMemberId) {
      throw new Error("Active member not found.");
    }

    const { schedule, resolution } = await resolveMemberExpectedAttendanceForDate({
      memberId,
      attendanceDate
    });
    if (resolution.blockedBy === "member-hold") {
      throw new Error("Member is on hold for this date.");
    }
    if (resolution.blockedBy === "center-closure") {
      throw new Error("Center is closed for this date.");
    }
    if (resolution.isScheduled) {
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
    const updated = await upsertAttendanceRecord({
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
      await applyMakeupBalanceDeltaWithAuditSupabase({
        scheduleId: schedule.id,
        memberId,
        attendanceDate,
        deltaDays: -1,
        source: "unscheduled-attendance",
        actor,
        at: now,
        failIfInsufficient: true
      });
    }

    await syncAttendanceBillingForDate({
      memberId,
      attendanceDate,
      actorName: actor.full_name
    });
    revalidateAttendanceViews(memberId);
    return {
      ok: true as const,
      record: toAttendanceMutationPayload(updated, memberId, attendanceDate)
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
