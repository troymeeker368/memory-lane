"use client";

import { useEffect, useId, useState } from "react";

type MemberOption = {
  id: string;
  displayName: string;
  lockerNumber: string | null;
};

type LockerStatus = "all" | "assigned" | "open";

type AssignLockerAction = (formData: FormData) => void | Promise<void>;

type LockerAssignModalTriggerProps = {
  assignAction: AssignLockerAction;
  defaultLocker: string;
  defaultMemberId?: string;
  activeMembers: MemberOption[];
  availableLockerOptions: string[];
  rawQuery: string;
  status: LockerStatus;
  currentPage: number;
};

export function LockerAssignModalTrigger({
  assignAction,
  defaultLocker,
  defaultMemberId = "",
  activeMembers,
  availableLockerOptions,
  rawQuery,
  status,
  currentPage
}: LockerAssignModalTriggerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [lockerNumber, setLockerNumber] = useState(defaultLocker);
  const [memberId, setMemberId] = useState(defaultMemberId);
  const headingId = useId();

  const openModal = () => {
    setLockerNumber(defaultLocker);
    setMemberId(defaultMemberId);
    setIsOpen(true);
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isOpen]);

  return (
    <>
      <button type="button" onClick={openModal} className="text-sm font-semibold text-brand">
        Assign/Reassign
      </button>

      {isOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby={headingId}
          onClick={() => setIsOpen(false)}
        >
          <div
            className="w-full max-w-2xl rounded-xl border border-border bg-white p-4 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <h2 id={headingId} className="text-base font-semibold text-foreground">
                Assign / Reassign Locker
              </h2>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded border border-border px-2 py-1 text-xs font-semibold text-muted"
              >
                Close
              </button>
            </div>

            <form
              action={assignAction}
              className="mt-3 grid gap-3 md:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto] md:items-end"
            >
              <input type="hidden" name="q" value={rawQuery} />
              <input type="hidden" name="status" value={status} />
              <input type="hidden" name="page" value={String(currentPage)} />

              <label className="flex min-w-0 flex-col gap-1 text-sm">
                <span className="block text-xs font-semibold text-muted">Locker #</span>
                <select
                  name="lockerNumber"
                  value={lockerNumber}
                  onChange={(event) => setLockerNumber(event.currentTarget.value)}
                  required
                  className="block h-10 w-full rounded-lg border border-border px-3"
                >
                  <option value="">Select locker</option>
                  {availableLockerOptions.map((locker) => (
                    <option key={locker} value={locker}>
                      {locker}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex min-w-0 flex-col gap-1 text-sm">
                <span className="block text-xs font-semibold text-muted">Member</span>
                <select
                  name="memberId"
                  value={memberId}
                  onChange={(event) => setMemberId(event.currentTarget.value)}
                  required
                  className="block h-10 w-full rounded-lg border border-border px-3"
                >
                  <option value="">Select active member</option>
                  {activeMembers.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.displayName}
                      {member.lockerNumber ? ` (current locker ${member.lockerNumber})` : ""}
                    </option>
                  ))}
                </select>
              </label>

              <div className="md:self-end">
                <button type="submit" className="h-10 w-full rounded-lg bg-brand px-4 text-sm font-semibold text-white md:w-auto">
                  Save Assignment
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
