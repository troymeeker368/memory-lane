"use client";

import { useEffect, useMemo, useState } from "react";

import { setMemberStatusAction } from "@/app/member-status-actions";
import { useScopedMutation } from "@/components/forms/use-scoped-mutation";
import { Button } from "@/components/ui/button";
import { MutationNotice } from "@/components/ui/mutation-notice";
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
  const [currentStatus, setCurrentStatus] = useState(status);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [dischargeReason, setDischargeReason] = useState("");
  const [dischargeDisposition, setDischargeDisposition] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const { isSaving, run } = useScopedMutation();
  const label = currentStatus === "active" ? "Discharge" : "Reactivate";
  const displayName = useMemo(() => memberName?.trim() || "this member", [memberName]);

  useEffect(() => {
    setCurrentStatus(status);
  }, [status]);

  function onReactivate() {
    if (!window.confirm(`Reactivate ${displayName}?`)) return;
    setFeedback(null);
    void run(() => setMemberStatusAction({ memberId, status: "active" }), {
      successMessage: "Member reactivated.",
      errorMessage: "Unable to update member status.",
      onSuccess: () => {
        setCurrentStatus("active");
        setFeedback("Member reactivated.");
      },
      onError: (result) => {
        setFeedback(`Error: ${result.error}`);
      }
    });
  }

  function onSaveDischarge() {
    if (!dischargeReason || !dischargeDisposition) {
      setFeedback("Discharge reason and disposition are required.");
      return;
    }
    if (!window.confirm(`Discharge ${displayName}?`)) return;

    setFeedback(null);
    void run(() => setMemberStatusAction({
        memberId,
        status: "inactive",
        dischargeReason,
        dischargeDisposition
      }), {
      successMessage: "Member discharged.",
      errorMessage: "Unable to update member status.",
      onSuccess: () => {
        setCurrentStatus("inactive");
        setIsDialogOpen(false);
        setDischargeReason("");
        setDischargeDisposition("");
        setFeedback("Member discharged.");
      },
      onError: (result) => {
        setFeedback(`Error: ${result.error}`);
      }
    });
  }

  return (
    <div className="space-y-1">
      {currentStatus === "active" ? (
        <Button
          type="button"
          className="h-9 bg-red-700 px-3 text-xs hover:bg-red-800"
          disabled={isSaving}
          onClick={() => {
            setFeedback(null);
            setIsDialogOpen(true);
          }}
        >
          {isSaving ? "Saving..." : label}
        </Button>
      ) : (
        <Button
          type="button"
          className="h-9 bg-[#99CC33] px-3 text-xs text-[#1B3E93] hover:bg-[#8fbe2d]"
          disabled={isSaving}
          onClick={onReactivate}
        >
          {isSaving ? "Saving..." : label}
        </Button>
      )}

      <MutationNotice kind={feedback?.startsWith("Error") ? "error" : "success"} message={feedback} />

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
              disabled={isSaving}
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
              disabled={isSaving}
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
                disabled={isSaving}
              >
                Cancel
              </button>
              <Button type="button" className="h-10 bg-red-700 px-3 hover:bg-red-800" onClick={onSaveDischarge} disabled={isSaving}>
                {isSaving ? "Saving..." : "Confirm Discharge"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
