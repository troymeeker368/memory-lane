"use client";

import { useState, useTransition } from "react";

import { triggerPdfDownload, triggerPdfPrint } from "@/components/documents/pdf-client";

export function FaceSheetActions({ memberId }: { memberId: string }) {
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
            const response = await fetch(`/api/members/${memberId}/face-sheet`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              }
            });

            let result:
              | { ok: true; fileName: string; dataUrl: string }
              | { ok: false; error: string };

            try {
              result = (await response.json()) as typeof result;
            } catch {
              setStatus("Error: unexpected server response while generating the face sheet PDF.");
              return;
            }

            if (!result?.ok) {
              setStatus(`Error: ${result.error}`);
              return;
            }
            triggerPdfDownload(result.dataUrl, result.fileName);
            triggerPdfPrint(result.dataUrl);
            setStatus("Face sheet PDF downloaded and print dialog opened.");
          })
        }
      >
        {isPending ? "Preparing..." : "Download / Print PDF"}
      </button>
      {status ? <p className="text-xs text-muted">{status}</p> : null}
    </div>
  );
}
