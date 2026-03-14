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

function drawSummaryReport(state: PdfLayoutState) {
  const report = state.report;

  const dataQualityNotes = report.dataQuality.warnings;
  if (dataQualityNotes.length > 0) {
    drawSectionTitle(state, "Data Quality Notes");
    dataQualityNotes.forEach((warning) => {
      drawParagraph(state, `- ${warning}`, { size: 8.6, color: rgb(0.42, 0.25, 0.1) });
    });
  }

  drawSectionTitle(
    state,
    "Monthly Totals",
    `Expected Scheduled Doses: ${report.totals.scheduledExpected} | Scheduled Given: ${report.totals.scheduledGiven} | Scheduled Not Given: ${report.totals.scheduledNotGiven} | PRN Administrations: ${report.totals.prnAdministrations}`
  );

  drawTable<MarMonthlyMedicationSummary>(state, {
    title: "Medication Summary",
    subtitle: "Active or month-relevant medications with schedule and order context",
    columns: [
      { header: "Medication", width: 95, value: (row) => row.medicationName },
      { header: "Strength / Dose", width: 70, value: (row) => [row.strength, row.dose].filter(Boolean).join(" | ") || "-" },
      { header: "Route", width: 40, value: (row) => row.route ?? "-" },
      {
        header: "Sig / Frequency",
        width: 118,
        value: (row) => [row.sig, row.frequency].filter(Boolean).join(" | ") || "-"
      },
      { header: "Times", width: 50, value: (row) => (row.scheduledTimes.length > 0 ? row.scheduledTimes.join(", ") : "-") },
      { header: "PRN", width: 24, align: "center", value: (row) => (row.prn ? "Y" : "N") },
      {
        header: "Start / End",
        width: 72,
        value: (row) => `${formatDate(row.startDate)} / ${formatDate(row.endDate)}`
      },
      { header: "Prescriber", width: 75, value: (row) => row.provider ?? "-" }
    ],
    rows: report.medications,
    emptyMessage: "No medication records were found for this month."
  });

  drawTable<MarMonthlyMedicationRollup>(state, {
    title: "Scheduled Administration Rollup",
    subtitle: "Per-medication expected opportunities and documented scheduled outcomes",
    columns: [
      { header: "Medication", width: 140, value: (row) => row.medicationName },
      { header: "Expected", width: 44, align: "right", value: (row) => String(row.scheduledExpectedCount) },
      { header: "Given", width: 38, align: "right", value: (row) => String(row.givenCount) },
      { header: "Not Given", width: 52, align: "right", value: (row) => String(row.notGivenCount) },
      { header: "Refused", width: 40, align: "right", value: (row) => String(row.refusedCount) },
      { header: "Held", width: 34, align: "right", value: (row) => String(row.heldCount) },
      { header: "Unavailable", width: 52, align: "right", value: (row) => String(row.unavailableCount) },
      { header: "Omitted", width: 42, align: "right", value: (row) => String(row.omittedCount) },
      { header: "Other", width: 36, align: "right", value: (row) => String(row.otherExceptionCount) },
      { header: "Last Exception", width: 66, value: (row) => formatDateTime(row.lastExceptionAt) }
    ],
    rows: report.medicationRollups,
    emptyMessage: "No scheduled administration rollup rows are available for this month."
  });

  drawTable<MarMonthlyMedicationRollup>(state, {
    title: "PRN Rollup",
    subtitle: "Per-medication PRN administrations and effectiveness outcomes",
    columns: [
      { header: "Medication", width: 200, value: (row) => row.medicationName },
      { header: "PRN Admin", width: 90, align: "right", value: (row) => String(row.prnAdministrationCount) },
      { header: "Effective", width: 80, align: "right", value: (row) => String(row.prnEffectiveCount) },
      { header: "Ineffective", width: 80, align: "right", value: (row) => String(row.prnIneffectiveCount) },
      { header: "Last Admin", width: 94, value: (row) => formatDateTime(row.lastAdministrationAt) }
    ],
    rows: report.medicationRollups,
    emptyMessage: "No PRN rollup rows are available for this month."
  });

  drawTable<MarMonthlyExceptionRow>(state, {
    title: "Exception / Variance Summary",
    subtitle: "Not Given doses and PRN ineffective outcomes requiring follow-up review",
    columns: [
      { header: "Date / Time", width: 88, value: (row) => formatDateTime(row.dateTime) },
      { header: "Medication", width: 96, value: (row) => row.medicationName },
      {
        header: "Due / Admin",
        width: 88,
        value: (row) => `${formatDateTime(row.scheduledTime)} / ${formatDateTime(row.administeredTime)}`
      },
      { header: "Outcome", width: 66, value: (row) => row.outcome },
      { header: "Reason", width: 76, value: (row) => row.reason ?? "-" },
      { header: "Staff", width: 58, value: (row) => row.staffName },
      { header: "Notes", width: 72, value: (row) => row.notes ?? "-" }
    ],
    rows: report.exceptions,
    emptyMessage: "No monthly exceptions were documented."
  });

  drawTable<MarMonthlyPrnRow>(state, {
    title: "PRN Administrations",
    subtitle: "PRN reasons, effectiveness, and follow-up documentation",
    columns: [
      { header: "Date / Time", width: 88, value: (row) => formatDateTime(row.administeredAt) },
      { header: "Medication", width: 110, value: (row) => row.medicationName },
      { header: "Reason", width: 78, value: (row) => row.reasonGiven ?? "-" },
      { header: "Outcome", width: 52, value: (row) => row.effectiveness },
      { header: "Follow-up", width: 112, value: (row) => row.followupDocumentation ?? "-" },
      { header: "Staff", width: 52, value: (row) => row.staffName },
      { header: "Notes", width: 52, value: (row) => row.notes ?? "-" }
    ],
    rows: report.prnRows,
    emptyMessage: "No PRN administrations were documented for this month."
  });

  drawTable<MarMonthlyStaffAttribution>(state, {
    title: "Staff Attribution / Signoff",
    subtitle: "Staff who documented administrations this month",
    columns: [
      { header: "Staff", width: 220, value: (row) => row.staffName },
      { header: "Role", width: 110, value: (row) => roleLabel(row.staffRole) },
      { header: "Initials", width: 70, align: "center", value: (row) => row.initials },
      { header: "Administrations", width: 144, align: "right", value: (row) => String(row.administrationCount) }
    ],
    rows: report.staffAttribution,
    emptyMessage: "No staff administration records were found for this month."
  });

  drawSectionTitle(state, "Clinical Review Signoff");
  drawParagraph(state, "Reviewed by (RN/LPN): ________________________________________     Date: _____________________", {
    size: 9
  });
  drawParagraph(state, "Comments: __________________________________________________________________________________________", {
    size: 9
  });
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
      { header: "Medication", width: 150, value: (row) => row.medicationName },
      { header: "Reason", width: 96, value: (row) => row.reasonGiven ?? "-" },
      { header: "Outcome", width: 72, value: (row) => row.effectiveness },
      { header: "Follow-up", width: 132, value: (row) => row.followupDocumentation ?? "-" }
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
  } else if (report.reportType === "exceptions") {
    drawExceptionReport(state);
  } else {
    drawSummaryReport(state);
  }

  drawFooters(state);

  return Buffer.from(await pdf.save());
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
