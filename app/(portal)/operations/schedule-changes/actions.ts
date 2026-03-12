"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getCurrentProfile } from "@/lib/auth";
import {
  createScheduleChangeSupabase,
  SCHEDULE_CHANGE_TYPES,
  SCHEDULE_WEEKDAY_KEYS,
  type ScheduleChangeType,
  type ScheduleChangeStatus,
  updateScheduleChangeStatusSupabase
} from "@/lib/services/schedule-changes-supabase";
import {
  ensureMemberAttendanceScheduleSupabase,
  type MemberAttendanceScheduleRow,
  updateMemberAttendanceScheduleSupabase
} from "@/lib/services/member-command-center-supabase";
import { normalizeOperationalDateOnly } from "@/lib/services/operations-calendar";

function asString(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function asNullableString(formData: FormData, key: string) {
  const value = asString(formData, key);
  return value.length > 0 ? value : null;
}

function asWeekdayArray(formData: FormData, key: string) {
  return formData
    .getAll(key)
    .map((value) => String(value ?? "").trim().toLowerCase())
    .filter((value): value is (typeof SCHEDULE_WEEKDAY_KEYS)[number] =>
      SCHEDULE_WEEKDAY_KEYS.includes(value as (typeof SCHEDULE_WEEKDAY_KEYS)[number])
    );
}

function normalizeChangeType(value: string): ScheduleChangeType {
  if (SCHEDULE_CHANGE_TYPES.includes(value as ScheduleChangeType)) return value as ScheduleChangeType;
  throw new Error("Invalid schedule change type.");
}

function normalizeStatus(value: string): ScheduleChangeStatus {
  if (value === "active" || value === "cancelled" || value === "completed") return value;
  throw new Error("Invalid schedule change status.");
}

async function requireScheduleChangeEditor() {
  const profile = await getCurrentProfile();
  if (
    profile.role !== "admin" &&
    profile.role !== "manager" &&
    profile.role !== "director" &&
    profile.role !== "coordinator"
  ) {
    throw new Error("Only Coordinator/Manager/Director/Admin can manage schedule changes.");
  }
  return profile;
}

function buildScheduleChangesHref(input?: {
  changeType?: string;
  memberId?: string;
  success?: string;
  error?: string;
}): `/operations/schedule-changes?${string}` {
  const params = new URLSearchParams();
  if (input?.changeType) params.set("changeType", input.changeType);
  if (input?.memberId) params.set("memberId", input.memberId);
  if (input?.success) params.set("success", input.success);
  if (input?.error) params.set("error", input.error);
  return `/operations/schedule-changes?${params.toString()}`;
}

function revalidateScheduleChangeWorkflows() {
  revalidatePath("/operations/schedule-changes");
  revalidatePath("/operations/attendance");
  revalidatePath("/operations/transportation-station");
  revalidatePath("/operations/transportation-station/print");
  revalidatePath("/operations/member-command-center");
}

async function applyPermanentBaseScheduleChange(input: {
  memberId: string;
  newDays: string[];
  actorUserId: string;
  actorName: string;
}) {
  const schedule = await ensureMemberAttendanceScheduleSupabase(input.memberId);
  if (!schedule) return;

  const daySet = new Set(input.newDays);
  const attendanceDaysPerWeek = SCHEDULE_WEEKDAY_KEYS.filter((day) => daySet.has(day)).length;
  await updateMemberAttendanceScheduleSupabase(schedule.id, {
    monday: daySet.has("monday"),
    tuesday: daySet.has("tuesday"),
    wednesday: daySet.has("wednesday"),
    thursday: daySet.has("thursday"),
    friday: daySet.has("friday"),
    attendance_days_per_week: attendanceDaysPerWeek,
    updated_by_user_id: input.actorUserId,
    updated_by_name: input.actorName
  });
}

function getMccScheduleDays(schedule: MemberAttendanceScheduleRow | null | undefined) {
  if (!schedule) return [] as (typeof SCHEDULE_WEEKDAY_KEYS)[number][];
  return SCHEDULE_WEEKDAY_KEYS.filter((day) => Boolean(schedule[day]));
}

export async function createScheduleChangeAction(formData: FormData) {
  const actor = await requireScheduleChangeEditor();

  const memberId = asString(formData, "memberId");
  const changeType = normalizeChangeType(asString(formData, "changeType"));
  const effectiveStartDate = normalizeOperationalDateOnly(asString(formData, "effectiveStartDate"));
  const effectiveEndDateRaw = asNullableString(formData, "effectiveEndDate");
  const submittedOriginalDays = asWeekdayArray(formData, "originalDays");
  const newDays = asWeekdayArray(formData, "newDays");
  const suspendBaseSchedule = asString(formData, "suspendBaseSchedule") === "true";
  const reason = asString(formData, "reason");
  const notes = asNullableString(formData, "notes");

  const failureHref = (message: string) =>
    buildScheduleChangesHref({
      changeType,
      memberId,
      error: message
    });

  if (!memberId) {
    redirect(failureHref("Member is required."));
  }
  if (!reason) {
    redirect(failureHref("Reason is required."));
  }

  const memberSchedule = await ensureMemberAttendanceScheduleSupabase(memberId);
  if (!memberSchedule) {
    redirect(failureHref("Unable to load member schedule from MCC."));
  }
  const mccOriginalDays = getMccScheduleDays(memberSchedule);
  const originalDays = mccOriginalDays.length > 0 ? mccOriginalDays : submittedOriginalDays;

  let effectiveEndDate = effectiveEndDateRaw ? normalizeOperationalDateOnly(effectiveEndDateRaw) : null;
  if (changeType === "Permanent Schedule Change") {
    effectiveEndDate = null;
  } else if (!effectiveEndDate) {
    effectiveEndDate = effectiveStartDate;
  }

  if (effectiveEndDate && effectiveEndDate < effectiveStartDate) {
    redirect(failureHref("Effective end date cannot be earlier than start date."));
  }

  if (changeType === "Scheduled Absence" && originalDays.length === 0) {
    redirect(failureHref("Selected member has no MCC attendance days configured."));
  }
  if (changeType === "Makeup Day" && newDays.length === 0) {
    redirect(failureHref("Makeup Day requires at least one new day."));
  }
  if (changeType === "Day Swap" && (originalDays.length === 0 || newDays.length === 0)) {
    redirect(failureHref("Day Swap requires MCC original days and at least one replacement day."));
  }
  if (
    (changeType === "Temporary Schedule Change" || changeType === "Permanent Schedule Change") &&
    newDays.length === 0
  ) {
    redirect(failureHref("Schedule changes require at least one new day."));
  }

  try {
    await createScheduleChangeSupabase({
      memberId,
      changeType,
      effectiveStartDate,
      effectiveEndDate,
      originalDays,
      newDays,
      suspendBaseSchedule,
      reason,
      notes,
      enteredBy: actor.full_name,
      enteredByUserId: actor.id
    });

    if (changeType === "Permanent Schedule Change") {
      await applyPermanentBaseScheduleChange({
        memberId,
        newDays,
        actorUserId: actor.id,
        actorName: actor.full_name
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save schedule change.";
    redirect(failureHref(message));
  }

  revalidateScheduleChangeWorkflows();
  redirect(
    buildScheduleChangesHref({
      success: "Schedule change saved."
    })
  );
}

export async function setScheduleChangeStatusAction(formData: FormData) {
  const actor = await requireScheduleChangeEditor();
  const id = asString(formData, "id");
  const status = normalizeStatus(asString(formData, "status"));
  if (!id) {
    redirect(
      buildScheduleChangesHref({
        error: "Schedule change id is required."
      })
    );
  }

  let updated: Awaited<ReturnType<typeof updateScheduleChangeStatusSupabase>> = null;
  try {
    updated = await updateScheduleChangeStatusSupabase({
      id,
      status,
      actorName: actor.full_name,
      actorUserId: actor.id
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update schedule change.";
    redirect(
      buildScheduleChangesHref({
        error: message
      })
    );
  }

  if (!updated) {
    redirect(
      buildScheduleChangesHref({
        error: "Schedule change not found."
      })
    );
  }

  revalidateScheduleChangeWorkflows();
  redirect(
    buildScheduleChangesHref({
      success: `Schedule change marked as ${status}.`
    })
  );
}
