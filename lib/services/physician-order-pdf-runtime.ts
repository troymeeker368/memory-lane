import { Buffer } from "node:buffer";

import { getPhysicianOrderById } from "@/lib/services/physician-orders-read";
import { toEasternDate, toEasternISO } from "@/lib/timezone";

async function loadPofDocumentPdfBuilder() {
  const { buildPofDocumentPdfBytes } = await import("@/lib/services/pof-document-pdf");
  return buildPofDocumentPdfBytes;
}

export async function buildPhysicianOrderPdfDataUrl(
  pofId: string,
  options?: {
    serviceRole?: boolean;
  }
) {
  const form = await getPhysicianOrderById(pofId, { serviceRole: options?.serviceRole });
  if (!form) throw new Error("Physician Order Form not found.");

  const now = toEasternISO();
  const buildPofDocumentPdfBytes = await loadPofDocumentPdfBuilder();
  const bytes = await buildPofDocumentPdfBytes({
    form,
    title: "Physician Order Form",
    metaLines: [`Generated: ${now}`]
  });
  return {
    form,
    fileName: `POF - ${form.memberNameSnapshot} - ${toEasternDate(now)}.pdf`,
    dataUrl: `data:application/pdf;base64,${Buffer.from(bytes).toString("base64")}`,
    generatedAt: now
  };
}
