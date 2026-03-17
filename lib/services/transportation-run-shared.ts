export const TRANSPORTATION_DRIVER_EXCLUSION_REASONS = [
  "no-show",
  "family-transported",
  "refused",
  "absent",
  "hospital",
  "excluded",
  "other"
] as const;

export type TransportationDriverExclusionReason =
  (typeof TRANSPORTATION_DRIVER_EXCLUSION_REASONS)[number];

export function getTransportationExclusionReasonLabel(reason: TransportationDriverExclusionReason) {
  switch (reason) {
    case "no-show":
      return "No-show";
    case "family-transported":
      return "Family transported";
    case "refused":
      return "Refused";
    case "absent":
      return "Absent";
    case "hospital":
      return "Hospital";
    case "excluded":
      return "Excluded";
    case "other":
      return "Other";
    default:
      return reason;
  }
}

export function buildTransportationPostingScopeKey(input: {
  memberId: string;
  serviceDate: string;
  shift: "AM" | "PM";
}) {
  const normalizedShift = input.shift === "PM" ? "PM" : "AM";
  return [String(input.memberId ?? "").trim(), String(input.serviceDate ?? "").trim(), normalizedShift].join(":");
}
