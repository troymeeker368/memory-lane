"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getCurrentProfile } from "@/lib/auth";
import { normalizePhoneForStorage } from "@/lib/phone";
import { normalizeRoleKey } from "@/lib/permissions";
import { resolveCanonicalMemberRef } from "@/lib/services/canonical-person-ref";
import { normalizeOperationalDateOnly } from "@/lib/services/operations-calendar";
import { getConfiguredBusNumbers } from "@/lib/services/operations-settings";
import {
  postTransportationRunSupabase,
  type TransportationRunManualExclusionInput
} from "@/lib/services/transportation-run-posting";
import {
  findTransportationManifestAdjustmentSupabase,
  getTransportationManifestSupabase,
  removeTransportationManifestAdjustmentSupabase,
  resolvePreferredMemberContactSupabase,
  upsertTransportationManifestAdjustmentSupabase
} from "@/lib/services/transportation-station-supabase";
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
  const role = normalizeRoleKey(profile.role);
  if (
    role !== "admin" &&
    role !== "manager" &&
    role !== "director" &&
    role !== "coordinator"
  ) {
    throw new Error("Transportation Station editing is limited to coordinators, managers, directors, and admins.");
  }
  return profile;
}

function revalidateTransportationStation() {
  revalidatePath("/operations/transportation-station");
  revalidatePath("/operations/transportation-station/print");
  revalidatePath("/operations/member-command-center");
  revalidatePath("/operations/attendance");
  revalidatePath("/documentation/transportation");
}

async function resolvePreferredContact(memberId: string, explicitContactId?: string | null) {
  return resolvePreferredMemberContactSupabase(memberId, explicitContactId);
}

async function resolveTransportationMemberId(rawMemberId: string, actionLabel: string) {
  const canonical = await resolveCanonicalMemberRef(
    {
      sourceType: "member",
      memberId: rawMemberId
    },
    { actionLabel }
  );
  if (!canonical.memberId) {
    throw new Error(`${actionLabel} expected member.id but canonical member resolution returned empty memberId.`);
  }
  return canonical.memberId;
}

async function upsertAdjustment(input: {
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
  return upsertTransportationManifestAdjustmentSupabase({
    selectedDate: input.date,
    shift: input.shift,
    memberId: input.memberId,
    adjustmentType: input.adjustmentType,
    busNumber: input.busNumber ?? null,
    transportType: input.transportType ?? null,
    busStopName: input.busStopName ?? null,
    doorToDoorAddress: input.doorToDoorAddress ?? null,
    caregiverContactId: input.caregiverContactId ?? null,
    caregiverContactNameSnapshot: input.caregiverContactNameSnapshot ?? null,
    caregiverContactPhoneSnapshot: input.caregiverContactPhoneSnapshot ?? null,
    caregiverContactAddressSnapshot: input.caregiverContactAddressSnapshot ?? null,
    notes: input.notes ?? null,
    actorUserId: input.actorUserId,
    actorName: input.actorName,
    nowIso: toEasternISO()
  });
}

export async function addTransportationManifestRiderAction(formData: FormData) {
  const actor = await requireTransportationEditor();
  const busNumberOptions = await getConfiguredBusNumbers();
  const selectedDate = normalizeDateOnly(asString(formData, "selectedDate"));
  const memberId = await resolveTransportationMemberId(asString(formData, "memberId"), "addTransportationManifestRiderAction");
  const shiftInput = asString(formData, "shift");
  const transportType = normalizeTransportMode(asString(formData, "transportType")) ?? "Door to Door";
  const busNumber = normalizeBusNumber(asString(formData, "busNumber"), busNumberOptions);
  const busStopName = asNullableString(formData, "busStopName");
  const doorToDoorAddress = asNullableString(formData, "doorToDoorAddress");
  const caregiverContactId = asNullableString(formData, "caregiverContactId");
  const caregiverContactName = asNullableString(formData, "caregiverContactName");
  const caregiverContactPhone = normalizePhoneForStorage(asNullableString(formData, "caregiverContactPhone"));
  const caregiverContactAddress = asNullableString(formData, "caregiverContactAddress");
  const notes = asNullableString(formData, "notes");

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
  const contact = await resolvePreferredContact(memberId, caregiverContactId);

  for (const shift of shifts) {
    await upsertAdjustment({
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
  }

  revalidateTransportationStation();
}

export async function excludeTransportationManifestRiderAction(formData: FormData) {
  const actor = await requireTransportationEditor();
  const busNumberOptions = await getConfiguredBusNumbers();
  const selectedDate = normalizeDateOnly(asString(formData, "selectedDate"));
  const memberId = await resolveTransportationMemberId(asString(formData, "memberId"), "excludeTransportationManifestRiderAction");
  const shift = normalizeShift(asString(formData, "shift"));
  const busNumber = normalizeBusNumber(asString(formData, "busNumber"), busNumberOptions);
  const transportType = normalizeTransportMode(asString(formData, "transportType"));
  const busStopName = asNullableString(formData, "busStopName");
  const doorToDoorAddress = asNullableString(formData, "doorToDoorAddress");
  const caregiverContactId = asNullableString(formData, "caregiverContactId");
  const caregiverContactName = asNullableString(formData, "caregiverContactName");
  const caregiverContactPhone = normalizePhoneForStorage(asNullableString(formData, "caregiverContactPhone"));
  const caregiverContactAddress = asNullableString(formData, "caregiverContactAddress");
  const notes = asNullableString(formData, "notes");

  await upsertAdjustment({
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
  const busNumberOptions = await getConfiguredBusNumbers();
  const selectedDate = normalizeDateOnly(asString(formData, "selectedDate"));
  const shift = normalizeShift(asString(formData, "shift"));
  const busFilter = normalizeBusFilter(asString(formData, "busFilter"), busNumberOptions);
  const failureHref = (message: string) =>
    buildStationHref({ selectedDate, shift, busFilter, error: message });
  const actor = await requireTransportationEditor();
  const memberId = await resolveTransportationMemberId(asString(formData, "memberId"), "reassignTransportationManifestBusAction");
  const busNumber = normalizeBusNumber(asString(formData, "busNumber"), busNumberOptions);
  const transportType = normalizeTransportMode(asString(formData, "transportType"));
  const busStopName = asNullableString(formData, "busStopName");
  const doorToDoorAddress = asNullableString(formData, "doorToDoorAddress");
  const caregiverContactId = asNullableString(formData, "caregiverContactId");
  const caregiverContactName = asNullableString(formData, "caregiverContactName");
  const caregiverContactPhone = normalizePhoneForStorage(asNullableString(formData, "caregiverContactPhone"));
  const caregiverContactAddress = asNullableString(formData, "caregiverContactAddress");
  const notes = asNullableString(formData, "notes");

  if (!busNumber) {
    redirect(failureHref("Bus assignment is required."));
  }
  if (!transportType) {
    redirect(failureHref("Transport type is required."));
  }

  const exclusion = await findTransportationManifestAdjustmentSupabase({
    selectedDate,
    shift,
    memberId,
    adjustmentType: "exclude"
  });
  if (exclusion) {
    await removeTransportationManifestAdjustmentSupabase(exclusion.id);
  }

  // Reassignments from Transportation Station are one-day operational overrides only.
  // They intentionally do not mutate the recurring MCC transportation schedule.
  await upsertAdjustment({
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

  await removeTransportationManifestAdjustmentSupabase(adjustmentId);

  revalidateTransportationStation();
}

export async function copyForwardTransportationDetailsAction(formData: FormData) {
  try {
    await requireTransportationEditor();
    const memberId = await resolveTransportationMemberId(asString(formData, "memberId"), "copyForwardTransportationDetailsAction");
    const sourceDate = normalizeDateOnly(asString(formData, "sourceDate"));
    const targetDate = normalizeDateOnly(asString(formData, "targetDate"));
    const shift = normalizeShift(asString(formData, "shift"));

    const sourceManifest = await getTransportationManifestSupabase({
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

    const targetManifest = await getTransportationManifestSupabase({
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

export async function postTransportationRunAction(input: {
  selectedDate: string;
  shift: Shift;
  busNumber: string;
  manualExclusions?: TransportationRunManualExclusionInput[];
}) {
  try {
    const actor = await requireTransportationEditor();
    const result = await postTransportationRunSupabase({
      selectedDate: input.selectedDate,
      shift: input.shift === "PM" ? "PM" : "AM",
      busNumber: String(input.busNumber ?? "").trim(),
      actor: {
        id: actor.id,
        fullName: actor.full_name,
        role: actor.role
      },
      manualExclusions: input.manualExclusions ?? []
    });

    revalidateTransportationStation();
    return { ok: true as const, result };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Unable to post transportation run."
    };
  }
}
