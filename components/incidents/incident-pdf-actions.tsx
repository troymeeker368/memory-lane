"use client";

import { useState, useTransition } from "react";

import { generateIncidentPdfAction } from "@/app/(portal)/documentation/incidents/actions";

function triggerDownload(dataUrl: string, fileName: string) {
  const anchor = document.createElement("a");
  anchor.href = dataUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export function IncidentPdfActions({ incidentId }: { incidentId: string }) {
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState("");

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setStatus("");
            const result = await generateIncidentPdfAction({ incidentId });
            if (!result.ok) {
              setStatus(`Error: ${result.error}`);
              return;
            }
            triggerDownload(result.dataUrl, result.fileName);
            setStatus("PDF downloaded.");
          })
        }
      >
        {isPending ? "Generating..." : "Download PDF"}
      </button>
      <button
        type="button"
        className="rounded-lg border border-border px-3 py-2 text-sm font-semibold"
        onClick={() => window.print()}
      >
        Print
      </button>
      {status ? <p className="text-xs text-muted">{status}</p> : null}
    </div>
  );
}
