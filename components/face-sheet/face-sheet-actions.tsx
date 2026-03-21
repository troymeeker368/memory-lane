"use client";

import { useTransition } from "react";

import { generateMemberFaceSheetPdfAction } from "@/app/(portal)/members/[memberId]/face-sheet/actions";
import { triggerPdfDownload, triggerPdfPrint } from "@/components/documents/pdf-client";

export function FaceSheetActions({ memberId }: { memberId: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <div className="print-hide flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white disabled:opacity-70"
        title="Uses your browser print dialog. Choose Save as PDF."
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await generateMemberFaceSheetPdfAction({ memberId });
            if (!result?.ok) return;
            triggerPdfDownload(result.dataUrl, result.fileName);
            triggerPdfPrint(result.dataUrl);
          })
        }
      >
        {isPending ? "Preparing..." : "Download / Print PDF"}
      </button>
    </div>
  );
}
