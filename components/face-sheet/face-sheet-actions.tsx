"use client";

import { useState, useTransition } from "react";

import { triggerPdfDownloadFromUrl, triggerPdfPrintFromUrl } from "@/components/documents/pdf-client";

type FaceSheetPdfResult =
  | {
      ok: false;
      status: "error";
      error: string;
    }
  | {
      ok: boolean;
      status: "verified" | "follow-up-needed";
      fileName: string;
      downloadUrl: string | null;
      memberFilesStatus?: "verified" | "follow-up-needed";
      memberFilesMessage?: string | null;
    };

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

            let result: FaceSheetPdfResult;

            try {
              result = (await response.json()) as typeof result;
            } catch {
              setStatus("Error: unexpected server response while generating the face sheet PDF.");
              return;
            }

            if (result.status === "error") {
              setStatus(`Error: ${result.error}`);
              return;
            }
            if (!result.downloadUrl) {
              setStatus("Face sheet saved to member files, but a temporary download link could not be created. Open it from Member Files.");
              return;
            }
            await triggerPdfDownloadFromUrl(result.downloadUrl, result.fileName);
            await triggerPdfPrintFromUrl(result.downloadUrl);
            setStatus(
              result.status === "follow-up-needed" && result.memberFilesMessage
                ? `Face sheet PDF downloaded and print dialog opened. ${result.memberFilesMessage}`
                : "Face sheet PDF downloaded and print dialog opened."
            );
          })
        }
      >
        {isPending ? "Preparing..." : "Download / Print PDF"}
      </button>
      {status ? <p className="text-xs text-muted">{status}</p> : null}
    </div>
  );
}
