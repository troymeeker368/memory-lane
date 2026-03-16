"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { setMemberStatusAction } from "@/app/member-status-actions";
import { Button } from "@/components/ui/button";
import { MEMBER_DISCHARGE_REASON_OPTIONS, MEMBER_DISPOSITION_OPTIONS } from "@/lib/canonical";

export function MemberStatusToggle({
  memberId,
  memberName,
  status
}: {
  memberId: string;
  memberName?: string;
  status: "active" | "inactive";
}) {
  const [isPending, startTransition] = useTransition();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [dischargeReason, setDischargeReason] = useState("");
  const [dischargeDisposition, setDischargeDisposition] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const router = useRouter();
  const label = status === "active" ? "Discharge" : "Reactivate";
  const displayName = useMemo(() => memberName?.trim() || "this member", [memberName]);

  function onReactivate() {
    if (!window.confirm(`Reactivate ${displayName}?`)) return;
    setFeedback(null);
    startTransition(async () => {
      const result = await setMemberStatusAction({ memberId, status: "active" });
      if (result?.error) setFeedback(result.error);
      else router.refresh();
    });
  }

  function onSaveDischarge() {
    if (!dischargeReason || !dischargeDisposition) {
      setFeedback("Discharge reason and disposition are required.");
      return;
    }
    if (!window.confirm(`Discharge ${displayName}?`)) return;

    setFeedback(null);
    startTransition(async () => {
      const result = await setMemberStatusAction({
        memberId,
        status: "inactive",
        dischargeReason,
        dischargeDisposition
      });
      if (result?.error) {
        setFeedback(result.error);
        return;
      }
      setIsDialogOpen(false);
      setDischargeReason("");
      setDischargeDisposition("");
      router.refresh();
    });
  }

  return (
    <div className="space-y-1">
      {status === "active" ? (
        <Button
          type="button"
          className="h-9 bg-red-700 px-3 text-xs hover:bg-red-800"
          disabled={isPending}
          onClick={() => {
            setFeedback(null);
            setIsDialogOpen(true);
          }}
        >
          {isPending ? "Saving..." : label}
        </Button>
      ) : (
        <Button
          type="button"
          className="h-9 bg-[#99CC33] px-3 text-xs text-[#1B3E93] hover:bg-[#8fbe2d]"
          disabled={isPending}
          onClick={onReactivate}
        >
          {isPending ? "Saving..." : label}
        </Button>
      )}

      {feedback ? <p className="text-xs text-red-700">{feedback}</p> : null}

      {isDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-white p-4 shadow-xl">
            <h3 className="text-base font-semibold">Discharge Member</h3>
            <p className="mt-1 text-sm text-muted">{displayName}</p>

            <label className="mt-3 block text-xs font-semibold text-muted">Discharge Reason</label>
            <select
              className="mt-1 h-11 w-full rounded-lg border border-border px-3 text-sm"
              value={dischargeReason}
              onChange={(event) => setDischargeReason(event.target.value)}
              disabled={isPending}
            >
              <option value="">Select reason</option>
              {MEMBER_DISCHARGE_REASON_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>

            <label className="mt-3 block text-xs font-semibold text-muted">Discharge Disposition</label>
            <select
              className="mt-1 h-11 w-full rounded-lg border border-border px-3 text-sm"
              value={dischargeDisposition}
              onChange={(event) => setDischargeDisposition(event.target.value)}
              disabled={isPending}
            >
              <option value="">Select disposition</option>
              {MEMBER_DISPOSITION_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="h-10 rounded-lg border border-border px-3 text-sm font-semibold"
                onClick={() => {
                  setIsDialogOpen(false);
                  setDischargeReason("");
                  setDischargeDisposition("");
                  setFeedback(null);
                }}
                disabled={isPending}
              >
                Cancel
              </button>
              <Button type="button" className="h-10 bg-red-700 px-3 hover:bg-red-800" onClick={onSaveDischarge} disabled={isPending}>
                {isPending ? "Saving..." : "Confirm Discharge"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
