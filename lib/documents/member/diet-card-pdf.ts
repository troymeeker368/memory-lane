import "server-only";

import { Buffer } from "node:buffer";

import { getMemberDietCard } from "@/lib/services/member-diet-card";

function lineOrDash(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : "-";
}

export async function buildDietCardPdf(memberId: string) {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const dietCard = await getMemberDietCard(memberId);
  if (!dietCard) {
    return { error: "Member diet card data not found." } as const;
  }

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 396]);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const black = rgb(0.1, 0.1, 0.1);

  let y = 350;
  const left = 48;

  const writeRow = (label: string, value: string) => {
    page.drawText(label, { x: left, y, size: 13, font: bold, color: black });
    page.drawText(value, { x: 220, y, size: 13, font: regular, color: black });
    y -= 34;
  };

  page.drawText("Diet Card", { x: left, y, size: 22, font: bold, color: black });
  y -= 34;
  writeRow("Member Name", lineOrDash(dietCard.member.name));
  writeRow("Assistance Required", lineOrDash(dietCard.assistanceRequired));
  writeRow("Diet", lineOrDash(dietCard.diet));
  writeRow("Allergies", lineOrDash(dietCard.allergies));
  writeRow("Texture", lineOrDash(dietCard.texture));
  writeRow("Notes", lineOrDash(dietCard.notes));

  const pdfBytes = await pdf.save();
  return {
    dietCard,
    pdfBytes: Buffer.from(pdfBytes)
  } as const;
}
