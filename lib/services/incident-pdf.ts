import "server-only";

import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";

import {
  DOCUMENT_CENTER_ADDRESS,
  DOCUMENT_CENTER_LOGO_PUBLIC_PATH,
  DOCUMENT_CENTER_NAME,
  DOCUMENT_CENTER_PHONE
} from "@/lib/services/document-branding";
import { loadIncidentSubmitterSignatureDataUrl } from "@/lib/services/incident-artifacts";
import { parseDataUrlPayload } from "@/lib/services/member-files";
import { formatDateTime } from "@/lib/utils";
import { type IncidentDetail } from "@/lib/services/incident-shared";

type DrawContext = {
  pdf: PDFDocument;
  page: PDFPage;
  font: PDFFont;
  bold: PDFFont;
  y: number;
};

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const PAGE_MARGIN = 36;
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;

function clean(value: string | null | undefined) {
  return String(value ?? "").trim();
}

function withFallback(value: string | null | undefined, fallback = "-") {
  const normalized = clean(value);
  return normalized.length > 0 ? normalized : fallback;
}

function safeFileName(value: string) {
  return value.replace(/[<>:"/\\|?*]/g, "").trim();
}

function publicAssetPath(publicPath: string) {
  const normalized = publicPath.startsWith("/") ? publicPath.slice(1) : publicPath;
  return path.join(process.cwd(), "public", normalized);
}

async function loadCenterLogoImage(pdf: PDFDocument) {
  try {
    const bytes = await readFile(publicAssetPath(DOCUMENT_CENTER_LOGO_PUBLIC_PATH));
    return await pdf.embedPng(bytes);
  } catch {
    return null;
  }
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

function newPage(pdf: PDFDocument, font: PDFFont, bold: PDFFont) {
  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  return {
    pdf,
    page,
    font,
    bold,
    y: PAGE_HEIGHT - PAGE_MARGIN
  } satisfies DrawContext;
}

function ensureSpace(context: DrawContext, neededHeight: number) {
  if (context.y - neededHeight > PAGE_MARGIN) return context;
  return newPage(context.pdf, context.font, context.bold);
}

function drawTextLine(
  context: DrawContext,
  text: string,
  options?: { x?: number; size?: number; bold?: boolean; color?: ReturnType<typeof rgb> }
) {
  const size = options?.size ?? 10;
  const next = ensureSpace(context, size + 8);
  next.page.drawText(text, {
    x: options?.x ?? PAGE_MARGIN,
    y: next.y,
    size,
    font: options?.bold ? next.bold : next.font,
    color: options?.color ?? rgb(0.12, 0.15, 0.22)
  });
  next.y -= size + 5;
  return next;
}

function drawSectionCard(
  context: DrawContext,
  title: string,
  lines: string[],
  options?: { highlight?: boolean }
) {
  const filtered = lines.map((line) => clean(line)).filter(Boolean);
  if (filtered.length === 0) return context;

  const titleSize = 11;
  const bodySize = 9.6;
  const bodyLineHeight = 14;
  const cardPadding = 12;
  const estimatedHeight = cardPadding * 2 + 22 + filtered.length * bodyLineHeight + 10;
  const next = ensureSpace(context, estimatedHeight);
  const cardTop = next.y;
  const cardHeight = Math.max(estimatedHeight, 74);

  next.page.drawRectangle({
    x: PAGE_MARGIN,
    y: cardTop - cardHeight,
    width: CONTENT_WIDTH,
    height: cardHeight,
    color: options?.highlight ? rgb(0.96, 0.98, 1) : rgb(0.985, 0.988, 0.994),
    borderColor: options?.highlight ? rgb(0.2, 0.41, 0.72) : rgb(0.83, 0.86, 0.9),
    borderWidth: 1
  });

  next.page.drawText(title, {
    x: PAGE_MARGIN + cardPadding,
    y: cardTop - 18,
    size: titleSize,
    font: next.bold,
    color: rgb(0.07, 0.24, 0.52)
  });

  let lineY = cardTop - 36;
  for (const line of filtered) {
    const wrapped = wrapText(next.font, line, CONTENT_WIDTH - cardPadding * 2, bodySize);
    for (const wrappedLine of wrapped) {
      next.page.drawText(wrappedLine, {
        x: PAGE_MARGIN + cardPadding,
        y: lineY,
        size: bodySize,
        font: next.font,
        color: rgb(0.13, 0.16, 0.22)
      });
      lineY -= bodyLineHeight;
    }
  }

  next.y = cardTop - cardHeight - 10;
  return next;
}

function drawTwoColumnSummary(context: DrawContext, leftLines: string[], rightLines: string[]) {
  const left = leftLines.map((line) => clean(line)).filter(Boolean);
  const right = rightLines.map((line) => clean(line)).filter(Boolean);
  const rows = Math.max(left.length, right.length, 1);
  const lineHeight = 14;
  const cardHeight = 26 + rows * lineHeight + 18;
  const next = ensureSpace(context, cardHeight + 8);
  const top = next.y;
  const boxWidth = (CONTENT_WIDTH - 12) / 2;

  for (const [index, lines] of [left, right].entries()) {
    const x = PAGE_MARGIN + index * (boxWidth + 12);
    next.page.drawRectangle({
      x,
      y: top - cardHeight,
      width: boxWidth,
      height: cardHeight,
      color: rgb(0.985, 0.988, 0.994),
      borderColor: rgb(0.83, 0.86, 0.9),
      borderWidth: 1
    });

    let lineY = top - 18;
    for (const line of lines) {
      const wrapped = wrapText(next.font, line, boxWidth - 20, 9.5);
      for (const wrappedLine of wrapped) {
        next.page.drawText(wrappedLine, {
          x: x + 10,
          y: lineY,
          size: 9.5,
          font: next.font,
          color: rgb(0.13, 0.16, 0.22)
        });
        lineY -= lineHeight;
      }
    }
  }

  next.y = top - cardHeight - 10;
  return next;
}

function composeNarrative(detail: IncidentDetail) {
  const pieces = [
    clean(detail.description),
    detail.unsafeConditionsPresent
      ? `Unsafe conditions noted: ${withFallback(detail.unsafeConditionsDescription)}.`
      : "",
    clean(detail.generalNotes),
    clean(detail.followUpNote) ? `Follow-up: ${clean(detail.followUpNote)}` : ""
  ].filter(Boolean);

  return pieces.join(" ");
}

function composeResponseSummary(detail: IncidentDetail) {
  const parts = [
    clean(detail.injuredBy) ? `Injured by ${clean(detail.injuredBy)}` : "",
    clean(detail.injuryType) && clean(detail.injuryType).toLowerCase() !== "none" ? `injury type ${clean(detail.injuryType)}` : "",
    clean(detail.bodyPart) ? `body part ${clean(detail.bodyPart)}` : ""
  ].filter(Boolean);
  return parts.length > 0 ? parts.join("; ") + "." : "No specific injury response details were documented.";
}

async function embedSignatureImage(pdf: PDFDocument, signatureDataUrl: string) {
  const parsed = parseDataUrlPayload(signatureDataUrl, "Incident signature artifact is invalid.");
  if (parsed.contentType === "image/jpeg" || parsed.contentType === "image/jpg") {
    return pdf.embedJpg(parsed.bytes);
  }
  return pdf.embedPng(parsed.bytes);
}

async function drawDocumentHeader(context: DrawContext, logo: PDFImage | null, generatedAt: string) {
  const pageWidth = context.page.getWidth();

  if (logo) {
    const logoHeight = 38;
    const scaled = logo.scale(logoHeight / logo.height);
    const logoWidth = Math.min(scaled.width, 160);
    context.page.drawImage(logo, {
      x: PAGE_MARGIN,
      y: context.y - logoHeight + 4,
      width: logoWidth,
      height: logoHeight
    });
  }

  const centerX = pageWidth / 2;
  context.page.drawText(DOCUMENT_CENTER_NAME, {
    x: centerX - context.bold.widthOfTextAtSize(DOCUMENT_CENTER_NAME, 14) / 2,
    y: context.y,
    size: 14,
    font: context.bold,
    color: rgb(0.08, 0.28, 0.58)
  });
  context.y -= 14;
  context.page.drawText(DOCUMENT_CENTER_ADDRESS, {
    x: centerX - context.font.widthOfTextAtSize(DOCUMENT_CENTER_ADDRESS, 9.5) / 2,
    y: context.y,
    size: 9.5,
    font: context.font,
    color: rgb(0.15, 0.18, 0.25)
  });
  context.y -= 12;
  context.page.drawText(DOCUMENT_CENTER_PHONE, {
    x: centerX - context.font.widthOfTextAtSize(DOCUMENT_CENTER_PHONE, 9.5) / 2,
    y: context.y,
    size: 9.5,
    font: context.font,
    color: rgb(0.15, 0.18, 0.25)
  });

  const generatedLabel = `Generated: ${generatedAt} (ET)`;
  context.page.drawText(generatedLabel, {
    x: pageWidth - context.font.widthOfTextAtSize(generatedLabel, 8.5) - PAGE_MARGIN,
    y: PAGE_HEIGHT - PAGE_MARGIN,
    size: 8.5,
    font: context.font,
    color: rgb(0.36, 0.4, 0.46)
  });

  context.page.drawLine({
    start: { x: PAGE_MARGIN, y: 712 },
    end: { x: pageWidth - PAGE_MARGIN, y: 712 },
    color: rgb(0.75, 0.78, 0.84),
    thickness: 1
  });

  context.y = 690;
  return context;
}

async function drawSignatureBlock(
  context: DrawContext,
  signatureImage: PDFImage | null,
  signerName: string | null,
  signedAt: string | null
) {
  const next = ensureSpace(context, 120);
  next.page.drawRectangle({
    x: PAGE_MARGIN,
    y: next.y - 110,
    width: CONTENT_WIDTH,
    height: 110,
    color: rgb(0.985, 0.988, 0.994),
    borderColor: rgb(0.83, 0.86, 0.9),
    borderWidth: 1
  });

  next.page.drawText("Electronic Signature", {
    x: PAGE_MARGIN + 12,
    y: next.y - 18,
    size: 11,
    font: next.bold,
    color: rgb(0.07, 0.24, 0.52)
  });

  next.page.drawText(`Signed by: ${withFallback(signerName)}`, {
    x: PAGE_MARGIN + 12,
    y: next.y - 38,
    size: 9.8,
    font: next.font,
    color: rgb(0.13, 0.16, 0.22)
  });
  next.page.drawText(`Signed at: ${withFallback(signedAt ? formatDateTime(signedAt) : null)}`, {
    x: PAGE_MARGIN + 12,
    y: next.y - 52,
    size: 9.8,
    font: next.font,
    color: rgb(0.13, 0.16, 0.22)
  });

  if (signatureImage) {
    const maxWidth = 210;
    const maxHeight = 48;
    const widthScale = maxWidth / signatureImage.width;
    const heightScale = maxHeight / signatureImage.height;
    const scale = Math.min(widthScale, heightScale, 1);
    const imageWidth = signatureImage.width * scale;
    const imageHeight = signatureImage.height * scale;

    next.page.drawRectangle({
      x: PAGE_MARGIN + 12,
      y: next.y - 100,
      width: maxWidth + 16,
      height: maxHeight + 18,
      color: rgb(1, 1, 1),
      borderColor: rgb(0.8, 0.84, 0.9),
      borderWidth: 1
    });
    next.page.drawImage(signatureImage, {
      x: PAGE_MARGIN + 20,
      y: next.y - 91,
      width: imageWidth,
      height: imageHeight
    });
  } else {
    next.page.drawText("No signature image on file.", {
      x: PAGE_MARGIN + 12,
      y: next.y - 82,
      size: 9.5,
      font: next.font,
      color: rgb(0.4, 0.43, 0.48)
    });
  }

  next.y -= 124;
  return next;
}

export async function buildIncidentPdfBytesFromDetail(
  detail: IncidentDetail,
  options?: { submitterSignatureDataUrl?: string | null }
) {
  const generatedAt = formatDateTime(new Date().toISOString());
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await loadCenterLogoImage(pdf);
  const signatureImage =
    options?.submitterSignatureDataUrl ? await embedSignatureImage(pdf, options.submitterSignatureDataUrl) : null;

  let context = newPage(pdf, font, bold);
  context = await drawDocumentHeader(context, logo, generatedAt);
  context = drawTextLine(context, "Incident Report Summary", { size: 18, bold: true, color: rgb(0.08, 0.28, 0.58) });
  context = drawTextLine(context, `Incident Number: ${detail.incidentNumber}`, { size: 10.5, bold: true });
  context.y -= 2;

  context = drawTwoColumnSummary(
    context,
    [
      `Category: ${detail.incidentCategory.replaceAll("_", " ")}`,
      `Status: ${detail.status.replaceAll("_", " ")}`,
      `Reportable: ${detail.reportable ? "Yes" : "No"}`,
      `Incident date/time: ${formatDateTime(detail.incidentDateTime)}`,
      `Reported date/time: ${formatDateTime(detail.reportedDateTime)}`
    ],
    [
      `Participant: ${withFallback(detail.participantName)}`,
      `Staff involved: ${withFallback(detail.staffMemberName)}`,
      `Additional parties: ${withFallback(detail.additionalParties)}`,
      `Location: ${detail.location}`,
      `Exact location: ${withFallback(detail.exactLocationDetails)}`
    ]
  );

  context = drawSectionCard(
    context,
    "Incident Summary",
    [
      composeNarrative(detail),
      `Entered by ${detail.reporterName}${detail.createdAt ? ` on ${formatDateTime(detail.createdAt)}` : ""}.`
    ],
    { highlight: true }
  );

  context = drawSectionCard(context, "Response Summary", [
    composeResponseSummary(detail),
    clean(detail.followUpNote) ? `Follow-up note: ${clean(detail.followUpNote)}` : "",
    detail.unsafeConditionsPresent ? `Unsafe condition follow-up required: ${withFallback(detail.unsafeConditionsDescription)}` : "No unsafe conditions were documented."
  ]);

  context = drawSectionCard(context, "Review and State Audit Record", [
    `Reported by: ${detail.reporterName}`,
    `Submitted by: ${withFallback(detail.submittedByName ?? detail.submitterSignatureName)}`,
    `Submitted at: ${withFallback(detail.submittedAt ? formatDateTime(detail.submittedAt) : null)}`,
    `Director review: ${withFallback(detail.directorDecision ? detail.directorDecision.replaceAll("_", " ") : null)}`,
    `Reviewed by: ${withFallback(detail.directorSignatureName)}`,
    `Reviewed at: ${withFallback(detail.directorReviewedAt ? formatDateTime(detail.directorReviewedAt) : null)}`,
    clean(detail.directorReviewNotes) ? `Director notes: ${clean(detail.directorReviewNotes)}` : "",
    detail.finalPdfSavedAt ? `Filed to member files: ${formatDateTime(detail.finalPdfSavedAt)}` : ""
  ]);

  const timelineLines = detail.history
    .slice(-5)
    .map((item) => {
      const actor = withFallback(item.userName, "System");
      const notes = clean(item.notes);
      return `${formatDateTime(item.createdAt)} | ${item.action.replaceAll("_", " ")} | ${actor}${notes ? ` | ${notes}` : ""}`;
    });

  if (timelineLines.length > 0) {
    context = drawSectionCard(context, "Recent Timeline", timelineLines);
  }

  context = await drawSignatureBlock(context, signatureImage, detail.submitterSignatureName, detail.submitterSignedAt);

  const bytes = await pdf.save();
  return {
    fileName: `${safeFileName(detail.incidentNumber)} Incident Report Summary.pdf`,
    bytes
  };
}

export async function buildIncidentPdfDataUrl(incidentId: string) {
  const { getIncidentDetail } = await import("@/lib/services/incidents");
  const detail = await getIncidentDetail(incidentId);
  if (!detail) throw new Error("Incident was not found.");

  const signatureDataUrl = await loadIncidentSubmitterSignatureDataUrl(detail.submitterSignatureArtifactStoragePath);
  const built = await buildIncidentPdfBytesFromDetail(detail, {
    submitterSignatureDataUrl: signatureDataUrl
  });

  return {
    fileName: built.fileName,
    dataUrl: `data:application/pdf;base64,${Buffer.from(built.bytes).toString("base64")}`
  };
}
