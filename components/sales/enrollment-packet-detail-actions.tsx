"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  resendEnrollmentPacketAction,
  voidEnrollmentPacketAction
} from "@/app/sales-enrollment-actions";

export function EnrollmentPacketDetailActions({
  packetId,
  leadId,
  status
}: {
  packetId: string;
  leadId: string | null;
  status: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const canResend = status === "draft" || status === "sent" || status === "in_progress";
  const canVoid = status === "draft" || status === "sent" || status === "in_progress";

  const onResend = () => {
    startTransition(async () => {
      const result = await resendEnrollmentPacketAction({ packetId });
      if (!result.ok) {
        setStatusMessage(result.error);
        return;
      }
      setStatusMessage("Enrollment packet resent.");
      router.refresh();
    });
  };

  const onVoid = () => {
    if (!voidReason.trim()) {
      setStatusMessage("Enter a void reason before voiding this packet.");
      return;
    }
    startTransition(async () => {
      const result = await voidEnrollmentPacketAction({
        packetId,
        reason: voidReason.trim()
      });
      if (!result.ok) {
        setStatusMessage(result.error);
        return;
      }
      setStatusMessage("Enrollment packet voided.");
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {canResend ? (
          <button
            type="button"
            className="rounded-lg border border-border px-3 py-2 text-sm font-semibold"
            onClick={onResend}
            disabled={isPending}
          >
            {isPending ? "Working..." : "Resend Packet"}
          </button>
        ) : null}
        {leadId ? (
          <Link href={`/sales/leads/${leadId}`} className="rounded-lg border border-border px-3 py-2 text-sm font-semibold">
            Open Lead
          </Link>
        ) : null}
      </div>
      {canVoid ? (
        <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <label className="block space-y-1 text-sm">
            <span className="text-xs font-semibold uppercase tracking-wide text-amber-900">Void Reason</span>
            <textarea
              className="min-h-[84px] w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm"
              value={voidReason}
              onChange={(event) => setVoidReason(event.target.value)}
              placeholder="Why should this packet be voided?"
              disabled={isPending}
            />
          </label>
          <button
            type="button"
            className="rounded-lg bg-amber-700 px-3 py-2 text-sm font-semibold text-white"
            onClick={onVoid}
            disabled={isPending || !voidReason.trim()}
          >
            Void Packet
          </button>
          {leadId ? (
            <p className="text-xs text-amber-900">
              After voiding, use <Link href={`/sales/leads/${leadId}`} className="font-semibold underline">Send Enrollment Packet</Link> on the lead to issue a corrected packet.
            </p>
          ) : null}
        </div>
      ) : null}
      {statusMessage ? <p className="text-sm text-muted">{statusMessage}</p> : null}
    </div>
  );
}
