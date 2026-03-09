"use client";

import { useTransition } from "react";

import { generateMemberFaceSheetPdfAction } from "@/app/(portal)/members/[memberId]/face-sheet/actions";

function triggerDownload(dataUrl: string, fileName: string) {
  const anchor = document.createElement("a");
  anchor.href = dataUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

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
            triggerDownload(result.dataUrl, result.fileName);
            window.print();
          })
        }
      >
        {isPending ? "Preparing..." : "Download / Print PDF"}
      </button>
    </div>
  );
}
