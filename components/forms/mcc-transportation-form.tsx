"use client";

import { FormEvent, useState, useTransition } from "react";

import { saveMemberCommandCenterTransportationAction } from "@/app/(portal)/operations/member-command-center/actions";
import {
  MEMBER_TRANSPORTATION_SERVICE_OPTIONS
} from "@/lib/canonical";

type TransportMode = "Door to Door" | "Bus Stop" | null;
type TransportBusNumber = string | null;
type DayKey = "monday" | "tuesday" | "wednesday" | "thursday" | "friday";
type SlotKey =
  | "mondayAm"
  | "mondayPm"
  | "tuesdayAm"
  | "tuesdayPm"
  | "wednesdayAm"
  | "wednesdayPm"
  | "thursdayAm"
  | "thursdayPm"
  | "fridayAm"
  | "fridayPm";

export function MccTransportationForm({
  memberId,
  transportationRequired,
  defaultDoorToDoorAddress,
  monday,
  tuesday,
  wednesday,
  thursday,
  friday,
  transportMondayAmMode,
  transportMondayAmDoorToDoorAddress,
  transportMondayAmBusNumber,
  transportMondayAmBusStop,
  transportMondayPmMode,
  transportMondayPmDoorToDoorAddress,
  transportMondayPmBusNumber,
  transportMondayPmBusStop,
  transportTuesdayAmMode,
  transportTuesdayAmDoorToDoorAddress,
  transportTuesdayAmBusNumber,
  transportTuesdayAmBusStop,
  transportTuesdayPmMode,
  transportTuesdayPmDoorToDoorAddress,
  transportTuesdayPmBusNumber,
  transportTuesdayPmBusStop,
  transportWednesdayAmMode,
  transportWednesdayAmDoorToDoorAddress,
  transportWednesdayAmBusNumber,
  transportWednesdayAmBusStop,
  transportWednesdayPmMode,
  transportWednesdayPmDoorToDoorAddress,
  transportWednesdayPmBusNumber,
  transportWednesdayPmBusStop,
  transportThursdayAmMode,
  transportThursdayAmDoorToDoorAddress,
  transportThursdayAmBusNumber,
  transportThursdayAmBusStop,
  transportThursdayPmMode,
  transportThursdayPmDoorToDoorAddress,
  transportThursdayPmBusNumber,
  transportThursdayPmBusStop,
  transportFridayAmMode,
  transportFridayAmDoorToDoorAddress,
  transportFridayAmBusNumber,
  transportFridayAmBusStop,
  transportFridayPmMode,
  transportFridayPmDoorToDoorAddress,
  transportFridayPmBusNumber,
  transportFridayPmBusStop,
  busStopOptions,
  busNumberOptions
}: {
  memberId: string;
  transportationRequired: boolean | null;
  defaultDoorToDoorAddress: string;
  monday: boolean;
  tuesday: boolean;
  wednesday: boolean;
  thursday: boolean;
  friday: boolean;
  transportMondayAmMode: TransportMode;
  transportMondayAmDoorToDoorAddress: string | null;
  transportMondayAmBusNumber: TransportBusNumber;
  transportMondayAmBusStop: string | null;
  transportMondayPmMode: TransportMode;
  transportMondayPmDoorToDoorAddress: string | null;
  transportMondayPmBusNumber: TransportBusNumber;
  transportMondayPmBusStop: string | null;
  transportTuesdayAmMode: TransportMode;
  transportTuesdayAmDoorToDoorAddress: string | null;
  transportTuesdayAmBusNumber: TransportBusNumber;
  transportTuesdayAmBusStop: string | null;
  transportTuesdayPmMode: TransportMode;
  transportTuesdayPmDoorToDoorAddress: string | null;
  transportTuesdayPmBusNumber: TransportBusNumber;
  transportTuesdayPmBusStop: string | null;
  transportWednesdayAmMode: TransportMode;
  transportWednesdayAmDoorToDoorAddress: string | null;
  transportWednesdayAmBusNumber: TransportBusNumber;
  transportWednesdayAmBusStop: string | null;
  transportWednesdayPmMode: TransportMode;
  transportWednesdayPmDoorToDoorAddress: string | null;
  transportWednesdayPmBusNumber: TransportBusNumber;
  transportWednesdayPmBusStop: string | null;
  transportThursdayAmMode: TransportMode;
  transportThursdayAmDoorToDoorAddress: string | null;
  transportThursdayAmBusNumber: TransportBusNumber;
  transportThursdayAmBusStop: string | null;
  transportThursdayPmMode: TransportMode;
  transportThursdayPmDoorToDoorAddress: string | null;
  transportThursdayPmBusNumber: TransportBusNumber;
  transportThursdayPmBusStop: string | null;
  transportFridayAmMode: TransportMode;
  transportFridayAmDoorToDoorAddress: string | null;
  transportFridayAmBusNumber: TransportBusNumber;
  transportFridayAmBusStop: string | null;
  transportFridayPmMode: TransportMode;
  transportFridayPmDoorToDoorAddress: string | null;
  transportFridayPmBusNumber: TransportBusNumber;
  transportFridayPmBusStop: string | null;
  busStopOptions: string[];
  busNumberOptions: string[];
}) {
  const [requiredValue, setRequiredValue] = useState(
    transportationRequired == null ? "" : transportationRequired ? "true" : "false"
  );
  const [slotModeValues, setSlotModeValues] = useState<Record<SlotKey, string>>({
    mondayAm: transportMondayAmMode ?? "None",
    mondayPm: transportMondayPmMode ?? "None",
    tuesdayAm: transportTuesdayAmMode ?? "None",
    tuesdayPm: transportTuesdayPmMode ?? "None",
    wednesdayAm: transportWednesdayAmMode ?? "None",
    wednesdayPm: transportWednesdayPmMode ?? "None",
    thursdayAm: transportThursdayAmMode ?? "None",
    thursdayPm: transportThursdayPmMode ?? "None",
    fridayAm: transportFridayAmMode ?? "None",
    fridayPm: transportFridayPmMode ?? "None"
  });
  const [status, setStatus] = useState("");
  const [isPending, startTransition] = useTransition();

  const enabled = requiredValue === "true";
  const dayConfig: Array<{ key: DayKey; label: string; enabled: boolean }> = [
    { key: "monday", label: "Monday", enabled: monday },
    { key: "tuesday", label: "Tuesday", enabled: tuesday },
    { key: "wednesday", label: "Wednesday", enabled: wednesday },
    { key: "thursday", label: "Thursday", enabled: thursday },
    { key: "friday", label: "Friday", enabled: friday }
  ];
  const busStopOptionListId = `mcc-bus-stop-directory-${memberId}`;
  const normalizedBusStopOptions = Array.from(
    new Set(
      busStopOptions
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    )
  ).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));

  const slotDefaults = {
    mondayAm: { doorToDoorAddress: transportMondayAmDoorToDoorAddress, busNumber: transportMondayAmBusNumber, busStop: transportMondayAmBusStop },
    mondayPm: { doorToDoorAddress: transportMondayPmDoorToDoorAddress, busNumber: transportMondayPmBusNumber, busStop: transportMondayPmBusStop },
    tuesdayAm: { doorToDoorAddress: transportTuesdayAmDoorToDoorAddress, busNumber: transportTuesdayAmBusNumber, busStop: transportTuesdayAmBusStop },
    tuesdayPm: { doorToDoorAddress: transportTuesdayPmDoorToDoorAddress, busNumber: transportTuesdayPmBusNumber, busStop: transportTuesdayPmBusStop },
    wednesdayAm: { doorToDoorAddress: transportWednesdayAmDoorToDoorAddress, busNumber: transportWednesdayAmBusNumber, busStop: transportWednesdayAmBusStop },
    wednesdayPm: { doorToDoorAddress: transportWednesdayPmDoorToDoorAddress, busNumber: transportWednesdayPmBusNumber, busStop: transportWednesdayPmBusStop },
    thursdayAm: { doorToDoorAddress: transportThursdayAmDoorToDoorAddress, busNumber: transportThursdayAmBusNumber, busStop: transportThursdayAmBusStop },
    thursdayPm: { doorToDoorAddress: transportThursdayPmDoorToDoorAddress, busNumber: transportThursdayPmBusNumber, busStop: transportThursdayPmBusStop },
    fridayAm: { doorToDoorAddress: transportFridayAmDoorToDoorAddress, busNumber: transportFridayAmBusNumber, busStop: transportFridayAmBusStop },
    fridayPm: { doorToDoorAddress: transportFridayPmDoorToDoorAddress, busNumber: transportFridayPmBusNumber, busStop: transportFridayPmBusStop }
  } satisfies Record<SlotKey, { doorToDoorAddress: string | null; busNumber: TransportBusNumber; busStop: string | null }>;

  const updateSlotMode = (slotKey: SlotKey, nextValue: string) => {
    setSlotModeValues((current) => ({
      ...current,
      [slotKey]: nextValue
    }));
  };

  const summarizeTransportation = () => {
    if (requiredValue === "false") return "No";
    if (requiredValue !== "true") return "-";

    const activeSlots: SlotKey[] = [
      ...(monday ? (["mondayAm", "mondayPm"] as SlotKey[]) : []),
      ...(tuesday ? (["tuesdayAm", "tuesdayPm"] as SlotKey[]) : []),
      ...(wednesday ? (["wednesdayAm", "wednesdayPm"] as SlotKey[]) : []),
      ...(thursday ? (["thursdayAm", "thursdayPm"] as SlotKey[]) : []),
      ...(friday ? (["fridayAm", "fridayPm"] as SlotKey[]) : [])
    ];

    const selectedModes = activeSlots
      .map((slot) => slotModeValues[slot])
      .filter((value): value is string => value !== "None" && value.length > 0);

    if (selectedModes.length === 0) return "None";

    const unique = Array.from(new Set(selectedModes));
    return unique.length === 1 ? unique[0] : "Mixed";
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("");
    const payload = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await saveMemberCommandCenterTransportationAction(payload);
      if (!result?.ok) {
        setStatus(result?.error ?? "Unable to save transportation.");
        return;
      }
      setStatus("Transportation saved.");
      window.dispatchEvent(
        new CustomEvent("mcc:header-update", {
          detail: {
            transportation: summarizeTransportation()
          }
        })
      );
    });
  };

  return (
    <form onSubmit={onSubmit} className="mt-3 space-y-3">
      <input type="hidden" name="memberId" value={memberId} />
      <datalist id={busStopOptionListId}>
        {normalizedBusStopOptions.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>

      <div className="grid gap-2 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="text-xs font-semibold text-muted">Transportation</span>
          <select
            name="transportationRequired"
            value={requiredValue}
            onChange={(event) => {
              const next = event.target.value;
              setRequiredValue(next);
              if (next !== "true") {
                setSlotModeValues({
                  mondayAm: "None",
                  mondayPm: "None",
                  tuesdayAm: "None",
                  tuesdayPm: "None",
                  wednesdayAm: "None",
                  wednesdayPm: "None",
                  thursdayAm: "None",
                  thursdayPm: "None",
                  fridayAm: "None",
                  fridayPm: "None"
                });
              }
            }}
            className="h-10 w-full rounded-lg border border-border px-3"
          >
            <option value="">-</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </label>
      </div>

      {enabled ? (
        <div className="rounded-lg border border-border p-3">
          <p className="mb-2 text-xs font-semibold text-muted">AM and PM Transport by Scheduled Day</p>
          <div className="space-y-3">
            {dayConfig
              .filter((day) => day.enabled)
              .map((day) => {
                const dayPrefix = day.key.charAt(0).toUpperCase() + day.key.slice(1);
                const amSlotKey = `${day.key}Am` as SlotKey;
                const pmSlotKey = `${day.key}Pm` as SlotKey;
                const amMode = slotModeValues[amSlotKey];
                const pmMode = slotModeValues[pmSlotKey];
                return (
                  <div key={day.key} className="rounded-lg border border-border p-3">
                    <p className="mb-2 text-xs font-semibold text-muted">{day.label}</p>

                    <div className="grid gap-2 md:grid-cols-2">
                      <label className="space-y-1 text-sm">
                        <span className="text-xs font-semibold text-muted">AM Type</span>
                        <select
                          name={`transport${dayPrefix}AmMode`}
                          value={amMode}
                          onChange={(event) => updateSlotMode(amSlotKey, event.target.value)}
                          required
                          className="h-10 w-full rounded-lg border border-border px-3"
                        >
                          <option value="None">None</option>
                          {MEMBER_TRANSPORTATION_SERVICE_OPTIONS.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="space-y-1 text-sm">
                        <span className="text-xs font-semibold text-muted">PM Type</span>
                        <select
                          name={`transport${dayPrefix}PmMode`}
                          value={pmMode}
                          onChange={(event) => updateSlotMode(pmSlotKey, event.target.value)}
                          required
                          className="h-10 w-full rounded-lg border border-border px-3"
                        >
                          <option value="None">None</option>
                          {MEMBER_TRANSPORTATION_SERVICE_OPTIONS.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      {amMode === "Door to Door" ? (
                        <label className="space-y-1 text-sm">
                          <span className="text-xs font-semibold text-muted">AM Door-to-Door Address</span>
                          <input
                            name={`transport${dayPrefix}AmDoorToDoorAddress`}
                            defaultValue={slotDefaults[amSlotKey].doorToDoorAddress ?? defaultDoorToDoorAddress}
                            required
                            className="h-10 w-full rounded-lg border border-border px-3"
                          />
                        </label>
                      ) : (
                        <div />
                      )}

                      {pmMode === "Door to Door" ? (
                        <label className="space-y-1 text-sm">
                          <span className="text-xs font-semibold text-muted">PM Door-to-Door Address</span>
                          <input
                            name={`transport${dayPrefix}PmDoorToDoorAddress`}
                            defaultValue={slotDefaults[pmSlotKey].doorToDoorAddress ?? defaultDoorToDoorAddress}
                            required
                            className="h-10 w-full rounded-lg border border-border px-3"
                          />
                        </label>
                      ) : (
                        <div />
                      )}
                    </div>

                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      {amMode !== "None" ? (
                        <div className="grid gap-2 md:grid-cols-2">
                          <label className="space-y-1 text-sm">
                            <span className="text-xs font-semibold text-muted">AM Bus #</span>
                            <select
                              name={`transport${dayPrefix}AmBusNumber`}
                              defaultValue={slotDefaults[amSlotKey].busNumber ?? ""}
                              required
                              className="h-10 w-full rounded-lg border border-border px-3"
                            >
                              <option value="">Select bus</option>
                              {busNumberOptions.map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          </label>

                          {amMode === "Bus Stop" ? (
                            <label className="space-y-1 text-sm">
                              <span className="text-xs font-semibold text-muted">AM Bus Stop</span>
                              <input
                                name={`transport${dayPrefix}AmBusStop`}
                                defaultValue={slotDefaults[amSlotKey].busStop ?? ""}
                                required
                                list={busStopOptionListId}
                                autoComplete="off"
                                className="h-10 w-full rounded-lg border border-border px-3"
                              />
                            </label>
                          ) : (
                            <div />
                          )}
                        </div>
                      ) : (
                        <div />
                      )}

                      {pmMode !== "None" ? (
                        <div className="grid gap-2 md:grid-cols-2">
                          <label className="space-y-1 text-sm">
                            <span className="text-xs font-semibold text-muted">PM Bus #</span>
                            <select
                              name={`transport${dayPrefix}PmBusNumber`}
                              defaultValue={slotDefaults[pmSlotKey].busNumber ?? ""}
                              required
                              className="h-10 w-full rounded-lg border border-border px-3"
                            >
                              <option value="">Select bus</option>
                              {busNumberOptions.map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          </label>

                          {pmMode === "Bus Stop" ? (
                            <label className="space-y-1 text-sm">
                              <span className="text-xs font-semibold text-muted">PM Bus Stop</span>
                              <input
                                name={`transport${dayPrefix}PmBusStop`}
                                defaultValue={slotDefaults[pmSlotKey].busStop ?? ""}
                                required
                                list={busStopOptionListId}
                                autoComplete="off"
                                className="h-10 w-full rounded-lg border border-border px-3"
                              />
                            </label>
                          ) : (
                            <div />
                          )}
                        </div>
                      ) : (
                        <div />
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      ) : null}

      <button type="submit" disabled={isPending} className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white disabled:opacity-70">
        {isPending ? "Saving..." : "Save Transportation"}
      </button>
      {status ? <p className="text-xs text-muted">{status}</p> : null}
    </form>
  );
}
