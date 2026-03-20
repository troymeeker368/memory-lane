"use client";

import { useMemo, useState, useTransition } from "react";

import { runDocumentationCreateAction } from "@/app/documentation-create-actions";
import { Button } from "@/components/ui/button";
import type { SelectCategory, SelectMember } from "@/types/data";
import { toEasternDate } from "@/lib/timezone";

export function AncillaryChargeForm({
  members,
  categories
}: {
  members: SelectMember[];
  categories: SelectCategory[];
}) {
  const isLatePickupCategory = (categoryName?: string | null) => {
    const normalized = (categoryName ?? "").toLowerCase();
    return normalized.includes("late pick-up") || normalized.includes("late pickup");
  };

  const today = useMemo(() => toEasternDate(), []);
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [form, setForm] = useState({
    memberId: members[0]?.id ?? "",
    categoryId: categories[0]?.id ?? "",
    serviceDate: today,
    latePickupTime: "",
    notes: ""
  });

  const selectedCategory = categories.find((category) => category.id === form.categoryId);
  const requiresLatePickupTime = isLatePickupCategory(selectedCategory?.name);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="font-semibold">Member Name</span>
          <select
            className="h-11 w-full rounded-lg border border-border bg-white px-3"
            value={form.memberId}
            onChange={(e) => setForm((f) => ({ ...f, memberId: e.target.value }))}
          >
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.display_name}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-sm">
          <span className="font-semibold">Category</span>
          <select
            className="h-11 w-full rounded-lg border border-border bg-white px-3"
            value={form.categoryId}
            onChange={(e) =>
              setForm((f) => {
                const nextCategoryId = e.target.value;
                const nextCategory = categories.find((category) => category.id === nextCategoryId);
                const nextRequiresLatePickupTime = isLatePickupCategory(nextCategory?.name);
                return {
                  ...f,
                  categoryId: nextCategoryId,
                  latePickupTime: nextRequiresLatePickupTime ? f.latePickupTime : ""
                };
              })
            }
          >
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className={`grid gap-3 ${requiresLatePickupTime ? "md:grid-cols-2" : ""}`}>
        <label className="space-y-1 text-sm">
          <span className="font-semibold">Date</span>
          <input
            type="date"
            className="h-11 w-full rounded-lg border border-border bg-white px-3"
            value={form.serviceDate}
            onChange={(e) => setForm((f) => ({ ...f, serviceDate: e.target.value }))}
          />
        </label>

        {requiresLatePickupTime ? (
          <label className="space-y-1 text-sm">
            <span className="font-semibold">If late pick up - what time was member picked up?</span>
            <input
              type="time"
              className="h-11 w-full rounded-lg border border-border bg-white px-3"
              value={form.latePickupTime}
              onChange={(e) => setForm((f) => ({ ...f, latePickupTime: e.target.value }))}
            />
          </label>
        ) : null}
      </div>

      <textarea
        className="min-h-20 w-full rounded-lg border border-border p-3 text-sm"
        placeholder="Notes"
        value={form.notes}
        onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
      />

      <Button
        type="button"
        disabled={isPending || !form.memberId || !form.categoryId || (requiresLatePickupTime && !form.latePickupTime)}
        onClick={() =>
          startTransition(async () => {
            const res = await runDocumentationCreateAction({
              kind: "createAncillaryCharge",
              payload: form
            });
            setStatus(res.error ? `Error: ${res.error}` : "Ancillary charge saved.");
          })
        }
      >
        Save Charge
      </Button>

      {status ? <p className="text-sm text-muted">{status}</p> : null}
    </div>
  );
}

