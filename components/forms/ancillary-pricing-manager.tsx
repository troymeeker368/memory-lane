"use client";

import { useEffect, useMemo, useState } from "react";

import { updateAncillaryCategoryPriceAction } from "@/app/operations-admin-actions";
import { useScopedMutation } from "@/components/forms/use-scoped-mutation";
import { Button } from "@/components/ui/button";
import { MutationNotice } from "@/components/ui/mutation-notice";

type PricingCategory = {
  id: string;
  name: string;
  price_cents: number;
};

function centsToDollars(cents: number) {
  return (cents / 100).toFixed(2);
}

export function AncillaryPricingManager({ categories }: { categories: PricingCategory[] }) {
  const [localCategories, setLocalCategories] = useState(categories);
  const [statusByCategoryId, setStatusByCategoryId] = useState<Record<string, string>>({});
  const [priceInputs, setPriceInputs] = useState<Record<string, string>>(() =>
    Object.fromEntries(categories.map((category) => [category.id, centsToDollars(category.price_cents)]))
  );
  const { isSaving, run } = useScopedMutation();

  useEffect(() => {
    setLocalCategories(categories);
    setPriceInputs(Object.fromEntries(categories.map((category) => [category.id, centsToDollars(category.price_cents)])));
  }, [categories]);

  const orderedCategories = useMemo(
    () => [...localCategories].sort((a, b) => a.name.localeCompare(b.name)),
    [localCategories]
  );

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        Admin-managed pricing. New ancillary entries use these values immediately after save.
      </p>
      <div className="table-wrap overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Charge Item</th>
              <th>Current Price</th>
              <th>Edit Price ($)</th>
              <th>Save</th>
            </tr>
          </thead>
          <tbody>
            {orderedCategories.map((category) => (
              <tr key={category.id}>
                <td>{category.name}</td>
                <td>${centsToDollars(category.price_cents)}</td>
                <td>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className="h-10 w-36 rounded-lg border border-border px-3 text-fg"
                    value={priceInputs[category.id] ?? ""}
                    onChange={(event) =>
                      setPriceInputs((current) => ({
                        ...current,
                        [category.id]: event.target.value
                      }))
                    }
                  />
                </td>
                <td>
                  <Button
                    type="button"
                    disabled={isSaving}
                    onClick={() =>
                      void run(() => {
                        const rawValue = priceInputs[category.id] ?? "";
                        const parsedValue = Number(rawValue);
                        if (!Number.isFinite(parsedValue) || parsedValue < 0) {
                          setStatusByCategoryId((current) => ({
                            ...current,
                            [category.id]: "Enter a valid non-negative price."
                          }));
                          return Promise.resolve({ ok: false, error: "Enter a valid non-negative price." });
                        }

                        return updateAncillaryCategoryPriceAction({
                          categoryId: category.id,
                          unitPriceDollars: parsedValue
                        });
                      }, {
                        successMessage: "Saved.",
                        errorMessage: "Unable to update ancillary pricing.",
                        onSuccess: (result) => {
                          const updatedCategory = ((result.data as { updated?: PricingCategory } | null)?.updated ?? null) as PricingCategory | null;
                          if (updatedCategory) {
                            setLocalCategories((current) =>
                              current.map((item) => (item.id === updatedCategory.id ? updatedCategory : item))
                            );
                            setPriceInputs((current) => ({
                              ...current,
                              [updatedCategory.id]: centsToDollars(updatedCategory.price_cents)
                            }));
                          }
                          setStatusByCategoryId((current) => ({
                            ...current,
                            [category.id]: "Saved."
                          }));
                        },
                        onError: (result) => {
                          setStatusByCategoryId((current) => ({
                            ...current,
                            [category.id]: `Error: ${result.error}`
                          }));
                        }
                      })
                    }
                  >
                    Save
                  </Button>
                  <MutationNotice
                    kind={statusByCategoryId[category.id]?.startsWith("Error") ? "error" : "success"}
                    message={statusByCategoryId[category.id]}
                    className="mt-1 text-xs"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
