import "server-only";

import { Buffer } from "node:buffer";

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import { getCarePlanById, getCarePlanDocumentBlueprint } from "@/lib/services/care-plans";
import { toEasternDate, toEasternISO } from "@/lib/timezone";
import { formatDate } from "@/lib/utils";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const PAGE_MARGIN_X = 54;
const PAGE_TOP_Y = 748;
const PAGE_BOTTOM_Y = 58;
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN_X * 2;
const BRAND_BLUE = rgb(0x1c / 255, 0x3e / 255, 0x92 / 255);
const TEXT_COLOR = rgb(0.12, 0.12, 0.12);
const RULE_COLOR = rgb(0.78, 0.8, 0.86);

function safeFileName(value: string) {
  return value.replace(/[<>:"/\\|?*]/g, "").trim();
}

function clean(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : "";
}

function formatDisplayDate(value: string | null | undefined) {
  const normalized = clean(value);
  return normalized ? formatDate(normalized) : "";
}

function wrapTextToWidth(input: {
  text: string;
  font: PDFFont;
  size: number;
  maxWidth: number;
}) {
  const normalized = input.text.replace(/\r/g, "").trim();
  if (!normalized) return [];

  const paragraphs = normalized.split("\n");
  const lines: string[] = [];

  const breakLongWord = (word: string) => {
    if (input.font.widthOfTextAtSize(word, input.size) <= input.maxWidth) return [word];

    const chunks: string[] = [];
    let current = "";
    for (const char of word) {
      const candidate = `${current}${char}`;
      if (input.font.widthOfTextAtSize(candidate, input.size) <= input.maxWidth) {
        current = candidate;
        continue;
      }
      if (current) chunks.push(current);
      current = char;
    }
    if (current) chunks.push(current);
    return chunks.length > 0 ? chunks : [word];
  };

  paragraphs.forEach((paragraph, paragraphIndex) => {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      return;
    }

    let current = "";
    words.forEach((word) => {
      const candidate = current ? `${current} ${word}` : word;
      if (input.font.widthOfTextAtSize(candidate, input.size) <= input.maxWidth) {
        current = candidate;
        return;
      }

      if (current) lines.push(current);
      const chunks = breakLongWord(word);
      if (chunks.length === 1) {
        current = chunks[0];
        return;
      }

      chunks.slice(0, -1).forEach((chunk) => lines.push(chunk));
      current = chunks[chunks.length - 1] ?? "";
    });

    if (current) lines.push(current);
    if (paragraphIndex < paragraphs.length - 1) lines.push("");
  });

  return lines;
}

function fitTextSize(input: {
  text: string;
  font: PDFFont;
  maxWidth: number;
  preferredSize: number;
  minSize?: number;
}) {
  const minSize = input.minSize ?? 8;
  let size = input.preferredSize;
  while (size > minSize && input.font.widthOfTextAtSize(input.text, size) > input.maxWidth) {
    size -= 0.25;
  }
  return size;
}

function drawLine(page: PDFPage, startX: number, endX: number, y: number, thickness = 1) {
  page.drawLine({
    start: { x: startX, y },
    end: { x: endX, y },
    thickness,
    color: RULE_COLOR
  });
}

function drawCheckbox(page: PDFPage, x: number, y: number, checked: boolean) {
  const size = 10;
  page.drawRectangle({
    x,
    y: y - size + 1,
    width: size,
    height: size,
    borderColor: TEXT_COLOR,
    borderWidth: 1
  });

  if (!checked) return;

  page.drawLine({
    start: { x: x + 2, y: y - 4 },
    end: { x: x + 4.5, y: y - 7 },
    thickness: 1.2,
    color: BRAND_BLUE
  });
  page.drawLine({
    start: { x: x + 4.5, y: y - 7 },
    end: { x: x + 8, y: y - 1.5 },
    thickness: 1.2,
    color: BRAND_BLUE
  });
}

function toGoalItems(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function buildCarePlanPdfDataUrl(carePlanId: string, options?: { serviceRole?: boolean }) {
  const detail = await getCarePlanById(carePlanId, { serviceRole: Boolean(options?.serviceRole) });
  if (!detail) {
    throw new Error("Care plan not found.");
  }

  const generatedAt = toEasternISO();
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const blueprint = getCarePlanDocumentBlueprint(detail.carePlan.track);

  let pageNumber = 0;
  let page: PDFPage;
  let y = PAGE_TOP_Y;

  const startPage = () => {
    pageNumber += 1;
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

    const title = pageNumber === 1 ? blueprint.definition.title : `${blueprint.definition.title} (continued)`;
    const titleSize = pageNumber === 1 ? 16 : 13;
    const titleWidth = fontBold.widthOfTextAtSize(title, titleSize);
    page.drawText(title, {
      x: PAGE_WIDTH / 2 - titleWidth / 2,
      y: PAGE_TOP_Y,
      size: titleSize,
      font: fontBold,
      color: BRAND_BLUE
    });
    drawLine(page, PAGE_MARGIN_X, PAGE_WIDTH - PAGE_MARGIN_X, PAGE_TOP_Y - 10);
    y = PAGE_TOP_Y - 36;
  };

  const ensureSpace = (requiredHeight: number) => {
    if (y - requiredHeight < PAGE_BOTTOM_Y) {
      startPage();
    }
  };

  const drawWrappedLines = (input: {
    text: string;
    x: number;
    maxWidth: number;
    size: number;
    lineHeight: number;
    bold?: boolean;
    color?: ReturnType<typeof rgb>;
    gapAfter?: number;
  }) => {
    const lines = wrapTextToWidth({
      text: input.text,
      font: input.bold ? fontBold : font,
      size: input.size,
      maxWidth: input.maxWidth
    });

    lines.forEach((line) => {
      ensureSpace(input.lineHeight + 2);
      page.drawText(line, {
        x: input.x,
        y,
        size: input.size,
        font: input.bold ? fontBold : font,
        color: input.color ?? TEXT_COLOR
      });
      y -= input.lineHeight;
    });

    y -= input.gapAfter ?? 0;
  };

  const drawHeading = (text: string, gapAfter = 18) => {
    ensureSpace(24);
    page.drawText(text, {
      x: PAGE_MARGIN_X,
      y,
      size: 12,
      font: fontBold,
      color: BRAND_BLUE
    });
    y -= gapAfter;
  };

  const drawSingleFieldRow = (label: string, value: string) => {
    ensureSpace(22);
    const labelSize = 10.5;
    const labelWidth = fontBold.widthOfTextAtSize(label, labelSize);
    const startX = PAGE_MARGIN_X + labelWidth + 8;
    const endX = PAGE_WIDTH - PAGE_MARGIN_X;
    drawLine(page, startX, endX, y - 3);
    page.drawText(label, {
      x: PAGE_MARGIN_X,
      y,
      size: labelSize,
      font: fontBold,
      color: TEXT_COLOR
    });

    const textValue = clean(value);
    if (textValue) {
      const valueSize = fitTextSize({
        text: textValue,
        font,
        maxWidth: endX - startX - 8,
        preferredSize: 10.25
      });
      page.drawText(textValue, {
        x: startX + 4,
        y,
        size: valueSize,
        font,
        color: TEXT_COLOR
      });
    }

    y -= 26;
  };

  const drawDualFieldRow = (input: {
    leftLabel: string;
    leftValue: string;
    rightLabel: string;
    rightValue: string;
  }) => {
    ensureSpace(22);
    const leftX = PAGE_MARGIN_X;
    const midX = PAGE_MARGIN_X + CONTENT_WIDTH / 2 + 16;
    const leftLineStart = leftX + fontBold.widthOfTextAtSize(input.leftLabel, 10) + 8;
    const rightLineStart = midX + fontBold.widthOfTextAtSize(input.rightLabel, 10) + 8;
    const leftLineEnd = PAGE_MARGIN_X + CONTENT_WIDTH / 2 - 20;
    const rightLineEnd = PAGE_WIDTH - PAGE_MARGIN_X;

    page.drawText(input.leftLabel, {
      x: leftX,
      y,
      size: 10,
      font: fontBold,
      color: TEXT_COLOR
    });
    page.drawText(input.rightLabel, {
      x: midX,
      y,
      size: 10,
      font: fontBold,
      color: TEXT_COLOR
    });
    drawLine(page, leftLineStart, leftLineEnd, y - 3);
    drawLine(page, rightLineStart, rightLineEnd, y - 3);

    const leftValue = clean(input.leftValue);
    if (leftValue) {
      const leftSize = fitTextSize({
        text: leftValue,
        font,
        maxWidth: leftLineEnd - leftLineStart - 8,
        preferredSize: 10
      });
      page.drawText(leftValue, {
        x: leftLineStart + 4,
        y,
        size: leftSize,
        font,
        color: TEXT_COLOR
      });
    }

    const rightValue = clean(input.rightValue);
    if (rightValue) {
      const rightSize = fitTextSize({
        text: rightValue,
        font,
        maxWidth: rightLineEnd - rightLineStart - 8,
        preferredSize: 10
      });
      page.drawText(rightValue, {
        x: rightLineStart + 4,
        y,
        size: rightSize,
        font,
        color: TEXT_COLOR
      });
    }

    y -= 26;
  };

  const drawCheckboxRow = (checked: boolean, label: string) => {
    ensureSpace(18);
    drawCheckbox(page, PAGE_MARGIN_X, y + 1, checked);
    page.drawText(label, {
      x: PAGE_MARGIN_X + 18,
      y,
      size: 10,
      font,
      color: TEXT_COLOR
    });
    y -= 20;
  };

  const drawLinedTextArea = (input: { text: string; minLines: number; lineHeight?: number }) => {
    const lineHeight = input.lineHeight ?? 20;
    const lines = wrapTextToWidth({
      text: input.text,
      font,
      size: 10,
      maxWidth: CONTENT_WIDTH - 8
    });
    const totalLines = Math.max(input.minLines, lines.length || 0);

    for (let index = 0; index < totalLines; index += 1) {
      ensureSpace(lineHeight);
      const lineY = y - 4;
      drawLine(page, PAGE_MARGIN_X, PAGE_WIDTH - PAGE_MARGIN_X, lineY);

      const lineText = lines[index];
      if (lineText) {
        page.drawText(lineText, {
          x: PAGE_MARGIN_X + 4,
          y,
          size: 10,
          font,
          color: TEXT_COLOR
        });
      }

      y -= lineHeight;
    }

    y -= 4;
  };

  const drawSignatureRow = (input: {
    leftLabel: string;
    leftValue: string;
    leftWidth?: number;
    rightLabel: string;
    rightValue: string;
  }) => {
    ensureSpace(24);
    const leftLabelX = PAGE_MARGIN_X;
    const rightLabelX = 372;
    const leftLineStart = leftLabelX + font.widthOfTextAtSize(input.leftLabel, 9.5) + 8;
    const leftLineEnd = leftLineStart + (input.leftWidth ?? 180);
    const rightLineStart = rightLabelX + font.widthOfTextAtSize(input.rightLabel, 9.5) + 8;
    const rightLineEnd = PAGE_WIDTH - PAGE_MARGIN_X;

    page.drawText(input.leftLabel, {
      x: leftLabelX,
      y,
      size: 9.5,
      font,
      color: TEXT_COLOR
    });
    page.drawText(input.rightLabel, {
      x: rightLabelX,
      y,
      size: 9.5,
      font,
      color: TEXT_COLOR
    });
    drawLine(page, leftLineStart, leftLineEnd, y - 3);
    drawLine(page, rightLineStart, rightLineEnd, y - 3);

    const leftValue = clean(input.leftValue);
    if (leftValue) {
      const leftSize = fitTextSize({
        text: leftValue,
        font,
        maxWidth: leftLineEnd - leftLineStart - 8,
        preferredSize: 9.5
      });
      page.drawText(leftValue, {
        x: leftLineStart + 4,
        y,
        size: leftSize,
        font,
        color: TEXT_COLOR
      });
    }

    const rightValue = clean(input.rightValue);
    if (rightValue) {
      const rightSize = fitTextSize({
        text: rightValue,
        font,
        maxWidth: rightLineEnd - rightLineStart - 8,
        preferredSize: 9.5
      });
      page.drawText(rightValue, {
        x: rightLineStart + 4,
        y,
        size: rightSize,
        font,
        color: TEXT_COLOR
      });
    }

    y -= 24;
  };

  startPage();

  const carePlan = detail.carePlan;
  const canonicalNurseSignerName =
    carePlan.nurseSignedByName ?? carePlan.completedBy ?? carePlan.administratorSignature ?? carePlan.nurseDesigneeName;
  const canonicalNurseSignedAt =
    carePlan.nurseSignedAt ?? carePlan.dateOfCompletion ?? carePlan.administratorSignatureDate;

  drawHeading(blueprint.definition.memberInformationLabel, 20);
  drawSingleFieldRow(blueprint.definition.memberNameLabel, carePlan.memberName);
  drawDualFieldRow({
    leftLabel: blueprint.definition.enrollmentDateLabel,
    leftValue: formatDisplayDate(carePlan.enrollmentDate),
    rightLabel: blueprint.definition.reviewDateLabel,
    rightValue: formatDisplayDate(carePlan.reviewDate)
  });

  detail.sections.forEach((section, index) => {
    ensureSpace(72);
    page.drawText(section.sectionType, {
      x: PAGE_MARGIN_X,
      y,
      size: 12,
      font: fontBold,
      color: BRAND_BLUE
    });
    y -= 18;

    drawWrappedLines({
      text: blueprint.labels.shortTerm,
      x: PAGE_MARGIN_X,
      maxWidth: CONTENT_WIDTH,
      size: 10,
      lineHeight: 12,
      bold: true,
      gapAfter: 2
    });

    toGoalItems(section.shortTermGoals).forEach((goal) => {
      drawWrappedLines({
        text: goal,
        x: PAGE_MARGIN_X,
        maxWidth: CONTENT_WIDTH,
        size: 10,
        lineHeight: 12,
        gapAfter: 4
      });
    });

    drawWrappedLines({
      text: blueprint.labels.longTerm,
      x: PAGE_MARGIN_X,
      maxWidth: CONTENT_WIDTH,
      size: 10,
      lineHeight: 12,
      bold: true,
      gapAfter: 2
    });

    toGoalItems(section.longTermGoals).forEach((goal) => {
      drawWrappedLines({
        text: goal,
        x: PAGE_MARGIN_X,
        maxWidth: CONTENT_WIDTH,
        size: 10,
        lineHeight: 12,
        gapAfter: 4
      });
    });

    ensureSpace(18);
    drawLine(page, PAGE_MARGIN_X, PAGE_WIDTH - PAGE_MARGIN_X, y + 4);
    y -= index === detail.sections.length - 1 ? 8 : 14;
  });

  drawHeading(blueprint.labels.reviewUpdates, 18);
  drawCheckboxRow(carePlan.noChangesNeeded, blueprint.labels.reviewOptions[0]);
  drawCheckboxRow(carePlan.modificationsRequired, blueprint.labels.reviewOptions[1]);
  drawLinedTextArea({
    text: carePlan.modificationsRequired ? clean(carePlan.modificationsDescription) : "",
    minLines: 3
  });

  drawHeading(blueprint.labels.careTeamNotes, 18);
  drawLinedTextArea({
    text: clean(carePlan.careTeamNotes),
    minLines: 2
  });

  y -= 6;
  drawSignatureRow({
    leftLabel: blueprint.labels.signatureLabels.completedBy,
    leftValue: clean(canonicalNurseSignerName),
    rightLabel: blueprint.labels.signatureLabels.completedByDate,
    rightValue: formatDisplayDate(canonicalNurseSignedAt)
  });
  drawSignatureRow({
    leftLabel: blueprint.labels.signatureLabels.responsibleParty,
    leftValue: clean(carePlan.responsiblePartySignature ?? carePlan.caregiverSignedName),
    leftWidth: 210,
    rightLabel: blueprint.labels.signatureLabels.responsiblePartyDate,
    rightValue: formatDisplayDate(carePlan.responsiblePartySignatureDate ?? carePlan.caregiverSignedAt)
  });
  drawSignatureRow({
    leftLabel: blueprint.labels.signatureLabels.administratorDesignee,
    leftValue: clean(canonicalNurseSignerName),
    leftWidth: 175,
    rightLabel: blueprint.labels.signatureLabels.administratorDesigneeDate,
    rightValue: formatDisplayDate(canonicalNurseSignedAt)
  });

  const bytes = await pdf.save();
  return {
    carePlan: detail.carePlan,
    fileName: `Care Plan - ${safeFileName(detail.carePlan.memberName)} - ${toEasternDate(generatedAt)}.pdf`,
    dataUrl: `data:application/pdf;base64,${Buffer.from(bytes).toString("base64")}`,
    generatedAt
  };
}
