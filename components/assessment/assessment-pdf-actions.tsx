"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  generateAssessmentPdfAction,
  retryAssessmentDraftPofAction
} from "@/app/(portal)/health/assessment/[assessmentId]/actions";
import { triggerPdfDownload, triggerPdfPrint } from "@/components/documents/pdf-client";

export function AssessmentPdfActions({
  assessmentId,
  canRetryDraftPof
}: {
  assessmentId: string;
  canRetryDraftPof: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState("");

  function runPdfAction(mode: "download" | "print") {
    startTransition(async () => {
      setStatus("");
      const result = await generateAssessmentPdfAction({
        assessmentId,
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
      setStatus("PDF downloaded and saved to member files.");
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
      {canRetryDraftPof ? (
        <button
          type="button"
          className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900 disabled:opacity-70"
          onClick={() =>
            startTransition(async () => {
              setStatus("");
              const result = await retryAssessmentDraftPofAction({ assessmentId });
              if (!result.ok) {
                setStatus(`Error: ${result.error}`);
                return;
              }
              router.refresh();
              setStatus("Draft POF retry succeeded.");
            })
          }
          disabled={isPending}
        >
          Retry Draft POF
        </button>
      ) : null}
      {status ? <p className="text-xs text-muted">{status}</p> : null}
    </div>
  );
}
