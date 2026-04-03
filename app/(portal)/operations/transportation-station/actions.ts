"use server";

import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/auth";
import { normalizePhoneForStorage } from "@/lib/phone";
import { normalizeRoleKey } from "@/lib/permissions";
import { resolveCanonicalMemberId } from "@/lib/services/canonical-person-ref";
import { normalizeOperationalDateOnly } from "@/lib/services/operations-calendar";
import { getConfiguredBusNumbers } from "@/lib/services/operations-settings";
import { getTransportationCopySnapshot } from "@/lib/services/transportation-read";
import {
  postTransportationRunSupabase,
  type TransportationRunManualExclusionInput
} from "@/lib/services/transportation-run-posting";
import {
  findTransportationManifestAdjustmentSupabase,
  removeTransportationManifestAdjustmentSupabase,
  resolvePreferredMemberContactSupabase,
  upsertTransportationManifestAdjustmentSupabase
} from "@/lib/services/transportation-station-supabase";
import { toEasternISO } from "@/lib/timezone";

type Shift = "AM" | "PM";
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
  const memberId = await resolveCanonicalMemberId(asString(formData, "memberId"), {
    actionLabel: "addTransportationManifestRiderAction"
  });
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

export async function searchTransportationAddRiderMembersAction(input: { q?: string; selectedId?: string | null; limit?: number }) {
  await requireTransportationEditor();
  const { getTransportationAddRiderMembers } = await import("@/lib/services/transportation-read");
  return getTransportationAddRiderMembers({
    q: String(input.q ?? "").trim(),
    selectedId: String(input.selectedId ?? "").trim() || null,
    limit: typeof input.limit === "number" ? input.limit : undefined
  });
}

export async function excludeTransportationManifestRiderAction(formData: FormData) {
  const actor = await requireTransportationEditor();
  const busNumberOptions = await getConfiguredBusNumbers();
  const selectedDate = normalizeDateOnly(asString(formData, "selectedDate"));
  const memberId = await resolveCanonicalMemberId(asString(formData, "memberId"), {
    actionLabel: "excludeTransportationManifestRiderAction"
  });
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
  const actor = await requireTransportationEditor();
  const memberId = await resolveCanonicalMemberId(asString(formData, "memberId"), {
    actionLabel: "reassignTransportationManifestBusAction"
  });
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
    return { ok: false as const, error: "Bus assignment is required." };
  }
  if (!transportType) {
    return { ok: false as const, error: "Transport type is required." };
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
  return { ok: true as const, success: "Bus assignment updated." };
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
    const copySnapshot = await getTransportationCopySnapshot({
      memberId: asString(formData, "memberId"),
      sourceDate: normalizeDateOnly(asString(formData, "sourceDate")),
      targetDate: normalizeDateOnly(asString(formData, "targetDate")),
      shift: normalizeShift(asString(formData, "shift"))
    });
    if (!copySnapshot) {
      return { ok: false as const, error: "No transport details found for that member/date/shift." };
    }

    return {
      ok: true as const,
      unchanged: copySnapshot.unchanged,
      snapshot: copySnapshot.snapshot
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
