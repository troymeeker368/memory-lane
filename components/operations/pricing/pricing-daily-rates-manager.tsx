"use client";

import { useEffect, useMemo, useState } from "react";

import {
  setEnrollmentPricingDailyRateActiveAction,
  upsertEnrollmentPricingDailyRateAction
} from "@/app/(portal)/operations/pricing/actions";
import { useScopedMutation } from "@/components/forms/use-scoped-mutation";
import { Button } from "@/components/ui/button";
import { MutationNotice } from "@/components/ui/mutation-notice";

type DailyRateRow = {
  id: string;
  label: string;
  minDaysPerWeek: number;
  maxDaysPerWeek: number;
  dailyRate: number;
  effectiveStartDate: string;
  effectiveEndDate: string | null;
  isActive: boolean;
  displayOrder: number;
  notes: string | null;
  updatedAt: string;
};

type DailyRateFormState = {
  id: string;
  label: string;
  minDaysPerWeek: string;
  maxDaysPerWeek: string;
  dailyRate: string;
  effectiveStartDate: string;
  effectiveEndDate: string;
  isActive: boolean;
  displayOrder: string;
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

function toFormState(row: DailyRateRow): DailyRateFormState {
  return {
    id: row.id,
    label: row.label,
    minDaysPerWeek: String(row.minDaysPerWeek),
    maxDaysPerWeek: String(row.maxDaysPerWeek),
    dailyRate: row.dailyRate.toFixed(2),
    effectiveStartDate: row.effectiveStartDate,
    effectiveEndDate: row.effectiveEndDate ?? "",
    isActive: row.isActive,
    displayOrder: String(row.displayOrder),
    notes: row.notes ?? ""
  };
}

function emptyForm(today: string): DailyRateFormState {
  return {
    id: "",
    label: "",
    minDaysPerWeek: "1",
    maxDaysPerWeek: "1",
    dailyRate: "",
    effectiveStartDate: today,
    effectiveEndDate: "",
    isActive: true,
    displayOrder: "100",
    notes: ""
  };
}

export function PricingDailyRatesManager({
  rows,
  canEdit,
  todayDate
}: {
  rows: DailyRateRow[];
  canEdit: boolean;
  todayDate: string;
}) {
  const [localRows, setLocalRows] = useState<DailyRateRow[]>(rows);
  const [status, setStatus] = useState<string | null>(null);
  const [editing, setEditing] = useState<DailyRateFormState | null>(null);
  const { isSaving, run } = useScopedMutation();

  useEffect(() => {
    setLocalRows(rows);
  }, [rows]);

  const orderedRows = useMemo(
    () =>
      [...localRows].sort((left, right) => {
        const activeDiff = Number(right.isActive) - Number(left.isActive);
        if (activeDiff !== 0) return activeDiff;
        const displayDiff = left.displayOrder - right.displayOrder;
        if (displayDiff !== 0) return displayDiff;
        return left.minDaysPerWeek - right.minDaysPerWeek;
      }),
    [localRows]
  );

  const onSubmit = () => {
    if (!editing) return;

    const minDaysPerWeek = Number(editing.minDaysPerWeek);
    const maxDaysPerWeek = Number(editing.maxDaysPerWeek);
    const dailyRate = Number(editing.dailyRate);
    const displayOrder = Number(editing.displayOrder);

    if (!editing.label.trim()) {
      setStatus("Label is required.");
      return;
    }
    if (!Number.isInteger(minDaysPerWeek) || minDaysPerWeek < 1 || minDaysPerWeek > 7) {
      setStatus("Min days/week must be between 1 and 7.");
      return;
    }
    if (!Number.isInteger(maxDaysPerWeek) || maxDaysPerWeek < 1 || maxDaysPerWeek > 7) {
      setStatus("Max days/week must be between 1 and 7.");
      return;
    }
    if (maxDaysPerWeek < minDaysPerWeek) {
      setStatus("Max days/week cannot be less than min days/week.");
      return;
    }
    if (!Number.isFinite(dailyRate) || dailyRate < 0) {
      setStatus("Daily rate must be 0 or greater.");
      return;
    }
    if (!Number.isInteger(displayOrder) || displayOrder < 0) {
      setStatus("Display order must be a non-negative whole number.");
      return;
    }
    if (!editing.effectiveStartDate) {
      setStatus("Effective start date is required.");
      return;
    }

    setStatus(null);
    void run(() => upsertEnrollmentPricingDailyRateAction({
        id: editing.id,
        label: editing.label,
        minDaysPerWeek,
        maxDaysPerWeek,
        dailyRate,
        effectiveStartDate: editing.effectiveStartDate,
        effectiveEndDate: editing.effectiveEndDate,
        isActive: editing.isActive,
        displayOrder,
        notes: editing.notes
      }), {
      successMessage: "Daily rate saved.",
      errorMessage: "Unable to save daily rate pricing.",
      onSuccess: (result) => {
        const savedRow = ((result.data as { row?: DailyRateRow } | null)?.row ?? null) as DailyRateRow | null;
        if (savedRow) {
          setLocalRows((current) =>
            editing.id
              ? current.map((row) => (row.id === savedRow.id ? savedRow : row))
              : [savedRow, ...current.filter((row) => row.id !== savedRow.id)]
          );
        }
        setEditing(null);
        setStatus("Daily rate saved.");
      },
      onError: (result) => {
        setStatus(`Error: ${result.error}`);
      }
    });
  };

  return (
    <div className="space-y-3">
      <MutationNotice kind={status?.startsWith("Error") ? "error" : "success"} message={status} />

      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={isSaving} onClick={() => setEditing(emptyForm(todayDate))}>
            Add Daily Rate
          </Button>
          {editing ? (
            <button
              type="button"
              className="rounded-lg border border-border px-3 py-2 text-sm font-semibold"
              onClick={() => setEditing(null)}
              disabled={isSaving}
            >
              Cancel
            </button>
          ) : null}
        </div>
      ) : null}

      {editing ? (
        <div className="rounded-lg border border-border bg-slate-50 p-3">
          <p className="text-sm font-semibold text-fg">{editing.id ? "Edit Daily Rate" : "New Daily Rate"}</p>
          <div className="mt-2 grid gap-2 md:grid-cols-4">
            <label className="space-y-1 text-sm md:col-span-2">
              <span className="text-xs font-semibold text-muted">Label</span>
              <input
                className="h-10 w-full rounded-lg border border-border px-3"
                value={editing.label}
                onChange={(event) => setEditing((current) => (current ? { ...current, label: event.target.value } : current))}
                disabled={isSaving}
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold text-muted">Min Days/Week</span>
              <input
                type="number"
                min={1}
                max={7}
                step={1}
                className="h-10 w-full rounded-lg border border-border px-3"
                value={editing.minDaysPerWeek}
                onChange={(event) =>
                  setEditing((current) => (current ? { ...current, minDaysPerWeek: event.target.value } : current))
                }
                disabled={isSaving}
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold text-muted">Max Days/Week</span>
              <input
                type="number"
                min={1}
                max={7}
                step={1}
                className="h-10 w-full rounded-lg border border-border px-3"
                value={editing.maxDaysPerWeek}
                onChange={(event) =>
                  setEditing((current) => (current ? { ...current, maxDaysPerWeek: event.target.value } : current))
                }
                disabled={isSaving}
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold text-muted">Daily Rate</span>
              <input
                type="number"
                min={0}
                step="0.01"
                className="h-10 w-full rounded-lg border border-border px-3"
                value={editing.dailyRate}
                onChange={(event) => setEditing((current) => (current ? { ...current, dailyRate: event.target.value } : current))}
                disabled={isSaving}
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold text-muted">Display Order</span>
              <input
                type="number"
                min={0}
                step={1}
                className="h-10 w-full rounded-lg border border-border px-3"
                value={editing.displayOrder}
                onChange={(event) =>
                  setEditing((current) => (current ? { ...current, displayOrder: event.target.value } : current))
                }
                disabled={isSaving}
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
                disabled={isSaving}
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
                disabled={isSaving}
              />
            </label>
            <label className="flex items-center gap-2 text-sm md:col-span-4">
              <input
                type="checkbox"
                checked={editing.isActive}
                onChange={(event) => setEditing((current) => (current ? { ...current, isActive: event.target.checked } : current))}
                disabled={isSaving}
              />
              <span className="text-xs font-semibold text-muted">Active</span>
            </label>
            <label className="space-y-1 text-sm md:col-span-4">
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
            <Button type="button" onClick={onSubmit} disabled={isSaving}>
              {isSaving ? "Saving..." : "Save Daily Rate"}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="table-wrap overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Label</th>
              <th>Tier</th>
              <th>Rate</th>
              <th>Effective Start</th>
              <th>Effective End</th>
              <th>Status</th>
              <th>Display</th>
              <th>Last Updated</th>
              {canEdit ? <th>Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {orderedRows.map((row) => (
              <tr key={row.id}>
                <td>{row.label}</td>
                <td>
                  {row.minDaysPerWeek}
                  {row.maxDaysPerWeek === row.minDaysPerWeek ? "" : `-${row.maxDaysPerWeek}`} day/week
                </td>
                <td>{formatMoney(row.dailyRate)}</td>
                <td>{row.effectiveStartDate}</td>
                <td>{row.effectiveEndDate ?? "-"}</td>
                <td>{row.isActive ? "Active" : "Inactive"}</td>
                <td>{row.displayOrder}</td>
                <td>{formatDateTime(row.updatedAt)}</td>
                {canEdit ? (
                  <td>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="rounded-lg border border-border px-2 py-1 text-xs font-semibold"
                        onClick={() => setEditing(toFormState(row))}
                        disabled={isSaving}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="rounded-lg border border-border px-2 py-1 text-xs font-semibold"
                        onClick={() =>
                          void run(() => setEnrollmentPricingDailyRateActiveAction({
                            id: row.id,
                            isActive: !row.isActive
                          }), {
                            successMessage: "Daily rate status updated.",
                            errorMessage: "Unable to update daily rate status.",
                            onSuccess: (result) => {
                              const savedRow = ((result.data as { row?: DailyRateRow } | null)?.row ?? null) as DailyRateRow | null;
                              if (savedRow) {
                                setLocalRows((current) => current.map((item) => (item.id === savedRow.id ? savedRow : item)));
                              }
                              setStatus("Daily rate status updated.");
                            },
                            onError: (result) => {
                              setStatus(`Error: ${result.error}`);
                            }
                          })
                        }
                        disabled={isSaving}
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
                <td colSpan={canEdit ? 9 : 8} className="py-4 text-center text-sm text-muted">
                  No daily rate records found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
