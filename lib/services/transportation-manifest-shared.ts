import {
  getTransportSlotForScheduleDay,
  type ScheduleWeekdayKey,
  type TransportMode
} from "@/lib/services/member-schedule-selectors";
import type { MemberContactRow } from "@/lib/services/member-command-center-read";

type Shift = "AM" | "PM";

export function formatTransportationContactAddress(contact: MemberContactRow | null) {
  return (
    [contact?.street_address, contact?.city, contact?.state, contact?.zip]
      .map((value) => (value ?? "").trim())
      .filter(Boolean)
      .join(", ") || null
  );
}

export function parseTransportationMode(mode: string | null | undefined): TransportMode | null {
  if (mode === "Door to Door" || mode === "Bus Stop") return mode;
  return null;
}

export function parseTransportationModeOrThrow(input: {
  mode: string | null | undefined;
  selectedDate: string;
  shift: Shift;
  memberId: string;
  context: string;
}) {
  const parsed = parseTransportationMode(input.mode);
  if (parsed) return parsed;
  throw new Error(
    `Invalid transportation mode in ${input.context} for member ${input.memberId} on ${input.selectedDate} ${input.shift}. ` +
      `Expected "Door to Door" or "Bus Stop"; refusing fabricated fallback.`
  );
}

export function getScheduleTransportSlotOrNull(input: {
  schedule: Parameters<typeof getTransportSlotForScheduleDay>[0];
  weekday: ScheduleWeekdayKey;
  shift: Shift;
}) {
  const slot = getTransportSlotForScheduleDay(input.schedule, input.weekday, input.shift);
  const parsedMode = parseTransportationMode(slot.mode);
  if (!parsedMode) return null;
  return {
    ...slot,
    mode: parsedMode
  };
}
