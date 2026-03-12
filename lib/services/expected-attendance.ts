import {
  getWeekdayForDate,
  normalizeOperationalDateOnly,
  type OperationsWeekdayKey
} from "@/lib/services/operations-calendar";
import {
  SCHEDULE_WEEKDAY_KEYS,
  type ScheduleChangeRow,
  type ScheduleWeekdayKey
} from "@/lib/services/schedule-changes-supabase";

export interface AttendanceWeekdayScheduleShape {
  monday: boolean;
  tuesday: boolean;
  wednesday: boolean;
  thursday: boolean;
  friday: boolean;
}

export interface MemberHoldLike {
  start_date: string;
  end_date: string | null;
  status: string;
}

export interface CenterClosureLike {
  closure_date: string;
  active?: boolean | null;
}

export interface ExpectedAttendanceResolution {
  date: string;
  weekday: OperationsWeekdayKey;
  isScheduled: boolean;
  scheduledFromSchedule: boolean;
  blockedBy: "center-closure" | "member-hold" | null;
  source:
    | "center-closure"
    | "member-hold"
    | "schedule-change"
    | "base-schedule"
    | "unscheduled-addition"
    | "not-scheduled";
  effectiveDays: ScheduleWeekdayKey[];
  appliedChangeIds: string[];
}

function isDateWithinRange(input: {
  date: string;
  startDate: string;
  endDate: string | null;
}) {
  if (input.date < input.startDate) return false;
  if (input.endDate && input.date > input.endDate) return false;
  return true;
}

function sortChangesForEvaluation(changes: ScheduleChangeRow[]) {
  return [...changes].sort((left, right) => {
    const byStart = left.effective_start_date.localeCompare(right.effective_start_date);
    if (byStart !== 0) return byStart;
    const byCreated = left.created_at.localeCompare(right.created_at);
    if (byCreated !== 0) return byCreated;
    return left.id.localeCompare(right.id);
  });
}

function weekdaySetFromBaseSchedule(
  schedule: AttendanceWeekdayScheduleShape | null | undefined
) {
  if (!schedule) return new Set<ScheduleWeekdayKey>();
  return new Set(
    SCHEDULE_WEEKDAY_KEYS.filter((day) => Boolean(schedule[day]))
  );
}

function weekdayArrayFromSet(set: Set<ScheduleWeekdayKey>) {
  return SCHEDULE_WEEKDAY_KEYS.filter((day) => set.has(day));
}

function isHoldActiveForDate(hold: MemberHoldLike, dateOnly: string) {
  if (String(hold.status).trim().toLowerCase() !== "active") return false;
  const start = normalizeOperationalDateOnly(hold.start_date);
  const end = hold.end_date ? normalizeOperationalDateOnly(hold.end_date) : null;
  return isDateWithinRange({
    date: dateOnly,
    startDate: start,
    endDate: end
  });
}

function isCenterClosedOnDate(closures: CenterClosureLike[], dateOnly: string) {
  return closures.some((closure) => {
    const isActive =
      closure.active == null
        ? true
        : Boolean(closure.active);
    if (!isActive) return false;
    return normalizeOperationalDateOnly(closure.closure_date) === dateOnly;
  });
}

function changeImpactsWeekday(change: ScheduleChangeRow, weekday: OperationsWeekdayKey) {
  if (!SCHEDULE_WEEKDAY_KEYS.includes(weekday as ScheduleWeekdayKey)) return false;
  const weekdayKey = weekday as ScheduleWeekdayKey;
  if (change.change_type === "Temporary Schedule Change" || change.change_type === "Permanent Schedule Change") {
    return true;
  }
  if (change.change_type === "Makeup Day") {
    return change.new_days.includes(weekdayKey);
  }
  if (change.change_type === "Scheduled Absence") {
    return change.original_days.includes(weekdayKey) || (change.suspend_base_schedule && change.original_days.length === 0);
  }
  return change.original_days.includes(weekdayKey) || change.new_days.includes(weekdayKey);
}

function applyChangeToWeekdaySet(input: {
  set: Set<ScheduleWeekdayKey>;
  change: ScheduleChangeRow;
}) {
  const next = new Set(input.set);
  const originalDays = input.change.original_days.filter((day): day is ScheduleWeekdayKey =>
    SCHEDULE_WEEKDAY_KEYS.includes(day)
  );
  const newDays = input.change.new_days.filter((day): day is ScheduleWeekdayKey =>
    SCHEDULE_WEEKDAY_KEYS.includes(day)
  );

  if (input.change.change_type === "Temporary Schedule Change" || input.change.change_type === "Permanent Schedule Change") {
    return new Set(newDays);
  }

  if (input.change.change_type === "Scheduled Absence") {
    if (originalDays.length === 0 && input.change.suspend_base_schedule) {
      return new Set<ScheduleWeekdayKey>();
    }
    originalDays.forEach((day) => next.delete(day));
    return next;
  }

  if (input.change.change_type === "Makeup Day") {
    newDays.forEach((day) => next.add(day));
    return next;
  }

  // Day swap: remove original day(s), then add replacement day(s).
  originalDays.forEach((day) => next.delete(day));
  newDays.forEach((day) => next.add(day));
  return next;
}

export function resolveExpectedAttendanceForDate(input: {
  date: string;
  baseSchedule: AttendanceWeekdayScheduleShape | null | undefined;
  scheduleChanges?: ScheduleChangeRow[] | null;
  holds?: MemberHoldLike[] | null;
  centerClosures?: CenterClosureLike[] | null;
  hasUnscheduledAttendanceAddition?: boolean;
}): ExpectedAttendanceResolution {
  const date = normalizeOperationalDateOnly(input.date);
  const weekday = getWeekdayForDate(date);
  const activeChanges = sortChangesForEvaluation(
    (input.scheduleChanges ?? []).filter((change) => {
      if (change.status !== "active") return false;
      return isDateWithinRange({
        date,
        startDate: normalizeOperationalDateOnly(change.effective_start_date),
        endDate: change.effective_end_date ? normalizeOperationalDateOnly(change.effective_end_date) : null
      });
    })
  );

  let weekdaySet = weekdaySetFromBaseSchedule(input.baseSchedule);
  const appliedChangeIds: string[] = [];
  let changedByScheduleChange = false;

  activeChanges.forEach((change) => {
    const before = weekdayArrayFromSet(weekdaySet).join("|");
    weekdaySet = applyChangeToWeekdaySet({ set: weekdaySet, change });
    const after = weekdayArrayFromSet(weekdaySet).join("|");
    if (before !== after || changeImpactsWeekday(change, weekday)) {
      changedByScheduleChange = true;
      appliedChangeIds.push(change.id);
    }
  });

  const effectiveDays = weekdayArrayFromSet(weekdaySet);
  const isScheduledWeekday =
    SCHEDULE_WEEKDAY_KEYS.includes(weekday as ScheduleWeekdayKey) &&
    weekdaySet.has(weekday as ScheduleWeekdayKey);
  const hasUnscheduledAttendanceAddition = Boolean(input.hasUnscheduledAttendanceAddition);
  const scheduledFromSchedule = isScheduledWeekday || hasUnscheduledAttendanceAddition;
  const onHold = (input.holds ?? []).some((hold) => isHoldActiveForDate(hold, date));
  const centerClosed = isCenterClosedOnDate(input.centerClosures ?? [], date);

  if (centerClosed) {
    return {
      date,
      weekday,
      isScheduled: false,
      scheduledFromSchedule,
      blockedBy: "center-closure",
      source: "center-closure",
      effectiveDays,
      appliedChangeIds
    };
  }

  if (onHold && scheduledFromSchedule) {
    return {
      date,
      weekday,
      isScheduled: false,
      scheduledFromSchedule,
      blockedBy: "member-hold",
      source: "member-hold",
      effectiveDays,
      appliedChangeIds
    };
  }

  if (scheduledFromSchedule) {
    return {
      date,
      weekday,
      isScheduled: true,
      scheduledFromSchedule,
      blockedBy: null,
      source: hasUnscheduledAttendanceAddition && !isScheduledWeekday
        ? "unscheduled-addition"
        : changedByScheduleChange
          ? "schedule-change"
          : "base-schedule",
      effectiveDays,
      appliedChangeIds
    };
  }

  return {
    date,
    weekday,
    isScheduled: false,
    scheduledFromSchedule,
    blockedBy: null,
    source: "not-scheduled",
    effectiveDays,
    appliedChangeIds
  };
}
