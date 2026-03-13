"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  setEnrollmentPricingCommunityFeeActiveAction,
  upsertEnrollmentPricingCommunityFeeAction
} from "@/app/(portal)/operations/pricing/actions";
import { Button } from "@/components/ui/button";

type CommunityFeeRow = {
  id: string;
  amount: number;
  effectiveStartDate: string;
  effectiveEndDate: string | null;
  isActive: boolean;
  notes: string | null;
  updatedAt: string;
};

type CommunityFeeFormState = {
  id: string;
  amount: string;
  effectiveStartDate: string;
  effectiveEndDate: string;
  isActive: boolean;
  notes: string;
};

function formatMoney(amount: number) {
  return `$${Number(amount).toFixed(2)}`;
}

function formatDateTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function toFormState(row: CommunityFeeRow): CommunityFeeFormState {
  return {
    id: row.id,
    amount: row.amount.toFixed(2),
    effectiveStartDate: row.effectiveStartDate,
    effectiveEndDate: row.effectiveEndDate ?? "",
    isActive: row.isActive,
    notes: row.notes ?? ""
  };
}

function emptyForm(today: string): CommunityFeeFormState {
  return {
    id: "",
    amount: "",
    effectiveStartDate: today,
    effectiveEndDate: "",
    isActive: true,
    notes: ""
  };
}

export function PricingCommunityFeeManager({
  rows,
  canEdit,
  todayDate
}: {
  rows: CommunityFeeRow[];
  canEdit: boolean;
  todayDate: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [editing, setEditing] = useState<CommunityFeeFormState | null>(null);

  const orderedRows = useMemo(
    () =>
      [...rows].sort((left, right) => {
        const activeDiff = Number(right.isActive) - Number(left.isActive);
        if (activeDiff !== 0) return activeDiff;
        return right.effectiveStartDate.localeCompare(left.effectiveStartDate);
      }),
    [rows]
  );

  const onSubmit = () => {
    if (!editing) return;
    const amount = Number(editing.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      setStatus("Enter a valid non-negative amount.");
      return;
    }
    if (!editing.effectiveStartDate) {
      setStatus("Effective start date is required.");
      return;
    }

    setStatus(null);
    startTransition(async () => {
      const result = await upsertEnrollmentPricingCommunityFeeAction({
        id: editing.id,
        amount,
        effectiveStartDate: editing.effectiveStartDate,
        effectiveEndDate: editing.effectiveEndDate,
        isActive: editing.isActive,
        notes: editing.notes
      });
      if (!result.ok) {
        setStatus(result.error);
        return;
      }
      setEditing(null);
      setStatus("Community fee saved.");
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      {status ? <p className="text-sm text-muted">{status}</p> : null}

      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={isPending} onClick={() => setEditing(emptyForm(todayDate))}>
            Add Community Fee
          </Button>
          {editing ? (
            <button
              type="button"
              className="rounded-lg border border-border px-3 py-2 text-sm font-semibold"
              onClick={() => setEditing(null)}
              disabled={isPending}
            >
              Cancel
            </button>
          ) : null}
        </div>
      ) : null}

      {editing ? (
        <div className="rounded-lg border border-border bg-slate-50 p-3">
          <p className="text-sm font-semibold text-fg">{editing.id ? "Edit Community Fee" : "New Community Fee"}</p>
          <div className="mt-2 grid gap-2 md:grid-cols-3">
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold text-muted">Amount</span>
              <input
                type="number"
                min={0}
                step="0.01"
                className="h-10 w-full rounded-lg border border-border px-3"
                value={editing.amount}
                onChange={(event) => setEditing((current) => (current ? { ...current, amount: event.target.value } : current))}
                disabled={isPending}
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold text-muted">Effective Start</span>
              <input
                type="date"
                className="h-10 w-full rounded-lg border border-border px-3"
                value={editing.effectiveStartDate}
                onChange={(event) =>
                  setEditing((current) => (current ? { ...current, effectiveStartDate: event.target.value } : current))
                }
                disabled={isPending}
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold text-muted">Effective End</span>
              <input
                type="date"
                className="h-10 w-full rounded-lg border border-border px-3"
                value={editing.effectiveEndDate}
                onChange={(event) =>
                  setEditing((current) => (current ? { ...current, effectiveEndDate: event.target.value } : current))
                }
                disabled={isPending}
              />
            </label>
            <label className="flex items-center gap-2 text-sm md:col-span-3">
              <input
                type="checkbox"
                checked={editing.isActive}
                onChange={(event) => setEditing((current) => (current ? { ...current, isActive: event.target.checked } : current))}
                disabled={isPending}
              />
              <span className="text-xs font-semibold text-muted">Active</span>
            </label>
            <label className="space-y-1 text-sm md:col-span-3">
              <span className="text-xs font-semibold text-muted">Notes (optional)</span>
              <textarea
                className="min-h-[70px] w-full rounded-lg border border-border px-3 py-2"
                value={editing.notes}
                onChange={(event) => setEditing((current) => (current ? { ...current, notes: event.target.value } : current))}
                disabled={isPending}
              />
            </label>
          </div>
          <div className="mt-3">
            <Button type="button" onClick={onSubmit} disabled={isPending}>
              {isPending ? "Saving..." : "Save Community Fee"}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="table-wrap overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Amount</th>
              <th>Effective Start</th>
              <th>Effective End</th>
              <th>Status</th>
              <th>Notes</th>
              <th>Last Updated</th>
              {canEdit ? <th>Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {orderedRows.map((row) => (
              <tr key={row.id}>
                <td>{formatMoney(row.amount)}</td>
                <td>{row.effectiveStartDate}</td>
                <td>{row.effectiveEndDate ?? "-"}</td>
                <td>{row.isActive ? "Active" : "Inactive"}</td>
                <td>{row.notes ?? "-"}</td>
                <td>{formatDateTime(row.updatedAt)}</td>
                {canEdit ? (
                  <td>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="rounded-lg border border-border px-2 py-1 text-xs font-semibold"
                        onClick={() => setEditing(toFormState(row))}
                        disabled={isPending}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="rounded-lg border border-border px-2 py-1 text-xs font-semibold"
                        onClick={() =>
                          startTransition(async () => {
                            const result = await setEnrollmentPricingCommunityFeeActiveAction({
                              id: row.id,
                              isActive: !row.isActive
                            });
                            setStatus(result.ok ? "Community fee status updated." : result.error);
                            if (result.ok) router.refresh();
                          })
                        }
                        disabled={isPending}
                      >
                        {row.isActive ? "Deactivate" : "Activate"}
                      </button>
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
            {orderedRows.length === 0 ? (
              <tr>
                <td colSpan={canEdit ? 7 : 6} className="py-4 text-center text-sm text-muted">
                  No community fee records found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
