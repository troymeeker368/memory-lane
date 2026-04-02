"use client";

import { useState, useTransition } from "react";

import { generateCarePlanPdfAction } from "@/app/(portal)/health/care-plans/[carePlanId]/actions";
import { triggerPdfDownload, triggerPdfPrint } from "@/components/documents/pdf-client";

export function CarePlanPdfActions({ carePlanId }: { carePlanId: string }) {
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState("");

  function runPdfAction(mode: "download" | "print") {
    startTransition(async () => {
      setStatus("");
      const result = await generateCarePlanPdfAction({
        carePlanId,
        persistToMemberFiles: mode === "download"
      });
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
      setStatus(
        result.memberFilesStatus === "follow-up-needed" && result.memberFilesMessage
          ? `PDF downloaded. ${result.memberFilesMessage}`
          : "PDF downloaded and saved to member files."
      );
    });
  }

  return (
    <div className="print-hide flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white disabled:opacity-70"
        onClick={() => runPdfAction("download")}
        disabled={isPending}
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
