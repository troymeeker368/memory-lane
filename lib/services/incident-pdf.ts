import "server-only";

import { Buffer } from "node:buffer";

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import { DOCUMENT_CENTER_NAME } from "@/lib/services/document-branding";
import { getIncidentDetail } from "@/lib/services/incidents";
import { formatDateTime } from "@/lib/utils";

type DrawContext = {
  pdf: PDFDocument;
  page: PDFPage;
  font: PDFFont;
  bold: PDFFont;
  y: number;
  width: number;
  height: number;
  margin: number;
};

function clean(value: string | null | undefined, fallback = "-") {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : fallback;
}

function addPage(pdf: PDFDocument, font: PDFFont, bold: PDFFont): DrawContext {
  const page = pdf.addPage([612, 792]);
  return {
    pdf,
    page,
    font,
    bold,
    y: 756,
    width: 612,
    height: 792,
    margin: 40
  };
}

function ensureSpace(context: DrawContext, neededHeight: number) {
  if (context.y - neededHeight > context.margin) return context;
  return addPage(context.pdf, context.font, context.bold);
}

function drawLine(context: DrawContext, text: string, options?: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb> }) {
  const size = options?.size ?? 10;
  const next = ensureSpace(context, size + 8);
  next.page.drawText(text, {
    x: next.margin,
    y: next.y,
    size,
    font: options?.bold ? next.bold : next.font,
    color: options?.color ?? rgb(0.1, 0.14, 0.2)
  });
  next.y -= size + 6;
  return next;
}

function wrapText(font: PDFFont, text: string, maxWidth: number, size: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
  }

  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

function drawWrappedBlock(context: DrawContext, label: string, value: string, size = 10) {
  let next = drawLine(context, label, { size, bold: true });
  const lines = wrapText(next.font, value, next.width - next.margin * 2, size);
  for (const line of lines) {
    next = drawLine(next, line, { size });
  }
  next.y -= 4;
  return next;
}

export async function buildIncidentPdfDataUrl(incidentId: string) {
  const detail = await getIncidentDetail(incidentId);
  if (!detail) throw new Error("Incident was not found.");

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let context = addPage(pdf, font, bold);
  context = drawLine(context, DOCUMENT_CENTER_NAME, { size: 11, bold: true, color: rgb(0.04, 0.35, 0.61) });
  context = drawLine(context, "Incident Report", { size: 18, bold: true });
  context = drawLine(context, `Incident Number: ${detail.incidentNumber}`, { size: 11, bold: true });
  context.y -= 4;

  context = drawWrappedBlock(
    context,
    "Summary",
    `Category: ${detail.incidentCategory} | Status: ${detail.status} | Reportable: ${detail.reportable ? "Yes" : "No"}`
  );
  context = drawWrappedBlock(
    context,
    "People",
    `Participant: ${clean(detail.participantName)} | Staff Member: ${clean(detail.staffMemberName)} | Additional Parties: ${clean(detail.additionalParties)}`
  );
  context = drawWrappedBlock(
    context,
    "Dates",
    `Incident: ${formatDateTime(detail.incidentDateTime)} | Reported: ${formatDateTime(detail.reportedDateTime)}`
  );
  context = drawWrappedBlock(
    context,
    "Location",
    `${detail.location}${detail.exactLocationDetails ? ` | ${detail.exactLocationDetails}` : ""}`
  );
  context = drawWrappedBlock(context, "Description / Cause", clean(detail.description));
  context = drawWrappedBlock(
    context,
    "Unsafe Conditions",
    detail.unsafeConditionsPresent
      ? `Yes. ${clean(detail.unsafeConditionsDescription)}`
      : "No unsafe conditions were documented."
  );
  context = drawWrappedBlock(
    context,
    "Injury / Response",
    `Injured By: ${clean(detail.injuredBy)} | Injury Type: ${clean(detail.injuryType)} | Body Part: ${clean(detail.bodyPart)}`
  );
  context = drawWrappedBlock(context, "General Notes", clean(detail.generalNotes));
  context = drawWrappedBlock(context, "Follow-up Note", clean(detail.followUpNote));
  context = drawWrappedBlock(
    context,
    "Audit Signoff",
    `Entered By: ${detail.reporterName} | Submitted: ${clean(detail.submittedAt ? formatDateTime(detail.submittedAt) : null)} | Approved By: ${clean(detail.directorSignatureName)} | Approved At: ${clean(detail.directorReviewedAt ? formatDateTime(detail.directorReviewedAt) : null)}`
  );
  context = drawWrappedBlock(context, "Director Review Notes", clean(detail.directorReviewNotes));

  context = drawLine(context, "Audit History", { size: 12, bold: true });
  for (const item of detail.history) {
    context = drawWrappedBlock(
      context,
      `${formatDateTime(item.createdAt)} | ${item.action}`,
      `${clean(item.userName)}${item.notes ? ` | ${item.notes}` : ""}`
    );
  }

  const bytes = await pdf.save();
  const fileName = `${detail.incidentNumber} Incident Report.pdf`;
  return {
    fileName,
    dataUrl: `data:application/pdf;base64,${Buffer.from(bytes).toString("base64")}`
  };
}
