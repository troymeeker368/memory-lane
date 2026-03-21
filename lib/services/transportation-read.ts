import { resolveCanonicalMemberId } from "@/lib/services/canonical-person-ref";
import { getTransportationAddRiderMemberOptionsSupabase } from "@/lib/services/member-command-center-read";
import { getTransportationRunManifestSupabase } from "@/lib/services/transportation-run-manifest-supabase";
import {
  getTransportationManifestSupabase,
  type TransportationManifestBusFilter,
  type TransportationManifestRider
} from "@/lib/services/transportation-station-supabase";
import type { TransportationStationShift } from "@/lib/services/transportation-station-supabase";

type Shift = "AM" | "PM";

function findManifestRider(
  riders: TransportationManifestRider[],
  memberId: string,
  shift: Shift
) {
  return riders.find((rider) => rider.memberId === memberId && rider.shift === shift) ?? null;
}

function flattenManifestRiders(manifest: Awaited<ReturnType<typeof getTransportationManifestSupabase>>) {
  return manifest.groups.flatMap((group) => group.riders);
}

function toCopySnapshot(rider: TransportationManifestRider) {
  return {
    transportType: rider.transportType,
    busNumber: rider.busNumber ?? "",
    busStopName: rider.busStopName ?? "",
    doorToDoorAddress: rider.doorToDoorAddress ?? "",
    caregiverContactName: rider.caregiverContactName ?? "",
    caregiverContactPhone: rider.caregiverContactPhone ?? "",
    caregiverContactAddress: rider.caregiverContactAddress ?? ""
  };
}

function snapshotsMatch(
  left: ReturnType<typeof toCopySnapshot>,
  right: ReturnType<typeof toCopySnapshot>
) {
  return (
    left.transportType === right.transportType &&
    left.busNumber === right.busNumber &&
    left.busStopName === right.busStopName &&
    left.doorToDoorAddress === right.doorToDoorAddress &&
    left.caregiverContactName === right.caregiverContactName &&
    left.caregiverContactPhone === right.caregiverContactPhone &&
    left.caregiverContactAddress === right.caregiverContactAddress
  );
}

export async function getTransportationManifest(...args: Parameters<typeof getTransportationManifestSupabase>) {
  return getTransportationManifestSupabase(...args);
}

export async function getTransportationRunManifest(...args: Parameters<typeof getTransportationRunManifestSupabase>) {
  return getTransportationRunManifestSupabase(...args);
}

export async function getTransportationAddRiderMembers(...args: Parameters<typeof getTransportationAddRiderMemberOptionsSupabase>) {
  return getTransportationAddRiderMemberOptionsSupabase(...args);
}

export async function getTransportationCopySnapshot(input: {
  memberId: string;
  sourceDate: string;
  targetDate: string;
  shift: Shift;
}) {
  const canonicalMemberId = await resolveCanonicalMemberId(input.memberId, {
    actionLabel: "getTransportationCopySnapshot"
  });
  const [sourceManifest, targetManifest] = await Promise.all([
    getTransportationManifestSupabase({
      selectedDate: input.sourceDate,
      shift: input.shift,
      busFilter: "all"
    }),
    getTransportationManifestSupabase({
      selectedDate: input.targetDate,
      shift: input.shift,
      busFilter: "all"
    })
  ]);

  const sourceRider = findManifestRider(flattenManifestRiders(sourceManifest), canonicalMemberId, input.shift);
  if (!sourceRider) {
    return null;
  }

  const targetRider = findManifestRider(flattenManifestRiders(targetManifest), canonicalMemberId, input.shift);
  const snapshot = toCopySnapshot(sourceRider);
  const targetSnapshot = targetRider ? toCopySnapshot(targetRider) : null;

  return {
    snapshot,
    unchanged: targetSnapshot ? snapshotsMatch(snapshot, targetSnapshot) : false
  };
}

export type { TransportationManifestBusFilter, TransportationStationShift };
