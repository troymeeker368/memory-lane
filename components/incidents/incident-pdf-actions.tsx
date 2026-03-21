"use client";

import { useState, useTransition } from "react";

import { generateIncidentPdfAction } from "@/app/(portal)/documentation/incidents/actions";
import { triggerPdfDownload, triggerPdfPrint } from "@/components/documents/pdf-client";

export function IncidentPdfActions({ incidentId }: { incidentId: string }) {
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState("");

  function runPdfAction(mode: "download" | "print") {
    startTransition(async () => {
      setStatus("");
      const result = await generateIncidentPdfAction({ incidentId });
      if (!result.ok) {
        setStatus(`Error: ${result.error}`);
        return;
      }
      if (mode === "print") {
        triggerPdfPrint(result.dataUrl);
        setStatus("Print dialog opened for the branded PDF.");
        return;
      }
      triggerPdfDownload(result.dataUrl, result.fileName);
      setStatus("PDF downloaded.");
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white"
        disabled={isPending}
        onClick={() => runPdfAction("download")}
      >
        {isPending ? "Generating..." : "Download PDF"}
      </button>
      <button
        type="button"
        className="rounded-lg border border-border px-3 py-2 text-sm font-semibold"
        onClick={() => runPdfAction("print")}
        disabled={isPending}
      >
        Print
      </button>
      {status ? <p className="text-xs text-muted">{status}</p> : null}
    </div>
  );
}
