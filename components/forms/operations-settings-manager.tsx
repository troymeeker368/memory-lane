"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { updateOperationalSettingsAction } from "@/app/actions";
import { usePropSyncedState, usePropSyncedStatus } from "@/components/forms/use-prop-synced-state";

export function OperationsSettingsManager({
  initialBusNumbers,
  initialMakeupPolicy,
  initialLatePickupRules
}: {
  initialBusNumbers: string[];
  initialMakeupPolicy: "rolling_30_day_expiration" | "running_total";
  initialLatePickupRules: {
    graceStartTime: string;
    firstWindowMinutes: number;
    firstWindowFeeCents: number;
    additionalPerMinuteCents: number;
    additionalMinutesCap: number;
  };
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const syncDeps = [
    initialBusNumbers.join(","),
    initialMakeupPolicy,
    initialLatePickupRules.graceStartTime,
    initialLatePickupRules.firstWindowMinutes,
    initialLatePickupRules.firstWindowFeeCents,
    initialLatePickupRules.additionalPerMinuteCents,
    initialLatePickupRules.additionalMinutesCap
  ];
  const [status, setStatus] = usePropSyncedStatus(syncDeps);
  const [busNumbersCsv, setBusNumbersCsv] = usePropSyncedState(initialBusNumbers.join(", "), syncDeps);
  const [makeupPolicy, setMakeupPolicy] = usePropSyncedState(initialMakeupPolicy, syncDeps);
  const [graceStartTime, setGraceStartTime] = usePropSyncedState(initialLatePickupRules.graceStartTime, syncDeps);
  const [firstWindowMinutes, setFirstWindowMinutes] = usePropSyncedState(String(initialLatePickupRules.firstWindowMinutes), syncDeps);
  const [firstWindowFeeDollars, setFirstWindowFeeDollars] = usePropSyncedState((initialLatePickupRules.firstWindowFeeCents / 100).toFixed(2), syncDeps);
  const [additionalPerMinuteDollars, setAdditionalPerMinuteDollars] = usePropSyncedState((initialLatePickupRules.additionalPerMinuteCents / 100).toFixed(2), syncDeps);
  const [additionalMinutesCap, setAdditionalMinutesCap] = usePropSyncedState(String(initialLatePickupRules.additionalMinutesCap), syncDeps);

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        Central operations rules for bus configuration, makeup-day behavior, and late pickup fee calculations.
      </p>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="font-semibold">Configured Buses</span>
          <input
            value={busNumbersCsv}
            onChange={(event) => setBusNumbersCsv(event.target.value)}
            placeholder="1, 2, 3"
            className="h-10 w-full rounded-lg border border-border px-3"
          />
          <span className="block text-xs text-muted">Comma-separated bus numbers used by MCC and Transportation Station.</span>
        </label>

        <label className="space-y-1 text-sm">
          <span className="font-semibold">Makeup Day Policy</span>
          <select
            value={makeupPolicy}
            onChange={(event) =>
              setMakeupPolicy(
                event.target.value === "running_total" ? "running_total" : "rolling_30_day_expiration"
              )
            }
            className="h-10 w-full rounded-lg border border-border px-3"
          >
            <option value="rolling_30_day_expiration">Reset after 30 days</option>
            <option value="running_total">Running total</option>
          </select>
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-5">
        <label className="space-y-1 text-sm">
          <span className="font-semibold">Late Pickup Starts</span>
          <input
            type="time"
            value={graceStartTime}
            onChange={(event) => setGraceStartTime(event.target.value)}
            className="h-10 w-full rounded-lg border border-border px-3"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-semibold">First Window (min)</span>
          <input
            type="number"
            min={1}
            value={firstWindowMinutes}
            onChange={(event) => setFirstWindowMinutes(event.target.value)}
            className="h-10 w-full rounded-lg border border-border px-3"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-semibold">First Window Fee ($)</span>
          <input
            type="number"
            min={0}
            step="0.01"
            value={firstWindowFeeDollars}
            onChange={(event) => setFirstWindowFeeDollars(event.target.value)}
            className="h-10 w-full rounded-lg border border-border px-3"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-semibold">Per Minute After ($)</span>
          <input
            type="number"
            min={0}
            step="0.01"
            value={additionalPerMinuteDollars}
            onChange={(event) => setAdditionalPerMinuteDollars(event.target.value)}
            className="h-10 w-full rounded-lg border border-border px-3"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-semibold">Additional Cap (min)</span>
          <input
            type="number"
            min={0}
            value={additionalMinutesCap}
            onChange={(event) => setAdditionalMinutesCap(event.target.value)}
            className="h-10 w-full rounded-lg border border-border px-3"
          />
        </label>
      </div>

      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await updateOperationalSettingsAction({
              busNumbersCsv,
              makeupPolicy,
              latePickupGraceStartTime: graceStartTime,
              latePickupFirstWindowMinutes: Number(firstWindowMinutes),
              latePickupFirstWindowFeeDollars: Number(firstWindowFeeDollars),
              latePickupAdditionalPerMinuteDollars: Number(additionalPerMinuteDollars),
              latePickupAdditionalMinutesCap: Number(additionalMinutesCap)
            });
            if (result?.error) {
              setStatus(`Error: ${result.error}`);
              return;
            }
            setStatus("Operations settings saved.");
            router.refresh();
          })
        }
        className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white disabled:opacity-70"
      >
        {isPending ? "Saving..." : "Save Operations Rules"}
      </button>
      {status ? <p className="text-xs text-muted">{status}</p> : null}
    </div>
  );
}
