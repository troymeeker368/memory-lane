"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { reassignTransportationManifestBusAction } from "@/app/(portal)/operations/transportation-station/actions";

type Shift = "AM" | "PM";
type TransportType = "Bus Stop" | "Door to Door";

type Props = {
  selectedDate: string;
  busFilter: "all" | "unassigned" | string;
  memberId: string;
  shift: Shift;
  transportType: TransportType;
  busStopName: string | null;
  doorToDoorAddress: string | null;
  caregiverContactId: string | null;
  caregiverContactName: string | null;
  caregiverContactPhone: string | null;
  caregiverContactAddress: string | null;
  notes: string | null;
  busNumberOptions: string[];
};

export function UnassignedRiderAssignmentForm(props: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleAssign(formData: FormData) {
    startTransition(async () => {
      setStatus(null);
      setError(null);
      const result = await reassignTransportationManifestBusAction(formData);
      if (!result.ok) {
        setError(result.error ?? "Unable to update bus assignment.");
        return;
      }

      setStatus(result.success ?? "Bus assignment updated.");
      router.refresh();
    });
  }

  return (
    <form action={handleAssign} className="flex w-full flex-col gap-2">
      <input type="hidden" name="selectedDate" value={props.selectedDate} />
      <input type="hidden" name="shift" value={props.shift} />
      <input type="hidden" name="busFilter" value={props.busFilter} />
      <input type="hidden" name="memberId" value={props.memberId} />
      <input type="hidden" name="transportType" value={props.transportType} />
      <input type="hidden" name="busStopName" value={props.busStopName ?? ""} />
      <input type="hidden" name="doorToDoorAddress" value={props.doorToDoorAddress ?? ""} />
      <input type="hidden" name="caregiverContactId" value={props.caregiverContactId ?? ""} />
      <input type="hidden" name="caregiverContactName" value={props.caregiverContactName ?? ""} />
      <input type="hidden" name="caregiverContactPhone" value={props.caregiverContactPhone ?? ""} />
      <input type="hidden" name="caregiverContactAddress" value={props.caregiverContactAddress ?? ""} />
      <input type="hidden" name="notes" value={props.notes ?? ""} />

      <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[240px] sm:flex-row sm.items-center">
        <select
          name="busNumber"
          required
          defaultValue=""
          className="h-10 w-full rounded-lg border border-border bg-white px-3 text-sm sm:min-w-[140px]"
        >
          <option value="" disabled>
            Assign bus
          </option>
          {props.busNumberOptions.map((option) => (
            <option key={option} value={option}>
              Bus {option}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="h-10 rounded-lg bg-brand px-3 text-sm font-semibold text-white disabled:opacity-60 sm:px-4"
          disabled={isPending}
        >
          {isPending ? "Assigning..." : "Assign"}
        </button>
      </div>
      {error ? <p className="text-xs text-rose-700">{error}</p> : null}
      {status ? <p className="text-xs text-emerald-700">{status}</p> : null}
    </form>
  );
}
