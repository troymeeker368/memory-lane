"use server";

import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/auth";
import { addMockRecord, getMockDb, removeMockRecord, updateMockRecord } from "@/lib/mock-repo";
import { getWeekdayForDate, normalizeOperationalDateOnly } from "@/lib/services/operations-calendar";
import { toEasternISO } from "@/lib/timezone";

type Shift = "AM" | "PM";
type TransportMode = "Bus Stop" | "Door to Door";
type BusNumber = "1" | "2" | "3";

function asString(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function asNullableString(formData: FormData, key: string) {
  const value = asString(formData, key);
  return value.length > 0 ? value : null;
}

function normalizeDateOnly(value: string | null | undefined) {
  return normalizeOperationalDateOnly(value);
}

function normalizeShift(raw: string): Shift {
  return raw === "PM" ? "PM" : "AM";
}

function normalizeTransportMode(raw: string | null | undefined): TransportMode | null {
  if (raw === "Bus Stop" || raw === "Door to Door") return raw;
  return null;
}

function normalizeBusNumber(raw: string | null | undefined): BusNumber | null {
  if (raw === "1" || raw === "2" || raw === "3") return raw;
  return null;
}

async function requireTransportationEditor() {
  const profile = await getCurrentProfile();
  if (profile.role !== "admin" && profile.role !== "manager") {
    throw new Error("Only Admin/Manager can edit Transportation Station manifests.");
  }
  return profile;
}

function revalidateTransportationStation() {
  revalidatePath("/operations/transportation-station");
  revalidatePath("/operations/transportation-station/print");
  revalidatePath("/operations/member-command-center");
  revalidatePath("/operations/attendance");
}

function resolvePreferredContact(memberId: string, explicitContactId?: string | null) {
  const db = getMockDb();
  if (explicitContactId) {
    const explicit = db.memberContacts.find((row) => row.id === explicitContactId && row.member_id === memberId);
    if (explicit) return explicit;
  }

  const priority: Record<string, number> = {
    "Responsible Party": 1,
    "Care Provider": 2,
    "Emergency Contact": 3,
    Spouse: 4,
    Child: 5,
    Payor: 6,
    Other: 7
  };

  return [...db.memberContacts]
    .filter((row) => row.member_id === memberId)
    .sort((left, right) => {
      const leftRank = priority[left.category] ?? 99;
      const rightRank = priority[right.category] ?? 99;
      if (leftRank !== rightRank) return leftRank - rightRank;
      if (left.updated_at === right.updated_at) return 0;
      return left.updated_at > right.updated_at ? -1 : 1;
    })[0];
}

function upsertAdjustment(input: {
  date: string;
  shift: Shift;
  memberId: string;
  adjustmentType: "add" | "exclude";
  busNumber?: BusNumber | null;
  transportType?: TransportMode | null;
  busStopName?: string | null;
  doorToDoorAddress?: string | null;
  caregiverContactId?: string | null;
  caregiverContactNameSnapshot?: string | null;
  caregiverContactPhoneSnapshot?: string | null;
  caregiverContactAddressSnapshot?: string | null;
  notes?: string | null;
  actorUserId: string;
  actorName: string;
}) {
  const db = getMockDb();
  const existing = db.transportationManifestAdjustments.find(
    (row) =>
      row.selected_date === input.date &&
      row.shift === input.shift &&
      row.member_id === input.memberId &&
      row.adjustment_type === input.adjustmentType
  );

  if (existing) {
    return updateMockRecord("transportationManifestAdjustments", existing.id, {
      bus_number: input.busNumber ?? null,
      transport_type: input.transportType ?? null,
      bus_stop_name: input.busStopName ?? null,
      door_to_door_address: input.doorToDoorAddress ?? null,
      caregiver_contact_id: input.caregiverContactId ?? null,
      caregiver_contact_name_snapshot: input.caregiverContactNameSnapshot ?? null,
      caregiver_contact_phone_snapshot: input.caregiverContactPhoneSnapshot ?? null,
      caregiver_contact_address_snapshot: input.caregiverContactAddressSnapshot ?? null,
      notes: input.notes ?? null,
      created_by_user_id: input.actorUserId,
      created_by_name: input.actorName,
      created_at: toEasternISO()
    });
  }

  return addMockRecord("transportationManifestAdjustments", {
    selected_date: input.date,
    shift: input.shift,
    member_id: input.memberId,
    adjustment_type: input.adjustmentType,
    bus_number: input.busNumber ?? null,
    transport_type: input.transportType ?? null,
    bus_stop_name: input.busStopName ?? null,
    door_to_door_address: input.doorToDoorAddress ?? null,
    caregiver_contact_id: input.caregiverContactId ?? null,
    caregiver_contact_name_snapshot: input.caregiverContactNameSnapshot ?? null,
    caregiver_contact_phone_snapshot: input.caregiverContactPhoneSnapshot ?? null,
    caregiver_contact_address_snapshot: input.caregiverContactAddressSnapshot ?? null,
    notes: input.notes ?? null,
    created_by_user_id: input.actorUserId,
    created_by_name: input.actorName,
    created_at: toEasternISO()
  });
}

function computePrimaryScheduleTransport(schedule: NonNullable<ReturnType<typeof getMockDb>["memberAttendanceSchedules"][number]>) {
  const slots = [
    { mode: schedule.transport_monday_am_mode, busNumber: schedule.transport_monday_am_bus_number, busStop: schedule.transport_monday_am_bus_stop },
    { mode: schedule.transport_monday_pm_mode, busNumber: schedule.transport_monday_pm_bus_number, busStop: schedule.transport_monday_pm_bus_stop },
    { mode: schedule.transport_tuesday_am_mode, busNumber: schedule.transport_tuesday_am_bus_number, busStop: schedule.transport_tuesday_am_bus_stop },
    { mode: schedule.transport_tuesday_pm_mode, busNumber: schedule.transport_tuesday_pm_bus_number, busStop: schedule.transport_tuesday_pm_bus_stop },
    { mode: schedule.transport_wednesday_am_mode, busNumber: schedule.transport_wednesday_am_bus_number, busStop: schedule.transport_wednesday_am_bus_stop },
    { mode: schedule.transport_wednesday_pm_mode, busNumber: schedule.transport_wednesday_pm_bus_number, busStop: schedule.transport_wednesday_pm_bus_stop },
    { mode: schedule.transport_thursday_am_mode, busNumber: schedule.transport_thursday_am_bus_number, busStop: schedule.transport_thursday_am_bus_stop },
    { mode: schedule.transport_thursday_pm_mode, busNumber: schedule.transport_thursday_pm_bus_number, busStop: schedule.transport_thursday_pm_bus_stop },
    { mode: schedule.transport_friday_am_mode, busNumber: schedule.transport_friday_am_bus_number, busStop: schedule.transport_friday_am_bus_stop },
    { mode: schedule.transport_friday_pm_mode, busNumber: schedule.transport_friday_pm_bus_number, busStop: schedule.transport_friday_pm_bus_stop }
  ];
  const first = slots.find((slot) => slot.mode) ?? null;
  return {
    transportationMode: first?.mode ?? null,
    transportBusNumber: first?.busNumber ?? null,
    transportationBusStop: first?.mode === "Bus Stop" ? first?.busStop ?? null : null
  };
}

function updateScheduleBusAssignment(input: {
  selectedDate: string;
  shift: Shift;
  memberId: string;
  busNumber: BusNumber;
  transportType: TransportMode;
  busStopName: string | null;
  doorToDoorAddress: string | null;
  actorUserId: string;
  actorName: string;
}) {
  const db = getMockDb();
  const schedule = db.memberAttendanceSchedules.find((row) => row.member_id === input.memberId);
  if (!schedule || schedule.transportation_required !== true) {
    return { updated: false as const };
  }

  const weekday = getWeekdayForDate(input.selectedDate);
  if (weekday !== "monday" && weekday !== "tuesday" && weekday !== "wednesday" && weekday !== "thursday" && weekday !== "friday") {
    return { updated: false as const };
  }

  if (!schedule[weekday]) {
    return { updated: false as const };
  }

  const patch: Record<string, string | null> = {};
  const dayPrefix = `transport_${weekday}_${input.shift.toLowerCase()}`;
  patch[`${dayPrefix}_mode`] = input.transportType;
  patch[`${dayPrefix}_bus_number`] = input.busNumber;
  patch[`${dayPrefix}_bus_stop`] = input.transportType === "Bus Stop" ? input.busStopName : null;
  patch[`${dayPrefix}_door_to_door_address`] = input.transportType === "Door to Door" ? input.doorToDoorAddress : null;

  const previewSchedule = { ...schedule, ...patch } as typeof schedule;
  const primary = computePrimaryScheduleTransport(previewSchedule);

  const schedulePatch = {
    ...(patch as Record<string, string | null>),
    transportation_mode: primary.transportationMode,
    transport_bus_number: primary.transportBusNumber,
    transportation_bus_stop: primary.transportationBusStop,
    updated_by_user_id: input.actorUserId,
    updated_by_name: input.actorName,
    updated_at: toEasternISO()
  } as Partial<(typeof db.memberAttendanceSchedules)[number]>;

  const updated = updateMockRecord("memberAttendanceSchedules", schedule.id, schedulePatch);
  if (!updated) {
    return { updated: false as const, error: "Unable to update recurring transportation schedule." };
  }

  return { updated: true as const };
}

export async function addTransportationManifestRiderAction(formData: FormData) {
  const actor = await requireTransportationEditor();
  const selectedDate = normalizeDateOnly(asString(formData, "selectedDate"));
  const memberId = asString(formData, "memberId");
  const shiftInput = asString(formData, "shift");
  const transportType = normalizeTransportMode(asString(formData, "transportType")) ?? "Door to Door";
  const busNumber = normalizeBusNumber(asString(formData, "busNumber"));
  const busStopName = asNullableString(formData, "busStopName");
  const doorToDoorAddress = asNullableString(formData, "doorToDoorAddress");
  const caregiverContactId = asNullableString(formData, "caregiverContactId");
  const caregiverContactName = asNullableString(formData, "caregiverContactName");
  const caregiverContactPhone = asNullableString(formData, "caregiverContactPhone");
  const caregiverContactAddress = asNullableString(formData, "caregiverContactAddress");
  const notes = asNullableString(formData, "notes");

  if (!memberId) {
    throw new Error("Member is required.");
  }

  if (!busNumber) {
    throw new Error("Bus assignment is required for all transport riders.");
  }

  if (transportType === "Bus Stop" && !busStopName) {
    throw new Error("Bus stop name is required for Bus Stop transport.");
  }

  if (transportType === "Door to Door" && !doorToDoorAddress) {
    throw new Error("Door-to-door address is required for Door to Door transport.");
  }

  const shifts: Shift[] = shiftInput === "Both" ? ["AM", "PM"] : [normalizeShift(shiftInput)];
  const contact = resolvePreferredContact(memberId, caregiverContactId);

  shifts.forEach((shift) => {
    upsertAdjustment({
      date: selectedDate,
      shift,
      memberId,
      adjustmentType: "add",
      busNumber,
      transportType,
      busStopName: transportType === "Bus Stop" ? busStopName : null,
      doorToDoorAddress: transportType === "Door to Door" ? doorToDoorAddress : null,
      caregiverContactId: contact?.id ?? caregiverContactId ?? null,
      caregiverContactNameSnapshot: caregiverContactName ?? contact?.contact_name ?? null,
      caregiverContactPhoneSnapshot:
        caregiverContactPhone ??
        contact?.cellular_number ??
        contact?.home_number ??
        contact?.work_number ??
        null,
      caregiverContactAddressSnapshot:
        caregiverContactAddress ??
        ([contact?.street_address, contact?.city, contact?.state, contact?.zip]
          .map((value) => (value ?? "").trim())
          .filter(Boolean)
          .join(", ") || null),
      notes,
      actorUserId: actor.id,
      actorName: actor.full_name
    });
  });

  revalidateTransportationStation();
}

export async function excludeTransportationManifestRiderAction(formData: FormData) {
  const actor = await requireTransportationEditor();
  const selectedDate = normalizeDateOnly(asString(formData, "selectedDate"));
  const memberId = asString(formData, "memberId");
  const shift = normalizeShift(asString(formData, "shift"));
  const busNumber = normalizeBusNumber(asString(formData, "busNumber"));
  const transportType = normalizeTransportMode(asString(formData, "transportType"));
  const busStopName = asNullableString(formData, "busStopName");
  const doorToDoorAddress = asNullableString(formData, "doorToDoorAddress");
  const caregiverContactId = asNullableString(formData, "caregiverContactId");
  const caregiverContactName = asNullableString(formData, "caregiverContactName");
  const caregiverContactPhone = asNullableString(formData, "caregiverContactPhone");
  const caregiverContactAddress = asNullableString(formData, "caregiverContactAddress");
  const notes = asNullableString(formData, "notes");

  if (!memberId) {
    throw new Error("Member is required.");
  }

  upsertAdjustment({
    date: selectedDate,
    shift,
    memberId,
    adjustmentType: "exclude",
    busNumber,
    transportType,
    busStopName,
    doorToDoorAddress,
    caregiverContactId,
    caregiverContactNameSnapshot: caregiverContactName,
    caregiverContactPhoneSnapshot: caregiverContactPhone,
    caregiverContactAddressSnapshot: caregiverContactAddress,
    notes,
    actorUserId: actor.id,
    actorName: actor.full_name
  });

  revalidateTransportationStation();
}

export async function reassignTransportationManifestBusAction(formData: FormData) {
  const actor = await requireTransportationEditor();
  const selectedDate = normalizeDateOnly(asString(formData, "selectedDate"));
  const memberId = asString(formData, "memberId");
  const shift = normalizeShift(asString(formData, "shift"));
  const busNumber = normalizeBusNumber(asString(formData, "busNumber"));
  const transportType = normalizeTransportMode(asString(formData, "transportType"));
  const busStopName = asNullableString(formData, "busStopName");
  const doorToDoorAddress = asNullableString(formData, "doorToDoorAddress");
  const caregiverContactId = asNullableString(formData, "caregiverContactId");
  const caregiverContactName = asNullableString(formData, "caregiverContactName");
  const caregiverContactPhone = asNullableString(formData, "caregiverContactPhone");
  const caregiverContactAddress = asNullableString(formData, "caregiverContactAddress");
  const notes = asNullableString(formData, "notes");

  if (!memberId) {
    throw new Error("Member is required.");
  }
  if (!busNumber) {
    throw new Error("Bus assignment is required.");
  }
  if (!transportType) {
    throw new Error("Transport type is required.");
  }

  const db = getMockDb();
  const exclusion = db.transportationManifestAdjustments.find(
    (row) =>
      row.selected_date === selectedDate &&
      row.shift === shift &&
      row.member_id === memberId &&
      row.adjustment_type === "exclude"
  );
  if (exclusion) {
    removeMockRecord("transportationManifestAdjustments", exclusion.id);
  }

  const scheduleUpdate = updateScheduleBusAssignment({
    selectedDate,
    shift,
    memberId,
    busNumber,
    transportType,
    busStopName: transportType === "Bus Stop" ? busStopName : null,
    doorToDoorAddress: transportType === "Door to Door" ? doorToDoorAddress : null,
    actorUserId: actor.id,
    actorName: actor.full_name
  });
  if (scheduleUpdate.error) {
    console.error("[Transport] schedule bus reassignment failed", {
      memberId,
      selectedDate,
      shift,
      error: scheduleUpdate.error
    });
    throw new Error(scheduleUpdate.error);
  }

  if (scheduleUpdate.updated) {
    const scheduleOverride = db.transportationManifestAdjustments.find(
      (row) =>
        row.selected_date === selectedDate &&
        row.shift === shift &&
        row.member_id === memberId &&
        row.adjustment_type === "add"
    );
    if (scheduleOverride) {
      removeMockRecord("transportationManifestAdjustments", scheduleOverride.id);
    }
    revalidateTransportationStation();
    return;
  }

  // If the rider is not on recurring schedule for this day/shift, keep this as a one-day manual override.
  upsertAdjustment({
    date: selectedDate,
    shift,
    memberId,
    adjustmentType: "add",
    busNumber,
    transportType,
    busStopName: transportType === "Bus Stop" ? busStopName : null,
    doorToDoorAddress: transportType === "Door to Door" ? doorToDoorAddress : null,
    caregiverContactId,
    caregiverContactNameSnapshot: caregiverContactName,
    caregiverContactPhoneSnapshot: caregiverContactPhone,
    caregiverContactAddressSnapshot: caregiverContactAddress,
    notes,
    actorUserId: actor.id,
    actorName: actor.full_name
  });

  revalidateTransportationStation();
}

export async function undoTransportationManifestAdjustmentAction(formData: FormData) {
  await requireTransportationEditor();
  const adjustmentId = asString(formData, "adjustmentId");
  if (!adjustmentId) {
    throw new Error("Adjustment id is required.");
  }

  const removed = removeMockRecord("transportationManifestAdjustments", adjustmentId);
  if (!removed) {
    throw new Error("Adjustment was not found.");
  }

  revalidateTransportationStation();
}
