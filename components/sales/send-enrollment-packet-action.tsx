"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { sendEnrollmentPacketAction } from "@/app/sales-actions";
import { Button } from "@/components/ui/button";

const WEEKDAY_OPTIONS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as const;

type WeekdayOption = (typeof WEEKDAY_OPTIONS)[number];

type PricingPreview = {
  communityFeeAmount: number | null;
  dailyRates: Array<{
    id: string;
    label: string;
    minDaysPerWeek: number;
    maxDaysPerWeek: number;
    dailyRate: number;
  }>;
  issues: string[];
};

export function SendEnrollmentPacketAction({
  leadId,
  memberId,
  defaultCaregiverEmail,
  pricingPreview
}: {
  leadId: string;
  memberId?: string | null;
  defaultCaregiverEmail?: string | null;
  pricingPreview: PricingPreview;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [caregiverEmail, setCaregiverEmail] = useState(defaultCaregiverEmail ?? "");
  const [requestedDays, setRequestedDays] = useState<WeekdayOption[]>(["Monday", "Wednesday", "Friday"]);
  const [transportation, setTransportation] = useState("Door to Door");
  const [optionalMessage, setOptionalMessage] = useState("");
  const router = useRouter();

  const requestedDaysText = useMemo(() => requestedDays.join(", "), [requestedDays]);

  const toggleDay = (day: WeekdayOption) => {
    setRequestedDays((current) => {
      if (current.includes(day)) {
        return current.filter((value) => value !== day);
      }
      return [...current, day];
    });
  };

  const onSend = () => {
    if (requestedDays.length === 0) {
      setStatus("Select at least one requested day.");
      return;
    }

    setStatus(null);
    startTransition(async () => {
      const result = await sendEnrollmentPacketAction({
        leadId,
        memberId: memberId ?? "",
        caregiverEmail,
        requestedDays,
        transportation,
        optionalMessage
      });
      if (!result.ok) {
        setStatus(result.error);
        if ("redirectTo" in result && result.redirectTo) {
          router.push(result.redirectTo);
        }
        return;
      }
      setStatus(`Enrollment packet sent. Requested days: ${requestedDaysText}`);
      setIsOpen(false);
      router.refresh();
    });
  };

  return (
    <div className="space-y-2">
      <Button type="button" onClick={() => setIsOpen(true)} disabled={isPending}>
        Send Enrollment Packet
      </Button>
      {status ? <p className="text-xs text-muted">{status}</p> : null}

      {isOpen ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[95vh] w-full max-w-2xl overflow-auto rounded-lg bg-white p-4 shadow-xl">
            <h3 className="text-base font-semibold">Send Enrollment Packet</h3>
            <p className="mt-1 text-sm text-muted">Complete required packet values, then send the secure caregiver link.</p>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-sm md:col-span-2">
                <span className="text-xs font-semibold text-muted">Caregiver Email</span>
                <input
                  className="h-11 w-full rounded-lg border border-border px-3"
                  value={caregiverEmail}
                  onChange={(event) => setCaregiverEmail(event.target.value)}
                  disabled={isPending}
                />
              </label>

              <div className="space-y-1 text-sm md:col-span-2">
                <span className="text-xs font-semibold text-muted">Requested Days</span>
                <div className="flex flex-wrap gap-2 rounded-lg border border-border p-2">
                  {WEEKDAY_OPTIONS.map((day) => (
                    <label key={day} className="flex items-center gap-2 rounded border border-border px-2 py-1 text-xs">
                      <input
                        type="checkbox"
                        checked={requestedDays.includes(day)}
                        onChange={() => toggleDay(day)}
                        disabled={isPending}
                      />
                      <span>{day}</span>
                    </label>
                  ))}
                </div>
              </div>

              <label className="space-y-1 text-sm">
                <span className="text-xs font-semibold text-muted">Transportation</span>
                <select
                  className="h-11 w-full rounded-lg border border-border px-3"
                  value={transportation}
                  onChange={(event) => setTransportation(event.target.value)}
                  disabled={isPending}
                >
                  <option value="Door to Door">Door to Door</option>
                  <option value="Bus Stop">Bus Stop</option>
                  <option value="No Transportation">No Transportation</option>
                </select>
              </label>

              <div className="space-y-1 rounded-lg border border-border bg-slate-50 p-3 text-xs md:col-span-2">
                <p className="font-semibold text-fg">Pricing Defaults (Operations &gt; Pricing)</p>
                <p className="text-muted">
                  Community Fee:{" "}
                  {pricingPreview.communityFeeAmount == null ? "Not configured" : `$${pricingPreview.communityFeeAmount.toFixed(2)}`}
                </p>
                {pricingPreview.dailyRates.length > 0 ? (
                  <ul className="space-y-1 text-muted">
                    {pricingPreview.dailyRates.map((tier) => (
                      <li key={tier.id}>
                        {tier.label}: ${tier.dailyRate.toFixed(2)} / day ({tier.minDaysPerWeek}
                        {tier.maxDaysPerWeek === tier.minDaysPerWeek ? "" : `-${tier.maxDaysPerWeek}`} day/week)
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted">No active daily rate tiers configured.</p>
                )}
                {pricingPreview.issues.map((issue) => (
                  <p key={issue} className="font-semibold text-amber-700">
                    {issue}
                  </p>
                ))}
                <p className="text-muted">Daily rate is resolved at send time from requested days and active pricing tiers.</p>
              </div>

              <label className="space-y-1 text-sm md:col-span-2">
                <span className="text-xs font-semibold text-muted">Optional Message</span>
                <textarea
                  className="min-h-[90px] w-full rounded-lg border border-border px-3 py-2"
                  value={optionalMessage}
                  onChange={(event) => setOptionalMessage(event.target.value)}
                  disabled={isPending}
                />
              </label>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-border px-4 py-2 text-sm font-semibold"
                onClick={() => setIsOpen(false)}
                disabled={isPending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white"
                onClick={onSend}
                disabled={isPending}
              >
                {isPending ? "Sending..." : "Send Packet"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
