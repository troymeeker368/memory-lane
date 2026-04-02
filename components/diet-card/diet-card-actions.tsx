"use client";

import { useState, useTransition } from "react";

import { generateMemberDietCardPdfAction } from "@/app/(portal)/members/[memberId]/diet-card/actions";
import { triggerPdfDownloadFromUrl, triggerPdfPrintFromUrl } from "@/components/documents/pdf-client";

export function DietCardActions({ memberId }: { memberId: string }) {
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState("");

  return (
    <div className="print-hide flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white disabled:opacity-70"
        title="Uses your browser print dialog. Choose Save as PDF."
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setStatus("");
            const result = await generateMemberDietCardPdfAction({ memberId });
            if (!result?.ok) {
              setStatus(`Error: ${result?.error ?? "Unable to generate diet card PDF."}`);
              return;
            }
            if (!result.downloadUrl) {
              setStatus("Error: diet card PDF is missing its download source.");
              return;
            }
            await triggerPdfDownloadFromUrl(result.downloadUrl, result.fileName);
            await triggerPdfPrintFromUrl(result.downloadUrl);
            setStatus(
              result.memberFilesStatus === "follow-up-needed" && result.memberFilesMessage
                ? `Diet card downloaded and print dialog opened. ${result.memberFilesMessage}`
                : "Diet card downloaded and print dialog opened."
            );
          })
        }
      >
        {isPending ? "Preparing..." : "Download / Print PDF"}
      </button>
      {status ? <p className={`text-xs ${status.startsWith("Error:") ? "text-[#B42318]" : "text-muted"}`}>{status}</p> : null}
    </div>
  );
}
