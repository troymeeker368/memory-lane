import { getMockDb } from "@/lib/mock-repo";
import { normalizeOperationalDateOnly, getWeekdayForDate, type OperationsWeekdayKey } from "@/lib/services/operations-calendar";
import { getTransportSlotForDate, isScheduledWeekday } from "@/lib/services/member-schedule-selectors";
import { isMemberOnHoldOnDate } from "@/lib/services/holds";
import { toEasternISO } from "@/lib/timezone";

type Shift = "AM" | "PM";
type TransportMode = "Bus Stop" | "Door to Door";
type BusNumber = "1" | "2" | "3";

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

function shiftsForSelection(selection: TransportationStationShift): Shift[] {
  if (selection === "Both") return ["AM", "PM"];
  return [selection];
}

function contactPriority(category: string | null | undefined): number {
  const normalized = (category ?? "").trim().toLowerCase();
  if (normalized === "responsible party") return 1;
  if (normalized === "care provider") return 2;
  if (normalized === "emergency contact") return 3;
  if (normalized === "spouse") return 4;
  if (normalized === "child") return 5;
  if (normalized === "payor") return 6;
  if (normalized === "other") return 7;
  return 8;
}


function buildLocationLabel(input: {
  mode: TransportMode;
  busStopName: string | null;
  doorToDoorAddress: string | null;
}): string {
  if (input.mode === "Bus Stop") {
    return input.busStopName?.trim() || "Bus Stop";
  }
  return input.doorToDoorAddress?.trim() || "Door-to-Door";
}

function sortRiders(left: TransportationManifestRider, right: TransportationManifestRider): number {
  const byName = left.memberName.localeCompare(right.memberName, undefined, { sensitivity: "base" });
  if (byName !== 0) return byName;
  if (left.shift === right.shift) return 0;
  return left.shift === "AM" ? -1 : 1;
}

function sortGroups(left: TransportationManifestGroup, right: TransportationManifestGroup): number {
  if (left.busNumber == null && right.busNumber == null) {
    return left.label.localeCompare(right.label, undefined, { sensitivity: "base" });
  }
  if (left.busNumber == null) return 1;
  if (right.busNumber == null) return -1;
  return Number(left.busNumber) - Number(right.busNumber);
}

export function getTransportationManifest(input?: {
  selectedDate?: string | null;
  shift?: TransportationStationShift;
  busFilter?: TransportationManifestBusFilter;
}): TransportationManifestResult {
  const db = getMockDb();
  const selectedDate = normalizeOperationalDateOnly(input?.selectedDate);
  const selectedShift = input?.shift === "AM" || input?.shift === "PM" || input?.shift === "Both" ? input.shift : "Both";
  const busFilter =
    input?.busFilter === "1" || input?.busFilter === "2" || input?.busFilter === "3" || input?.busFilter === "unassigned"
      ? input.busFilter
      : "all";
  const weekday = getWeekdayForDate(selectedDate);
  const selectedShifts = shiftsForSelection(selectedShift);

  const contactMap = new Map(
    db.memberContacts.map((contact) => [contact.member_id, contact] as const)
  );

  const sortedContacts = [...db.memberContacts].sort((left, right) => {
    const memberCompare = left.member_id.localeCompare(right.member_id);
    if (memberCompare !== 0) return memberCompare;
    const categoryCompare = contactPriority(left.category) - contactPriority(right.category);
    if (categoryCompare !== 0) return categoryCompare;
    if (left.updated_at === right.updated_at) return 0;
    return left.updated_at > right.updated_at ? -1 : 1;
  });

  const preferredContactByMember = new Map<string, (typeof sortedContacts)[number]>();
  sortedContacts.forEach((contact) => {
    if (!preferredContactByMember.has(contact.member_id)) {
      preferredContactByMember.set(contact.member_id, contact);
    }
  });

  const scheduledRiders: TransportationManifestRider[] = [];
  const holdExcludedScheduledRiders: TransportationManifestRider[] = [];
  db.memberAttendanceSchedules.forEach((schedule) => {
    if (!schedule.transportation_required) return;
    if (!isScheduledWeekday(schedule, weekday)) return;

    const member = db.members.find((row) => row.id === schedule.member_id);
    if (!member || member.status !== "active") return;
    const memberOnHold = isMemberOnHoldOnDate(member.id, selectedDate);
    const contact = preferredContactByMember.get(schedule.member_id) ?? contactMap.get(schedule.member_id) ?? null;

    selectedShifts.forEach((shift) => {
      const slot = getTransportSlotForDate(schedule, selectedDate, shift);
      if (slot.mode !== "Bus Stop" && slot.mode !== "Door to Door") return;

      const rider: TransportationManifestRider = {
        key: `${member.id}:${shift}`,
        adjustmentId: null,
        memberId: member.id,
        memberName: member.display_name,
        shift,
        busNumber: slot.busNumber ?? null,
        transportType: slot.mode,
        locationLabel: buildLocationLabel({
          mode: slot.mode,
          busStopName: slot.busStop ?? null,
          doorToDoorAddress: slot.doorToDoorAddress ?? null
        }),
        busStopName: slot.busStop ?? null,
        doorToDoorAddress: slot.doorToDoorAddress ?? null,
        caregiverContactId: contact?.id ?? null,
        caregiverContactName: contact?.contact_name ?? null,
        caregiverContactPhone:
          contact?.cellular_number ?? contact?.home_number ?? contact?.work_number ?? null,
        caregiverContactAddress:
          [contact?.street_address, contact?.city, contact?.state, contact?.zip]
            .map((value) => (value ?? "").trim())
            .filter(Boolean)
            .join(", ") || null,
        notes: null,
        source: "schedule"
      };
      if (memberOnHold) {
        holdExcludedScheduledRiders.push(rider);
      } else {
        scheduledRiders.push(rider);
      }
    });
  });

  const matchingAdjustments = db.transportationManifestAdjustments.filter(
    (row) => row.selected_date === selectedDate && selectedShifts.includes(row.shift)
  );

  const exclusions = matchingAdjustments.filter((row) => row.adjustment_type === "exclude");
  const exclusionKeys = new Set(exclusions.map((row) => `${row.member_id}:${row.shift}`));
  const excludedScheduledRiders = scheduledRiders.filter((row) => exclusionKeys.has(row.key)).sort(sortRiders);
  const afterExclusion = scheduledRiders.filter((row) => !exclusionKeys.has(row.key));

  const manualAdditions = matchingAdjustments.filter((row) => row.adjustment_type === "add");
  const manualAddRiders = manualAdditions.map((row) => {
    const member = db.members.find((candidate) => candidate.id === row.member_id);
    const contact =
      (row.caregiver_contact_id
        ? db.memberContacts.find((candidate) => candidate.id === row.caregiver_contact_id) ?? null
        : null) ??
      preferredContactByMember.get(row.member_id) ??
      null;
    const transportType = row.transport_type === "Door to Door" || row.transport_type === "Bus Stop"
      ? row.transport_type
      : "Door to Door";
    const busStopName = row.bus_stop_name ?? null;
    const doorToDoorAddress =
      row.door_to_door_address ??
      (([contact?.street_address, contact?.city, contact?.state, contact?.zip]
        .map((value) => (value ?? "").trim())
        .filter(Boolean)
        .join(", ")) ||
        null);

    return {
      key: `${row.member_id}:${row.shift}`,
      adjustmentId: row.id,
      memberId: row.member_id,
      memberName: member?.display_name ?? "Unknown Member",
      shift: row.shift,
      busNumber: row.bus_number,
      transportType,
      locationLabel: buildLocationLabel({
        mode: transportType,
        busStopName,
        doorToDoorAddress
      }),
      busStopName,
      doorToDoorAddress,
      caregiverContactId: row.caregiver_contact_id ?? contact?.id ?? null,
      caregiverContactName: row.caregiver_contact_name_snapshot ?? contact?.contact_name ?? null,
      caregiverContactPhone:
        row.caregiver_contact_phone_snapshot ??
        contact?.cellular_number ??
        contact?.home_number ??
        contact?.work_number ??
        null,
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
  afterExclusion.forEach((row) => {
    mergedByKey.set(row.key, row);
  });
  manualAddRiders.forEach((row) => {
    mergedByKey.set(row.key, row);
  });

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
      const label = rider.busNumber ? `Bus ${rider.busNumber}` : "Unassigned";
      groupsMap.set(groupKey, {
        busNumber: rider.busNumber,
        label,
        riders: []
      });
    }
    groupsMap.get(groupKey)!.riders.push(rider);
  });

  const groups = Array.from(groupsMap.values())
    .map((group) => ({ ...group, riders: [...group.riders].sort(sortRiders) }))
    .sort(sortGroups);

  const summarizeAdjustment = (
    row: ReturnType<typeof getMockDb>["transportationManifestAdjustments"][number]
  ): TransportationManifestAdjustmentSummary => {
    const member = db.members.find((candidate) => candidate.id === row.member_id);
    return {
      id: row.id,
      memberId: row.member_id,
      memberName: member?.display_name ?? "Unknown Member",
      shift: row.shift,
      createdAt: row.created_at,
      createdByName: row.created_by_name,
      adjustmentType: row.adjustment_type,
      busNumber: row.bus_number,
      transportType: row.transport_type
    };
  };

  return {
    selectedDate,
    selectedShift,
    weekday,
    generatedAt: toEasternISO(),
    totalRiders: finalRiders.length,
    groups,
    manualAdditions: manualAdditions
      .map(summarizeAdjustment)
      .sort((left, right) => (left.createdAt > right.createdAt ? -1 : 1)),
    exclusions: exclusions
      .map(summarizeAdjustment)
      .sort((left, right) => (left.createdAt > right.createdAt ? -1 : 1)),
    excludedScheduledRiders,
    holdExcludedScheduledRiders: holdExcludedScheduledRiders.sort(sortRiders)
  };
}

export function buildTransportationManifestCsv(manifest: TransportationManifestResult): string {
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
