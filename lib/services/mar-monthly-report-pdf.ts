import "server-only";

import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";

import { resolveFacilityLogoUrl } from "@/lib/config/facility-branding";
import {
  assembleMarMonthlyReportData,
  type MarMonthlyAdministrationDetailRow,
  type MarMonthlyExceptionRow,
  type MarMonthlyMedicationRollup,
  type MarMonthlyMedicationSummary,
  type MarMonthlyPrnRow,
  type MarMonthlyReportData,
  type MarMonthlyReportType,
  type MarMonthlyStaffAttribution
} from "@/lib/services/mar-monthly-report";
import { buildMarSummaryGridRows } from "@/lib/services/mar-monthly-summary-layout";
import { DOCUMENT_CENTER_LOGO_PUBLIC_PATH } from "@/lib/services/document-branding";
import { EASTERN_TIME_ZONE } from "@/lib/timezone";
import type { AppRole } from "@/types/app";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const PAGE_MARGIN_X = 34;
const PAGE_TOP = 760;
const PAGE_BOTTOM = 56;
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN_X * 2;

const COLOR_TEXT = rgb(0.12, 0.12, 0.12);
const COLOR_MUTED = rgb(0.38, 0.38, 0.38);
const COLOR_BORDER = rgb(0.76, 0.78, 0.82);
const COLOR_HEADER_BG = rgb(0.94, 0.95, 0.97);
const COLOR_ALT_ROW = rgb(0.98, 0.98, 0.99);
const COLOR_BRAND = rgb(0.1, 0.24, 0.55);

type TableColumn<T> = {
  header: string;
  width: number;
  value: (row: T) => string;
  align?: "left" | "center" | "right";
};

type PdfLayoutState = {
  pdf: PDFDocument;
  font: PDFFont;
  fontBold: PDFFont;
  logo: PDFImage | null;
  page: PDFPage;
  y: number;
  report: MarMonthlyReportData;
};

function clean(value: string | null | undefined) {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function publicAssetPath(publicPath: string) {
  const normalized = publicPath.startsWith("/") ? publicPath.slice(1) : publicPath;
  return path.join(process.cwd(), "public", normalized);
}

function safeFileToken(value: string) {
  return value
    .replace(/[<>:"/\\|?*]/g, "")
    .trim()
    .replace(/\s+/g, "_");
}

function reportTypeLabel(reportType: MarMonthlyReportType) {
  if (reportType === "detail") return "Detail";
  if (reportType === "exceptions") return "Exceptions";
  return "Summary";
}

function roleLabel(role: AppRole | null) {
  if (!role) return "-";
  if (role === "program-assistant") return "Program Assistant";
  return role
    .split("-")
    .map((segment) => `${segment.slice(0, 1).toUpperCase()}${segment.slice(1)}`)
    .join(" ");
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    month: "2-digit",
    day: "2-digit",
    year: "numeric"
  }).format(date);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function wrapText(text: string, font: PDFFont, fontSize: number, maxWidth: number) {
  const normalized = clean(text) ?? "-";
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length === 0) return ["-"];

  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      current = candidate;
      continue;
    }

    if (current) {
      lines.push(current);
      current = word;
      continue;
    }

    let remainder = word;
    while (remainder.length > 0) {
      let chunk = remainder;
      while (chunk.length > 1 && font.widthOfTextAtSize(chunk, fontSize) > maxWidth) {
        chunk = chunk.slice(0, -1);
      }
      lines.push(chunk);
      remainder = remainder.slice(chunk.length);
    }
    current = "";
  }

  if (current) lines.push(current);
  return lines.length > 0 ? lines : ["-"];
}

async function loadLogo(pdf: PDFDocument) {
  const localPath = publicAssetPath(DOCUMENT_CENTER_LOGO_PUBLIC_PATH);
  try {
    const bytes = await readFile(localPath);
    return DOCUMENT_CENTER_LOGO_PUBLIC_PATH.toLowerCase().endsWith(".png")
      ? await pdf.embedPng(bytes)
      : await pdf.embedJpg(bytes);
  } catch {
    const fallbackUrl = clean(resolveFacilityLogoUrl());
    if (!fallbackUrl || !/^https:\/\//i.test(fallbackUrl)) {
      return null;
    }

    try {
      const response = await fetch(fallbackUrl);
      if (!response.ok) return null;
      const bytes = Buffer.from(await response.arrayBuffer());
      const isPng = fallbackUrl.toLowerCase().includes(".png") || response.headers.get("content-type")?.includes("png");
      return isPng ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    } catch {
      return null;
    }
  }
}

function drawHeader(state: PdfLayoutState) {
  const { page, font, fontBold, logo, report } = state;
  let y = PAGE_TOP;

  if (logo) {
    const logoHeight = 36;
    const scaled = logo.scale(logoHeight / logo.height);
    page.drawImage(logo, {
      x: PAGE_MARGIN_X,
      y: y - logoHeight + 2,
      width: Math.min(scaled.width, 160),
      height: logoHeight
    });
  }

  const facilityName = report.facility.name;
  page.drawText(facilityName, {
    x: PAGE_MARGIN_X + 170,
    y,
    size: 13,
    font: fontBold,
    color: COLOR_BRAND
  });
  y -= 12;

  if (report.facility.address) {
    page.drawText(report.facility.address, {
      x: PAGE_MARGIN_X + 170,
      y,
      size: 9,
      font,
      color: COLOR_TEXT
    });
    y -= 11;
  }

  if (report.facility.phone) {
    page.drawText(report.facility.phone, {
      x: PAGE_MARGIN_X + 170,
      y,
      size: 9,
      font,
      color: COLOR_TEXT
    });
  }

  const metaX = PAGE_WIDTH - PAGE_MARGIN_X - 180;
  const metaLines = [
    `Report Month: ${report.month.label}`,
    `Generated: ${formatDateTime(report.generatedAt)} ET`,
    `Generated By: ${report.generatedBy.name} (${roleLabel(report.generatedBy.role)})`
  ];

  let metaY = PAGE_TOP;
  metaLines.forEach((line) => {
    page.drawText(line, {
      x: metaX,
      y: metaY,
      size: 8.5,
      font,
      color: COLOR_MUTED
    });
    metaY -= 11;
  });

  const title =
    report.reportType === "detail"
      ? "Monthly Medication Administration Record (Detail)"
      : report.reportType === "exceptions"
        ? "Monthly Medication Administration Exceptions"
        : "Monthly Medication Administration Summary";

  page.drawText(title, {
    x: PAGE_MARGIN_X,
    y: 708,
    size: 14,
    font: fontBold,
    color: COLOR_BRAND
  });

  const memberMeta = [
    `Member: ${report.member.fullName}`,
    `DOB: ${formatDate(report.member.dob)}`,
    `Identifier: ${report.member.identifier ?? report.member.id}`
  ];
  let memberMetaY = 692;
  memberMeta.forEach((line) => {
    page.drawText(line, {
      x: PAGE_MARGIN_X,
      y: memberMetaY,
      size: 9,
      font,
      color: COLOR_TEXT
    });
    memberMetaY -= 11;
  });

  page.drawLine({
    start: { x: PAGE_MARGIN_X, y: 656 },
    end: { x: PAGE_WIDTH - PAGE_MARGIN_X, y: 656 },
    thickness: 1,
    color: COLOR_BORDER
  });

  state.y = 642;
}

function addPage(state: PdfLayoutState) {
  state.page = state.pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  drawHeader(state);
}

function ensureSpace(state: PdfLayoutState, needed: number) {
  if (state.y - needed >= PAGE_BOTTOM) return;
  addPage(state);
}

function drawSectionTitle(state: PdfLayoutState, title: string, subtitle?: string | null) {
  ensureSpace(state, 32);
  state.page.drawText(title, {
    x: PAGE_MARGIN_X,
    y: state.y,
    size: 11,
    font: state.fontBold,
    color: COLOR_BRAND
  });
  state.y -= 13;

  if (subtitle) {
    state.page.drawText(subtitle, {
      x: PAGE_MARGIN_X,
      y: state.y,
      size: 8.5,
      font: state.font,
      color: COLOR_MUTED
    });
    state.y -= 12;
  }

  state.y -= 2;
}

function drawParagraph(state: PdfLayoutState, text: string, options?: { size?: number; color?: ReturnType<typeof rgb> }) {
  const fontSize = options?.size ?? 9;
  const color = options?.color ?? COLOR_TEXT;
  const lines = wrapText(text, state.font, fontSize, CONTENT_WIDTH);
  const lineHeight = fontSize + 2;

  ensureSpace(state, lines.length * lineHeight + 4);

  lines.forEach((line) => {
    state.page.drawText(line, {
      x: PAGE_MARGIN_X,
      y: state.y,
      size: fontSize,
      font: state.font,
      color
    });
    state.y -= lineHeight;
  });

  state.y -= 4;
}

function drawTableHeader<T>(
  state: PdfLayoutState,
  columns: TableColumn<T>[],
  xStart: number,
  yStart: number,
  rowHeight: number
) {
  let x = xStart;
  columns.forEach((column) => {
    state.page.drawRectangle({
      x,
      y: yStart - rowHeight,
      width: column.width,
      height: rowHeight,
      color: COLOR_HEADER_BG,
      borderColor: COLOR_BORDER,
      borderWidth: 0.5
    });

    const textWidth = state.fontBold.widthOfTextAtSize(column.header, 8);
    let textX = x + 4;
    if (column.align === "center") {
      textX = x + Math.max((column.width - textWidth) / 2, 3);
    } else if (column.align === "right") {
      textX = x + column.width - textWidth - 4;
    }

    state.page.drawText(column.header, {
      x: textX,
      y: yStart - 10,
      size: 8,
      font: state.fontBold,
      color: COLOR_TEXT
    });

    x += column.width;
  });
}

function drawTable<T>(state: PdfLayoutState, input: {
  title: string;
  subtitle?: string;
  columns: TableColumn<T>[];
  rows: T[];
  emptyMessage: string;
}) {
  drawSectionTitle(state, input.title, input.subtitle ?? null);

  const headerHeight = 16;
  const rowPadding = 3;
  const cellFontSize = 8.2;
  const lineHeight = 10;

  const startNewTablePage = () => {
    ensureSpace(state, headerHeight + 6);
    drawTableHeader(state, input.columns, PAGE_MARGIN_X, state.y, headerHeight);
    state.y -= headerHeight;
  };

  if (input.rows.length === 0) {
    drawParagraph(state, input.emptyMessage, { size: 8.6, color: COLOR_MUTED });
    return;
  }

  startNewTablePage();

  input.rows.forEach((row, rowIndex) => {
    const cellLinesByColumn = input.columns.map((column) =>
      wrapText(column.value(row), state.font, cellFontSize, Math.max(column.width - 6, 12))
    );
    const maxLineCount = Math.max(...cellLinesByColumn.map((lines) => lines.length));
    const rowHeight = maxLineCount * lineHeight + rowPadding * 2;

    if (state.y - rowHeight < PAGE_BOTTOM) {
      addPage(state);
      startNewTablePage();
    }

    let x = PAGE_MARGIN_X;
    input.columns.forEach((column, columnIndex) => {
      state.page.drawRectangle({
        x,
        y: state.y - rowHeight,
        width: column.width,
        height: rowHeight,
        color: rowIndex % 2 === 0 ? rgb(1, 1, 1) : COLOR_ALT_ROW,
        borderColor: COLOR_BORDER,
        borderWidth: 0.25
      });

      const lines = cellLinesByColumn[columnIndex];
      lines.forEach((line, lineIndex) => {
        const textWidth = state.font.widthOfTextAtSize(line, cellFontSize);
        let textX = x + 3;
        if (column.align === "center") {
          textX = x + Math.max((column.width - textWidth) / 2, 2);
        } else if (column.align === "right") {
          textX = x + column.width - textWidth - 3;
        }

        state.page.drawText(line, {
          x: textX,
          y: state.y - rowPadding - 8.5 - lineIndex * lineHeight,
          size: cellFontSize,
          font: state.font,
          color: COLOR_TEXT
        });
      });

      x += column.width;
    });

    state.y -= rowHeight;
  });

  state.y -= 8;
}

type SummaryCommentRow = {
  dateLabel: string;
  timeLabel: string;
  medicationLabel: string;
  outcomeLabel: string;
  noteLabel: string;
  staffLabel: string;
};

const SUMMARY_PAGE_WIDTH = 792;
const SUMMARY_PAGE_HEIGHT = 612;
const SUMMARY_MARGIN_X = 26;
const SUMMARY_TOP = 576;
const SUMMARY_BOTTOM = 34;
const SUMMARY_LEFT_COLUMNS = {
  medication: 126,
  order: 116,
  time: 52
} as const;

function formatTimeToken(value: string | null | undefined) {
  const normalized = clean(value);
  if (!normalized) return "-";

  const directMatch = /^(\d{1,2}):(\d{2})/.exec(normalized);
  if (directMatch) {
    return `${directMatch[1].padStart(2, "0")}:${directMatch[2]}`;
  }

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return normalized;

  return new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function weekdayInitial(day: number, month: MarMonthlyReportData["month"]) {
  const date = new Date(Date.UTC(month.year, month.monthNumber - 1, day));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    weekday: "short"
  })
    .format(date)
    .slice(0, 1)
    .toUpperCase();
}

function buildSummaryCommentRows(report: MarMonthlyReportData) {
  const rows: SummaryCommentRow[] = [];

  report.exceptions.forEach((row) => {
    rows.push({
      dateLabel: formatDate(row.dateTime),
      timeLabel: formatTimeToken(row.scheduledTime ?? row.administeredTime ?? row.dateTime),
      medicationLabel: row.medicationName,
      outcomeLabel: row.outcome,
      noteLabel: [row.reason, row.notes].filter(Boolean).join(" | ") || "-",
      staffLabel: row.staffName
    });
  });

  report.prnRows.forEach((row) => {
    rows.push({
      dateLabel: formatDate(row.administeredAt),
      timeLabel: formatTimeToken(row.administeredAt),
      medicationLabel: row.medicationName,
      outcomeLabel: `PRN ${row.status} / ${row.effectiveness}`,
      noteLabel:
        [
          row.reasonGiven ? `Reason: ${row.reasonGiven}` : null,
          row.followupDocumentation ? `Follow-up: ${row.followupDocumentation}` : null,
          row.notes
        ]
          .filter(Boolean)
          .join(" | ") || "-",
      staffLabel: row.staffName
    });
  });

  return rows.sort((left, right) => {
    const leftKey = `${left.dateLabel} ${left.timeLabel}`;
    const rightKey = `${right.dateLabel} ${right.timeLabel}`;
    return leftKey.localeCompare(rightKey);
  });
}

async function renderSummaryReportPdf(report: MarMonthlyReportData) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await loadLogo(pdf);
  const daysInMonth = new Date(Date.UTC(report.month.year, report.month.monthNumber, 0)).getUTCDate();
  const gridRows = buildMarSummaryGridRows(report);
  const commentRows = buildSummaryCommentRows(report);
  const dayColumnWidth =
    (SUMMARY_PAGE_WIDTH - SUMMARY_MARGIN_X * 2 - SUMMARY_LEFT_COLUMNS.medication - SUMMARY_LEFT_COLUMNS.order - SUMMARY_LEFT_COLUMNS.time) /
    daysInMonth;

  const drawHeader = (page: PDFPage, pageLabel: string) => {
    if (logo) {
      const height = 30;
      const scaled = logo.scale(height / logo.height);
      page.drawImage(logo, {
        x: SUMMARY_MARGIN_X,
        y: SUMMARY_TOP - 8,
        width: Math.min(scaled.width, 120),
        height
      });
    }

    page.drawText("MEDICATION ADMINISTRATION RECORD", {
      x: SUMMARY_MARGIN_X,
      y: SUMMARY_TOP - 44,
      size: 18,
      font: fontBold,
      color: COLOR_TEXT
    });

    page.drawText(report.facility.name, {
      x: SUMMARY_MARGIN_X + 132,
      y: SUMMARY_TOP - 10,
      size: 11,
      font: fontBold,
      color: COLOR_BRAND
    });

    const rightX = SUMMARY_PAGE_WIDTH - SUMMARY_MARGIN_X - 180;
    const rightLines = [
      `Month: ${report.month.label}`,
      `Generated: ${formatDateTime(report.generatedAt)} ET`,
      `Page: ${pageLabel}`
    ];
    let rightY = SUMMARY_TOP - 8;
    rightLines.forEach((line) => {
      page.drawText(line, {
        x: rightX,
        y: rightY,
        size: 8.5,
        font,
        color: COLOR_MUTED
      });
      rightY -= 11;
    });

    const memberLines = [
      `Member: ${report.member.fullName}`,
      `DOB: ${formatDate(report.member.dob)}`,
      `Identifier: ${report.member.identifier ?? report.member.id}`,
      `Legend: initials = given, NG = not given`
    ];

    let memberY = SUMMARY_TOP - 62;
    memberLines.forEach((line) => {
      page.drawText(line, {
        x: SUMMARY_MARGIN_X,
        y: memberY,
        size: 9,
        font,
        color: COLOR_TEXT
      });
      memberY -= 11;
    });

    page.drawText(
      `Scheduled Given: ${report.totals.scheduledGiven}   Not Given: ${report.totals.scheduledNotGiven}   PRN Administrations: ${report.totals.prnAdministrations}`,
      {
        x: SUMMARY_MARGIN_X,
        y: SUMMARY_TOP - 108,
        size: 8.5,
        font: fontBold,
        color: COLOR_BRAND
      }
    );

    page.drawLine({
      start: { x: SUMMARY_MARGIN_X, y: SUMMARY_TOP - 118 },
      end: { x: SUMMARY_PAGE_WIDTH - SUMMARY_MARGIN_X, y: SUMMARY_TOP - 118 },
      thickness: 1,
      color: COLOR_BORDER
    });
  };

  const drawGridHeader = (page: PDFPage, y: number) => {
    const headerHeight = 24;
    let x = SUMMARY_MARGIN_X;
    const headers = [
      { label: "Medication", width: SUMMARY_LEFT_COLUMNS.medication },
      { label: "Order / Instructions", width: SUMMARY_LEFT_COLUMNS.order },
      { label: "Time", width: SUMMARY_LEFT_COLUMNS.time }
    ];

    headers.forEach((column) => {
      page.drawRectangle({
        x,
        y: y - headerHeight,
        width: column.width,
        height: headerHeight,
        color: COLOR_HEADER_BG,
        borderColor: COLOR_BORDER,
        borderWidth: 0.6
      });
      page.drawText(column.label, {
        x: x + 4,
        y: y - 14,
        size: 8,
        font: fontBold,
        color: COLOR_TEXT
      });
      x += column.width;
    });

    for (let day = 1; day <= daysInMonth; day += 1) {
      page.drawRectangle({
        x,
        y: y - headerHeight,
        width: dayColumnWidth,
        height: headerHeight,
        color: COLOR_HEADER_BG,
        borderColor: COLOR_BORDER,
        borderWidth: 0.6
      });

      const dayLabel = String(day);
      const dayWidth = fontBold.widthOfTextAtSize(dayLabel, 7.5);
      page.drawText(dayLabel, {
        x: x + Math.max((dayColumnWidth - dayWidth) / 2, 1),
        y: y - 11,
        size: 7.5,
        font: fontBold,
        color: COLOR_TEXT
      });

      const weekday = weekdayInitial(day, report.month);
      const weekdayWidth = font.widthOfTextAtSize(weekday, 6);
      page.drawText(weekday, {
        x: x + Math.max((dayColumnWidth - weekdayWidth) / 2, 1),
        y: y - 19,
        size: 6,
        font,
        color: COLOR_MUTED
      });

      x += dayColumnWidth;
    }

    return y - headerHeight;
  };

  const drawWrappedCell = (
    page: PDFPage,
    text: string,
    x: number,
    y: number,
    width: number,
    _height: number,
    size: number,
    bold = false
  ) => {
    const lines = wrapText(text, bold ? fontBold : font, size, Math.max(width - 6, 10)).slice(0, 3);
    const lineHeight = size + 1.5;
    const textTop = y - 6;
    lines.forEach((line, index) => {
      page.drawText(line, {
        x: x + 3,
        y: textTop - index * lineHeight,
        size,
        font: bold ? fontBold : font,
        color: COLOR_TEXT
      });
    });
  };

  let pageNumber = 0;
  let page = pdf.addPage([SUMMARY_PAGE_WIDTH, SUMMARY_PAGE_HEIGHT]);
  let y = SUMMARY_TOP;

  const startGridPage = () => {
    pageNumber += 1;
    if (pageNumber > 1) {
      page = pdf.addPage([SUMMARY_PAGE_WIDTH, SUMMARY_PAGE_HEIGHT]);
    }
    drawHeader(page, `${pageNumber}`);
    y = drawGridHeader(page, SUMMARY_TOP - 132);
  };

  startGridPage();

  const drawBlankGridMessage = () => {
    page.drawText("No scheduled MAR rows were available for this member and month.", {
      x: SUMMARY_MARGIN_X,
      y: y - 18,
      size: 9,
      font,
      color: COLOR_MUTED
    });
  };

  if (gridRows.length === 0) {
    drawBlankGridMessage();
  }

  gridRows.forEach((row) => {
    const medicationLines = wrapText(row.medicationName, fontBold, 8, SUMMARY_LEFT_COLUMNS.medication - 6).slice(0, 3);
    const orderLines = wrapText(row.orderLabel, font, 7.4, SUMMARY_LEFT_COLUMNS.order - 6).slice(0, 3);
    const rowHeight = Math.max(26, Math.max(medicationLines.length, orderLines.length) * 8 + 10);

    if (y - rowHeight < SUMMARY_BOTTOM + 56) {
      startGridPage();
    }

    let x = SUMMARY_MARGIN_X;
    const leftCells = [
      { width: SUMMARY_LEFT_COLUMNS.medication, text: row.medicationName, size: 8, bold: true },
      { width: SUMMARY_LEFT_COLUMNS.order, text: row.orderLabel, size: 7.4, bold: false },
      { width: SUMMARY_LEFT_COLUMNS.time, text: row.timeLabel, size: 8, bold: true }
    ] as const;

    leftCells.forEach((cell) => {
      page.drawRectangle({
        x,
        y: y - rowHeight,
        width: cell.width,
        height: rowHeight,
        color: rgb(1, 1, 1),
        borderColor: COLOR_BORDER,
        borderWidth: 0.45
      });
      drawWrappedCell(page, cell.text, x, y, cell.width, rowHeight, cell.size, cell.bold);
      x += cell.width;
    });

    for (let day = 1; day <= daysInMonth; day += 1) {
      const cell = row.cells.get(day) ?? null;
      page.drawRectangle({
        x,
        y: y - rowHeight,
        width: dayColumnWidth,
        height: rowHeight,
        color:
          cell?.status === "given" ? rgb(0.95, 0.98, 1) : cell?.status === "not-given" ? rgb(1, 0.96, 0.94) : rgb(1, 1, 1),
        borderColor: COLOR_BORDER,
        borderWidth: 0.4
      });

      if (cell) {
        const labelWidth = fontBold.widthOfTextAtSize(cell.label, 7);
        page.drawText(cell.label, {
          x: x + Math.max((dayColumnWidth - labelWidth) / 2, 1),
          y: y - rowHeight / 2 - 2,
          size: 7,
          font: fontBold,
          color: cell.status === "given" ? COLOR_BRAND : rgb(0.5, 0.18, 0.12)
        });
      }

      x += dayColumnWidth;
    }

    y -= rowHeight;
  });

  const commentsPage = pdf.addPage([SUMMARY_PAGE_WIDTH, SUMMARY_PAGE_HEIGHT]);
  pageNumber += 1;
  drawHeader(commentsPage, `${pageNumber}`);

  commentsPage.drawText("Comments / Variance Log", {
    x: SUMMARY_MARGIN_X,
    y: SUMMARY_TOP - 132,
    size: 11,
    font: fontBold,
    color: COLOR_BRAND
  });

  const commentColumns = [
    { header: "Date", width: 68 },
    { header: "Time", width: 48 },
    { header: "Medication", width: 128 },
    { header: "Outcome", width: 114 },
    { header: "Reason / Notes", width: 286 },
    { header: "Staff", width: 96 }
  ] as const;

  const commentHeaderY = SUMMARY_TOP - 144;
  let commentX = SUMMARY_MARGIN_X;
  commentColumns.forEach((column) => {
    commentsPage.drawRectangle({
      x: commentX,
      y: commentHeaderY - 22,
      width: column.width,
      height: 22,
      color: COLOR_HEADER_BG,
      borderColor: COLOR_BORDER,
      borderWidth: 0.5
    });
    commentsPage.drawText(column.header, {
      x: commentX + 4,
      y: commentHeaderY - 14,
      size: 8,
      font: fontBold,
      color: COLOR_TEXT
    });
    commentX += column.width;
  });

  let commentY = commentHeaderY - 22;
  const paddedCommentRows =
    commentRows.length > 0
      ? commentRows
      : [
          {
            dateLabel: "",
            timeLabel: "",
            medicationLabel: "",
            outcomeLabel: "",
            noteLabel: "",
            staffLabel: ""
          }
        ];

  paddedCommentRows.slice(0, 12).forEach((row) => {
    const cells = [
      row.dateLabel || "",
      row.timeLabel || "",
      row.medicationLabel || "",
      row.outcomeLabel || "",
      row.noteLabel || "",
      row.staffLabel || ""
    ];

    const lineCounts = cells.map((text, index) =>
      wrapText(text || " ", font, 7.5, commentColumns[index].width - 6).slice(0, 3).length
    );
    const rowHeight = Math.max(24, Math.max(...lineCounts) * 8 + 8);

    commentX = SUMMARY_MARGIN_X;
    cells.forEach((text, index) => {
      commentsPage.drawRectangle({
        x: commentX,
        y: commentY - rowHeight,
        width: commentColumns[index].width,
        height: rowHeight,
        color: rgb(1, 1, 1),
        borderColor: COLOR_BORDER,
        borderWidth: 0.4
      });
      drawWrappedCell(commentsPage, text || " ", commentX, commentY, commentColumns[index].width, rowHeight, 7.5, false);
      commentX += commentColumns[index].width;
    });
    commentY -= rowHeight;
  });

  commentsPage.drawText("Initials / Signature Key", {
    x: SUMMARY_MARGIN_X,
    y: commentY - 18,
    size: 11,
    font: fontBold,
    color: COLOR_BRAND
  });

  const signatureTop = commentY - 28;
  const signatureColumns = [
    { header: "Staff", width: 220 },
    { header: "Role", width: 120 },
    { header: "Initials", width: 70 },
    { header: "Signature", width: 330 }
  ] as const;

  commentX = SUMMARY_MARGIN_X;
  signatureColumns.forEach((column) => {
    commentsPage.drawRectangle({
      x: commentX,
      y: signatureTop - 22,
      width: column.width,
      height: 22,
      color: COLOR_HEADER_BG,
      borderColor: COLOR_BORDER,
      borderWidth: 0.5
    });
    commentsPage.drawText(column.header, {
      x: commentX + 4,
      y: signatureTop - 14,
      size: 8,
      font: fontBold,
      color: COLOR_TEXT
    });
    commentX += column.width;
  });

  let signatureY = signatureTop - 22;
  const attributionRows = report.staffAttribution.length > 0 ? report.staffAttribution.slice(0, 5) : [];
  const blankSignatureRows = Math.max(5 - attributionRows.length, 0);
  [...attributionRows, ...Array.from({ length: blankSignatureRows }, () => null)].forEach((row) => {
    const rowHeight = 24;
    commentX = SUMMARY_MARGIN_X;
    signatureColumns.forEach((column, index) => {
      commentsPage.drawRectangle({
        x: commentX,
        y: signatureY - rowHeight,
        width: column.width,
        height: rowHeight,
        color: rgb(1, 1, 1),
        borderColor: COLOR_BORDER,
        borderWidth: 0.4
      });

      const text =
        !row
          ? ""
          : index === 0
            ? row.staffName
            : index === 1
              ? roleLabel(row.staffRole)
              : index === 2
                ? row.initials
                : "";

      if (text) {
        commentsPage.drawText(text, {
          x: commentX + 4,
          y: signatureY - 15,
          size: 8,
          font: index === 2 ? fontBold : font,
          color: COLOR_TEXT
        });
      }

      if (index === 3) {
        commentsPage.drawLine({
          start: { x: commentX + 8, y: signatureY - 18 },
          end: { x: commentX + column.width - 8, y: signatureY - 18 },
          thickness: 0.6,
          color: COLOR_BORDER
        });
      }

      commentX += column.width;
    });
    signatureY -= rowHeight;
  });

  const footerPages = pdf.getPages();
  footerPages.forEach((footerPage, index) => {
    const footerY = 16;
    footerPage.drawLine({
      start: { x: SUMMARY_MARGIN_X, y: footerY + 12 },
      end: { x: footerPage.getWidth() - SUMMARY_MARGIN_X, y: footerY + 12 },
      thickness: 0.5,
      color: COLOR_BORDER
    });

    footerPage.drawText(report.facility.confidentialityFooter, {
      x: SUMMARY_MARGIN_X,
      y: footerY,
      size: 7.5,
      font,
      color: COLOR_MUTED
    });

    const pageLabel = `Page ${index + 1} of ${footerPages.length}`;
    footerPage.drawText(pageLabel, {
      x: footerPage.getWidth() - SUMMARY_MARGIN_X - font.widthOfTextAtSize(pageLabel, 7.5),
      y: footerY,
      size: 7.5,
      font,
      color: COLOR_MUTED
    });
  });

  return Buffer.from(await pdf.save());
}

function drawDetailReport(state: PdfLayoutState) {
  const report = state.report;

  drawSectionTitle(
    state,
    "Monthly Totals",
    `Expected Scheduled: ${report.totals.scheduledExpected} | Given: ${report.totals.scheduledGiven} | Not Given: ${report.totals.scheduledNotGiven} | Exceptions: ${report.totals.exceptions}`
  );

  drawTable<MarMonthlyAdministrationDetailRow>(state, {
    title: "Full Administration Detail",
    subtitle: "Chronological month view across scheduled and PRN medication administrations",
    columns: [
      { header: "Date / Time", width: 90, value: (row) => formatDateTime(row.administeredAt) },
      { header: "Medication", width: 110, value: (row) => row.medicationName },
      { header: "Due", width: 72, value: (row) => formatDateTime(row.dueTime) },
      {
        header: "Source / Status",
        width: 76,
        value: (row) => `${row.source === "scheduled" ? "Sched" : "PRN"} | ${row.status}`
      },
      {
        header: "Reason / Outcome",
        width: 96,
        value: (row) => {
          if (row.source === "prn") {
            const outcome = row.prnOutcome ? `Outcome: ${row.prnOutcome}` : "Outcome: Pending";
            return [row.prnReason ? `Reason: ${row.prnReason}` : null, outcome].filter(Boolean).join(" | ");
          }
          return row.reason ?? "-";
        }
      },
      { header: "Staff", width: 56, value: (row) => row.staffName },
      {
        header: "Notes",
        width: 44,
        value: (row) => [row.prnFollowupNote, row.notes].filter(Boolean).join(" | ") || "-"
      }
    ],
    rows: report.detailRows,
    emptyMessage: "No administration events were found for this month."
  });

  drawTable<MarMonthlyExceptionRow>(state, {
    title: "Exception Focus",
    subtitle: "Quick review of monthly not-given doses and PRN ineffective outcomes",
    columns: [
      { header: "Date / Time", width: 88, value: (row) => formatDateTime(row.dateTime) },
      { header: "Medication", width: 130, value: (row) => row.medicationName },
      { header: "Outcome", width: 80, value: (row) => row.outcome },
      { header: "Reason", width: 90, value: (row) => row.reason ?? "-" },
      { header: "Staff", width: 70, value: (row) => row.staffName },
      { header: "Notes", width: 86, value: (row) => row.notes ?? "-" }
    ],
    rows: report.exceptions,
    emptyMessage: "No exception events were found for this month."
  });
}

function drawExceptionReport(state: PdfLayoutState) {
  const report = state.report;

  drawSectionTitle(
    state,
    "Exception Totals",
    `Exceptions: ${report.totals.exceptions} | Scheduled Not Given: ${report.totals.scheduledNotGiven} | PRN Ineffective: ${report.totals.prnIneffective}`
  );

  drawTable<MarMonthlyExceptionRow>(state, {
    title: "Exception Events",
    subtitle: "Monthly medication variances for quality and compliance review",
    columns: [
      { header: "Date / Time", width: 90, value: (row) => formatDateTime(row.dateTime) },
      { header: "Medication", width: 140, value: (row) => row.medicationName },
      { header: "Due", width: 86, value: (row) => formatDateTime(row.scheduledTime) },
      { header: "Outcome", width: 76, value: (row) => row.outcome },
      { header: "Reason", width: 80, value: (row) => row.reason ?? "-" },
      { header: "Staff", width: 72, value: (row) => row.staffName }
    ],
    rows: report.exceptions,
    emptyMessage: "No monthly exception events were found."
  });

  drawTable<MarMonthlyPrnRow>(state, {
    title: "PRN Follow-up",
    subtitle: "PRN administrations including pending and ineffective effectiveness documentation",
    columns: [
      { header: "Date / Time", width: 94, value: (row) => formatDateTime(row.administeredAt) },
      { header: "Medication", width: 126, value: (row) => row.medicationName },
      { header: "Reason", width: 84, value: (row) => row.reasonGiven ?? "-" },
      { header: "Status / Outcome", width: 92, value: (row) => `${row.status} | ${row.effectiveness}` },
      {
        header: "Follow-up",
        width: 148,
        value: (row) =>
          [row.followupStatus, row.followupDueAt ? formatDateTime(row.followupDueAt) : null, row.followupDocumentation]
            .filter(Boolean)
            .join(" | ") || "-"
      }
    ],
    rows: report.prnRows,
    emptyMessage: "No PRN events were found for this month."
  });
}

function drawFooters(state: PdfLayoutState) {
  const pages = state.pdf.getPages();
  const total = pages.length;

  pages.forEach((page, index) => {
    const footerY = 24;

    page.drawLine({
      start: { x: PAGE_MARGIN_X, y: footerY + 12 },
      end: { x: PAGE_WIDTH - PAGE_MARGIN_X, y: footerY + 12 },
      thickness: 0.5,
      color: COLOR_BORDER
    });

    page.drawText(state.report.facility.confidentialityFooter, {
      x: PAGE_MARGIN_X,
      y: footerY,
      size: 7.5,
      font: state.font,
      color: COLOR_MUTED
    });

    const pageLabel = `Page ${index + 1} of ${total}`;
    page.drawText(pageLabel, {
      x: PAGE_WIDTH - PAGE_MARGIN_X - state.font.widthOfTextAtSize(pageLabel, 7.5),
      y: footerY,
      size: 7.5,
      font: state.font,
      color: COLOR_MUTED
    });
  });
}

async function renderMarMonthlyReportPdf(report: MarMonthlyReportData) {
  if (report.reportType === "summary") {
    return renderSummaryReportPdf(report);
  }

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await loadLogo(pdf);

  const state: PdfLayoutState = {
    pdf,
    font,
    fontBold,
    logo,
    page: pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]),
    y: PAGE_TOP,
    report
  };

  drawHeader(state);

  if (report.reportType === "detail") {
    drawDetailReport(state);
  } else {
    drawExceptionReport(state);
  }

  drawFooters(state);

  return Buffer.from(await pdf.save());
}

export async function renderMarMonthlyReportPdfBytesForReport(report: MarMonthlyReportData) {
  return renderMarMonthlyReportPdf(report);
}

export async function buildMarMonthlyReportPdfDataUrl(input: {
  memberId: string;
  month: string;
  reportType: MarMonthlyReportType;
  generatedBy: {
    name: string;
    role: AppRole | null;
  };
  generatedAtIso?: string;
  serviceRole?: boolean;
}) {
  const report = await assembleMarMonthlyReportData({
    memberId: input.memberId,
    month: input.month,
    reportType: input.reportType,
    generatedBy: input.generatedBy,
    generatedAtIso: input.generatedAtIso,
    serviceRole: input.serviceRole
  });

  const bytes = await renderMarMonthlyReportPdf(report);
  const reportLabel = reportTypeLabel(report.reportType);
  const memberToken = safeFileToken(report.member.fullName || "Member");
  const fileName = `${memberToken}_MAR_${reportLabel}_${report.month.value}.pdf`;

  return {
    fileName,
    dataUrl: `data:application/pdf;base64,${bytes.toString("base64")}`,
    report
  };
}
