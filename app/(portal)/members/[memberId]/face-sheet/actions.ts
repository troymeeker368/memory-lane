"use server";

import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/auth";
import { formatPhoneDisplay } from "@/lib/phone";
import { canGenerateMemberDocumentForRole } from "@/lib/permissions";
import {
  DOCUMENT_CENTER_ADDRESS,
  DOCUMENT_CENTER_LOGO_PUBLIC_PATH,
  DOCUMENT_CENTER_NAME,
  DOCUMENT_CENTER_PHONE
} from "@/lib/services/document-branding";
import {
  buildGeneratedMemberFilePersistenceState,
  saveGeneratedMemberPdfToFiles
} from "@/lib/services/member-files";
import { getMemberFaceSheet } from "@/lib/services/member-face-sheet";
import { toEasternISO } from "@/lib/timezone";
import { formatDate, formatDateTime, formatOptionalDate } from "@/lib/utils";
import type { PDFDocument as PDFDocumentType, PDFFont, PDFImage, PDFPage, RGB } from "pdf-lib";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const PAGE_MARGIN = 42;
const PAGE_BOTTOM = 34;
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;
const GRID_GAP = 16;
const BODY_FONT_SIZE = 9.25;
const BODY_LINE_HEIGHT = 11.5;
const LABEL_FONT_SIZE = 8;
const LABEL_LINE_HEIGHT = 9.5;
const TABLE_FONT_SIZE = 8.25;
const TABLE_LINE_HEIGHT = 10;
const SECTION_GAP = 14;
const SECTION_LINE_GAP = 8;

function lineOrDash(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : "-";
}

function listOrDash(values: string[]) {
  return values.length > 0 ? values.join(", ") : "-";
}

function publicAssetPath(publicPath: string) {
  const normalized = publicPath.startsWith("/") ? publicPath.slice(1) : publicPath;
  return path.join(process.cwd(), "public", normalized);
}

function buildInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
}

function wrapText(text: string, font: PDFFont, fontSize: number, maxWidth: number) {
  const normalized = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return ["-"];

  const lines: string[] = [];
  let currentLine = "";

  const pushWord = (word: string) => {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      currentLine = candidate;
      return;
    }

    if (!currentLine) {
      let fragment = word;
      while (fragment.length > 0 && font.widthOfTextAtSize(fragment, fontSize) > maxWidth) {
        let sliceLength = fragment.length - 1;
        while (
          sliceLength > 1 &&
          font.widthOfTextAtSize(`${fragment.slice(0, sliceLength)}-`, fontSize) > maxWidth
        ) {
          sliceLength -= 1;
        }
        lines.push(`${fragment.slice(0, Math.max(sliceLength, 1))}-`);
        fragment = fragment.slice(Math.max(sliceLength, 1));
      }
      currentLine = fragment;
      return;
    }

    lines.push(currentLine);
    currentLine = "";
    pushWord(word);
  };

  normalized.split(" ").forEach(pushWord);
  if (currentLine) lines.push(currentLine);
  return lines;
}

function heightForWrappedText(lines: string[], lineHeight: number) {
  return Math.max(lines.length, 1) * lineHeight;
}

async function loadCenterLogoImage(pdf: PDFDocumentType) {
  try {
    const bytes = await readFile(publicAssetPath(DOCUMENT_CENTER_LOGO_PUBLIC_PATH));
    return await pdf.embedPng(bytes);
  } catch {
    return null;
  }
}

async function loadMemberPhotoImage(pdf: PDFDocumentType, photoUrl: string | null | undefined) {
  const normalized = String(photoUrl ?? "").trim();
  if (!normalized) return null;

  try {
    const response = await fetch(normalized, { cache: "force-cache" });
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    const contentType = String(response.headers.get("content-type") ?? "").toLowerCase();
    if (contentType.includes("png")) {
      return await pdf.embedPng(bytes);
    }
    if (contentType.includes("jpeg") || contentType.includes("jpg")) {
      return await pdf.embedJpg(bytes);
    }

    const pathname = new URL(normalized).pathname.toLowerCase();
    if (pathname.endsWith(".png")) {
      return await pdf.embedPng(bytes);
    }
    if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) {
      return await pdf.embedJpg(bytes);
    }
    return null;
  } catch {
    return null;
  }
}

async function buildFaceSheetPdf(memberId: string) {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const faceSheet = await getMemberFaceSheet(memberId);
  if (!faceSheet) {
    return { error: "Member face sheet data not found." } as const;
  }
  const resolvedFaceSheet = faceSheet;

  const pdf = await PDFDocument.create();
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const logo = await loadCenterLogoImage(pdf);
  const memberPhoto = await loadMemberPhotoImage(pdf, faceSheet.member.photoUrl);

  const colors = {
    brand: rgb(0.106, 0.243, 0.576),
    ink: rgb(0.1, 0.1, 0.1),
    muted: rgb(0.35, 0.4, 0.47),
    line: rgb(0.82, 0.86, 0.9),
    fill: rgb(0.94, 0.96, 0.99),
    headerFill: rgb(0.91, 0.94, 0.98)
  } satisfies Record<string, RGB>;

  const pages: PDFPage[] = [];
  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  pages.push(page);
  let y = PAGE_HEIGHT - PAGE_MARGIN;
  let currentSectionTitle: string | null = null;

  function addPage(withContinuationHeader = true) {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pages.push(page);
    y = PAGE_HEIGHT - PAGE_MARGIN;

    if (withContinuationHeader) {
      const title = "MEMBER FACE SHEET";
      const subtitle = resolvedFaceSheet.member.name;
      const generated = `Generated: ${formatDateTime(resolvedFaceSheet.generatedAt)} ET`;

      page.drawText(title, {
        x: PAGE_MARGIN,
        y,
        size: 11.5,
        font: bold,
        color: colors.brand
      });
      page.drawText(subtitle, {
        x: PAGE_MARGIN,
        y: y - 13,
        size: 9.5,
        font: regular,
        color: colors.ink
      });
      page.drawText(generated, {
        x: PAGE_WIDTH - PAGE_MARGIN - regular.widthOfTextAtSize(generated, 8),
        y,
        size: 8,
        font: regular,
        color: colors.muted
      });
      page.drawLine({
        start: { x: PAGE_MARGIN, y: y - 20 },
        end: { x: PAGE_WIDTH - PAGE_MARGIN, y: y - 20 },
        color: colors.line,
        thickness: 1
      });
      y -= 34;
    }
  }

  function ensureSpace(minHeight: number) {
    if (y - minHeight >= PAGE_BOTTOM) return;
    addPage(true);
    if (currentSectionTitle) {
      drawSectionHeading(`${currentSectionTitle} (continued)`);
    }
  }

  function drawWrappedLines(options: {
    lines: string[];
    x: number;
    yTop: number;
    font: PDFFont;
    fontSize: number;
    lineHeight: number;
    color: RGB;
  }) {
    options.lines.forEach((line, index) => {
      page.drawText(line, {
        x: options.x,
        y: options.yTop - options.fontSize - index * options.lineHeight,
        size: options.fontSize,
        font: options.font,
        color: options.color
      });
    });
  }

  function drawSectionHeading(title: string) {
    currentSectionTitle = title.replace(" (continued)", "");
    ensureSpace(24);
    const label = title.toUpperCase();
    page.drawText(label, {
      x: PAGE_MARGIN,
      y,
      size: 10.5,
      font: bold,
      color: colors.brand
    });
    page.drawLine({
      start: { x: PAGE_MARGIN, y: y - 5 },
      end: { x: PAGE_WIDTH - PAGE_MARGIN, y: y - 5 },
      color: colors.line,
      thickness: 1
    });
    y -= 18;
  }

  function drawKeyValueGrid(items: Array<{ label: string; value: string }>, columns = 2) {
    const columnWidth = (CONTENT_WIDTH - GRID_GAP * (columns - 1)) / columns;

    for (let index = 0; index < items.length; index += columns) {
      const rowItems = items.slice(index, index + columns);
      const measured = rowItems.map((item) => {
        const labelLines = wrapText(item.label, bold, LABEL_FONT_SIZE, columnWidth);
        const valueLines = wrapText(item.value, regular, BODY_FONT_SIZE, columnWidth);
        return {
          labelLines,
          valueLines,
          height:
            heightForWrappedText(labelLines, LABEL_LINE_HEIGHT) +
            heightForWrappedText(valueLines, BODY_LINE_HEIGHT) +
            8
        };
      });

      const rowHeight = Math.max(...measured.map((entry) => entry.height), BODY_LINE_HEIGHT * 2 + 10);
      ensureSpace(rowHeight + SECTION_LINE_GAP);

      rowItems.forEach((item, columnIndex) => {
        const x = PAGE_MARGIN + columnIndex * (columnWidth + GRID_GAP);
        const metrics = measured[columnIndex];
        drawWrappedLines({
          lines: metrics.labelLines,
          x,
          yTop: y,
          font: bold,
          fontSize: LABEL_FONT_SIZE,
          lineHeight: LABEL_LINE_HEIGHT,
          color: colors.brand
        });
        const valueTop = y - heightForWrappedText(metrics.labelLines, LABEL_LINE_HEIGHT) - 2;
        drawWrappedLines({
          lines: metrics.valueLines,
          x,
          yTop: valueTop,
          font: regular,
          fontSize: BODY_FONT_SIZE,
          lineHeight: BODY_LINE_HEIGHT,
          color: colors.ink
        });
      });

      y -= rowHeight + SECTION_LINE_GAP;
    }
  }

  function drawNarrativeColumns(items: Array<{ title: string; value: string }>, columns = 2) {
    const columnWidth = (CONTENT_WIDTH - GRID_GAP * (columns - 1)) / columns;

    for (let index = 0; index < items.length; index += columns) {
      const rowItems = items.slice(index, index + columns);
      const measured = rowItems.map((item) => {
        const titleLines = wrapText(item.title, bold, BODY_FONT_SIZE, columnWidth);
        const valueLines = wrapText(item.value, regular, BODY_FONT_SIZE, columnWidth);
        return {
          titleLines,
          valueLines,
          height:
            heightForWrappedText(titleLines, BODY_LINE_HEIGHT) +
            heightForWrappedText(valueLines, BODY_LINE_HEIGHT) +
            8
        };
      });

      const rowHeight = Math.max(...measured.map((entry) => entry.height), BODY_LINE_HEIGHT * 3);
      ensureSpace(rowHeight + SECTION_LINE_GAP);

      rowItems.forEach((item, columnIndex) => {
        const x = PAGE_MARGIN + columnIndex * (columnWidth + GRID_GAP);
        const metrics = measured[columnIndex];
        drawWrappedLines({
          lines: metrics.titleLines,
          x,
          yTop: y,
          font: bold,
          fontSize: BODY_FONT_SIZE,
          lineHeight: BODY_LINE_HEIGHT,
          color: colors.ink
        });
        const valueTop = y - heightForWrappedText(metrics.titleLines, BODY_LINE_HEIGHT) - 1;
        drawWrappedLines({
          lines: metrics.valueLines,
          x,
          yTop: valueTop,
          font: regular,
          fontSize: BODY_FONT_SIZE,
          lineHeight: BODY_LINE_HEIGHT,
          color: colors.ink
        });
      });

      y -= rowHeight + SECTION_LINE_GAP;
    }
  }

  function drawTable(input: {
    title: string;
    headers: string[];
    rows: string[][];
    widths: number[];
    emptyMessage: string;
  }) {
    drawSectionHeading(input.title);
    if (input.rows.length === 0) {
      drawKeyValueGrid([{ label: input.title, value: input.emptyMessage }], 1);
      return;
    }

    const tableWidth = CONTENT_WIDTH;
    const columnWidths = input.widths.map((width) => width * tableWidth);
    const padding = 4;
    const headerHeight = 20;

    const drawHeader = () => {
      ensureSpace(headerHeight + 6);
      let columnX = PAGE_MARGIN;
      input.headers.forEach((header, index) => {
        const width = columnWidths[index] ?? 0;
        page.drawRectangle({
          x: columnX,
          y: y - headerHeight,
          width,
          height: headerHeight,
          color: colors.headerFill,
          borderColor: colors.line,
          borderWidth: 1
        });
        drawWrappedLines({
          lines: wrapText(header, bold, TABLE_FONT_SIZE, width - padding * 2),
          x: columnX + padding,
          yTop: y - 4,
          font: bold,
          fontSize: TABLE_FONT_SIZE,
          lineHeight: TABLE_LINE_HEIGHT,
          color: colors.ink
        });
        columnX += width;
      });
      y -= headerHeight;
    };

    drawHeader();

    input.rows.forEach((row) => {
      const wrappedCells = row.map((value, index) =>
        wrapText(lineOrDash(value), regular, TABLE_FONT_SIZE, (columnWidths[index] ?? 0) - padding * 2)
      );
      const rowHeight =
        Math.max(...wrappedCells.map((lines) => heightForWrappedText(lines, TABLE_LINE_HEIGHT)), TABLE_LINE_HEIGHT) +
        padding * 2;

      if (y - rowHeight < PAGE_BOTTOM) {
        addPage(true);
        drawSectionHeading(`${input.title} (continued)`);
        drawHeader();
      }

      let columnX = PAGE_MARGIN;
      wrappedCells.forEach((lines, index) => {
        const width = columnWidths[index] ?? 0;
        page.drawRectangle({
          x: columnX,
          y: y - rowHeight,
          width,
          height: rowHeight,
          borderColor: colors.line,
          borderWidth: 1
        });
        drawWrappedLines({
          lines,
          x: columnX + padding,
          yTop: y - padding,
          font: regular,
          fontSize: TABLE_FONT_SIZE,
          lineHeight: TABLE_LINE_HEIGHT,
          color: colors.ink
        });
        columnX += width;
      });
      y -= rowHeight;
    });

    y -= SECTION_GAP;
  }

  function drawHeroSection() {
    const photoBoxSize = 78;
    const photoX = PAGE_MARGIN;
    const photoY = y - photoBoxSize;

    page.drawRectangle({
      x: photoX,
      y: photoY,
      width: photoBoxSize,
      height: photoBoxSize,
      borderColor: colors.line,
      borderWidth: 1
    });

    if (memberPhoto) {
      const scale = Math.min(photoBoxSize / memberPhoto.width, photoBoxSize / memberPhoto.height);
      const width = memberPhoto.width * scale;
      const height = memberPhoto.height * scale;
      page.drawImage(memberPhoto, {
        x: photoX + (photoBoxSize - width) / 2,
        y: photoY + (photoBoxSize - height) / 2,
        width,
        height
      });
    } else {
      const initials = buildInitials(resolvedFaceSheet.member.name);
      const initialsSize = 24;
      page.drawText(initials || "?", {
        x: photoX + (photoBoxSize - bold.widthOfTextAtSize(initials || "?", initialsSize)) / 2,
        y: photoY + (photoBoxSize - initialsSize) / 2,
        size: initialsSize,
        font: bold,
        color: colors.ink
      });
    }

    const detailX = photoX + photoBoxSize + GRID_GAP;
    const detailWidth = CONTENT_WIDTH - photoBoxSize - GRID_GAP;
    const labelWidth = (detailWidth - GRID_GAP) / 2;
    const rowTop = y - 6;
    const rowGap = 34;
    const rows = [
      [
        { label: "Member", value: lineOrDash(resolvedFaceSheet.member.name) },
        { label: "DOB", value: formatOptionalDate(resolvedFaceSheet.member.dob) }
      ],
      [
        {
          label: "Age",
          value:
            resolvedFaceSheet.member.age == null ? "-" : String(resolvedFaceSheet.member.age)
        },
        { label: "Gender", value: lineOrDash(resolvedFaceSheet.member.gender) }
      ]
    ];

    rows.forEach((row, rowIndex) => {
      row.forEach((item, columnIndex) => {
        const x = detailX + columnIndex * (labelWidth + GRID_GAP);
        const rowY = rowTop - rowIndex * rowGap;
        page.drawText(`${item.label}:`, {
          x,
          y: rowY,
          size: 9.25,
          font: bold,
          color: colors.ink
        });
        const valueLines = wrapText(item.value, regular, 9.25, labelWidth - 4);
        drawWrappedLines({
          lines: valueLines,
          x,
          yTop: rowY - 11,
          font: regular,
          fontSize: 9.25,
          lineHeight: BODY_LINE_HEIGHT,
          color: colors.ink
        });
      });
    });

    y -= photoBoxSize + 10;
  }

  const generatedLabel = `Generated: ${formatDateTime(faceSheet.generatedAt)} (ET)`;
  const title = "MEMBER FACE SHEET";
  const leftInfoX = PAGE_MARGIN + (logo ? 142 : 0);

  if (logo) {
    const scale = Math.min(132 / logo.width, 42 / logo.height);
    const width = logo.width * scale;
    const height = logo.height * scale;
    page.drawImage(logo, {
      x: PAGE_MARGIN,
      y: y - height + 4,
      width,
      height
    });
  }

  page.drawText(DOCUMENT_CENTER_NAME, {
    x: leftInfoX,
    y,
    size: 11.5,
    font: bold,
    color: colors.ink
  });
  page.drawText(DOCUMENT_CENTER_ADDRESS, {
    x: leftInfoX,
    y: y - 13,
    size: 8.5,
    font: regular,
    color: colors.ink
  });
  page.drawText(DOCUMENT_CENTER_PHONE, {
    x: leftInfoX,
    y: y - 25,
    size: 8.5,
    font: regular,
    color: colors.ink
  });
  page.drawText(title, {
    x: PAGE_WIDTH / 2 - bold.widthOfTextAtSize(title, 15) / 2 + 18,
    y: y - 4,
    size: 15,
    font: bold,
    color: colors.brand
  });
  page.drawText(generatedLabel, {
    x: PAGE_WIDTH - PAGE_MARGIN - regular.widthOfTextAtSize(generatedLabel, 8),
    y,
    size: 8,
    font: regular,
    color: colors.muted
  });
  page.drawLine({
    start: { x: PAGE_MARGIN, y: y - 38 },
    end: { x: PAGE_WIDTH - PAGE_MARGIN, y: y - 38 },
    color: colors.line,
    thickness: 1
  });
  y -= 56;

  drawHeroSection();

  drawSectionHeading("Code Status");
  drawKeyValueGrid([
    { label: "Code Status", value: lineOrDash(faceSheet.legal.codeStatus) },
    { label: "DNR", value: lineOrDash(faceSheet.legal.dnr) },
    { label: "DNI", value: lineOrDash(faceSheet.legal.dni) }
  ]);

  drawSectionHeading("Demographics");
  drawKeyValueGrid([
    { label: "Address", value: lineOrDash(faceSheet.demographics.address) },
    { label: "Primary Language", value: lineOrDash(faceSheet.demographics.primaryLanguage) },
    { label: "Marital Status", value: lineOrDash(faceSheet.demographics.maritalStatus) },
    { label: "Veteran", value: lineOrDash(faceSheet.demographics.veteran) },
    { label: "Veteran Branch", value: lineOrDash(faceSheet.demographics.veteranBranch) }
  ]);

  drawTable({
    title: "Emergency / Primary Contacts",
    headers: ["Category", "Name", "Relationship", "Phone", "Email"],
    rows: faceSheet.contacts.map((contact) => [
      lineOrDash(contact.category),
      lineOrDash(contact.name),
      lineOrDash(contact.relationship),
      formatPhoneDisplay(contact.phone),
      lineOrDash(contact.email)
    ]),
    widths: [0.16, 0.21, 0.19, 0.16, 0.28],
    emptyMessage: "No contact records on file."
  });

  drawSectionHeading("Legal / Critical Status");
  drawKeyValueGrid([
    { label: "POLST/MOLST/COLST", value: lineOrDash(faceSheet.legal.polst) },
    { label: "Hospice", value: lineOrDash(faceSheet.legal.hospice) },
    { label: "POA", value: lineOrDash(faceSheet.legal.powerOfAttorney) },
    {
      label: "Advanced Directives Obtained",
      value: lineOrDash(faceSheet.legal.advancedDirectives)
    }
  ]);

  addPage(true);
  currentSectionTitle = null;

  drawSectionHeading("Medical Summary");
  drawNarrativeColumns([
    { title: "Primary Diagnoses", value: listOrDash(faceSheet.medical.primaryDiagnoses) },
    { title: "Secondary Diagnoses", value: listOrDash(faceSheet.medical.secondaryDiagnoses) }
  ]);

  drawTable({
    title: "Current Medications",
    headers: ["Medication", "Dose", "Route", "Frequency"],
    rows: faceSheet.medical.medications.map((medication) => [
      lineOrDash(medication.medication_name),
      lineOrDash(medication.dose),
      lineOrDash(medication.route),
      lineOrDash(medication.frequency)
    ]),
    widths: [0.34, 0.15, 0.16, 0.35],
    emptyMessage: "No current medications recorded."
  });

  drawNarrativeColumns([
    {
      title: "Diet / Restrictions",
      value: [lineOrDash(faceSheet.medical.dietType), lineOrDash(faceSheet.medical.dietRestrictions)].join("\n")
    },
    {
      title: "Swallowing / Oxygen",
      value: [
        `Swallowing Difficulty: ${lineOrDash(faceSheet.medical.swallowingDifficulty)}`,
        `Oxygen Required: ${lineOrDash(faceSheet.medical.oxygenRequired)}`
      ].join("\n")
    }
  ]);

  drawTable({
    title: "Allergies",
    headers: ["Group", "Allergy", "Severity"],
    rows: [
      ...faceSheet.medical.allergyGroups.food.map((allergy) => [
        "Food",
        lineOrDash(allergy.name),
        lineOrDash(allergy.severity)
      ]),
      ...faceSheet.medical.allergyGroups.medication.map((allergy) => [
        "Medication",
        lineOrDash(allergy.name),
        lineOrDash(allergy.severity)
      ]),
      ...faceSheet.medical.allergyGroups.environmental.map((allergy) => [
        "Environmental",
        lineOrDash(allergy.name),
        lineOrDash(allergy.severity)
      ])
    ],
    widths: [0.22, 0.5, 0.28],
    emptyMessage: "No allergies recorded."
  });
  if (faceSheet.medical.noKnownAllergies) {
    drawKeyValueGrid([{ label: "Allergy Flag", value: "No Known Allergies (NKA)" }], 1);
  }

  drawSectionHeading("Functional / Safety Summary");
  drawKeyValueGrid([
    { label: "Ambulation", value: lineOrDash(faceSheet.functionalSafety.ambulation) },
    { label: "Transfer Assistance", value: lineOrDash(faceSheet.functionalSafety.transferring) },
    { label: "Toileting Needs", value: lineOrDash(faceSheet.functionalSafety.toiletingNeeds) },
    { label: "Bathroom Assistance", value: lineOrDash(faceSheet.functionalSafety.bathroomAssistance) },
    { label: "Hearing", value: lineOrDash(faceSheet.functionalSafety.hearing) },
    { label: "Vision", value: lineOrDash(faceSheet.functionalSafety.vision) },
    { label: "Speech", value: lineOrDash(faceSheet.functionalSafety.speech) },
    { label: "Memory Impairment", value: lineOrDash(faceSheet.functionalSafety.memoryImpairment) },
    {
      label: "Behavior Concerns",
      value: listOrDash(faceSheet.functionalSafety.behaviorConcerns)
    }
  ]);

  drawTable({
    title: "Providers",
    headers: ["Name", "Specialty", "Practice", "Phone"],
    rows: faceSheet.providers.map((provider) => [
      lineOrDash(provider.name),
      lineOrDash(provider.specialty),
      lineOrDash(provider.practice),
      formatPhoneDisplay(provider.phone)
    ]),
    widths: [0.28, 0.18, 0.34, 0.2],
    emptyMessage: "No provider records on file."
  });

  drawSectionHeading("Diet / Allergy Flags");
  drawKeyValueGrid([
    { label: "Diet Type", value: lineOrDash(faceSheet.dietAllergyFlags.dietType) },
    { label: "Texture", value: lineOrDash(faceSheet.dietAllergyFlags.texture) },
    { label: "Restrictions", value: lineOrDash(faceSheet.dietAllergyFlags.restrictions) },
    { label: "Food Allergies", value: listOrDash(faceSheet.dietAllergyFlags.foodAllergies) },
    {
      label: "Medication Allergies",
      value: listOrDash(faceSheet.dietAllergyFlags.medicationAllergies)
    },
    {
      label: "Environmental Allergies",
      value: listOrDash(faceSheet.dietAllergyFlags.environmentalAllergies)
    }
  ]);

  const footerText = `Face Sheet generated on ${formatDateTime(faceSheet.generatedAt)} ET for ${faceSheet.member.name} (${formatDate(faceSheet.generatedAt)}).`;
  ensureSpace(24);
  page.drawLine({
    start: { x: PAGE_MARGIN, y: y - 2 },
    end: { x: PAGE_WIDTH - PAGE_MARGIN, y: y - 2 },
    color: colors.line,
    thickness: 1
  });
  drawWrappedLines({
    lines: wrapText(footerText, regular, 8, CONTENT_WIDTH),
    x: PAGE_MARGIN,
    yTop: y - 8,
    font: regular,
    fontSize: 8,
    lineHeight: 9,
    color: colors.muted
  });

  pages.forEach((currentPage, index) => {
    const pageLabel = `Page ${index + 1} of ${pages.length}`;
    currentPage.drawText(pageLabel, {
      x: PAGE_WIDTH - PAGE_MARGIN - regular.widthOfTextAtSize(pageLabel, 8),
      y: 18,
      size: 8,
      font: regular,
      color: colors.muted
    });
  });

  const pdfBytes = await pdf.save();
  return {
    faceSheet,
    dataUrl: `data:application/pdf;base64,${Buffer.from(pdfBytes).toString("base64")}`
  } as const;
}

export async function generateMemberFaceSheetPdfAction(input: { memberId: string }) {
  const profile = await getCurrentProfile();
  if (!canGenerateMemberDocumentForRole(profile.role)) {
    return { ok: false, error: "You do not have access to generate face sheets." } as const;
  }

  const memberId = String(input.memberId ?? "").trim();
  if (!memberId) {
    return { ok: false, error: "Member is required." } as const;
  }

  try {
    const built = await buildFaceSheetPdf(memberId);
    if ("error" in built) {
      return { ok: false, error: built.error } as const;
    }

    const saved = await saveGeneratedMemberPdfToFiles({
      memberId,
      memberName: built.faceSheet.member.name,
      documentLabel: "Face Sheet",
      documentSource: "Face Sheet Generator",
      category: "Health Unit",
      dataUrl: built.dataUrl,
      uploadedBy: {
        id: profile.id,
        name: profile.full_name
      },
      generatedAtIso: toEasternISO(),
      replaceExistingByDocumentSource: true
    });

    revalidatePath(`/members/${memberId}/face-sheet`);
    revalidatePath(`/operations/member-command-center/${memberId}`);
    revalidatePath(`/health/member-health-profiles/${memberId}`);

    return {
      ok: true,
      fileName: saved.fileName,
      dataUrl: built.dataUrl,
      ...buildGeneratedMemberFilePersistenceState({
        documentLabel: "Face Sheet",
        verifiedPersisted: saved.verifiedPersisted
      })
    } as const;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to generate face sheet PDF."
    } as const;
  }
}
