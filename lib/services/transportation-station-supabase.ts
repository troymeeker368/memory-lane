import { randomUUID } from "node:crypto";

import { createClient } from "@/lib/supabase/server";
import { resolveCanonicalMemberId } from "@/lib/services/canonical-person-ref";
import { normalizePhoneForStorage } from "@/lib/phone";
import { normalizeOperationalDateOnly, getWeekdayForDate, type OperationsWeekdayKey } from "@/lib/services/operations-calendar";
import {
  buildTransportLocationLabel,
  getTransportSlotForScheduleDay,
  toScheduleWeekdayKey
} from "@/lib/services/member-schedule-selectors";
import { getConfiguredBusNumbers } from "@/lib/services/operations-settings";
import {
  loadExpectedAttendanceSupabaseContext,
  resolveExpectedAttendanceFromSupabaseContext
} from "@/lib/services/expected-attendance-supabase";
import type { ScheduleWeekdayKey } from "@/lib/services/schedule-changes-supabase";
import {
  type MemberAttendanceScheduleRow,
  type MemberContactRow
} from "@/lib/services/member-command-center-read";
import { listPreferredContactsByMemberSupabase } from "@/lib/services/transportation-contact-preferences-supabase";

type Shift = "AM" | "PM";
type TransportMode = "Bus Stop" | "Door to Door";
type BusNumber = string;

export interface TransportationManifestAdjustmentRow {
  id: string;
  selected_date: string;
  shift: Shift;
  member_id: string;
  adjustment_type: "add" | "exclude";
  bus_number: string | null;
  transport_type: TransportMode | null;
  bus_stop_name: string | null;
  door_to_door_address: string | null;
  caregiver_contact_id: string | null;
  caregiver_contact_name_snapshot: string | null;
  caregiver_contact_phone_snapshot: string | null;
  caregiver_contact_address_snapshot: string | null;
  notes: string | null;
  created_by_user_id: string | null;
  created_by_name: string;
  created_at: string;
}

export type TransportationStationShift = Shift | "Both";
export type TransportationManifestRiderSource = "schedule" | "manual-add";
export type TransportationManifestBusFilter = BusNumber | "all" | "unassigned";

export interface TransportationManifestRider {
  key: string;
  adjustmentId: string | null;
  memberId: string;
  memberName: string;
  shift: Shift;
  busNumber: BusNumber | null;
  transportType: TransportMode;
  locationLabel: string;
  busStopName: string | null;
  doorToDoorAddress: string | null;
  caregiverContactId: string | null;
  caregiverContactName: string | null;
  caregiverContactPhone: string | null;
  caregiverContactAddress: string | null;
  notes: string | null;
  source: TransportationManifestRiderSource;
}

export interface TransportationManifestGroup {
  busNumber: BusNumber | null;
  label: string;
  riders: TransportationManifestRider[];
}

export interface TransportationManifestAdjustmentSummary {
  id: string;
  memberId: string;
  memberName: string;
  shift: Shift;
  createdAt: string;
  createdByName: string;
  adjustmentType: "add" | "exclude";
  busNumber: BusNumber | null;
  transportType: TransportMode | null;
}

export interface TransportationManifestResult {
  selectedDate: string;
  selectedShift: TransportationStationShift;
  weekday: OperationsWeekdayKey;
  generatedAt: string;
  totalRiders: number;
  groups: TransportationManifestGroup[];
  manualAdditions: TransportationManifestAdjustmentSummary[];
  exclusions: TransportationManifestAdjustmentSummary[];
  excludedScheduledRiders: TransportationManifestRider[];
  holdExcludedScheduledRiders: TransportationManifestRider[];
}

type PostgrestErrorLike = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

function shiftsForSelection(selection: TransportationStationShift): Shift[] {
  if (selection === "Both") return ["AM", "PM"];
  return [selection];
}

function sortRiders(left: TransportationManifestRider, right: TransportationManifestRider) {
  const byName = left.memberName.localeCompare(right.memberName, undefined, { sensitivity: "base" });
  if (byName !== 0) return byName;
  if (left.shift === right.shift) return 0;
  return left.shift === "AM" ? -1 : 1;
}

function sortGroups(left: TransportationManifestGroup, right: TransportationManifestGroup) {
  if (left.busNumber == null && right.busNumber == null) {
    return left.label.localeCompare(right.label, undefined, { sensitivity: "base" });
  }
  if (left.busNumber == null) return 1;
  if (right.busNumber == null) return -1;
  const leftNum = Number(left.busNumber);
  const rightNum = Number(right.busNumber);
  const leftIsNumber = Number.isFinite(leftNum);
  const rightIsNumber = Number.isFinite(rightNum);
  if (leftIsNumber && rightIsNumber) return leftNum - rightNum;
  if (leftIsNumber) return -1;
  if (rightIsNumber) return 1;
  return left.busNumber.localeCompare(right.busNumber, undefined, { sensitivity: "base" });
}

function extractErrorText(error: PostgrestErrorLike | null | undefined) {
  return [error?.message, error?.details, error?.hint].filter(Boolean).join(" ").toLowerCase();
}

function isMissingTableError(error: PostgrestErrorLike | null | undefined, tableName: string) {
  const text = extractErrorText(error);
  if (!text) return false;
  const normalizedTable = tableName.trim().toLowerCase();
  if (!normalizedTable) return false;
  if (error?.code === "PGRST205") return text.includes(normalizedTable);
  return (
    text.includes(normalizedTable) &&
    (text.includes("schema cache") || text.includes("does not exist") || text.includes("relation"))
  );
}

function transportationManifestStorageRequiredError() {
  return new Error(
    "Transportation Station storage is not available. Run Supabase migration 0011_member_command_center_aux_schema.sql."
  );
}

const MEMBER_CONTACT_MANIFEST_SELECT =
  "id, member_id, contact_name, category, cellular_number, work_number, home_number, street_address, city, state, zip, updated_at";

export async function resolvePreferredMemberContactSupabase(memberId: string, explicitContactId?: string | null) {
  const canonicalMemberId = await resolveCanonicalMemberId(memberId, {
    actionLabel: "resolvePreferredMemberContactSupabase"
  });
  const supabase = await createClient();
  if (explicitContactId) {
    const { data, error } = await supabase
      .from("member_contacts")
      .select(MEMBER_CONTACT_MANIFEST_SELECT)
      .eq("id", explicitContactId)
      .eq("member_id", canonicalMemberId)
      .maybeSingle();
    if (error) {
      if (isMissingTableError(error, "member_contacts")) {
        throw transportationManifestStorageRequiredError();
      }
      throw new Error(error.message);
    }
    if (data) return data as MemberContactRow;
  }
  const preferred = await listPreferredContactsByMemberSupabase({ memberIds: [canonicalMemberId] });
  return preferred.get(canonicalMemberId) ?? null;
}

export async function findTransportationManifestAdjustmentSupabase(input: {
  selectedDate: string;
  shift: Shift;
  memberId: string;
  adjustmentType: "add" | "exclude";
}) {
  const canonicalMemberId = await resolveCanonicalMemberId(input.memberId, {
    actionLabel: "findTransportationManifestAdjustmentSupabase"
  });
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("transportation_manifest_adjustments")
    .select("*")
    .eq("selected_date", normalizeOperationalDateOnly(input.selectedDate))
    .eq("shift", input.shift)
    .eq("member_id", canonicalMemberId)
    .eq("adjustment_type", input.adjustmentType)
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error, "transportation_manifest_adjustments")) {
      throw transportationManifestStorageRequiredError();
    }
    throw new Error(error.message);
  }
  return (data as TransportationManifestAdjustmentRow | null) ?? null;
}

export async function upsertTransportationManifestAdjustmentSupabase(input: {
  selectedDate: string;
  shift: Shift;
  memberId: string;
  adjustmentType: "add" | "exclude";
  busNumber: string | null;
  transportType: TransportMode | null;
  busStopName: string | null;
  doorToDoorAddress: string | null;
  caregiverContactId: string | null;
  caregiverContactNameSnapshot: string | null;
  caregiverContactPhoneSnapshot: string | null;
  caregiverContactAddressSnapshot: string | null;
  notes: string | null;
  actorUserId: string;
  actorName: string;
  nowIso: string;
}) {
  const canonicalMemberId = await resolveCanonicalMemberId(input.memberId, {
    actionLabel: "upsertTransportationManifestAdjustmentSupabase"
  });
  const supabase = await createClient();
  const existing = await findTransportationManifestAdjustmentSupabase({
    selectedDate: input.selectedDate,
    shift: input.shift,
    memberId: canonicalMemberId,
    adjustmentType: input.adjustmentType
  });
  if (existing) {
    const { data, error } = await supabase
      .from("transportation_manifest_adjustments")
      .update({
        bus_number: input.busNumber,
        transport_type: input.transportType,
        bus_stop_name: input.busStopName,
        door_to_door_address: input.doorToDoorAddress,
        caregiver_contact_id: input.caregiverContactId,
        caregiver_contact_name_snapshot: input.caregiverContactNameSnapshot,
        caregiver_contact_phone_snapshot: normalizePhoneForStorage(input.caregiverContactPhoneSnapshot),
        caregiver_contact_address_snapshot: input.caregiverContactAddressSnapshot,
        notes: input.notes,
        created_by_user_id: input.actorUserId,
        created_by_name: input.actorName,
        created_at: input.nowIso
      })
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) {
      if (isMissingTableError(error, "transportation_manifest_adjustments")) {
        throw transportationManifestStorageRequiredError();
      }
      throw new Error(error.message);
    }
    return data as TransportationManifestAdjustmentRow;
  }
  const { data, error } = await supabase
    .from("transportation_manifest_adjustments")
    .insert({
      id: `transport-adjustment-${randomUUID()}`,
      selected_date: normalizeOperationalDateOnly(input.selectedDate),
      shift: input.shift,
      member_id: canonicalMemberId,
      adjustment_type: input.adjustmentType,
      bus_number: input.busNumber,
      transport_type: input.transportType,
      bus_stop_name: input.busStopName,
      door_to_door_address: input.doorToDoorAddress,
      caregiver_contact_id: input.caregiverContactId,
      caregiver_contact_name_snapshot: input.caregiverContactNameSnapshot,
      caregiver_contact_phone_snapshot: normalizePhoneForStorage(input.caregiverContactPhoneSnapshot),
      caregiver_contact_address_snapshot: input.caregiverContactAddressSnapshot,
      notes: input.notes,
      created_by_user_id: input.actorUserId,
      created_by_name: input.actorName,
      created_at: input.nowIso
    })
    .select("*")
    .single();
  if (error) {
    if (isMissingTableError(error, "transportation_manifest_adjustments")) {
      throw transportationManifestStorageRequiredError();
    }
    throw new Error(error.message);
  }
  return data as TransportationManifestAdjustmentRow;
}

export async function removeTransportationManifestAdjustmentSupabase(adjustmentId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("transportation_manifest_adjustments").delete().eq("id", adjustmentId);
  if (error) {
    if (isMissingTableError(error, "transportation_manifest_adjustments")) {
      throw transportationManifestStorageRequiredError();
    }
    throw new Error(error.message);
  }
  return true;
}

export async function getTransportationManifestSupabase(input?: {
  selectedDate?: string | null;
  shift?: TransportationStationShift;
  busFilter?: TransportationManifestBusFilter;
}): Promise<TransportationManifestResult> {
  const supabase = await createClient();
  const selectedDate = normalizeOperationalDateOnly(input?.selectedDate);
  const selectedShift = input?.shift === "AM" || input?.shift === "PM" || input?.shift === "Both" ? input.shift : "Both";
  const configuredBusNumbers = await getConfiguredBusNumbers();
  const requestedBusFilter = String(input?.busFilter ?? "all").trim();
  const busFilter: TransportationManifestBusFilter =
    requestedBusFilter === "all" || requestedBusFilter === "unassigned" || configuredBusNumbers.includes(requestedBusFilter)
      ? requestedBusFilter
      : "all";
  const weekday = getWeekdayForDate(selectedDate);
  const selectedShifts = shiftsForSelection(selectedShift);

  const { data: schedulesData, error: scheduleError } = await supabase
    .from("member_attendance_schedules")
    .select("*")
    .eq("transportation_required", true);
  const schedules: MemberAttendanceScheduleRow[] = (() => {
    if (!scheduleError) return (schedulesData ?? []) as MemberAttendanceScheduleRow[];
    if (isMissingTableError(scheduleError, "member_attendance_schedules")) {
      throw transportationManifestStorageRequiredError();
    }
    throw new Error(scheduleError.message);
  })();
  const memberIds = Array.from(new Set(schedules.map((row) => row.member_id)));
  const expectedAttendanceContext = await loadExpectedAttendanceSupabaseContext({
    memberIds,
    startDate: selectedDate,
    endDate: selectedDate,
    includeAttendanceRecords: false
  });

  const [membersData, preferredContactByMember, adjustmentsResult] = await Promise.all([
    memberIds.length > 0
      ? supabase.from("members").select("id, display_name, status").in("id", memberIds)
      : Promise.resolve({ data: [], error: null }),
    listPreferredContactsByMemberSupabase({
      memberIds,
      onQueryError: (error) => {
        if (isMissingTableError(error, "member_contacts")) {
          throw transportationManifestStorageRequiredError();
        }
        throw new Error(error.message ?? "Unable to load member contacts.");
      }
    }),
    supabase
      .from("transportation_manifest_adjustments")
      .select("*")
      .eq("selected_date", selectedDate)
      .in("shift", selectedShifts)
  ]);
  if (membersData.error) throw new Error(membersData.error.message);

  const adjustments: TransportationManifestAdjustmentRow[] = (() => {
    if (!adjustmentsResult.error) return (adjustmentsResult.data ?? []) as TransportationManifestAdjustmentRow[];
    if (isMissingTableError(adjustmentsResult.error, "transportation_manifest_adjustments")) {
      throw transportationManifestStorageRequiredError();
    }
    throw new Error(adjustmentsResult.error.message);
  })();

  const memberById = new Map(
    ((membersData.data ?? []) as Array<{ id: string; display_name: string; status: string }>).map((row) => [row.id, row] as const)
  );

  const scheduledRiders: TransportationManifestRider[] = [];
  const holdExcludedScheduledRiders: TransportationManifestRider[] = [];
  const scheduleWeekday = toScheduleWeekdayKey(weekday);
  schedules.forEach((schedule) => {
    const member = memberById.get(schedule.member_id);
    if (!member || member.status !== "active") return;
    const resolution = resolveExpectedAttendanceFromSupabaseContext({
      context: expectedAttendanceContext,
      memberId: schedule.member_id,
      date: selectedDate,
      baseScheduleOverride: schedule
    });
    if (!resolution.scheduledFromSchedule) return;
    const contact = preferredContactByMember.get(schedule.member_id) ?? null;
    selectedShifts.forEach((shift) => {
      if (!scheduleWeekday) return;
    const slot = getTransportSlotForScheduleDay(schedule as Parameters<typeof getTransportSlotForScheduleDay>[0], scheduleWeekday, shift);
      if (slot.mode !== "Bus Stop" && slot.mode !== "Door to Door") return;
      const rider: TransportationManifestRider = {
        key: `${member.id}:${shift}`,
        adjustmentId: null,
        memberId: member.id,
        memberName: member.display_name,
        shift,
        busNumber: slot.busNumber ?? null,
        transportType: slot.mode,
        locationLabel: buildTransportLocationLabel({
          mode: slot.mode,
          busStopName: slot.busStop ?? null,
          doorToDoorAddress: slot.doorToDoorAddress ?? null
        }),
        busStopName: slot.busStop ?? null,
        doorToDoorAddress: slot.doorToDoorAddress ?? null,
        caregiverContactId: contact?.id ?? null,
        caregiverContactName: contact?.contact_name ?? null,
        caregiverContactPhone:
          normalizePhoneForStorage(contact?.cellular_number ?? contact?.home_number ?? contact?.work_number ?? null),
        caregiverContactAddress:
          [contact?.street_address, contact?.city, contact?.state, contact?.zip]
            .map((value) => (value ?? "").trim())
            .filter(Boolean)
            .join(", ") || null,
        notes: null,
        source: "schedule"
      };
      if (resolution.blockedBy === "member-hold") {
        holdExcludedScheduledRiders.push(rider);
      } else if (!resolution.isScheduled) {
        return;
      } else {
        scheduledRiders.push(rider);
      }
    });
  });

  const exclusions = adjustments.filter((row) => row.adjustment_type === "exclude");
  const exclusionKeys = new Set(exclusions.map((row) => `${row.member_id}:${row.shift}`));
  const excludedScheduledRiders = scheduledRiders.filter((row) => exclusionKeys.has(row.key)).sort(sortRiders);
  const afterExclusion = scheduledRiders.filter((row) => !exclusionKeys.has(row.key));

  const manualAdditions = adjustments.filter((row) => row.adjustment_type === "add");
  const manualAddRiders = manualAdditions.map((row) => {
    const member = memberById.get(row.member_id);
    const contact = preferredContactByMember.get(row.member_id) ?? null;
    const transportType = row.transport_type === "Door to Door" || row.transport_type === "Bus Stop"
      ? row.transport_type
      : "Door to Door";
    const busStopName = row.bus_stop_name ?? null;
    const doorToDoorAddress =
      row.door_to_door_address ??
      ([contact?.street_address, contact?.city, contact?.state, contact?.zip]
        .map((value) => (value ?? "").trim())
        .filter(Boolean)
        .join(", ") || null);
    return {
      key: `${row.member_id}:${row.shift}`,
      adjustmentId: row.id,
      memberId: row.member_id,
      memberName: member?.display_name ?? "Unknown Member",
      shift: row.shift,
      busNumber: row.bus_number,
      transportType,
      locationLabel: buildTransportLocationLabel({
        mode: transportType,
        busStopName,
        doorToDoorAddress
      }),
      busStopName,
      doorToDoorAddress,
      caregiverContactId: row.caregiver_contact_id ?? contact?.id ?? null,
      caregiverContactName: row.caregiver_contact_name_snapshot ?? contact?.contact_name ?? null,
      caregiverContactPhone:
        normalizePhoneForStorage(
          row.caregiver_contact_phone_snapshot ??
          contact?.cellular_number ??
          contact?.home_number ??
          contact?.work_number ??
          null
        ),
      caregiverContactAddress:
        row.caregiver_contact_address_snapshot ??
        ([contact?.street_address, contact?.city, contact?.state, contact?.zip]
          .map((value) => (value ?? "").trim())
          .filter(Boolean)
          .join(", ") || null),
      notes: row.notes ?? null,
      source: "manual-add"
    } satisfies TransportationManifestRider;
  });

  const mergedByKey = new Map<string, TransportationManifestRider>();
  afterExclusion.forEach((row) => mergedByKey.set(row.key, row));
  manualAddRiders.forEach((row) => mergedByKey.set(row.key, row));
  let finalRiders = Array.from(mergedByKey.values()).sort(sortRiders);
  if (busFilter === "unassigned") {
    finalRiders = finalRiders.filter((row) => !row.busNumber);
  } else if (busFilter !== "all") {
    finalRiders = finalRiders.filter((row) => row.busNumber === busFilter);
  }

  const groupsMap = new Map<string, TransportationManifestGroup>();
  finalRiders.forEach((rider) => {
    const groupKey = rider.busNumber ?? "unassigned";
    if (!groupsMap.has(groupKey)) {
      groupsMap.set(groupKey, {
        busNumber: rider.busNumber,
        label: rider.busNumber ? `Bus ${rider.busNumber}` : "Unassigned",
        riders: []
      });
    }
    groupsMap.get(groupKey)!.riders.push(rider);
  });
  const groups = Array.from(groupsMap.values())
    .map((group) => ({ ...group, riders: [...group.riders].sort(sortRiders) }))
    .sort(sortGroups);

  const summarize = (row: TransportationManifestAdjustmentRow): TransportationManifestAdjustmentSummary => ({
    id: row.id,
    memberId: row.member_id,
    memberName: memberById.get(row.member_id)?.display_name ?? "Unknown Member",
    shift: row.shift,
    createdAt: row.created_at,
    createdByName: row.created_by_name,
    adjustmentType: row.adjustment_type,
    busNumber: row.bus_number,
    transportType: row.transport_type
  });

  return {
    selectedDate,
    selectedShift,
    weekday,
    generatedAt: new Date().toISOString(),
    totalRiders: finalRiders.length,
    groups,
    manualAdditions: manualAdditions.map(summarize).sort((left, right) => (left.createdAt > right.createdAt ? -1 : 1)),
    exclusions: exclusions.map(summarize).sort((left, right) => (left.createdAt > right.createdAt ? -1 : 1)),
    excludedScheduledRiders,
    holdExcludedScheduledRiders: holdExcludedScheduledRiders.sort(sortRiders)
  };
}

export function buildTransportationManifestCsv(manifest: TransportationManifestResult) {
  const header = [
    "Date",
    "Shift",
    "Bus",
    "Member Name",
    "Transport Type",
    "Location",
    "Caregiver/Transport Contact",
    "Contact Phone",
    "Contact Address",
    "Source",
    "Notes"
  ];
  const rows = manifest.groups.flatMap((group) =>
    group.riders.map((rider) => [
      manifest.selectedDate,
      rider.shift,
      group.label,
      rider.memberName,
      rider.transportType,
      rider.locationLabel,
      rider.caregiverContactName ?? "",
      rider.caregiverContactPhone ?? "",
      rider.caregiverContactAddress ?? "",
      rider.source,
      rider.notes ?? ""
    ])
  );
  const escape = (value: string) => {
    const normalized = String(value ?? "");
    if (!/[",\n]/.test(normalized)) return normalized;
    return `"${normalized.replace(/"/g, "\"\"")}"`;
  };
  return [header, ...rows]
    .map((columns) => columns.map((column) => escape(String(column))).join(","))
    .join("\n");
}
