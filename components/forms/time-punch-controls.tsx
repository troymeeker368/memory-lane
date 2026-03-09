"use client";

import { useState, useTransition } from "react";

import { timePunchAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { CLOCK_IN_BUTTON_CLASS, CLOCK_OUT_BUTTON_CLASS } from "@/components/ui/punch-type-badge";

export function TimePunchControls() {
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function submit(punchType: "in" | "out") {
    setMessage(null);

    let lat: number | undefined;
    let lng: number | undefined;

    if (typeof window !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          lat = position.coords.latitude;
          lng = position.coords.longitude;
          startTransition(async () => {
            const res = await timePunchAction({ punchType, lat, lng, note });
            setMessage(res.error ? `Error: ${res.error}` : `Clock ${punchType} recorded.`);
          });
        },
        () => {
          startTransition(async () => {
            const res = await timePunchAction({ punchType, note });
            setMessage(res.error ? `Error: ${res.error}` : `Clock ${punchType} recorded (no location).`);
          });
        }
      );
      return;
    }

    startTransition(async () => {
      const res = await timePunchAction({ punchType, note });
      setMessage(res.error ? `Error: ${res.error}` : `Clock ${punchType} recorded.`);
    });
  }

  return (
    <div className="space-y-3">
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Optional note (shift context, correction details, etc.)"
        className="min-h-20 w-full rounded-lg border border-border p-3 text-sm"
      />
      <div className="grid grid-cols-2 gap-3">
        <Button type="button" disabled={isPending} className={CLOCK_IN_BUTTON_CLASS} onClick={() => submit("in")}>
          Clock In
        </Button>
        <Button type="button" disabled={isPending} className={CLOCK_OUT_BUTTON_CLASS} onClick={() => submit("out")}>
          Clock Out
        </Button>
      </div>
      {message ? <p className="text-sm text-muted">{message}</p> : null}
    </div>
  );
}

