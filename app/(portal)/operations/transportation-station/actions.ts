"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getCurrentProfile } from "@/lib/auth";
import { addMockRecord, getMockDb, removeMockRecord, updateMockRecord } from "@/lib/mock-repo";
import { normalizeOperationalDateOnly } from "@/lib/services/operations-calendar";
import { getConfiguredBusNumbers } from "@/lib/services/operations-settings";
import { getTransportationManifest } from "@/lib/services/transportation-station";
import { toEasternISO } from "@/lib/timezone";

type Shift = "AM" | "PM";
type TransportationStationShift = Shift | "Both";
type TransportMode = "Bus Stop" | "Door to Door";
type BusNumber = string;

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

function normalizeBusNumber(raw: string | null | undefined, busNumberOptions: string[]): BusNumber | null {
  const normalized = String(raw ?? "").trim();
  if (busNumberOptions.includes(normalized)) return normalized;
  return null;
}

function normalizeBusFilter(raw: string | null | undefined, busNumberOptions: string[]): "all" | "unassigned" | string {
  if (raw === "all" || raw === "unassigned") return raw;
  if (busNumberOptions.includes(String(raw ?? "").trim())) return String(raw ?? "").trim();
  return "all";
}

function buildStationHref(input: {
  selectedDate: string;
  shift: TransportationStationShift;
  busFilter: "all" | "unassigned" | string;
  error?: string;
  success?: string;
}): `/operations/transportation-station?${string}` {
  const params = new URLSearchParams();
  params.set("date", input.selectedDate);
  params.set("shift", input.shift);
  params.set("bus", input.busFilter);
  if (input.error) params.set("error", input.error);
  if (input.success) params.set("success", input.success);
  return `/operations/transportation-station?${params.toString()}`;
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

export async function addTransportationManifestRiderAction(formData: FormData) {
  const actor = await requireTransportationEditor();
  const busNumberOptions = getConfiguredBusNumbers();
  const selectedDate = normalizeDateOnly(asString(formData, "selectedDate"));
  const memberId = asString(formData, "memberId");
  const shiftInput = asString(formData, "shift");
  const transportType = normalizeTransportMode(asString(formData, "transportType")) ?? "Door to Door";
  const busNumber = normalizeBusNumber(asString(formData, "busNumber"), busNumberOptions);
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
  const busNumberOptions = getConfiguredBusNumbers();
  const selectedDate = normalizeDateOnly(asString(formData, "selectedDate"));
  const memberId = asString(formData, "memberId");
  const shift = normalizeShift(asString(formData, "shift"));
  const busNumber = normalizeBusNumber(asString(formData, "busNumber"), busNumberOptions);
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
  const busNumberOptions = getConfiguredBusNumbers();
  const selectedDate = normalizeDateOnly(asString(formData, "selectedDate"));
  const shift = normalizeShift(asString(formData, "shift"));
  const busFilter = normalizeBusFilter(asString(formData, "busFilter"), busNumberOptions);
  const failureHref = (message: string) =>
    buildStationHref({ selectedDate, shift, busFilter, error: message });
  const actor = await requireTransportationEditor();
  const memberId = asString(formData, "memberId");
  const busNumber = normalizeBusNumber(asString(formData, "busNumber"), busNumberOptions);
  const transportType = normalizeTransportMode(asString(formData, "transportType"));
  const busStopName = asNullableString(formData, "busStopName");
  const doorToDoorAddress = asNullableString(formData, "doorToDoorAddress");
  const caregiverContactId = asNullableString(formData, "caregiverContactId");
  const caregiverContactName = asNullableString(formData, "caregiverContactName");
  const caregiverContactPhone = asNullableString(formData, "caregiverContactPhone");
  const caregiverContactAddress = asNullableString(formData, "caregiverContactAddress");
  const notes = asNullableString(formData, "notes");

  if (!memberId) {
    redirect(failureHref("Member is required."));
  }
  if (!busNumber) {
    redirect(failureHref("Bus assignment is required."));
  }
  if (!transportType) {
    redirect(failureHref("Transport type is required."));
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

  // Reassignments from Transportation Station are one-day operational overrides only.
  // They intentionally do not mutate the recurring MCC transportation schedule.
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
  redirect(
    buildStationHref({
      selectedDate,
      shift,
      busFilter,
      success: "Bus assignment updated."
    })
  );
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

export async function copyForwardTransportationDetailsAction(formData: FormData) {
  try {
    await requireTransportationEditor();
    const memberId = asString(formData, "memberId");
    const sourceDate = normalizeDateOnly(asString(formData, "sourceDate"));
    const targetDate = normalizeDateOnly(asString(formData, "targetDate"));
    const shift = normalizeShift(asString(formData, "shift"));
    if (!memberId) {
      return { ok: false as const, error: "Member is required." };
    }

    const sourceManifest = getTransportationManifest({
      selectedDate: sourceDate,
      shift,
      busFilter: "all"
    });
    const sourceRider =
      sourceManifest.groups
        .flatMap((group) => group.riders)
        .find((rider) => rider.memberId === memberId && rider.shift === shift) ?? null;
    if (!sourceRider) {
      return { ok: false as const, error: "No transport details found for that member/date/shift." };
    }

    const targetManifest = getTransportationManifest({
      selectedDate: targetDate,
      shift,
      busFilter: "all"
    });
    const targetRider =
      targetManifest.groups
        .flatMap((group) => group.riders)
        .find((rider) => rider.memberId === memberId && rider.shift === shift) ?? null;
    const unchanged =
      Boolean(targetRider) &&
      targetRider?.transportType === sourceRider.transportType &&
      (targetRider?.busNumber ?? "") === (sourceRider.busNumber ?? "") &&
      (targetRider?.busStopName ?? "") === (sourceRider.busStopName ?? "") &&
      (targetRider?.doorToDoorAddress ?? "") === (sourceRider.doorToDoorAddress ?? "") &&
      (targetRider?.caregiverContactName ?? "") === (sourceRider.caregiverContactName ?? "") &&
      (targetRider?.caregiverContactPhone ?? "") === (sourceRider.caregiverContactPhone ?? "") &&
      (targetRider?.caregiverContactAddress ?? "") === (sourceRider.caregiverContactAddress ?? "");

    return {
      ok: true as const,
      unchanged,
      snapshot: {
        transportType: sourceRider.transportType,
        busNumber: sourceRider.busNumber ?? "",
        busStopName: sourceRider.busStopName ?? "",
        doorToDoorAddress: sourceRider.doorToDoorAddress ?? "",
        caregiverContactName: sourceRider.caregiverContactName ?? "",
        caregiverContactPhone: sourceRider.caregiverContactPhone ?? "",
        caregiverContactAddress: sourceRider.caregiverContactAddress ?? ""
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to copy transport details.";
    return { ok: false as const, error: message };
  }
}
