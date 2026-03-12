import { Buffer } from "node:buffer";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { PDFDocument, type PDFFont, rgb, StandardFonts } from "pdf-lib";

import { buildPofDocumentSections } from "@/lib/services/pof-document-content";
import {
  DOCUMENT_CENTER_ADDRESS,
  DOCUMENT_CENTER_LOGO_PUBLIC_PATH,
  DOCUMENT_CENTER_NAME,
  DOCUMENT_CENTER_PHONE
} from "@/lib/services/document-branding";
import type { PhysicianOrderForm } from "@/lib/services/physician-orders-supabase";

type SignaturePayload = {
  providerTypedName: string;
  signedAt: string;
  signatureImageBytes: Buffer;
  signatureContentType: string;
};

function wrapText(input: string, maxChars: number) {
  const normalized = input.trim();
  if (!normalized) return ["-"];
  const words = normalized.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  words.forEach((word) => {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= maxChars) {
      line = candidate;
      return;
    }
    if (line) lines.push(line);
    line = word;
  });
  if (line) lines.push(line);
  return lines.length > 0 ? lines : ["-"];
}

function drawWrappedLine(input: {
  text: string;
  maxChars: number;
  x: number;
  y: number;
  lineHeight: number;
  font: PDFFont;
  fontSize: number;
  color?: [number, number, number];
  page: (ReturnType<PDFDocument["addPage"]>);
}) {
  const lines = wrapText(input.text, input.maxChars);
  lines.forEach((line, index) => {
    input.page.drawText(line, {
      x: input.x,
      y: input.y - index * input.lineHeight,
      size: input.fontSize,
      font: input.font,
      color: rgb(input.color?.[0] ?? 0.1, input.color?.[1] ?? 0.1, input.color?.[2] ?? 0.1)
    });
  });
  return lines.length * input.lineHeight;
}

function loadCenterLogoBytes() {
  const relative = DOCUMENT_CENTER_LOGO_PUBLIC_PATH.replace(/^\//, "");
  const fullPath = join(process.cwd(), "public", relative);
  if (!existsSync(fullPath)) return null;
  return readFileSync(fullPath);
}

export async function buildPofDocumentPdfBytes(input: {
  form: PhysicianOrderForm;
  title: string;
  metaLines?: string[];
  signature?: SignaturePayload | null;
}) {
  const pdf = await PDFDocument.create();
  let page = pdf.addPage([612, 792]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logoBytes = loadCenterLogoBytes();
  const logoImage = logoBytes
    ? DOCUMENT_CENTER_LOGO_PUBLIC_PATH.toLowerCase().endsWith(".png")
      ? await pdf.embedPng(logoBytes)
      : await pdf.embedJpg(logoBytes)
    : null;

  const pageWidth = 612;
  const marginLeft = 34;
  const marginRight = 34;
  const usableWidth = pageWidth - marginLeft - marginRight;
  const maxY = 760;
  const minY = 48;
  const sections = buildPofDocumentSections(input.form);
  const metaLines = input.metaLines ?? [];

  const startNewPage = () => {
    page = pdf.addPage([612, 792]);
    return 760;
  };

  const drawHeader = (startY: number) => {
    let y = startY;
    if (logoImage) {
      const scaled = logoImage.scale(42 / logoImage.height);
      page.drawImage(logoImage, {
        x: marginLeft,
        y: y - 38,
        width: Math.min(scaled.width, 150),
        height: 42
      });
    }
    page.drawText(DOCUMENT_CENTER_NAME, { x: marginLeft + 158, y: y - 10, size: 10, font: bold });
    page.drawText(DOCUMENT_CENTER_ADDRESS, { x: marginLeft + 158, y: y - 24, size: 9, font: regular });
    page.drawText(DOCUMENT_CENTER_PHONE, { x: marginLeft + 158, y: y - 36, size: 9, font: regular });
    page.drawText(input.title, { x: marginLeft, y: y - 58, size: 14, font: bold, color: rgb(0.1, 0.24, 0.55) });
    let metaY = y - 10;
    metaLines.forEach((line) => {
      page.drawText(line, { x: pageWidth - marginRight - 180, y: metaY, size: 8, font: regular });
      metaY -= 11;
    });
    page.drawLine({
      start: { x: marginLeft, y: y - 66 },
      end: { x: pageWidth - marginRight, y: y - 66 },
      thickness: 1,
      color: rgb(0.8, 0.84, 0.9)
    });
    return y - 82;
  };

  let y = drawHeader(maxY);

  for (const section of sections) {
    if (y < minY + 40) {
      y = drawHeader(startNewPage());
    }
    page.drawText(section.title, { x: marginLeft, y, size: 11, font: bold, color: rgb(0.11, 0.25, 0.57) });
    y -= 16;

    for (const row of section.rows) {
      if (y < minY + 28) {
        y = drawHeader(startNewPage());
        page.drawText(section.title, { x: marginLeft, y, size: 11, font: bold, color: rgb(0.11, 0.25, 0.57) });
        y -= 16;
      }
      const labelText = `${row.label}:`;
      page.drawText(labelText, { x: marginLeft, y, size: 9, font: bold, color: rgb(0.15, 0.15, 0.15) });
      const consumed = drawWrappedLine({
        text: row.value,
        maxChars: 86,
        x: marginLeft + 160,
        y,
        lineHeight: 11,
        font: regular,
        fontSize: 9,
        page
      });
      y -= Math.max(consumed, 11);
    }
    y -= 9;
  }

  if (input.signature) {
    if (y < minY + 120) {
      y = drawHeader(startNewPage());
    }
    page.drawRectangle({
      x: marginLeft,
      y: y - 92,
      width: usableWidth,
      height: 92,
      color: rgb(0.96, 0.98, 1)
    });
    page.drawText("Provider Electronic Signature", {
      x: marginLeft + 10,
      y: y - 18,
      size: 11,
      font: bold,
      color: rgb(0.1, 0.24, 0.55)
    });
    const signatureImage =
      input.signature.signatureContentType === "image/jpeg" || input.signature.signatureContentType === "image/jpg"
        ? await pdf.embedJpg(input.signature.signatureImageBytes)
        : await pdf.embedPng(input.signature.signatureImageBytes);
    page.drawImage(signatureImage, {
      x: marginLeft + 10,
      y: y - 78,
      width: 180,
      height: 48
    });
    page.drawText(`Signed by: ${input.signature.providerTypedName}`, {
      x: marginLeft + 204,
      y: y - 42,
      size: 10,
      font: regular
    });
    page.drawText(`Signed at: ${input.signature.signedAt}`, {
      x: marginLeft + 204,
      y: y - 56,
      size: 10,
      font: regular
    });
    page.drawText("Attestation accepted electronically via secure link.", {
      x: marginLeft + 204,
      y: y - 70,
      size: 9,
      font: regular
    });
  }

  return Buffer.from(await pdf.save());
}
