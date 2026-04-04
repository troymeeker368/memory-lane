import "server-only";

import {
  MEMBER_TRANSPORTATION_SERVICE_OPTIONS
} from "@/lib/canonical";
import { saveMemberCommandCenterTransportationWorkflow } from "@/lib/services/member-command-center";
import { resolveTransportPeriod } from "@/lib/services/member-schedule-selectors";
import {
  getRequiredMemberAttendanceScheduleSupabase,
  getRequiredMemberCommandCenterProfileSupabase
} from "@/lib/services/member-command-center-write";
import { getConfiguredBusNumbers } from "@/lib/services/operations-settings";
import { toEasternISO } from "@/lib/timezone";

import {
  asNullableBoolSelect,
  asNullableString,
  asString,
  requireCommandCenterEditor,
  revalidateCommandCenter,
  toServiceActor
} from "./shared";

export async function saveMemberCommandCenterTransportationAction(formData: FormData) {
  try {
    const actor = await requireCommandCenterEditor();
    const memberId = asString(formData, "memberId");
    if (!memberId) return { ok: false, error: "Member is required." };

    const schedule = await getRequiredMemberAttendanceScheduleSupabase(memberId);

    const commandCenterProfile = await getRequiredMemberCommandCenterProfileSupabase(memberId);
    const now = toEasternISO();
    const defaultDoorToDoorAddress =
      [
        commandCenterProfile.street_address,
        commandCenterProfile.city,
        commandCenterProfile.state,
        commandCenterProfile.zip
      ]
        .map((value) => (value ?? "").trim())
        .filter(Boolean)
        .join(", ") || null;

    const transportationRequired = asNullableBoolSelect(formData, "transportationRequired");
    const configuredBusNumbers = await getConfiguredBusNumbers();
    const normalizeMode = (raw: string) =>
      MEMBER_TRANSPORTATION_SERVICE_OPTIONS.includes(raw as (typeof MEMBER_TRANSPORTATION_SERVICE_OPTIONS)[number])
        ? (raw as "Door to Door" | "Bus Stop")
        : null;
    const normalizeBusNumber = (raw: string) => {
      const normalized = raw.trim();
      return configuredBusNumbers.includes(normalized) ? normalized : null;
    };
    const parseSlot = (dayEnabled: boolean, slotPrefix: string) => {
      if (transportationRequired !== true || !dayEnabled) {
        return { mode: null, doorToDoorAddress: null, busNumber: null, busStop: null } as const;
      }
      const mode = normalizeMode(asString(formData, `${slotPrefix}Mode`));
      const doorToDoorAddress =
        mode === "Door to Door"
          ? asNullableString(formData, `${slotPrefix}DoorToDoorAddress`) ?? defaultDoorToDoorAddress
          : null;
      const busNumber = mode ? normalizeBusNumber(asString(formData, `${slotPrefix}BusNumber`)) : null;
      const busStop = mode === "Bus Stop" ? asNullableString(formData, `${slotPrefix}BusStop`) : null;
      return { mode, doorToDoorAddress, busNumber, busStop } as const;
    };

    const mondayAm = parseSlot(schedule.monday, "transportMondayAm");
    const mondayPm = parseSlot(schedule.monday, "transportMondayPm");
    const tuesdayAm = parseSlot(schedule.tuesday, "transportTuesdayAm");
    const tuesdayPm = parseSlot(schedule.tuesday, "transportTuesdayPm");
    const wednesdayAm = parseSlot(schedule.wednesday, "transportWednesdayAm");
    const wednesdayPm = parseSlot(schedule.wednesday, "transportWednesdayPm");
    const thursdayAm = parseSlot(schedule.thursday, "transportThursdayAm");
    const thursdayPm = parseSlot(schedule.thursday, "transportThursdayPm");
    const fridayAm = parseSlot(schedule.friday, "transportFridayAm");
    const fridayPm = parseSlot(schedule.friday, "transportFridayPm");
    const configuredSlotCount = [
      mondayAm.mode,
      mondayPm.mode,
      tuesdayAm.mode,
      tuesdayPm.mode,
      wednesdayAm.mode,
      wednesdayPm.mode,
      thursdayAm.mode,
      thursdayPm.mode,
      fridayAm.mode,
      fridayPm.mode
    ].filter(Boolean).length;

    if (transportationRequired === true && configuredSlotCount === 0) {
      return { ok: false, error: "Choose Door to Door or Bus Stop for at least one AM/PM slot (or set Transportation to No)." };
    }
    if (transportationRequired === true) {
      const allSlots = [
        mondayAm,
        mondayPm,
        tuesdayAm,
        tuesdayPm,
        wednesdayAm,
        wednesdayPm,
        thursdayAm,
        thursdayPm,
        fridayAm,
        fridayPm
      ];
      const missingDoorToDoorAddress = allSlots.some((slot) => slot.mode === "Door to Door" && !slot.doorToDoorAddress);
      if (missingDoorToDoorAddress) {
        return { ok: false, error: "Door to Door trips require an address (defaults to demographics address when available)." };
      }
      const missingBusAssignment = allSlots.some((slot) => slot.mode && !slot.busNumber);
      if (missingBusAssignment) {
        return { ok: false, error: "Every transport trip (Bus Stop and Door to Door) requires a bus assignment." };
      }
    }

    const firstMode =
      mondayAm.mode ??
      mondayPm.mode ??
      tuesdayAm.mode ??
      tuesdayPm.mode ??
      wednesdayAm.mode ??
      wednesdayPm.mode ??
      thursdayAm.mode ??
      thursdayPm.mode ??
      fridayAm.mode ??
      fridayPm.mode;
    const firstBusNumber =
      mondayAm.busNumber ??
      mondayPm.busNumber ??
      tuesdayAm.busNumber ??
      tuesdayPm.busNumber ??
      wednesdayAm.busNumber ??
      wednesdayPm.busNumber ??
      thursdayAm.busNumber ??
      thursdayPm.busNumber ??
      fridayAm.busNumber ??
      fridayPm.busNumber;
    const firstBusStop =
      mondayAm.busStop ??
      mondayPm.busStop ??
      tuesdayAm.busStop ??
      tuesdayPm.busStop ??
      wednesdayAm.busStop ??
      wednesdayPm.busStop ??
      thursdayAm.busStop ??
      thursdayPm.busStop ??
      fridayAm.busStop ??
      fridayPm.busStop;

    const schedulePatch = {
      transportation_required: transportationRequired,
      transportation_mode: transportationRequired === true ? firstMode : null,
      transport_bus_number: transportationRequired === true ? firstBusNumber : null,
      transportation_bus_stop: transportationRequired === true && firstMode === "Bus Stop" ? firstBusStop : null,
      transport_monday_period: resolveTransportPeriod({
        dayEnabled: schedule.monday,
        amMode: mondayAm.mode,
        pmMode: mondayPm.mode
      }),
      transport_tuesday_period: resolveTransportPeriod({
        dayEnabled: schedule.tuesday,
        amMode: tuesdayAm.mode,
        pmMode: tuesdayPm.mode
      }),
      transport_wednesday_period: resolveTransportPeriod({
        dayEnabled: schedule.wednesday,
        amMode: wednesdayAm.mode,
        pmMode: wednesdayPm.mode
      }),
      transport_thursday_period: resolveTransportPeriod({
        dayEnabled: schedule.thursday,
        amMode: thursdayAm.mode,
        pmMode: thursdayPm.mode
      }),
      transport_friday_period: resolveTransportPeriod({
        dayEnabled: schedule.friday,
        amMode: fridayAm.mode,
        pmMode: fridayPm.mode
      }),
      transport_monday_am_mode: schedule.monday ? mondayAm.mode : null,
      transport_monday_am_door_to_door_address: schedule.monday ? mondayAm.doorToDoorAddress : null,
      transport_monday_am_bus_number: schedule.monday ? mondayAm.busNumber : null,
      transport_monday_am_bus_stop: schedule.monday ? mondayAm.busStop : null,
      transport_monday_pm_mode: schedule.monday ? mondayPm.mode : null,
      transport_monday_pm_door_to_door_address: schedule.monday ? mondayPm.doorToDoorAddress : null,
      transport_monday_pm_bus_number: schedule.monday ? mondayPm.busNumber : null,
      transport_monday_pm_bus_stop: schedule.monday ? mondayPm.busStop : null,
      transport_tuesday_am_mode: schedule.tuesday ? tuesdayAm.mode : null,
      transport_tuesday_am_door_to_door_address: schedule.tuesday ? tuesdayAm.doorToDoorAddress : null,
      transport_tuesday_am_bus_number: schedule.tuesday ? tuesdayAm.busNumber : null,
      transport_tuesday_am_bus_stop: schedule.tuesday ? tuesdayAm.busStop : null,
      transport_tuesday_pm_mode: schedule.tuesday ? tuesdayPm.mode : null,
      transport_tuesday_pm_door_to_door_address: schedule.tuesday ? tuesdayPm.doorToDoorAddress : null,
      transport_tuesday_pm_bus_number: schedule.tuesday ? tuesdayPm.busNumber : null,
      transport_tuesday_pm_bus_stop: schedule.tuesday ? tuesdayPm.busStop : null,
      transport_wednesday_am_mode: schedule.wednesday ? wednesdayAm.mode : null,
      transport_wednesday_am_door_to_door_address: schedule.wednesday ? wednesdayAm.doorToDoorAddress : null,
      transport_wednesday_am_bus_number: schedule.wednesday ? wednesdayAm.busNumber : null,
      transport_wednesday_am_bus_stop: schedule.wednesday ? wednesdayAm.busStop : null,
      transport_wednesday_pm_mode: schedule.wednesday ? wednesdayPm.mode : null,
      transport_wednesday_pm_door_to_door_address: schedule.wednesday ? wednesdayPm.doorToDoorAddress : null,
      transport_wednesday_pm_bus_number: schedule.wednesday ? wednesdayPm.busNumber : null,
      transport_wednesday_pm_bus_stop: schedule.wednesday ? wednesdayPm.busStop : null,
      transport_thursday_am_mode: schedule.thursday ? thursdayAm.mode : null,
      transport_thursday_am_door_to_door_address: schedule.thursday ? thursdayAm.doorToDoorAddress : null,
      transport_thursday_am_bus_number: schedule.thursday ? thursdayAm.busNumber : null,
      transport_thursday_am_bus_stop: schedule.thursday ? thursdayAm.busStop : null,
      transport_thursday_pm_mode: schedule.thursday ? thursdayPm.mode : null,
      transport_thursday_pm_door_to_door_address: schedule.thursday ? thursdayPm.doorToDoorAddress : null,
      transport_thursday_pm_bus_number: schedule.thursday ? thursdayPm.busNumber : null,
      transport_thursday_pm_bus_stop: schedule.thursday ? thursdayPm.busStop : null,
      transport_friday_am_mode: schedule.friday ? fridayAm.mode : null,
      transport_friday_am_door_to_door_address: schedule.friday ? fridayAm.doorToDoorAddress : null,
      transport_friday_am_bus_number: schedule.friday ? fridayAm.busNumber : null,
      transport_friday_am_bus_stop: schedule.friday ? fridayAm.busStop : null,
      transport_friday_pm_mode: schedule.friday ? fridayPm.mode : null,
      transport_friday_pm_door_to_door_address: schedule.friday ? fridayPm.doorToDoorAddress : null,
      transport_friday_pm_bus_number: schedule.friday ? fridayPm.busNumber : null,
      transport_friday_pm_bus_stop: schedule.friday ? fridayPm.busStop : null
    };

    await saveMemberCommandCenterTransportationWorkflow({
      memberId,
      schedulePatch,
      busStopNames: [
        mondayAm.busStop,
        mondayPm.busStop,
        tuesdayAm.busStop,
        tuesdayPm.busStop,
        wednesdayAm.busStop,
        wednesdayPm.busStop,
        thursdayAm.busStop,
        thursdayPm.busStop,
        fridayAm.busStop,
        fridayPm.busStop
      ].filter((value): value is string => Boolean(value)),
      actor: toServiceActor(actor),
      now
    });

    revalidateCommandCenter(memberId);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save transportation updates.";
    console.error("[MCC] saveMemberCommandCenterTransportationAction failed", {
      message,
      memberId: asString(formData, "memberId")
    });
    return { ok: false, error: message };
  }
}
