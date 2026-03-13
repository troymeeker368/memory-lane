import "server-only";

import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";

import { createClient } from "@/lib/supabase/server";
import {
  DOCUMENT_CENTER_ADDRESS,
  DOCUMENT_CENTER_LOGO_PUBLIC_PATH,
  DOCUMENT_CENTER_NAME,
  DOCUMENT_CENTER_PHONE
} from "@/lib/services/document-branding";
import { getIntakeAssessmentSignatureState } from "@/lib/services/intake-assessment-esign";
import { toEasternDate, toEasternISO } from "@/lib/timezone";

type AssessmentSection = {
  section: string;
  rows: Array<{ label: string; value: string }>;
};

const PDF_EXCLUDED_SECTION_NAMES = new Set(["Lead Intake Context"]);
const PDF_EXCLUDED_FIELD_KEYS = new Set([
  "assessmentid",
  "admissionreviewrequired",
  "completed",
  "complete",
  "signeruserid",
  "signatureartifactstoragepath",
  "createdby",
  "createdat",
  "leadintakecontext"
]);
const PDF_SECTION_ORDER = [
  "Vital Signs",
  "Orientation & General Health",
  "Independence & Daily Routines",
  "Diet & Nutrition",
  "Mobility & Safety",
  "Social Engagement & Emotional Wellness",
  "Personal Notes & Joy Sparks",
  "Transportation Screening",
  "Scoring"
] as const;

function toNormalizedKey(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function toYesNo(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "yes" || normalized === "1") return "Yes";
  if (normalized === "false" || normalized === "no" || normalized === "0") return "No";
  return value.trim();
}

function isOrientedValue(value: string) {
  const resolved = toYesNo(value);
  if (!resolved) return "-";
  return resolved === "Yes" ? "oriented" : "not oriented";
}

function formatAssessmentRow(input: {
  fieldKey: string;
  fieldLabel: string;
  fieldValue: string;
}) {
  const normalizedFieldKey = toNormalizedKey(input.fieldKey);
  if (normalizedFieldKey === "orientationdobverified") {
    return { label: "DOB", value: isOrientedValue(input.fieldValue) };
  }
  if (normalizedFieldKey === "orientationcityverified") {
    return { label: "Town/City", value: isOrientedValue(input.fieldValue) };
  }
  if (normalizedFieldKey === "orientationcurrentyearverified" || normalizedFieldKey === "orientationyearverified") {
    return { label: "Current Year", value: isOrientedValue(input.fieldValue) };
  }
  if (
    normalizedFieldKey === "orientationformeroccupationverified" ||
    normalizedFieldKey === "orientationoccupationverified"
  ) {
    return { label: "Former Occupation", value: isOrientedValue(input.fieldValue) };
  }
  return {
    label: input.fieldLabel.trim() || input.fieldKey,
    value: input.fieldValue.trim().length > 0 ? input.fieldValue.trim() : "-"
  };
}

function sectionSortOrder(section: string) {
  const index = PDF_SECTION_ORDER.findIndex((entry) => entry === section);
  if (index >= 0) return index;
  return PDF_SECTION_ORDER.length + 1;
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

function drawWrappedText(input: {
  page: PDFPage;
  text: string;
  x: number;
  y: number;
  maxWidth: number;
  lineHeight: number;
  font: PDFFont;
  size: number;
  color?: ReturnType<typeof rgb>;
}) {
  const words = input.text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (input.font.widthOfTextAtSize(next, input.size) <= input.maxWidth) {
      current = next;
      return;
    }
    if (current) lines.push(current);
    current = word;
  });
  if (current) lines.push(current);

  let y = input.y;
  lines.forEach((line) => {
    input.page.drawText(line, {
      x: input.x,
      y,
      size: input.size,
      font: input.font,
      color: input.color ?? rgb(0.1, 0.1, 0.1)
    });
    y -= input.lineHeight;
  });
  return y;
}

function drawDocumentHeader(input: {
  page: PDFPage;
  font: PDFFont;
  fontBold: PDFFont;
  textColor: ReturnType<typeof rgb>;
  brandColor: ReturnType<typeof rgb>;
  logo: PDFImage | null;
  generatedAt: string;
}) {
  const { page, font, fontBold, textColor, brandColor, logo, generatedAt } = input;
  const pageWidth = page.getWidth();
  let y = 760;

  if (logo) {
    const logoHeight = 38;
    const scaled = logo.scale(logoHeight / logo.height);
    const logoWidth = Math.min(scaled.width, 160);
    page.drawImage(logo, {
      x: 36,
      y: y - logoHeight + 4,
      width: logoWidth,
      height: logoHeight
    });
  }

  const centerX = pageWidth / 2;
  page.drawText(DOCUMENT_CENTER_NAME, {
    x: centerX - fontBold.widthOfTextAtSize(DOCUMENT_CENTER_NAME, 14) / 2,
    y,
    size: 14,
    font: fontBold,
    color: brandColor
  });
  y -= 14;
  page.drawText(DOCUMENT_CENTER_ADDRESS, {
    x: centerX - font.widthOfTextAtSize(DOCUMENT_CENTER_ADDRESS, 9.5) / 2,
    y,
    size: 9.5,
    font,
    color: textColor
  });
  y -= 12;
  page.drawText(DOCUMENT_CENTER_PHONE, {
    x: centerX - font.widthOfTextAtSize(DOCUMENT_CENTER_PHONE, 9.5) / 2,
    y,
    size: 9.5,
    font,
    color: textColor
  });

  const generated = `Generated: ${generatedAt} (ET)`;
  page.drawText(generated, {
    x: pageWidth - font.widthOfTextAtSize(generated, 8.5) - 36,
    y: 760,
    size: 8.5,
    font,
    color: textColor
  });
  page.drawLine({
    start: { x: 36, y: 712 },
    end: { x: pageWidth - 36, y: 712 },
    color: rgb(0.75, 0.78, 0.84),
    thickness: 1
  });

  return 694;
}

async function groupedAssessmentSections(assessmentId: string): Promise<AssessmentSection[]> {
  const supabase = await createClient();
  const { data: responses, error: responsesError } = await supabase
    .from("assessment_responses")
    .select("field_key, field_label, section_type, field_value")
    .eq("assessment_id", assessmentId);
  if (responsesError) {
    throw new Error(`Unable to load assessment responses for PDF: ${responsesError.message}`);
  }

  const bySection = new Map<string, AssessmentSection>();
  (responses ?? []).forEach((row: any) => {
    const section = row.section_type?.trim() || "Other";
    if (PDF_EXCLUDED_SECTION_NAMES.has(section)) return;
    const fieldKey = String(row.field_key ?? "");
    const normalizedFieldKey = toNormalizedKey(fieldKey);
    if (PDF_EXCLUDED_FIELD_KEYS.has(normalizedFieldKey)) return;
    const rowValue = String(row.field_value ?? "");
    const formattedRow = formatAssessmentRow({
      fieldKey,
      fieldLabel: row.field_label?.trim() || row.field_key,
      fieldValue: rowValue
    });
    if (!bySection.has(section)) {
      bySection.set(section, { section, rows: [] });
    }
    bySection.get(section)?.rows.push({
      label: formattedRow.label,
      value: formattedRow.value
    });
  });

  return Array.from(bySection.values())
    .map((section) => ({
      ...section,
      rows: section.rows.sort((a, b) => a.label.localeCompare(b.label))
    }))
    .sort((a, b) => {
      const orderA = sectionSortOrder(a.section);
      const orderB = sectionSortOrder(b.section);
      if (orderA !== orderB) return orderA - orderB;
      return a.section.localeCompare(b.section);
    });
}

export async function buildIntakeAssessmentPdfDataUrl(assessmentId: string) {
  const supabase = await createClient();
  const { data: assessment, error: assessmentError } = await supabase
    .from("intake_assessments")
    .select("*, member:members!intake_assessments_member_id_fkey(display_name)")
    .eq("id", assessmentId)
    .maybeSingle();
  if (assessmentError) {
    throw new Error(`Unable to load intake assessment for PDF: ${assessmentError.message}`);
  }
  if (!assessment) {
    throw new Error("Intake assessment not found.");
  }
  const signature = await getIntakeAssessmentSignatureState(assessmentId);

  const generatedAt = toEasternISO();
  const sections = await groupedAssessmentSections(assessmentId);
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const text = rgb(0.1, 0.1, 0.1);
  const blue = rgb(0.09, 0.24, 0.55);
  const logo = await loadCenterLogoImage(pdf);

  const newPage = () => {
    const page = pdf.addPage([612, 792]);
    const yStart = drawDocumentHeader({
      page,
      font,
      fontBold,
      textColor: text,
      brandColor: blue,
      logo,
      generatedAt
    });
    return { page, y: yStart };
  };

  let { page, y } = newPage();
  page.drawText("Intake Assessment", { x: 36, y, size: 15, font: fontBold, color: blue });
  y -= 20;

  const summaryLines = [
    `Member: ${assessment.member?.display_name ?? "Unknown Member"}`,
    `Assessment Date: ${assessment.assessment_date}`
  ];

  summaryLines.forEach((line) => {
    if (y < 80) {
      const next = newPage();
      page = next.page;
      y = next.y;
    }
    y = drawWrappedText({
      page,
      text: line,
      x: 36,
      y,
      maxWidth: 540,
      lineHeight: 12,
      font,
      size: 10.5,
      color: text
    });
    y -= 4;
  });

  y -= 2;
  sections.forEach((section) => {
    if (y < 110) {
      const next = newPage();
      page = next.page;
      y = next.y;
    }

    page.drawText(section.section, { x: 36, y, size: 12, font: fontBold, color: blue });
    y -= 16;

    section.rows.forEach((row) => {
      if (y < 86) {
        const next = newPage();
        page = next.page;
        y = next.y;
        page.drawText(`${section.section} (continued)`, { x: 36, y, size: 11, font: fontBold, color: blue });
        y -= 14;
      }

      y = drawWrappedText({
        page,
        text: `${row.label}: ${row.value}`,
        x: 36,
        y,
        maxWidth: 540,
        lineHeight: 11,
        font,
        size: 9.8,
        color: text
      });
      y -= 2;
    });

    y -= 4;
  });

  const signedByDisplay = (signature.signedByName ?? assessment.signed_by ?? "").trim() || "-";
  const eSignLines = [
    `E-Sign Status: ${signature.status}`,
    `Signed By: ${signedByDisplay}`,
    `Signed At: ${signature.signedAt ?? "-"}`
  ];
  eSignLines.forEach((line) => {
    if (y < 80) {
      const next = newPage();
      page = next.page;
      y = next.y;
    }
    y = drawWrappedText({
      page,
      text: line,
      x: 36,
      y,
      maxWidth: 540,
      lineHeight: 12,
      font,
      size: 10.5,
      color: text
    });
    y -= 4;
  });

  const bytes = await pdf.save();
  const dataUrl = `data:application/pdf;base64,${Buffer.from(bytes).toString("base64")}`;
  const fileName = `Intake Assessment - ${safeFileName(assessment.member?.display_name ?? "Unknown Member")} - ${toEasternDate(generatedAt)}.pdf`;

  return {
    assessment,
    generatedAt,
    fileName,
    dataUrl
  };
}
