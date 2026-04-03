import { Buffer } from "node:buffer";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { PDFDocument, type PDFFont, type PDFImage, type PDFPage, rgb, StandardFonts } from "pdf-lib";

import { buildPofDocumentSections } from "@/lib/services/pof-document-content";
import {
  DOCUMENT_CENTER_ADDRESS_LINE_1,
  DOCUMENT_CENTER_ADDRESS_LINE_2,
  DOCUMENT_CENTER_LOGO_PUBLIC_PATH,
  DOCUMENT_CENTER_NAME,
  DOCUMENT_CENTER_PHONE
} from "@/lib/services/document-branding";
import type { PhysicianOrderForm } from "@/lib/services/physician-order-model";

type SignaturePayload = {
  providerTypedName: string;
  providerCredentials?: string | null;
  signedAt: string;
  signatureImageBytes: Buffer;
  signatureContentType: string;
};

function wrapTextToWidth(input: {
  text: string;
  font: PDFFont;
  fontSize: number;
  maxWidth: number;
}) {
  const normalized = input.text.trim();
  if (!normalized) return ["-"];

  const paragraphs = normalized.split(/\r?\n/);
  const lines: string[] = [];

  const breakLongWord = (word: string) => {
    if (input.font.widthOfTextAtSize(word, input.fontSize) <= input.maxWidth) return [word];
    const chunks: string[] = [];
    let chunk = "";
    for (const char of word) {
      const candidate = `${chunk}${char}`;
      if (input.font.widthOfTextAtSize(candidate, input.fontSize) <= input.maxWidth) {
        chunk = candidate;
        continue;
      }
      if (chunk) chunks.push(chunk);
      chunk = char;
    }
    if (chunk) chunks.push(chunk);
    return chunks.length > 0 ? chunks : [word];
  };

  paragraphs.forEach((paragraph, paragraphIndex) => {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("-");
      return;
    }
    let line = "";
    words.forEach((word) => {
      const candidate = line ? `${line} ${word}` : word;
      if (input.font.widthOfTextAtSize(candidate, input.fontSize) <= input.maxWidth) {
        line = candidate;
        return;
      }
      if (line) lines.push(line);
      const chunks = breakLongWord(word);
      if (chunks.length === 1) {
        line = chunks[0];
        return;
      }
      chunks.slice(0, -1).forEach((chunk) => lines.push(chunk));
      line = chunks[chunks.length - 1];
    });
    if (line) lines.push(line);
    if (paragraphIndex < paragraphs.length - 1) {
      lines.push("");
    }
  });

  return lines.length > 0 ? lines : ["-"];
}

function drawWrappedText(input: {
  page: PDFPage;
  font: PDFFont;
  text: string;
  fontSize: number;
  lineHeight: number;
  maxWidth: number;
  x: number;
  y: number;
  color?: [number, number, number];
}) {
  const lines = wrapTextToWidth({
    text: input.text,
    font: input.font,
    fontSize: input.fontSize,
    maxWidth: input.maxWidth
  });
  lines.forEach((line, index) => {
    input.page.drawText(line, {
      x: input.x,
      y: input.y - index * input.lineHeight,
      size: input.fontSize,
      font: input.font,
      color: rgb(input.color?.[0] ?? 0.1, input.color?.[1] ?? 0.1, input.color?.[2] ?? 0.1)
    });
  });
  return lines.length;
}

function loadCenterLogoBytes() {
  const relative = DOCUMENT_CENTER_LOGO_PUBLIC_PATH.replace(/^\//, "");
  const fullPath = join(process.cwd(), "public", relative);
  if (!existsSync(fullPath)) return null;
  return readFileSync(fullPath);
}

function resolveHeaderLogoWidth(logo: PDFImage | null, logoHeight: number, maxWidth: number) {
  if (!logo) return 0;
  const scaled = logo.scale(logoHeight / logo.height);
  return Math.min(scaled.width, maxWidth);
}

function clean(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

export async function buildPofDocumentPdfBytes(input: {
  form: PhysicianOrderForm;
  title: string;
  metaLines?: string[];
  signature?: SignaturePayload | null;
}) {
  if (input.signature) {
    if (!clean(input.signature.providerTypedName)) {
      throw new Error("Signed PDF generation failed: provider typed name is required.");
    }
    if (!input.signature.signatureContentType.startsWith("image/")) {
      throw new Error("Signed PDF generation failed: provider signature image content type is invalid.");
    }
    if (!input.signature.signatureImageBytes || input.signature.signatureImageBytes.byteLength === 0) {
      throw new Error("Signed PDF generation failed: provider signature image asset is missing.");
    }
  }

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

  const drawHeader = (startY: number) => {
    const y = startY;
    const logoHeight = 42;
    const logoWidth = resolveHeaderLogoWidth(logoImage, logoHeight, 132);
    if (logoImage) {
      page.drawImage(logoImage, {
        x: marginLeft,
        y: y - 38,
        width: logoWidth,
        height: logoHeight
      });
    }
    const infoX = marginLeft + (logoWidth > 0 ? Math.max(logoWidth + 12, 142) : 0);
    page.drawText(DOCUMENT_CENTER_NAME, { x: infoX, y: y - 10, size: 10, font: bold });
    page.drawText(DOCUMENT_CENTER_ADDRESS_LINE_1, { x: infoX, y: y - 24, size: 9, font: regular });
    page.drawText(DOCUMENT_CENTER_ADDRESS_LINE_2, { x: infoX, y: y - 36, size: 9, font: regular });
    page.drawText(DOCUMENT_CENTER_PHONE, { x: infoX, y: y - 48, size: 9, font: regular });
    page.drawText(input.title, { x: marginLeft, y: y - 72, size: 14, font: bold, color: rgb(0.1, 0.24, 0.55) });
    let metaY = y - 10;
    metaLines.forEach((line) => {
      page.drawText(line, { x: pageWidth - marginRight - 210, y: metaY, size: 8, font: regular });
      metaY -= 11;
    });
    page.drawLine({
      start: { x: marginLeft, y: y - 80 },
      end: { x: pageWidth - marginRight, y: y - 80 },
      thickness: 1,
      color: rgb(0.8, 0.84, 0.9)
    });
    return y - 96;
  };

  const startNewPage = () => {
    page = pdf.addPage([612, 792]);
    return drawHeader(maxY);
  };

  let y = drawHeader(maxY);

  const sectionTitleColor: [number, number, number] = [0.11, 0.25, 0.57];
  const borderColor = rgb(0.8, 0.84, 0.9);

  for (const section of sections) {
    if (section.layout === "fields") {
      if (y < minY + 44) y = startNewPage();
      page.drawText(section.title, { x: marginLeft, y, size: 11, font: bold, color: rgb(...sectionTitleColor) });
      y -= 16;

      for (const row of section.rows) {
        const labelWidth = 160;
        const valueWidth = usableWidth - labelWidth - 8;
        const valueLines = wrapTextToWidth({
          text: row.value,
          font: regular,
          fontSize: 9,
          maxWidth: valueWidth
        });
        const lineHeight = 11;
        const rowHeight = Math.max(lineHeight, valueLines.length * lineHeight) + 2;
        if (y - rowHeight < minY) {
          y = startNewPage();
          page.drawText(section.title, { x: marginLeft, y, size: 11, font: bold, color: rgb(...sectionTitleColor) });
          y -= 16;
        }
        page.drawText(`${row.label}:`, { x: marginLeft, y, size: 9, font: bold, color: rgb(0.15, 0.15, 0.15) });
        drawWrappedText({
          page,
          font: regular,
          text: row.value,
          fontSize: 9,
          lineHeight,
          maxWidth: valueWidth,
          x: marginLeft + labelWidth,
          y
        });
        y -= rowHeight;
      }
      y -= 10;
      continue;
    }

    const sectionTitle = section.title;
    const drawSectionTitle = () => {
      page.drawText(sectionTitle, { x: marginLeft, y, size: 11, font: bold, color: rgb(...sectionTitleColor) });
      y -= 14;
    };

    const totalWidthWeight = section.columns.reduce((sum, column) => sum + (column.widthWeight ?? 1), 0);
    const columnWidths = section.columns.map((column) => usableWidth * ((column.widthWeight ?? 1) / totalWidthWeight));
    const headerFontSize = 8;
    const cellFontSize = 8.2;
    const headerLineHeight = 10;
    const rowLineHeight = 10;
    const cellPadding = 4;

    const getColumnMaxTextWidth = (columnIndex: number) => Math.max(24, columnWidths[columnIndex] - cellPadding * 2);

    const drawTableHeader = () => {
      const headerLines = section.columns.map((column, index) =>
        wrapTextToWidth({
          text: column.label,
          font: bold,
          fontSize: headerFontSize,
          maxWidth: getColumnMaxTextWidth(index)
        })
      );
      const headerHeight = Math.max(...headerLines.map((lines) => lines.length)) * headerLineHeight + cellPadding * 2;
      if (y - headerHeight < minY) {
        y = startNewPage();
        drawSectionTitle();
      }

      const topY = y;
      const bottomY = y - headerHeight;
      page.drawRectangle({
        x: marginLeft,
        y: bottomY,
        width: usableWidth,
        height: headerHeight,
        color: rgb(0.94, 0.97, 1),
        borderColor,
        borderWidth: 0.7
      });

      let cursorX = marginLeft;
      section.columns.forEach((column, index) => {
        if (index > 0) {
          page.drawLine({
            start: { x: cursorX, y: topY },
            end: { x: cursorX, y: bottomY },
            thickness: 0.6,
            color: borderColor
          });
        }
        drawWrappedText({
          page,
          font: bold,
          text: column.label,
          fontSize: headerFontSize,
          lineHeight: headerLineHeight,
          maxWidth: getColumnMaxTextWidth(index),
          x: cursorX + cellPadding,
          y: topY - cellPadding - headerFontSize + 1,
          color: [0.18, 0.2, 0.28]
        });
        cursorX += columnWidths[index];
      });

      y = bottomY;
    };

    if (y < minY + 52) y = startNewPage();
    drawSectionTitle();
    drawTableHeader();

    for (const row of section.rows) {
      const wrappedCells = section.columns.map((column, index) =>
        wrapTextToWidth({
          text: row.cells[column.key] ?? "-",
          font: regular,
          fontSize: cellFontSize,
          maxWidth: getColumnMaxTextWidth(index)
        })
      );
      const rowHeight = Math.max(...wrappedCells.map((lines) => lines.length)) * rowLineHeight + cellPadding * 2;

      if (y - rowHeight < minY) {
        y = startNewPage();
        drawSectionTitle();
        drawTableHeader();
      }

      const topY = y;
      const bottomY = y - rowHeight;
      page.drawRectangle({
        x: marginLeft,
        y: bottomY,
        width: usableWidth,
        height: rowHeight,
        borderColor,
        borderWidth: 0.6
      });

      let cursorX = marginLeft;
      section.columns.forEach((column, columnIndex) => {
        if (columnIndex > 0) {
          page.drawLine({
            start: { x: cursorX, y: topY },
            end: { x: cursorX, y: bottomY },
            thickness: 0.5,
            color: borderColor
          });
        }
        const lines = wrappedCells[columnIndex];
        lines.forEach((line, lineIndex) => {
          page.drawText(line, {
            x: cursorX + cellPadding,
            y: topY - cellPadding - cellFontSize - lineIndex * rowLineHeight + 2,
            size: cellFontSize,
            font: regular,
            color: rgb(0.13, 0.13, 0.16)
          });
        });
        cursorX += columnWidths[columnIndex];
      });
      y = bottomY;
    }
    y -= 12;
  }

  if (input.signature) {
    if (y < minY + 138) {
      y = startNewPage();
    }

    const signatureBoxHeight = 116;
    const topY = y;
    const bottomY = y - signatureBoxHeight;
    page.drawRectangle({
      x: marginLeft,
      y: bottomY,
      width: usableWidth,
      height: signatureBoxHeight,
      color: rgb(0.96, 0.98, 1),
      borderColor: rgb(0.75, 0.82, 0.92),
      borderWidth: 0.9
    });
    page.drawText("Provider Electronic Signature", {
      x: marginLeft + 10,
      y: topY - 16,
      size: 11,
      font: bold,
      color: rgb(0.1, 0.24, 0.55)
    });

    const signatureImage =
      input.signature.signatureContentType === "image/jpeg" || input.signature.signatureContentType === "image/jpg"
        ? await pdf.embedJpg(input.signature.signatureImageBytes)
        : await pdf.embedPng(input.signature.signatureImageBytes);

    const signatureFrameX = marginLeft + 10;
    const signatureFrameY = topY - 94;
    const signatureFrameWidth = 208;
    const signatureFrameHeight = 62;
    page.drawRectangle({
      x: signatureFrameX,
      y: signatureFrameY,
      width: signatureFrameWidth,
      height: signatureFrameHeight,
      borderColor: rgb(0.78, 0.8, 0.85),
      borderWidth: 0.7
    });

    const imageScale = Math.min(
      (signatureFrameWidth - 12) / signatureImage.width,
      (signatureFrameHeight - 12) / signatureImage.height
    );
    const imageWidth = signatureImage.width * imageScale;
    const imageHeight = signatureImage.height * imageScale;
    page.drawImage(signatureImage, {
      x: signatureFrameX + (signatureFrameWidth - imageWidth) / 2,
      y: signatureFrameY + (signatureFrameHeight - imageHeight) / 2,
      width: imageWidth,
      height: imageHeight
    });

    const detailX = signatureFrameX + signatureFrameWidth + 14;
    page.drawText(`Provider: ${input.signature.providerTypedName}`, {
      x: detailX,
      y: topY - 40,
      size: 10,
      font: regular,
      color: rgb(0.14, 0.14, 0.18)
    });
    if (clean(input.signature.providerCredentials)) {
      page.drawText(`Credentials: ${input.signature.providerCredentials}`, {
        x: detailX,
        y: topY - 54,
        size: 10,
        font: regular,
        color: rgb(0.14, 0.14, 0.18)
      });
    }
    page.drawText(`Signed at: ${input.signature.signedAt}`, {
      x: detailX,
      y: topY - 68,
      size: 10,
      font: regular,
      color: rgb(0.14, 0.14, 0.18)
    });
    page.drawText("Attestation accepted electronically via secure provider link.", {
      x: detailX,
      y: topY - 84,
      size: 9,
      font: regular,
      color: rgb(0.2, 0.22, 0.28)
    });
  }

  return Buffer.from(await pdf.save({ useObjectStreams: false }));
}
