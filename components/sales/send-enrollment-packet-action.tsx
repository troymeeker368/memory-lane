"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  replaceEnrollmentPacketAction,
  sendEnrollmentPacketAction,
  voidEnrollmentPacketAction
} from "@/app/sales-enrollment-actions";
import { Button } from "@/components/ui/button";
import {
  calculateInitialEnrollmentAmount,
  countRemainingEnrollmentAttendanceDaysInMonth
} from "@/lib/services/enrollment-packet-proration";

const WEEKDAY_OPTIONS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as const;
const STAFF_TRANSPORTATION_OPTIONS = ["None", "Door to Door", "Bus Stop", "Mixed"] as const;
type WeekdayOption = (typeof WEEKDAY_OPTIONS)[number];
type StaffTransportationOption = (typeof STAFF_TRANSPORTATION_OPTIONS)[number];

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

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

type ActivePacketConflict = {
  id: string;
  leadId: string | null;
  status: string;
  sentAt: string | null;
  openedAt: string | null;
  updatedAt: string;
};

type SendEnrollmentPacketFailure = {
  ok: false;
  error: string;
  code?: string;
  redirectTo?: string;
  activePacket?: ActivePacketConflict;
};

export function SendEnrollmentPacketAction({
  leadId,
  defaultCaregiverEmail,
  defaultRequestedStartDate,
  pricingPreview
}: {
  leadId: string;
  defaultCaregiverEmail?: string | null;
  defaultRequestedStartDate?: string | null;
  pricingPreview: PricingPreview;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [caregiverEmail, setCaregiverEmail] = useState(defaultCaregiverEmail ?? "");
  const [requestedStartDate, setRequestedStartDate] = useState(defaultRequestedStartDate ?? todayDateString());
  const [requestedDays, setRequestedDays] = useState<WeekdayOption[]>([]);
  const [transportation, setTransportation] = useState<StaffTransportationOption>("None");
  const [optionalMessage, setOptionalMessage] = useState("");
  const [communityFee, setCommunityFee] = useState<string>(
    pricingPreview.communityFeeAmount == null ? "" : pricingPreview.communityFeeAmount.toFixed(2)
  );
  const [dailyRate, setDailyRate] = useState<string>("");
  const [totalInitialEnrollmentAmount, setTotalInitialEnrollmentAmount] = useState<string>("");
  const [communityFeeEdited, setCommunityFeeEdited] = useState(false);
  const [dailyRateEdited, setDailyRateEdited] = useState(false);
  const [initialAmountEdited, setInitialAmountEdited] = useState(false);
  const [sentResult, setSentResult] = useState(false);
  const [activeConflict, setActiveConflict] = useState<ActivePacketConflict | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const submitGuardRef = useRef(false);
  const router = useRouter();
  const isWorking = isPending || isSubmitting;

  const resolvedDaysPerWeek = requestedDays.length;
  const resolvedDailyRateTier = useMemo(
    () =>
      pricingPreview.dailyRates.find(
        (tier) => resolvedDaysPerWeek >= tier.minDaysPerWeek && resolvedDaysPerWeek <= tier.maxDaysPerWeek
      ) ?? null,
    [pricingPreview.dailyRates, resolvedDaysPerWeek]
  );
  const calculatedRemainingAttendanceDays = useMemo(() => {
    if (!requestedStartDate || requestedDays.length === 0) return 0;
    try {
      return countRemainingEnrollmentAttendanceDaysInMonth({
        requestedStartDate,
        requestedDays
      });
    } catch {
      return 0;
    }
  }, [requestedDays, requestedStartDate]);

  const calculatedInitialEnrollmentAmount = useMemo(() => {
    const parsedDailyRate = Number(dailyRate);
    if (!requestedStartDate || requestedDays.length === 0 || !Number.isFinite(parsedDailyRate) || parsedDailyRate < 0) {
      return 0;
    }
    try {
      return calculateInitialEnrollmentAmount({
        requestedStartDate,
        requestedDays,
        dailyRate: parsedDailyRate,
        communityFee: Number(communityFee)
      });
    } catch {
      return 0;
    }
  }, [communityFee, dailyRate, requestedDays, requestedStartDate]);

  useEffect(() => {
    if (communityFeeEdited) return;
    setCommunityFee(pricingPreview.communityFeeAmount == null ? "" : pricingPreview.communityFeeAmount.toFixed(2));
  }, [communityFeeEdited, pricingPreview.communityFeeAmount]);

  useEffect(() => {
    if (dailyRateEdited) return;
    setDailyRate(resolvedDailyRateTier ? resolvedDailyRateTier.dailyRate.toFixed(2) : "");
  }, [dailyRateEdited, resolvedDailyRateTier]);

  useEffect(() => {
    if (initialAmountEdited) return;
    setTotalInitialEnrollmentAmount(calculatedInitialEnrollmentAmount.toFixed(2));
  }, [calculatedInitialEnrollmentAmount, initialAmountEdited]);

  const toggleDay = (day: WeekdayOption) => {
    setRequestedDays((current) => {
      if (current.includes(day)) {
        return current.filter((value) => value !== day);
      }
      return [...current, day];
    });
  };

  const resetPricingDefaults = () => {
    setCommunityFee(pricingPreview.communityFeeAmount == null ? "" : pricingPreview.communityFeeAmount.toFixed(2));
    setDailyRate(resolvedDailyRateTier ? resolvedDailyRateTier.dailyRate.toFixed(2) : "");
    setTotalInitialEnrollmentAmount(calculatedInitialEnrollmentAmount.toFixed(2));
    setCommunityFeeEdited(false);
    setDailyRateEdited(false);
    setInitialAmountEdited(false);
  };

  const buildActionPayload = () => {
    const parsedCommunityFee = Number(communityFee);
    const parsedDailyRate = Number(dailyRate);
    const parsedInitialEnrollmentAmount = Number(totalInitialEnrollmentAmount);
    return {
      parsedCommunityFee,
      parsedDailyRate,
      parsedInitialEnrollmentAmount,
      actionPayload: {
        leadId,
        caregiverEmail,
        requestedStartDate,
        requestedDays,
        transportation,
        communityFee: parsedCommunityFee,
        dailyRate: parsedDailyRate,
        totalInitialEnrollmentAmount: parsedInitialEnrollmentAmount,
        optionalMessage
      }
    };
  };

  const onSend = () => {
    if (submitGuardRef.current) return;
    if (!requestedStartDate) {
      setStatus("Requested start date is required.");
      return;
    }
    if (requestedDays.length === 0) {
      setStatus("Select at least one requested day.");
      return;
    }
    const { parsedCommunityFee, parsedDailyRate, parsedInitialEnrollmentAmount, actionPayload } = buildActionPayload();
    if (!Number.isFinite(parsedCommunityFee) || parsedCommunityFee < 0) {
      setStatus("Community fee must be a valid non-negative amount.");
      return;
    }
    if (!Number.isFinite(parsedDailyRate) || parsedDailyRate < 0) {
      setStatus("Daily rate must be a valid non-negative amount.");
      return;
    }
    if (!Number.isFinite(parsedInitialEnrollmentAmount) || parsedInitialEnrollmentAmount < 0) {
      setStatus("Initial enrollment amount must be a valid non-negative amount.");
      return;
    }

    setStatus(null);
    setActiveConflict(null);
    submitGuardRef.current = true;
    setIsSubmitting(true);
    startTransition(async () => {
      try {
        const result = (await sendEnrollmentPacketAction(actionPayload)) as
          | { ok: true; requestId: string; requestUrl: string }
          | SendEnrollmentPacketFailure;
        if (!result.ok) {
          if (result.code === "active_enrollment_packet_exists" && result.activePacket) {
            setActiveConflict(result.activePacket);
          }
          setStatus(result.error);
          if (result.redirectTo) {
            router.push(result.redirectTo);
          }
          return;
        }

        router.refresh();
        setSentResult(true);
        setStatus(null);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Unable to send enrollment packet.");
      } finally {
        setIsSubmitting(false);
        submitGuardRef.current = false;
      }
    });
  };

  const onVoidExisting = () => {
    if (!activeConflict || !voidReason.trim()) {
      setStatus("Enter a void reason before voiding the active packet.");
      return;
    }
    setStatus(null);
    startTransition(async () => {
      const result = await voidEnrollmentPacketAction({
        packetId: activeConflict.id,
        reason: voidReason.trim()
      });
      if (!result.ok) {
        setStatus(result.error);
        return;
      }
      setActiveConflict(null);
      setVoidReason("");
      router.refresh();
      setStatus("Existing packet voided. Review the updated terms and send the new packet.");
    });
  };

  const onReplaceExisting = () => {
    if (!activeConflict || !voidReason.trim()) {
      setStatus("Enter a void reason before replacing the active packet.");
      return;
    }
    const { actionPayload } = buildActionPayload();
    setStatus(null);
    submitGuardRef.current = true;
    setIsSubmitting(true);
    startTransition(async () => {
      try {
        const result = await replaceEnrollmentPacketAction({
          packetId: activeConflict.id,
          voidReason: voidReason.trim(),
          ...actionPayload
        });
        if (!result.ok) {
          setStatus(result.error);
          return;
        }
        setActiveConflict(null);
        setVoidReason("");
        router.refresh();
        setSentResult(true);
        setStatus(null);
      } finally {
        setIsSubmitting(false);
        submitGuardRef.current = false;
      }
    });
  };

  return (
    <div className="space-y-2">
      <Button type="button" onClick={() => setIsOpen(true)} disabled={isWorking}>
        Send Enrollment Packet
      </Button>

      {isOpen ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[95vh] w-full max-w-2xl overflow-auto rounded-lg bg-white p-4 shadow-xl">
            {sentResult ? (
              <div className="space-y-3">
                <h3 className="text-base font-semibold">Enrollment Packet Sent Successfully</h3>
                <p className="text-sm text-muted">
                  The enrollment packet was sent and is now in the signature workflow.
                </p>
                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    className="rounded-lg border border-border px-4 py-2 text-sm font-semibold"
                    onClick={() => {
                      setIsOpen(false);
                      setSentResult(false);
                      setActiveConflict(null);
                      setVoidReason("");
                    }}
                    disabled={isWorking}
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <>
                <h3 className="text-base font-semibold">Send Enrollment Packet</h3>
                <p className="mt-1 text-sm text-muted">Complete required packet values, then send the secure caregiver link.</p>
                {status ? (
                  <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{status}</p>
                ) : null}
                {activeConflict ? (
                  <div className="mt-3 space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
                    <div>
                      <p className="font-semibold text-amber-900">An active enrollment packet already exists.</p>
                      <p className="mt-1 text-amber-800">
                        Status: {activeConflict.status.replaceAll("_", " ")} | Sent: {activeConflict.sentAt || "-"} | Opened: {activeConflict.openedAt || "-"}
                      </p>
                      <p className="text-amber-800">Last activity: {activeConflict.updatedAt}</p>
                    </div>
                    <label className="block space-y-1">
                      <span className="text-xs font-semibold uppercase tracking-wide text-amber-900">Void / Replace Reason</span>
                      <textarea
                        className="min-h-[84px] w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-fg"
                        value={voidReason}
                        onChange={(event) => setVoidReason(event.target.value)}
                        placeholder="Explain why the active packet must be voided or replaced."
                        disabled={isWorking}
                      />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="rounded-lg border border-amber-400 bg-white px-3 py-2 text-sm font-semibold text-amber-900"
                        onClick={() => router.push(`/sales/pipeline/enrollment-packets/${activeConflict.id}`)}
                        disabled={isWorking}
                      >
                        Open Existing Packet
                      </button>
                      <button
                        type="button"
                        className="rounded-lg border border-amber-400 bg-white px-3 py-2 text-sm font-semibold text-amber-900"
                        onClick={onVoidExisting}
                        disabled={isWorking || !voidReason.trim()}
                      >
                        Void Existing Packet
                      </button>
                      <button
                        type="button"
                        className="rounded-lg bg-amber-700 px-3 py-2 text-sm font-semibold text-white"
                        onClick={onReplaceExisting}
                        disabled={isWorking || !voidReason.trim()}
                      >
                        Replace With New Packet
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <label className="space-y-1 text-sm md:col-span-2">
                    <span className="text-xs font-semibold text-muted">Caregiver Email</span>
                    <input
                      className="h-11 w-full rounded-lg border border-border px-3"
                      value={caregiverEmail}
                      onChange={(event) => setCaregiverEmail(event.target.value)}
                      disabled={isWorking}
                    />
                  </label>

                  <label className="space-y-1 text-sm">
                    <span className="text-xs font-semibold text-muted">Requested Start Date</span>
                    <input
                      type="date"
                      className="h-11 w-full rounded-lg border border-border px-3"
                      value={requestedStartDate}
                      onChange={(event) => {
                        setRequestedStartDate(event.target.value);
                        setInitialAmountEdited(false);
                      }}
                      disabled={isWorking}
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
                            disabled={isWorking}
                          />
                          <span>{day}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <label className="space-y-1 text-sm">
                    <span className="text-xs font-semibold text-muted">Transportation (staff set)</span>
                    <select
                      className="h-11 w-full rounded-lg border border-border px-3"
                      value={transportation}
                      onChange={(event) => setTransportation(event.target.value as StaffTransportationOption)}
                      disabled={isWorking}
                    >
                      {STAFF_TRANSPORTATION_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-1 text-sm">
                    <span className="text-xs font-semibold text-muted">Community Fee ($)</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className="h-11 w-full rounded-lg border border-border px-3"
                      value={communityFee}
                      onChange={(event) => {
                        setCommunityFee(event.target.value);
                        setCommunityFeeEdited(true);
                      }}
                      disabled={isWorking}
                    />
                  </label>

                  <label className="space-y-1 text-sm">
                    <span className="text-xs font-semibold text-muted">Daily Rate ($)</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className="h-11 w-full rounded-lg border border-border px-3"
                      value={dailyRate}
                      onChange={(event) => {
                        setDailyRate(event.target.value);
                        setDailyRateEdited(true);
                      }}
                      disabled={isWorking}
                    />
                  </label>

                  <label className="space-y-1 text-sm">
                    <span className="text-xs font-semibold text-muted">Initial Enrollment Amount ($)</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className="h-11 w-full rounded-lg border border-border px-3"
                      value={totalInitialEnrollmentAmount}
                      onChange={(event) => {
                        setTotalInitialEnrollmentAmount(event.target.value);
                        setInitialAmountEdited(true);
                      }}
                      disabled={isWorking}
                    />
                  </label>

                  <div className="space-y-1 rounded-lg border border-border bg-slate-50 p-3 text-xs md:col-span-2">
                    <p className="font-semibold text-fg">Pricing Defaults (Operations &gt; Pricing)</p>
                    <p className="text-muted">
                      Selected days: {resolvedDaysPerWeek} per week
                      {resolvedDailyRateTier ? ` | Default tier: ${resolvedDailyRateTier.label}` : ""}
                    </p>
                    <p className="text-muted">
                      Remaining attendance days this month from start date: {calculatedRemainingAttendanceDays}
                    </p>
                    <p className="text-muted">
                      Community Fee Default:{" "}
                      {pricingPreview.communityFeeAmount == null ? "Not configured" : `$${pricingPreview.communityFeeAmount.toFixed(2)}`}
                    </p>
                    <p className="text-muted">
                      Daily Rate Default: {resolvedDailyRateTier ? `$${resolvedDailyRateTier.dailyRate.toFixed(2)}` : "No matching tier"}
                    </p>
                    <p className="text-muted">
                      Calculated Initial Enrollment Amount: ${calculatedInitialEnrollmentAmount.toFixed(2)}
                    </p>
                    <div className="pt-1">
                      <button
                        type="button"
                        className="rounded-lg border border-border px-3 py-1 text-xs font-semibold"
                        onClick={resetPricingDefaults}
                        disabled={isWorking}
                      >
                        Reset Pricing to Defaults
                      </button>
                    </div>
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
                  </div>

                  <label className="space-y-1 text-sm md:col-span-2">
                    <span className="text-xs font-semibold text-muted">Optional Message</span>
                    <textarea
                      className="min-h-[90px] w-full rounded-lg border border-border px-3 py-2"
                      value={optionalMessage}
                      onChange={(event) => setOptionalMessage(event.target.value)}
                      disabled={isWorking}
                    />
                  </label>
                </div>

                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-border px-4 py-2 text-sm font-semibold"
                    onClick={() => {
                      setIsOpen(false);
                      setActiveConflict(null);
                      setVoidReason("");
                    }}
                    disabled={isWorking}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white"
                    onClick={onSend}
                    disabled={isWorking}
                  >
                    {isWorking ? "Sending..." : "Send Packet"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
