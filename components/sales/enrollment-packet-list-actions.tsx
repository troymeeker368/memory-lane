"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  resendEnrollmentPacketAction,
  voidEnrollmentPacketAction
} from "@/app/sales-enrollment-actions";

export function EnrollmentPacketListActions({
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
  const [isVoiding, setIsVoiding] = useState(false);
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
      setStatusMessage("Resent.");
      router.refresh();
    });
  };

  const onVoid = () => {
    if (!voidReason.trim()) {
      setStatusMessage("Void reason required.");
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
      setIsVoiding(false);
      setVoidReason("");
      setStatusMessage("Voided.");
      router.refresh();
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Link className="font-semibold text-brand" href={`/sales/pipeline/enrollment-packets/${packetId}`}>
          Open
        </Link>
        {leadId ? (
          <Link className="font-semibold text-brand" href={`/sales/leads/${leadId}`}>
            Lead
          </Link>
        ) : null}
        {canResend ? (
          <button
            type="button"
            className="font-semibold text-brand"
            onClick={onResend}
            disabled={isPending}
          >
            {isPending ? "Working..." : "Resend"}
          </button>
        ) : null}
        {canVoid ? (
          <button
            type="button"
            className="font-semibold text-amber-800"
            onClick={() => {
              setIsVoiding((current) => !current);
              setStatusMessage(null);
            }}
            disabled={isPending}
          >
            Void
          </button>
        ) : null}
      </div>
      {isVoiding ? (
        <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-2">
          <textarea
            className="min-h-[72px] w-full rounded-lg border border-amber-300 bg-white px-2 py-1 text-xs"
            value={voidReason}
            onChange={(event) => setVoidReason(event.target.value)}
            placeholder="Void reason"
            disabled={isPending}
          />
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-lg bg-amber-700 px-2 py-1 text-xs font-semibold text-white"
              onClick={onVoid}
              disabled={isPending || !voidReason.trim()}
            >
              Confirm Void
            </button>
            <button
              type="button"
              className="rounded-lg border border-border px-2 py-1 text-xs font-semibold"
              onClick={() => {
                setIsVoiding(false);
                setVoidReason("");
                setStatusMessage(null);
              }}
              disabled={isPending}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {statusMessage ? <p className="text-xs text-muted">{statusMessage}</p> : null}
    </div>
  );
}
