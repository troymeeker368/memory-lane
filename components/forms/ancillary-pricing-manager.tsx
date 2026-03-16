"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { updateAncillaryCategoryPriceAction } from "@/app/operations-admin-actions";
import { Button } from "@/components/ui/button";

type PricingCategory = {
  id: string;
  name: string;
  price_cents: number;
};

function centsToDollars(cents: number) {
  return (cents / 100).toFixed(2);
}

export function AncillaryPricingManager({ categories }: { categories: PricingCategory[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [statusByCategoryId, setStatusByCategoryId] = useState<Record<string, string>>({});
  const [priceInputs, setPriceInputs] = useState<Record<string, string>>(() =>
    Object.fromEntries(categories.map((category) => [category.id, centsToDollars(category.price_cents)]))
  );

  const orderedCategories = useMemo(
    () => [...categories].sort((a, b) => a.name.localeCompare(b.name)),
    [categories]
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
                    disabled={isPending}
                    onClick={() =>
                      startTransition(async () => {
                        const rawValue = priceInputs[category.id] ?? "";
                        const parsedValue = Number(rawValue);
                        if (!Number.isFinite(parsedValue) || parsedValue < 0) {
                          setStatusByCategoryId((current) => ({
                            ...current,
                            [category.id]: "Enter a valid non-negative price."
                          }));
                          return;
                        }

                        const result = await updateAncillaryCategoryPriceAction({
                          categoryId: category.id,
                          unitPriceDollars: parsedValue
                        });

                        setStatusByCategoryId((current) => ({
                          ...current,
                          [category.id]: result.error ? `Error: ${result.error}` : "Saved."
                        }));

                        if (!result.error) {
                          router.refresh();
                        }
                      })
                    }
                  >
                    Save
                  </Button>
                  {statusByCategoryId[category.id] ? (
                    <p className="mt-1 text-xs text-muted">{statusByCategoryId[category.id]}</p>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
