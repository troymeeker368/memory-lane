"use client";

import { useState, useTransition } from "react";

import {
  generateAssessmentPdfAction,
  retryAssessmentDraftPofAction
} from "@/app/(portal)/health/assessment/[assessmentId]/actions";

function triggerDownload(dataUrl: string, fileName: string) {
  const anchor = document.createElement("a");
  anchor.href = dataUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export function AssessmentPdfActions({
  assessmentId,
  canRetryDraftPof
}: {
  assessmentId: string;
  canRetryDraftPof: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState("");

  return (
    <div className="print-hide flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white disabled:opacity-70"
        onClick={() =>
          startTransition(async () => {
            setStatus("");
            const result = await generateAssessmentPdfAction({ assessmentId });
            if (!result.ok) {
              setStatus(`Error: ${result.error}`);
              return;
            }
            triggerDownload(result.dataUrl, result.fileName);
            setStatus("PDF downloaded and saved to member files.");
          })
        }
        disabled={isPending}
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
