"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getCurrentProfile } from "@/lib/auth";
import { mutationError, mutationOk } from "@/lib/mutations/result";
import {
  ensureMemberAttendanceScheduleSupabase,
  type MemberAttendanceScheduleRow,
  updateMemberAttendanceScheduleSupabase
} from "@/lib/services/member-command-center-supabase";
import { normalizeOperationalDateOnly } from "@/lib/services/operations-calendar";
import {
  getScheduleChangeSupabase,
  createScheduleChangeSupabase,
  type ScheduleWeekdayKey,
  updateScheduleChangeStatusSupabase,
  updateScheduleChangeSupabase
} from "@/lib/services/schedule-changes-supabase";
import {
  SCHEDULE_CHANGE_STATUSES,
  SCHEDULE_CHANGE_TYPES,
  SCHEDULE_WEEKDAY_KEYS,
  type ScheduleChangeStatus,
  type ScheduleChangeType
} from "@/lib/services/schedule-changes-shared";

const optionalStringSchema = z.string().optional().or(z.literal(""));
const scheduleWeekdaySchema = z.enum(SCHEDULE_WEEKDAY_KEYS);

const upsertScheduleChangeSchema = z.object({
  id: optionalStringSchema,
  memberId: optionalStringSchema,
  changeType: z.enum(SCHEDULE_CHANGE_TYPES),
  effectiveStartDate: z.string().min(1),
  effectiveEndDate: optionalStringSchema,
  originalDays: z.array(scheduleWeekdaySchema).default([]),
  newDays: z.array(scheduleWeekdaySchema).default([]),
  suspendBaseSchedule: z.boolean().default(false),
  reason: z.string().trim().min(1),
  notes: optionalStringSchema
});

const scheduleChangeStatusSchema = z.object({
  id: z.string().trim().min(1),
  status: z.enum(SCHEDULE_CHANGE_STATUSES)
});

function normalizeWeekdays(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => String(value ?? "").trim().toLowerCase())
        .filter((value): value is ScheduleWeekdayKey =>
          SCHEDULE_WEEKDAY_KEYS.includes(value as ScheduleWeekdayKey)
        )
    )
  );
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

function revalidateScheduleChangeWorkflows(memberId?: string) {
  revalidatePath("/");
  revalidatePath("/operations");
  revalidatePath("/operations/schedule-changes");
  revalidatePath("/operations/attendance");
  revalidatePath("/operations/attendance?tab=daily-attendance");
  revalidatePath("/operations/attendance?tab=weekly-attendance");
  revalidatePath("/operations/attendance?tab=daily-census");
  revalidatePath("/operations/attendance?tab=weekly-census");
  revalidatePath("/operations/transportation-station");
  revalidatePath("/operations/transportation-station/print");
  revalidatePath("/operations/member-command-center");
  if (memberId) {
    revalidatePath(`/operations/member-command-center/${memberId}`);
  }
}

function getMccScheduleDays(schedule: MemberAttendanceScheduleRow | null | undefined) {
  if (!schedule) {
    throw new Error("Unable to load member schedule from MCC.");
  }
  return SCHEDULE_WEEKDAY_KEYS.filter((day) => Boolean(schedule[day]));
}

async function applyAttendanceScheduleDays(input: {
  memberId: string;
  days: string[];
  actorUserId: string;
  actorName: string;
}) {
  const schedule = await ensureMemberAttendanceScheduleSupabase(input.memberId);
  if (!schedule) {
    throw new Error(`Unable to resolve attendance schedule for member ${input.memberId}.`);
  }

  const daySet = new Set(input.days);
  const attendanceDaysPerWeek = SCHEDULE_WEEKDAY_KEYS.filter((day) => daySet.has(day)).length;
  const updated = await updateMemberAttendanceScheduleSupabase(schedule.id, {
    monday: daySet.has("monday"),
    tuesday: daySet.has("tuesday"),
    wednesday: daySet.has("wednesday"),
    thursday: daySet.has("thursday"),
    friday: daySet.has("friday"),
    attendance_days_per_week: attendanceDaysPerWeek,
    updated_by_user_id: input.actorUserId,
    updated_by_name: input.actorName
  });
  if (!updated) {
    throw new Error(`Unable to update attendance schedule for member ${input.memberId}.`);
  }
  return updated;
}

async function getCurrentMemberScheduleDays(memberId: string) {
  const schedule = await ensureMemberAttendanceScheduleSupabase(memberId);
  return {
    memberId,
    days: getMccScheduleDays(schedule)
  };
}

function validateScheduleChangeInput(input: {
  changeType: ScheduleChangeType;
  effectiveStartDate: string;
  effectiveEndDate: string | null;
  originalDays: ScheduleWeekdayKey[];
  newDays: ScheduleWeekdayKey[];
}) {
  if (input.effectiveEndDate && input.effectiveEndDate < input.effectiveStartDate) {
    return "Effective end date cannot be earlier than start date.";
  }

  if (input.changeType === "Scheduled Absence" && input.originalDays.length === 0) {
    return "Selected member has no MCC attendance days configured.";
  }
  if (input.changeType === "Makeup Day" && input.newDays.length === 0) {
    return "Makeup Day requires at least one new day.";
  }
  if (input.changeType === "Day Swap" && (input.originalDays.length === 0 || input.newDays.length === 0)) {
    return "Day Swap requires original days and at least one replacement day.";
  }
  if (
    (input.changeType === "Temporary Schedule Change" || input.changeType === "Permanent Schedule Change") &&
    input.newDays.length === 0
  ) {
    return "Schedule changes require at least one new day.";
  }

  return null;
}

export async function upsertScheduleChangeAction(raw: z.infer<typeof upsertScheduleChangeSchema>) {
  try {
    const actor = await requireScheduleChangeEditor();
    const payload = upsertScheduleChangeSchema.safeParse(raw);
    if (!payload.success) {
      return mutationError("Invalid schedule change input.");
    }

    const id = (payload.data.id ?? "").trim();
    const existing = id ? await getScheduleChangeSupabase(id) : null;
    if (id && !existing) {
      return mutationError("Schedule change not found.");
    }
    if (existing && existing.status !== "active") {
      return mutationError("Only active schedule changes can be edited. Completed or cancelled items stay locked as history.");
    }

    const memberId = existing?.member_id ?? (payload.data.memberId ?? "").trim();
    if (!memberId) {
      return mutationError("Member is required.", { memberId: "Member is required." });
    }

    let originalDays = normalizeWeekdays(existing?.original_days ?? payload.data.originalDays);
    if (!existing) {
      try {
        const memberSchedule = await ensureMemberAttendanceScheduleSupabase(memberId);
        const mccOriginalDays = getMccScheduleDays(memberSchedule);
        originalDays = mccOriginalDays.length > 0 ? mccOriginalDays : originalDays;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to load member schedule from MCC.";
        return mutationError(message);
      }
    }

    const effectiveStartDate = normalizeOperationalDateOnly(payload.data.effectiveStartDate);
    let effectiveEndDate = payload.data.effectiveEndDate
      ? normalizeOperationalDateOnly(payload.data.effectiveEndDate)
      : null;
    if (payload.data.changeType === "Permanent Schedule Change") {
      effectiveEndDate = null;
    } else if (!effectiveEndDate) {
      effectiveEndDate = effectiveStartDate;
    }

    const newDays =
      payload.data.changeType === "Scheduled Absence" ? [] : normalizeWeekdays(payload.data.newDays);
    const suspendBaseSchedule =
      payload.data.changeType === "Permanent Schedule Change" ? false : payload.data.suspendBaseSchedule;

    const validationError = validateScheduleChangeInput({
      changeType: payload.data.changeType,
      effectiveStartDate,
      effectiveEndDate,
      originalDays,
      newDays
    });
    if (validationError) {
      return mutationError(validationError);
    }

    const saved = existing
      ? await updateScheduleChangeSupabase({
          id: existing.id,
          memberId,
          changeType: payload.data.changeType,
          effectiveStartDate,
          effectiveEndDate,
          originalDays,
          newDays,
          suspendBaseSchedule,
          reason: payload.data.reason,
          notes: payload.data.notes || null
        })
      : await createScheduleChangeSupabase({
          memberId,
          changeType: payload.data.changeType,
          effectiveStartDate,
          effectiveEndDate,
          originalDays,
          newDays,
          suspendBaseSchedule,
          reason: payload.data.reason,
          notes: payload.data.notes || null,
          enteredBy: actor.full_name,
          enteredByUserId: actor.id
        });

    if (!saved) {
      return mutationError(existing ? "Schedule change not found." : "Unable to save schedule change.");
    }

    const wasPermanent = existing?.change_type === "Permanent Schedule Change";
    const isPermanent = saved.change_type === "Permanent Schedule Change";
    if (isPermanent) {
      await applyAttendanceScheduleDays({
        memberId,
        days: saved.new_days,
        actorUserId: actor.id,
        actorName: actor.full_name
      });
    } else if (wasPermanent) {
      await applyAttendanceScheduleDays({
        memberId,
        days: existing.original_days,
        actorUserId: actor.id,
        actorName: actor.full_name
      });
    }

    revalidateScheduleChangeWorkflows(memberId);
    const memberSchedule = await getCurrentMemberScheduleDays(memberId);
    return mutationOk(
      {
        row: saved,
        memberSchedule
      },
      existing ? "Schedule change updated." : "Schedule change saved."
    );
  } catch (error) {
    return mutationError(error instanceof Error ? error.message : "Unable to save schedule change.");
  }
}

export async function setScheduleChangeStatusAction(raw: z.infer<typeof scheduleChangeStatusSchema>) {
  try {
    const actor = await requireScheduleChangeEditor();
    const payload = scheduleChangeStatusSchema.safeParse(raw);
    if (!payload.success) {
      return mutationError("Invalid schedule change action.");
    }

    const updated = await updateScheduleChangeStatusSupabase({
      id: payload.data.id,
      status: payload.data.status as ScheduleChangeStatus,
      actorName: actor.full_name,
      actorUserId: actor.id
    });
    if (!updated) {
      return mutationError("Schedule change not found.");
    }

    revalidateScheduleChangeWorkflows(updated.member_id);
    return mutationOk(
      {
        row: updated
      },
      `Schedule change marked as ${payload.data.status}.`
    );
  } catch (error) {
    return mutationError(error instanceof Error ? error.message : "Unable to update schedule change.");
  }
}
