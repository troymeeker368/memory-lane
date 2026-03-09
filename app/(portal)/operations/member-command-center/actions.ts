"use server";

import { Buffer } from "node:buffer";
import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/auth";
import {
  MEMBER_BUS_NUMBER_OPTIONS,
  MEMBER_CONTACT_CATEGORY_OPTIONS,
  MEMBER_FILE_CATEGORY_OPTIONS,
  MEMBER_TRANSPORTATION_SERVICE_OPTIONS
} from "@/lib/canonical";
import { addMockRecord, getMockDb, removeMockRecord, updateMockRecord } from "@/lib/mock-repo";
import {
  ensureMemberAttendanceSchedule,
  ensureMemberCommandCenterProfile,
  updateMemberDobFromCommandCenter,
  updateMemberEnrollmentFromSchedule
} from "@/lib/services/member-command-center";
import { syncCommandCenterToMhp, syncMhpToCommandCenter } from "@/lib/services/member-profile-sync";
import { toEasternISO } from "@/lib/timezone";

function asString(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function asNullableString(formData: FormData, key: string) {
  const value = asString(formData, key);
  return value.length > 0 ? value : null;
}

function asNullableBoolSelect(formData: FormData, key: string) {
  const value = asString(formData, key).toLowerCase();
  if (!value) return null;
  if (value === "true" || value === "yes" || value === "1") return true;
  if (value === "false" || value === "no" || value === "0") return false;
  return null;
}

function asCheckbox(formData: FormData, key: string) {
  return formData.get(key) === "on" || formData.get(key) === "true";
}

function normalizeLockerInput(raw: string) {
  const normalized = raw.trim();
  if (!normalized) return null;
  if (/^\d+$/.test(normalized)) {
    const parsed = Number(normalized);
    if (Number.isFinite(parsed) && parsed > 0) {
      return String(parsed);
    }
  }
  return normalized.toUpperCase();
}

function normalizeBusStopName(value: string | null | undefined) {
  const normalized = (value ?? "").trim().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : null;
}

async function asUploadedImageDataUrl(formData: FormData, key: string, fallback: string | null) {
  const file = formData.get(key);
  if (file instanceof File && file.size > 0 && file.type.startsWith("image/")) {
    const bytes = Buffer.from(await file.arrayBuffer());
    return `data:${file.type};base64,${bytes.toString("base64")}`;
  }
  return fallback;
}

async function requireCommandCenterEditor() {
  const profile = await getCurrentProfile();
  if (profile.role !== "admin" && profile.role !== "manager") {
    throw new Error("Only Admin/Manager can edit Member Command Center records.");
  }
  return profile;
}

function revalidateCommandCenter(memberId: string) {
  revalidatePath("/operations/member-command-center");
  revalidatePath(`/operations/member-command-center/${memberId}`);
  revalidatePath("/operations/attendance");
  revalidatePath("/operations/transportation-station");
  revalidatePath("/operations/transportation-station/print");
  revalidatePath("/operations/locker-assignments");
  revalidatePath("/health/member-health-profiles");
  revalidatePath(`/health/member-health-profiles/${memberId}`);
  revalidatePath(`/members/${memberId}`);
}

function upsertBusStopDirectoryFromValues(input: {
  busStopNames: Array<string | null | undefined>;
  actor: { id: string; full_name: string };
  now: string;
}) {
  const db = getMockDb();
  const nextNames = Array.from(
    new Set(
      input.busStopNames
        .map((value) => normalizeBusStopName(value))
        .filter((value): value is string => Boolean(value))
    )
  );

  nextNames.forEach((busStopName) => {
    const existing = db.busStopDirectory.find(
      (row) => normalizeBusStopName(row.bus_stop_name)?.toLowerCase() === busStopName.toLowerCase()
    );

    if (existing) {
      updateMockRecord("busStopDirectory", existing.id, {
        bus_stop_name: busStopName,
        updated_at: input.now
      });
      return;
    }

    addMockRecord("busStopDirectory", {
      bus_stop_name: busStopName,
      created_by_user_id: input.actor.id,
      created_by_name: input.actor.full_name,
      created_at: input.now,
      updated_at: input.now
    });
  });
}

export async function saveMemberCommandCenterSummaryAction(formData: FormData) {
  const actor = await requireCommandCenterEditor();
  const memberId = asString(formData, "memberId");
  if (!memberId) return { ok: false, error: "Member is required." };

  const db = getMockDb();
  const member = db.members.find((row) => row.id === memberId);
  if (!member) return { ok: false, error: "Member not found." };
  const lockerNumber = normalizeLockerInput(asString(formData, "lockerNumber"));
  if (lockerNumber && member.status === "active") {
    const conflict = db.members.find(
      (member) =>
        member.id !== memberId &&
        member.status === "active" &&
        String(member.locker_number ?? "").trim().toLowerCase() === lockerNumber.toLowerCase()
    );
    if (conflict) {
      return { ok: false, error: `Locker ${lockerNumber} is already assigned to ${conflict.display_name}.` };
    }
  }

  const now = toEasternISO();
  const profile = ensureMemberCommandCenterProfile(memberId);
  const defaultLocation = profile.location ?? "Fort Mill";

  updateMockRecord("memberCommandCenters", profile.id, {
    payor: asNullableString(formData, "payor"),
    original_referral_source: asNullableString(formData, "originalReferralSource"),
    photo_consent: asNullableBoolSelect(formData, "photoConsent"),
    location: defaultLocation,
    updated_by_user_id: actor.id,
    updated_by_name: actor.full_name,
    updated_at: now
  });
  updateMockRecord("members", memberId, {
    locker_number: lockerNumber
  });

  syncCommandCenterToMhp(
    memberId,
    {
      id: actor.id,
      fullName: actor.full_name
    },
    now
  );

  revalidateCommandCenter(memberId);
  return { ok: true };
}

export async function updateMemberCommandCenterPhotoAction(formData: FormData) {
  const actor = await requireCommandCenterEditor();
  const memberId = asString(formData, "memberId");
  if (!memberId) return { ok: false, error: "Member is required." };

  const now = toEasternISO();
  const profile = ensureMemberCommandCenterProfile(memberId);
  const profileImageUrl = await asUploadedImageDataUrl(formData, "photoFile", profile.profile_image_url ?? null);
  updateMockRecord("memberCommandCenters", profile.id, {
    profile_image_url: profileImageUrl,
    updated_by_user_id: actor.id,
    updated_by_name: actor.full_name,
    updated_at: now
  });

  syncCommandCenterToMhp(
    memberId,
    {
      id: actor.id,
      fullName: actor.full_name
    },
    now
  );

  revalidateCommandCenter(memberId);
  return { ok: true, profileImageUrl };
}

export async function saveMemberCommandCenterAttendanceAction(formData: FormData) {
  const actor = await requireCommandCenterEditor();
  const memberId = asString(formData, "memberId");
  if (!memberId) return { ok: false, error: "Member is required." };

  const schedule = ensureMemberAttendanceSchedule(memberId);
  if (!schedule) return { ok: false, error: "Attendance schedule not found." };
  const commandCenterProfile = ensureMemberCommandCenterProfile(memberId);
  const now = toEasternISO();
  const enrollmentDate = asNullableString(formData, "enrollmentDate");
  const wasMonday = schedule.monday;
  const wasTuesday = schedule.tuesday;
  const wasWednesday = schedule.wednesday;
  const wasThursday = schedule.thursday;
  const wasFriday = schedule.friday;
  const monday = asCheckbox(formData, "monday");
  const tuesday = asCheckbox(formData, "tuesday");
  const wednesday = asCheckbox(formData, "wednesday");
  const thursday = asCheckbox(formData, "thursday");
  const friday = asCheckbox(formData, "friday");
  const mondayAdded = monday && !wasMonday;
  const tuesdayAdded = tuesday && !wasTuesday;
  const wednesdayAdded = wednesday && !wasWednesday;
  const thursdayAdded = thursday && !wasThursday;
  const fridayAdded = friday && !wasFriday;

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

  const existingSlots = [
    {
      mode: schedule.transport_monday_am_mode,
      busNumber: schedule.transport_monday_am_bus_number,
      busStop: schedule.transport_monday_am_bus_stop,
      doorToDoorAddress: schedule.transport_monday_am_door_to_door_address
    },
    {
      mode: schedule.transport_monday_pm_mode,
      busNumber: schedule.transport_monday_pm_bus_number,
      busStop: schedule.transport_monday_pm_bus_stop,
      doorToDoorAddress: schedule.transport_monday_pm_door_to_door_address
    },
    {
      mode: schedule.transport_tuesday_am_mode,
      busNumber: schedule.transport_tuesday_am_bus_number,
      busStop: schedule.transport_tuesday_am_bus_stop,
      doorToDoorAddress: schedule.transport_tuesday_am_door_to_door_address
    },
    {
      mode: schedule.transport_tuesday_pm_mode,
      busNumber: schedule.transport_tuesday_pm_bus_number,
      busStop: schedule.transport_tuesday_pm_bus_stop,
      doorToDoorAddress: schedule.transport_tuesday_pm_door_to_door_address
    },
    {
      mode: schedule.transport_wednesday_am_mode,
      busNumber: schedule.transport_wednesday_am_bus_number,
      busStop: schedule.transport_wednesday_am_bus_stop,
      doorToDoorAddress: schedule.transport_wednesday_am_door_to_door_address
    },
    {
      mode: schedule.transport_wednesday_pm_mode,
      busNumber: schedule.transport_wednesday_pm_bus_number,
      busStop: schedule.transport_wednesday_pm_bus_stop,
      doorToDoorAddress: schedule.transport_wednesday_pm_door_to_door_address
    },
    {
      mode: schedule.transport_thursday_am_mode,
      busNumber: schedule.transport_thursday_am_bus_number,
      busStop: schedule.transport_thursday_am_bus_stop,
      doorToDoorAddress: schedule.transport_thursday_am_door_to_door_address
    },
    {
      mode: schedule.transport_thursday_pm_mode,
      busNumber: schedule.transport_thursday_pm_bus_number,
      busStop: schedule.transport_thursday_pm_bus_stop,
      doorToDoorAddress: schedule.transport_thursday_pm_door_to_door_address
    },
    {
      mode: schedule.transport_friday_am_mode,
      busNumber: schedule.transport_friday_am_bus_number,
      busStop: schedule.transport_friday_am_bus_stop,
      doorToDoorAddress: schedule.transport_friday_am_door_to_door_address
    },
    {
      mode: schedule.transport_friday_pm_mode,
      busNumber: schedule.transport_friday_pm_bus_number,
      busStop: schedule.transport_friday_pm_bus_stop,
      doorToDoorAddress: schedule.transport_friday_pm_door_to_door_address
    }
  ];
  const defaultMode =
    schedule.transportation_mode ??
    existingSlots.find((slot) => slot.mode)?.mode ??
    null;
  const defaultBusNumber =
    schedule.transport_bus_number ??
    existingSlots.find((slot) => slot.busNumber)?.busNumber ??
    null;
  const defaultBusStop =
    schedule.transportation_bus_stop ??
    existingSlots.find((slot) => slot.busStop)?.busStop ??
    null;
  const fallbackDoorToDoorAddress =
    existingSlots.find((slot) => slot.doorToDoorAddress)?.doorToDoorAddress ??
    defaultDoorToDoorAddress;

  const resolveSlot = (
    dayEnabled: boolean,
    dayWasAdded: boolean,
    current: {
      mode: "Door to Door" | "Bus Stop" | null;
      doorToDoorAddress: string | null;
      busNumber: "1" | "2" | "3" | null;
      busStop: string | null;
    }
  ) => {
    if (!dayEnabled) {
      return { mode: null, doorToDoorAddress: null, busNumber: null, busStop: null } as const;
    }

    if (!dayWasAdded || schedule.transportation_required !== true) {
      return current;
    }

    const seededMode = current.mode ?? defaultMode;
    const seededBusNumber = seededMode ? (current.busNumber ?? defaultBusNumber) : null;
    const seededDoorToDoorAddress =
      seededMode === "Door to Door"
        ? (current.doorToDoorAddress ?? fallbackDoorToDoorAddress ?? null)
        : null;
    const seededBusStop =
      seededMode === "Bus Stop"
        ? (current.busStop ?? defaultBusStop ?? null)
        : null;

    return {
      mode: seededMode,
      doorToDoorAddress: seededDoorToDoorAddress,
      busNumber: seededBusNumber,
      busStop: seededBusStop
    } as const;
  };

  const mondayAm = resolveSlot(monday, mondayAdded, {
    mode: schedule.transport_monday_am_mode,
    doorToDoorAddress: schedule.transport_monday_am_door_to_door_address,
    busNumber: schedule.transport_monday_am_bus_number,
    busStop: schedule.transport_monday_am_bus_stop
  });
  const mondayPm = resolveSlot(monday, mondayAdded, {
    mode: schedule.transport_monday_pm_mode,
    doorToDoorAddress: schedule.transport_monday_pm_door_to_door_address,
    busNumber: schedule.transport_monday_pm_bus_number,
    busStop: schedule.transport_monday_pm_bus_stop
  });
  const tuesdayAm = resolveSlot(tuesday, tuesdayAdded, {
    mode: schedule.transport_tuesday_am_mode,
    doorToDoorAddress: schedule.transport_tuesday_am_door_to_door_address,
    busNumber: schedule.transport_tuesday_am_bus_number,
    busStop: schedule.transport_tuesday_am_bus_stop
  });
  const tuesdayPm = resolveSlot(tuesday, tuesdayAdded, {
    mode: schedule.transport_tuesday_pm_mode,
    doorToDoorAddress: schedule.transport_tuesday_pm_door_to_door_address,
    busNumber: schedule.transport_tuesday_pm_bus_number,
    busStop: schedule.transport_tuesday_pm_bus_stop
  });
  const wednesdayAm = resolveSlot(wednesday, wednesdayAdded, {
    mode: schedule.transport_wednesday_am_mode,
    doorToDoorAddress: schedule.transport_wednesday_am_door_to_door_address,
    busNumber: schedule.transport_wednesday_am_bus_number,
    busStop: schedule.transport_wednesday_am_bus_stop
  });
  const wednesdayPm = resolveSlot(wednesday, wednesdayAdded, {
    mode: schedule.transport_wednesday_pm_mode,
    doorToDoorAddress: schedule.transport_wednesday_pm_door_to_door_address,
    busNumber: schedule.transport_wednesday_pm_bus_number,
    busStop: schedule.transport_wednesday_pm_bus_stop
  });
  const thursdayAm = resolveSlot(thursday, thursdayAdded, {
    mode: schedule.transport_thursday_am_mode,
    doorToDoorAddress: schedule.transport_thursday_am_door_to_door_address,
    busNumber: schedule.transport_thursday_am_bus_number,
    busStop: schedule.transport_thursday_am_bus_stop
  });
  const thursdayPm = resolveSlot(thursday, thursdayAdded, {
    mode: schedule.transport_thursday_pm_mode,
    doorToDoorAddress: schedule.transport_thursday_pm_door_to_door_address,
    busNumber: schedule.transport_thursday_pm_bus_number,
    busStop: schedule.transport_thursday_pm_bus_stop
  });
  const fridayAm = resolveSlot(friday, fridayAdded, {
    mode: schedule.transport_friday_am_mode,
    doorToDoorAddress: schedule.transport_friday_am_door_to_door_address,
    busNumber: schedule.transport_friday_am_bus_number,
    busStop: schedule.transport_friday_am_bus_stop
  });
  const fridayPm = resolveSlot(friday, fridayAdded, {
    mode: schedule.transport_friday_pm_mode,
    doorToDoorAddress: schedule.transport_friday_pm_door_to_door_address,
    busNumber: schedule.transport_friday_pm_bus_number,
    busStop: schedule.transport_friday_pm_bus_stop
  });

  const derivePeriod = (
    dayEnabled: boolean,
    amMode: "Door to Door" | "Bus Stop" | null,
    pmMode: "Door to Door" | "Bus Stop" | null
  ) => {
    if (!dayEnabled) return null;
    if (amMode) return "AM";
    if (pmMode) return "PM";
    return null;
  };

  updateMockRecord("memberAttendanceSchedules", schedule.id, {
    enrollment_date: enrollmentDate,
    monday,
    tuesday,
    wednesday,
    thursday,
    friday,
    // Current operations are full-day only; half-day toggle is intentionally disabled.
    full_day: true,
    transport_monday_period: derivePeriod(monday, mondayAm.mode, mondayPm.mode),
    transport_tuesday_period: derivePeriod(tuesday, tuesdayAm.mode, tuesdayPm.mode),
    transport_wednesday_period: derivePeriod(wednesday, wednesdayAm.mode, wednesdayPm.mode),
    transport_thursday_period: derivePeriod(thursday, thursdayAm.mode, thursdayPm.mode),
    transport_friday_period: derivePeriod(friday, fridayAm.mode, fridayPm.mode),
    transport_monday_am_mode: mondayAm.mode,
    transport_monday_am_door_to_door_address: mondayAm.doorToDoorAddress,
    transport_monday_am_bus_number: mondayAm.busNumber,
    transport_monday_am_bus_stop: mondayAm.busStop,
    transport_monday_pm_mode: mondayPm.mode,
    transport_monday_pm_door_to_door_address: mondayPm.doorToDoorAddress,
    transport_monday_pm_bus_number: mondayPm.busNumber,
    transport_monday_pm_bus_stop: mondayPm.busStop,
    transport_tuesday_am_mode: tuesdayAm.mode,
    transport_tuesday_am_door_to_door_address: tuesdayAm.doorToDoorAddress,
    transport_tuesday_am_bus_number: tuesdayAm.busNumber,
    transport_tuesday_am_bus_stop: tuesdayAm.busStop,
    transport_tuesday_pm_mode: tuesdayPm.mode,
    transport_tuesday_pm_door_to_door_address: tuesdayPm.doorToDoorAddress,
    transport_tuesday_pm_bus_number: tuesdayPm.busNumber,
    transport_tuesday_pm_bus_stop: tuesdayPm.busStop,
    transport_wednesday_am_mode: wednesdayAm.mode,
    transport_wednesday_am_door_to_door_address: wednesdayAm.doorToDoorAddress,
    transport_wednesday_am_bus_number: wednesdayAm.busNumber,
    transport_wednesday_am_bus_stop: wednesdayAm.busStop,
    transport_wednesday_pm_mode: wednesdayPm.mode,
    transport_wednesday_pm_door_to_door_address: wednesdayPm.doorToDoorAddress,
    transport_wednesday_pm_bus_number: wednesdayPm.busNumber,
    transport_wednesday_pm_bus_stop: wednesdayPm.busStop,
    transport_thursday_am_mode: thursdayAm.mode,
    transport_thursday_am_door_to_door_address: thursdayAm.doorToDoorAddress,
    transport_thursday_am_bus_number: thursdayAm.busNumber,
    transport_thursday_am_bus_stop: thursdayAm.busStop,
    transport_thursday_pm_mode: thursdayPm.mode,
    transport_thursday_pm_door_to_door_address: thursdayPm.doorToDoorAddress,
    transport_thursday_pm_bus_number: thursdayPm.busNumber,
    transport_thursday_pm_bus_stop: thursdayPm.busStop,
    transport_friday_am_mode: fridayAm.mode,
    transport_friday_am_door_to_door_address: fridayAm.doorToDoorAddress,
    transport_friday_am_bus_number: fridayAm.busNumber,
    transport_friday_am_bus_stop: fridayAm.busStop,
    transport_friday_pm_mode: fridayPm.mode,
    transport_friday_pm_door_to_door_address: fridayPm.doorToDoorAddress,
    transport_friday_pm_bus_number: fridayPm.busNumber,
    transport_friday_pm_bus_stop: fridayPm.busStop,
    make_up_days_available: (() => {
      const raw = asString(formData, "makeUpDaysAvailable");
      if (!raw) return null;
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : null;
    })(),
    attendance_notes: asNullableString(formData, "attendanceNotes"),
    updated_by_user_id: actor.id,
    updated_by_name: actor.full_name,
    updated_at: now
  });

  updateMemberEnrollmentFromSchedule(memberId, enrollmentDate);

  revalidateCommandCenter(memberId);
  return { ok: true };
}

export async function saveMemberCommandCenterTransportationAction(formData: FormData) {
  try {
    const actor = await requireCommandCenterEditor();
    const memberId = asString(formData, "memberId");
    if (!memberId) return { ok: false, error: "Member is required." };

    const schedule = ensureMemberAttendanceSchedule(memberId);
    if (!schedule) return { ok: false, error: "Attendance schedule not found." };
    const commandCenterProfile = ensureMemberCommandCenterProfile(memberId);
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
    const normalizeMode = (raw: string) =>
      MEMBER_TRANSPORTATION_SERVICE_OPTIONS.includes(raw as (typeof MEMBER_TRANSPORTATION_SERVICE_OPTIONS)[number])
        ? (raw as "Door to Door" | "Bus Stop")
        : null;
    const normalizeBusNumber = (raw: string) =>
      MEMBER_BUS_NUMBER_OPTIONS.includes(raw as (typeof MEMBER_BUS_NUMBER_OPTIONS)[number])
        ? (raw as "1" | "2" | "3")
        : null;
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

    const updatedSchedule = updateMockRecord("memberAttendanceSchedules", schedule.id, {
      transportation_required: transportationRequired,
      transportation_mode: transportationRequired === true ? firstMode : null,
      transport_bus_number: transportationRequired === true ? firstBusNumber : null,
      transportation_bus_stop: transportationRequired === true && firstMode === "Bus Stop" ? firstBusStop : null,
      transport_monday_period: schedule.monday ? (mondayAm.mode ? "AM" : mondayPm.mode ? "PM" : null) : null,
      transport_tuesday_period: schedule.tuesday ? (tuesdayAm.mode ? "AM" : tuesdayPm.mode ? "PM" : null) : null,
      transport_wednesday_period: schedule.wednesday ? (wednesdayAm.mode ? "AM" : wednesdayPm.mode ? "PM" : null) : null,
      transport_thursday_period: schedule.thursday ? (thursdayAm.mode ? "AM" : thursdayPm.mode ? "PM" : null) : null,
      transport_friday_period: schedule.friday ? (fridayAm.mode ? "AM" : fridayPm.mode ? "PM" : null) : null,
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
      transport_friday_pm_bus_stop: schedule.friday ? fridayPm.busStop : null,
      updated_by_user_id: actor.id,
      updated_by_name: actor.full_name,
      updated_at: now
    });
    if (!updatedSchedule) {
      return { ok: false, error: "Unable to save transportation updates." };
    }

    upsertBusStopDirectoryFromValues({
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
      ],
      actor,
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

export async function saveMemberCommandCenterDemographicsAction(formData: FormData) {
  const actor = await requireCommandCenterEditor();
  const memberId = asString(formData, "memberId");
  if (!memberId) return { ok: false, error: "Member is required." };

  const profile = ensureMemberCommandCenterProfile(memberId);
  const now = toEasternISO();
  const city = asNullableString(formData, "city");
  const isVeteran = asNullableBoolSelect(formData, "isVeteran");
  const veteranBranch = isVeteran ? asNullableString(formData, "veteranBranch") : null;
  const rawGender = asString(formData, "gender");
  const gender = rawGender === "M" || rawGender === "F" ? rawGender : null;
  const memberDisplayName = asString(formData, "memberDisplayName");
  const memberDob = asNullableString(formData, "memberDob");

  updateMockRecord("memberCommandCenters", profile.id, {
    gender,
    street_address: asNullableString(formData, "streetAddress"),
    city,
    state: asNullableString(formData, "state"),
    zip: asNullableString(formData, "zip"),
    marital_status: asNullableString(formData, "maritalStatus"),
    primary_language: asNullableString(formData, "primaryLanguage") ?? "English",
    secondary_language: asNullableString(formData, "secondaryLanguage"),
    religion: asNullableString(formData, "religion"),
    ethnicity: asNullableString(formData, "ethnicity"),
    is_veteran: isVeteran,
    veteran_branch: veteranBranch,
    updated_by_user_id: actor.id,
    updated_by_name: actor.full_name,
    updated_at: now
  });

  const memberPatch: Record<string, string | null> = { city };
  if (memberDisplayName.length > 0) {
    memberPatch.display_name = memberDisplayName;
  }
  updateMockRecord("members", memberId, memberPatch);
  updateMemberDobFromCommandCenter(memberId, memberDob);
  syncCommandCenterToMhp(
    memberId,
    {
      id: actor.id,
      fullName: actor.full_name
    },
    now
  );

  revalidateCommandCenter(memberId);
  return { ok: true };
}

export async function saveMemberCommandCenterLegalAction(formData: FormData) {
  const actor = await requireCommandCenterEditor();
  const memberId = asString(formData, "memberId");
  if (!memberId) return { ok: false, error: "Member is required." };

  const now = toEasternISO();
  const profile = ensureMemberCommandCenterProfile(memberId);
  const codeStatusInput = asNullableString(formData, "codeStatus");
  const dnrInput = asNullableBoolSelect(formData, "dnr");
  const codeStatus =
    codeStatusInput ?? (dnrInput === true ? "DNR" : dnrInput === false ? "Full Code" : null);
  const dnr = codeStatus === "DNR" ? true : codeStatus === "Full Code" ? false : dnrInput;

  updateMockRecord("memberCommandCenters", profile.id, {
    code_status: codeStatus,
    dnr,
    dni: asNullableBoolSelect(formData, "dni"),
    polst_molst_colst: asNullableString(formData, "polstMolstColst"),
    hospice: asNullableBoolSelect(formData, "hospice"),
    advanced_directives_obtained: asNullableBoolSelect(formData, "advancedDirectivesObtained"),
    power_of_attorney: asNullableString(formData, "powerOfAttorney"),
    legal_comments: asNullableString(formData, "legalComments"),
    updated_by_user_id: actor.id,
    updated_by_name: actor.full_name,
    updated_at: now
  });

  updateMockRecord("members", memberId, { code_status: codeStatus });
  syncCommandCenterToMhp(
    memberId,
    {
      id: actor.id,
      fullName: actor.full_name
    },
    now
  );

  revalidateCommandCenter(memberId);
  return { ok: true };
}

export async function saveMemberCommandCenterDietAction(formData: FormData) {
  const actor = await requireCommandCenterEditor();
  const memberId = asString(formData, "memberId");
  if (!memberId) return { ok: false, error: "Member is required." };

  const now = toEasternISO();
  const profile = ensureMemberCommandCenterProfile(memberId);
  const dietType = asString(formData, "dietType");
  const dietTypeOther = asNullableString(formData, "dietTypeOther");
  const normalizedDietType = dietType === "Other" ? (dietTypeOther ?? "Other") : dietType || "Regular";

  updateMockRecord("memberCommandCenters", profile.id, {
    diet_type: normalizedDietType,
    dietary_preferences_restrictions: asNullableString(formData, "dietaryPreferencesRestrictions"),
    swallowing_difficulty: asNullableString(formData, "swallowingDifficulty"),
    supplements: asNullableString(formData, "supplements"),
    food_dislikes: asNullableString(formData, "foodDislikes"),
    foods_to_omit: asNullableString(formData, "foodsToOmit"),
    diet_texture: asNullableString(formData, "dietTexture") ?? "Regular",
    command_center_notes: asNullableString(formData, "commandCenterNotes"),
    updated_by_user_id: actor.id,
    updated_by_name: actor.full_name,
    updated_at: now
  });
  syncCommandCenterToMhp(
    memberId,
    {
      id: actor.id,
      fullName: actor.full_name
    },
    now,
    { syncAllergies: true }
  );

  revalidateCommandCenter(memberId);
  return { ok: true };
}

export async function addMemberCommandCenterAllergyInlineAction(formData: FormData) {
  try {
    const actor = await requireCommandCenterEditor();
    const memberId = asString(formData, "memberId");
    if (!memberId) return { ok: false, error: "Member is required." };

    const allergyGroupRaw = asString(formData, "allergyGroup");
    const allergyGroup =
      allergyGroupRaw === "food" || allergyGroupRaw === "medication" || allergyGroupRaw === "environmental"
        ? allergyGroupRaw
        : null;
    const allergyName = asString(formData, "allergyName");
    if (!allergyGroup || !allergyName) return { ok: false, error: "Allergy group and name are required." };

    const now = toEasternISO();
    const created = addMockRecord("memberAllergies", {
      member_id: memberId,
      allergy_group: allergyGroup,
      allergy_name: allergyName,
      severity: asNullableString(formData, "allergySeverity"),
      comments: asNullableString(formData, "allergyComments"),
      created_by_user_id: actor.id,
      created_by_name: actor.full_name,
      created_at: now,
      updated_at: now
    });

    syncMhpToCommandCenter(
      memberId,
      {
        id: actor.id,
        fullName: actor.full_name
      },
      now
    );

    revalidateCommandCenter(memberId);
    return { ok: true, row: created };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unable to add allergy." };
  }
}

export async function updateMemberCommandCenterAllergyInlineAction(formData: FormData) {
  try {
    const actor = await requireCommandCenterEditor();
    const memberId = asString(formData, "memberId");
    const allergyId = asString(formData, "allergyId");
    if (!memberId || !allergyId) return { ok: false, error: "Missing allergy reference." };

    const allergyGroupRaw = asString(formData, "allergyGroup");
    const allergyGroup =
      allergyGroupRaw === "food" || allergyGroupRaw === "medication" || allergyGroupRaw === "environmental"
        ? allergyGroupRaw
        : null;
    const allergyName = asString(formData, "allergyName");
    if (!allergyGroup || !allergyName) return { ok: false, error: "Allergy group and name are required." };

    const now = toEasternISO();
    const updated = updateMockRecord("memberAllergies", allergyId, {
      allergy_group: allergyGroup,
      allergy_name: allergyName,
      severity: asNullableString(formData, "allergySeverity"),
      comments: asNullableString(formData, "allergyComments"),
      updated_at: now
    });
    if (!updated) return { ok: false, error: "Allergy not found." };

    syncMhpToCommandCenter(
      memberId,
      {
        id: actor.id,
        fullName: actor.full_name
      },
      now
    );

    revalidateCommandCenter(memberId);
    return { ok: true, row: updated };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unable to update allergy." };
  }
}

export async function deleteMemberCommandCenterAllergyInlineAction(formData: FormData) {
  try {
    const actor = await requireCommandCenterEditor();
    const memberId = asString(formData, "memberId");
    const allergyId = asString(formData, "allergyId");
    if (!memberId || !allergyId) return { ok: false, error: "Missing allergy reference." };

    const removed = removeMockRecord("memberAllergies", allergyId);
    if (!removed) return { ok: false, error: "Allergy not found." };

    const now = toEasternISO();
    syncMhpToCommandCenter(
      memberId,
      {
        id: actor.id,
        fullName: actor.full_name
      },
      now
    );

    revalidateCommandCenter(memberId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unable to delete allergy." };
  }
}

export async function upsertMemberContactAction(raw: {
  id?: string;
  memberId: string;
  contactName: string;
  relationshipToMember?: string;
  category: string;
  categoryOther?: string;
  email?: string;
  cellularNumber?: string;
  workNumber?: string;
  homeNumber?: string;
  streetAddress?: string;
  city?: string;
  state?: string;
  zip?: string;
}) {
  try {
    const actor = await requireCommandCenterEditor();
    const memberId = raw.memberId?.trim();
    const contactName = raw.contactName?.trim();
    const category = raw.category?.trim();

    if (!memberId || !contactName || !category) {
      return { error: "Member, contact name, and category are required." };
    }

    const normalizedCategory = MEMBER_CONTACT_CATEGORY_OPTIONS.includes(category as (typeof MEMBER_CONTACT_CATEGORY_OPTIONS)[number])
      ? category
      : "Other";
    const categoryOther = raw.categoryOther?.trim() || null;
    if (normalizedCategory === "Other" && !categoryOther) {
      return { error: "Custom category is required when category is Other." };
    }

    const now = toEasternISO();

    if (raw.id?.trim()) {
      const updated = updateMockRecord("memberContacts", raw.id.trim(), {
        member_id: memberId,
        contact_name: contactName,
        relationship_to_member: raw.relationshipToMember?.trim() || null,
        category: normalizedCategory,
        category_other: normalizedCategory === "Other" ? categoryOther : null,
        email: raw.email?.trim() || null,
        cellular_number: raw.cellularNumber?.trim() || null,
        work_number: raw.workNumber?.trim() || null,
        home_number: raw.homeNumber?.trim() || null,
        street_address: raw.streetAddress?.trim() || null,
        city: raw.city?.trim() || null,
        state: raw.state?.trim() || null,
        zip: raw.zip?.trim() || null,
        updated_at: now
      });
      if (!updated) return { error: "Contact not found." };
      revalidateCommandCenter(memberId);
      return { ok: true, row: updated };
    } else {
      const created = addMockRecord("memberContacts", {
        member_id: memberId,
        contact_name: contactName,
        relationship_to_member: raw.relationshipToMember?.trim() || null,
        category: normalizedCategory,
        category_other: normalizedCategory === "Other" ? categoryOther : null,
        email: raw.email?.trim() || null,
        cellular_number: raw.cellularNumber?.trim() || null,
        work_number: raw.workNumber?.trim() || null,
        home_number: raw.homeNumber?.trim() || null,
        street_address: raw.streetAddress?.trim() || null,
        city: raw.city?.trim() || null,
        state: raw.state?.trim() || null,
        zip: raw.zip?.trim() || null,
        created_by_user_id: actor.id,
        created_by_name: actor.full_name,
        created_at: now,
        updated_at: now
      });
      revalidateCommandCenter(memberId);
      return { ok: true, row: created };
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to save contact." };
  }
}

export async function deleteMemberContactAction(raw: { id: string; memberId: string }) {
  try {
    await requireCommandCenterEditor();
    const id = raw.id?.trim();
    const memberId = raw.memberId?.trim();
    if (!id || !memberId) return { error: "Invalid contact delete request." };

    const removed = removeMockRecord("memberContacts", id);
    if (!removed) return { error: "Contact not found." };

    revalidateCommandCenter(memberId);
    return { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to delete contact." };
  }
}

export async function addMemberFileAction(raw: {
  memberId: string;
  fileName: string;
  fileType?: string;
  fileDataUrl?: string;
  category: string;
  categoryOther?: string;
  documentSource?: string;
}) {
  try {
    const actor = await requireCommandCenterEditor();
    const memberId = raw.memberId?.trim();
    const fileName = raw.fileName?.trim();
    const category = raw.category?.trim();

    if (!memberId || !fileName || !category) {
      return { error: "Member, file, and category are required." };
    }

    const normalizedCategory = MEMBER_FILE_CATEGORY_OPTIONS.includes(category as (typeof MEMBER_FILE_CATEGORY_OPTIONS)[number])
      ? category
      : "Other";
    const categoryOther = raw.categoryOther?.trim() || null;
    if (normalizedCategory === "Other" && !categoryOther) {
      return { error: "Custom file category is required when category is Other." };
    }

    const now = toEasternISO();

    addMockRecord("memberFiles", {
      member_id: memberId,
      file_name: fileName,
      file_type: raw.fileType?.trim() || "application/octet-stream",
      file_data_url: raw.fileDataUrl?.trim() || null,
      category: normalizedCategory,
      category_other: normalizedCategory === "Other" ? categoryOther : null,
      document_source: raw.documentSource?.trim() || null,
      uploaded_by_user_id: actor.id,
      uploaded_by_name: actor.full_name,
      uploaded_at: now,
      updated_at: now
    });

    revalidateCommandCenter(memberId);
    return { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to upload file." };
  }
}

export async function deleteMemberFileAction(raw: { id: string; memberId: string }) {
  try {
    await requireCommandCenterEditor();
    const id = raw.id?.trim();
    const memberId = raw.memberId?.trim();
    if (!id || !memberId) return { error: "Invalid file delete request." };

    const removed = removeMockRecord("memberFiles", id);
    if (!removed) return { error: "File not found." };

    revalidateCommandCenter(memberId);
    return { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to delete file." };
  }
}
