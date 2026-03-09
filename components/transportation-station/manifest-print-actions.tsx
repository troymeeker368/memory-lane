"use client";

import { useTransition } from "react";

export function ManifestPrintActions() {
  const [isPending, startTransition] = useTransition();

  return (
    <div className="print-hide flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white disabled:opacity-70"
        title="Use your browser print dialog to save as PDF."
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            window.print();
          })
        }
      >
        {isPending ? "Preparing..." : "Download / Print PDF"}
      </button>
    </div>
  );
}

