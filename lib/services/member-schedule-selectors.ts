import type { MockMemberAttendanceSchedule } from "@/lib/mock/types";
import {
  getWeekdayForDate,
  type OperationsWeekdayKey
} from "@/lib/services/operations-calendar";

export type ScheduleWeekdayKey = "monday" | "tuesday" | "wednesday" | "thursday" | "friday";
export type TransportShift = "AM" | "PM";
export type TransportMode = "Door to Door" | "Bus Stop";
export type TransportBusNumber = "1" | "2" | "3";

export interface MemberTransportSlot {
  mode: TransportMode | null;
  busNumber: TransportBusNumber | null;
  busStop: string | null;
  doorToDoorAddress: string | null;
}

export interface MemberTransportSnapshot {
  required: boolean;
  mode: TransportMode | null;
  busNumber: TransportBusNumber | null;
  busStop: string | null;
  doorToDoorAddress: string | null;
}

const WEEKDAY_ABBREVIATIONS: Record<ScheduleWeekdayKey, string> = {
  monday: "M",
  tuesday: "Tu",
  wednesday: "W",
  thursday: "Th",
  friday: "F"
};

function toScheduleWeekdayKey(weekday: OperationsWeekdayKey): ScheduleWeekdayKey | null {
  if (weekday === "monday" || weekday === "tuesday" || weekday === "wednesday" || weekday === "thursday" || weekday === "friday") {
    return weekday;
  }
  return null;
}

export function isScheduledWeekday(
  schedule: MockMemberAttendanceSchedule | null | undefined,
  weekday: OperationsWeekdayKey
): boolean {
  if (!schedule) return false;
  const weekdayKey = toScheduleWeekdayKey(weekday);
  if (!weekdayKey) return false;
  return Boolean(schedule[weekdayKey]);
}

export function isMemberScheduledForDate(
  schedule: MockMemberAttendanceSchedule | null | undefined,
  dateOnly: string
): boolean {
  return isScheduledWeekday(schedule, getWeekdayForDate(dateOnly));
}

export function getScheduledDayAbbreviations(
  schedule: MockMemberAttendanceSchedule | null | undefined
): string {
  if (!schedule) return "-";

  const days = (["monday", "tuesday", "wednesday", "thursday", "friday"] as ScheduleWeekdayKey[])
    .filter((day) => Boolean(schedule[day]))
    .map((day) => WEEKDAY_ABBREVIATIONS[day]);

  return days.length > 0 ? days.join(", ") : "-";
}

export function getTransportSlotForScheduleDay(
  schedule: MockMemberAttendanceSchedule,
  weekday: ScheduleWeekdayKey,
  shift: TransportShift
): MemberTransportSlot {
  if (weekday === "monday" && shift === "AM") {
    return {
      mode: schedule.transport_monday_am_mode,
      busNumber: schedule.transport_monday_am_bus_number,
      busStop: schedule.transport_monday_am_bus_stop,
      doorToDoorAddress: schedule.transport_monday_am_door_to_door_address
    };
  }
  if (weekday === "monday" && shift === "PM") {
    return {
      mode: schedule.transport_monday_pm_mode,
      busNumber: schedule.transport_monday_pm_bus_number,
      busStop: schedule.transport_monday_pm_bus_stop,
      doorToDoorAddress: schedule.transport_monday_pm_door_to_door_address
    };
  }
  if (weekday === "tuesday" && shift === "AM") {
    return {
      mode: schedule.transport_tuesday_am_mode,
      busNumber: schedule.transport_tuesday_am_bus_number,
      busStop: schedule.transport_tuesday_am_bus_stop,
      doorToDoorAddress: schedule.transport_tuesday_am_door_to_door_address
    };
  }
  if (weekday === "tuesday" && shift === "PM") {
    return {
      mode: schedule.transport_tuesday_pm_mode,
      busNumber: schedule.transport_tuesday_pm_bus_number,
      busStop: schedule.transport_tuesday_pm_bus_stop,
      doorToDoorAddress: schedule.transport_tuesday_pm_door_to_door_address
    };
  }
  if (weekday === "wednesday" && shift === "AM") {
    return {
      mode: schedule.transport_wednesday_am_mode,
      busNumber: schedule.transport_wednesday_am_bus_number,
      busStop: schedule.transport_wednesday_am_bus_stop,
      doorToDoorAddress: schedule.transport_wednesday_am_door_to_door_address
    };
  }
  if (weekday === "wednesday" && shift === "PM") {
    return {
      mode: schedule.transport_wednesday_pm_mode,
      busNumber: schedule.transport_wednesday_pm_bus_number,
      busStop: schedule.transport_wednesday_pm_bus_stop,
      doorToDoorAddress: schedule.transport_wednesday_pm_door_to_door_address
    };
  }
  if (weekday === "thursday" && shift === "AM") {
    return {
      mode: schedule.transport_thursday_am_mode,
      busNumber: schedule.transport_thursday_am_bus_number,
      busStop: schedule.transport_thursday_am_bus_stop,
      doorToDoorAddress: schedule.transport_thursday_am_door_to_door_address
    };
  }
  if (weekday === "thursday" && shift === "PM") {
    return {
      mode: schedule.transport_thursday_pm_mode,
      busNumber: schedule.transport_thursday_pm_bus_number,
      busStop: schedule.transport_thursday_pm_bus_stop,
      doorToDoorAddress: schedule.transport_thursday_pm_door_to_door_address
    };
  }
  if (weekday === "friday" && shift === "AM") {
    return {
      mode: schedule.transport_friday_am_mode,
      busNumber: schedule.transport_friday_am_bus_number,
      busStop: schedule.transport_friday_am_bus_stop,
      doorToDoorAddress: schedule.transport_friday_am_door_to_door_address
    };
  }
  return {
    mode: schedule.transport_friday_pm_mode,
    busNumber: schedule.transport_friday_pm_bus_number,
    busStop: schedule.transport_friday_pm_bus_stop,
    doorToDoorAddress: schedule.transport_friday_pm_door_to_door_address
  };
}

export function getTransportSlotForDate(
  schedule: MockMemberAttendanceSchedule | null | undefined,
  dateOnly: string,
  shift: TransportShift
): MemberTransportSlot {
  if (!schedule || !schedule.transportation_required) {
    return {
      mode: null,
      busNumber: null,
      busStop: null,
      doorToDoorAddress: null
    };
  }

  const weekdayKey = toScheduleWeekdayKey(getWeekdayForDate(dateOnly));
  if (!weekdayKey || !schedule[weekdayKey]) {
    return {
      mode: null,
      busNumber: null,
      busStop: null,
      doorToDoorAddress: null
    };
  }

  return getTransportSlotForScheduleDay(schedule, weekdayKey, shift);
}

export function getPrimaryTransportSnapshotForDate(
  schedule: MockMemberAttendanceSchedule | null | undefined,
  dateOnly: string
): MemberTransportSnapshot {
  if (!schedule || !schedule.transportation_required) {
    return {
      required: false,
      mode: null,
      busNumber: null,
      busStop: null,
      doorToDoorAddress: null
    };
  }

  const amSlot = getTransportSlotForDate(schedule, dateOnly, "AM");
  const pmSlot = getTransportSlotForDate(schedule, dateOnly, "PM");
  const mode = amSlot.mode ?? pmSlot.mode;

  return {
    required: Boolean(mode),
    mode,
    busNumber: amSlot.busNumber ?? pmSlot.busNumber,
    busStop: amSlot.busStop ?? pmSlot.busStop,
    doorToDoorAddress: amSlot.doorToDoorAddress ?? pmSlot.doorToDoorAddress
  };
}

