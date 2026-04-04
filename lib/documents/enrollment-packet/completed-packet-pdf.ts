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
import { formatPhoneDisplay } from "@/lib/phone";
import { toEasternDate, toEasternISO } from "@/lib/timezone";
import { buildEnrollmentPacketLegalText } from "@/lib/services/enrollment-packet-legal-text";
import { type EnrollmentPacketIntakePayload } from "@/lib/services/enrollment-packet-intake-payload";
import { formatEnrollmentPacketRecreationInterests } from "@/lib/services/enrollment-packet-recreation";
import type { EnrollmentPacketUploadCategory } from "@/lib/services/enrollment-packet-types";

type CompletedEnrollmentPacketDocxInput = {
  memberName: string;
  packetId: string;
  requestedDays: string[];
  transportation: string | null;
  communityFee: number;
  dailyRate: number;
  caregiverName: string | null;
  caregiverPhone: string | null;
  caregiverEmail: string | null;
  caregiverAddressLine1: string | null;
  caregiverAddressLine2: string | null;
  caregiverCity: string | null;
  caregiverState: string | null;
  caregiverZip: string | null;
  secondaryContactName: string | null;
  secondaryContactPhone: string | null;
  secondaryContactEmail: string | null;
  secondaryContactRelationship: string | null;
  intakePayload: EnrollmentPacketIntakePayload;
  senderSignatureName: string;
  caregiverSignatureName: string;
  uploadedDocuments: Array<{
    category: EnrollmentPacketUploadCategory;
    fileName: string;
  }>;
};

const DOCUMENT_CENTER_FAX = "844-308-7996";
const DOCUMENT_CENTER_WEBSITE = "www.townsquare.net/fortmill";
const FORM_TEXT_COLOR = rgb(0.18, 0.22, 0.29);
const FORM_MUTED_COLOR = rgb(0.43, 0.49, 0.57);
const FORM_BORDER_COLOR = rgb(0.78, 0.82, 0.88);
const WEEKDAY_OPTIONS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as const;
const WELCOME_CHECKLIST_DOCUMENTS = [
  "Welcome Guide",
  "Face Sheet and Biography",
  "Membership Agreement & Exhibit A",
  "Notice of Privacy Practices",
  "Statement of Rights of Adult Day Care Participants",
  "Photo Consent",
  "Ancillary Charges Notice",
  "Insurance and POA Upload"
] as const;
const WELCOME_PRIOR_FIRST_DAY_ITEMS = [
  "Copy of insurance cards (can be uploaded in Memory Lane)",
  "Copy of POA or guardianship paperwork (if applicable, can be uploaded in Memory Lane)"
] as const;
const WELCOME_FIRST_DAY_ITEMS = [
  "Change of clothes labeled with the member's name",
  "Medications in labeled prescription bottles (if applicable)",
  "Personal care products such as incontinence items, wipes, or toiletries (if applicable)"
] as const;

function clean(value: string | null | undefined, fallback = "-") {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : fallback;
}

function moneyValue(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "$0.00";
  return `$${value.toFixed(2)}`;
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

export function splitEnrollmentPacketFieldValueRows(inputText: string, maxChars = 105) {
  const normalized = inputText.trim();
  if (!normalized) return ["-"];
  const lines: string[] = [];
  let current = "";

  for (const char of normalized) {
    const next = `${current}${char}`;
    if (!current || next.length <= maxChars) {
      current = next;
      continue;
    }

    lines.push(current);
    current = char;
  }

  if (current) lines.push(current);
  return lines.length > 0 ? lines : ["-"];
}

function wrapText(text: string, maxChars = 105) {
  return splitEnrollmentPacketFieldValueRows(text, maxChars);
}

function cleanPhone(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "-";
  return formatPhoneDisplay(normalized) || normalized;
}

function compactJoin(values: Array<string | null | undefined>, separator = ", ") {
  const normalized = values.map((value) => clean(value, "")).filter(Boolean);
  return normalized.length > 0 ? normalized.join(separator) : "-";
}

function checkboxMark(selected: boolean) {
  return selected ? "[x]" : "[ ]";
}

function radioLine(input: {
  selectedValue: string | null | undefined;
  options: readonly string[];
}) {
  const selected = clean(input.selectedValue, "");
  return input.options.map((option) => `${checkboxMark(selected === option)} ${option}`).join("    ");
}

function checkboxLine(input: {
  selectedValues: readonly string[];
  options: readonly string[];
}) {
  const selected = new Set(input.selectedValues.map((value) => clean(value, "")).filter(Boolean));
  return input.options.map((option) => `${checkboxMark(selected.has(option))} ${option}`).join("    ");
}

function normalizeBulletParagraph(text: string) {
  return text
    .replace(/^\s*/u, "• ")
    .replace(/^o\s+/u, "• ")
    .replace(/^\u25aa\s*/u, "• ");
}

function groupedUploadNames(input: {
  uploadedDocuments: Array<{ category: EnrollmentPacketUploadCategory; fileName: string }>;
  categories: EnrollmentPacketUploadCategory[];
}) {
  const matched = input.uploadedDocuments
    .filter((document) => input.categories.includes(document.category))
    .map((document) => clean(document.fileName, ""))
    .filter(Boolean);
  return matched.length > 0 ? matched.join(", ") : "Not provided";
}

function hasUploadedDocuments(input: {
  uploadedDocuments: Array<{ category: EnrollmentPacketUploadCategory; fileName: string }>;
  categories: EnrollmentPacketUploadCategory[];
}) {
  return input.uploadedDocuments.some((document) => input.categories.includes(document.category));
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
  const normalized = input.text.trim();
  if (!normalized) return input.y;

  const lines: string[] = [];
  let current = "";

  for (const char of normalized) {
    const next = `${current}${char}`;
    if (!current || input.font.widthOfTextAtSize(next, input.size) <= input.maxWidth) {
      current = next;
      continue;
    }
    lines.push(current);
    current = char;
  }
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
    const logoHeight = 44;
    const scaled = logo.scale(logoHeight / logo.height);
    const logoWidth = Math.min(scaled.width, 170);
    page.drawImage(logo, {
      x: 36,
      y: y - logoHeight + 4,
      width: logoWidth,
      height: logoHeight
    });
  }

  page.drawText(DOCUMENT_CENTER_NAME.toUpperCase(), {
    x: 210,
    y: 758,
    size: 17,
    font: fontBold,
    color: brandColor
  });
  page.drawText("Fort Mill", {
    x: 210,
    y: 740,
    size: 13,
    font: fontBold,
    color: brandColor
  });

  const centerDetailLine = `${DOCUMENT_CENTER_ADDRESS} | Phone: ${DOCUMENT_CENTER_PHONE} | Fax: ${DOCUMENT_CENTER_FAX} | ${DOCUMENT_CENTER_WEBSITE}`;
  page.drawText(centerDetailLine, {
    x: 36,
    y: 712,
    size: 8.5,
    font,
    color: textColor
  });

  const generated = `Generated: ${generatedAt} (ET)`;
  page.drawText(generated, {
    x: pageWidth - font.widthOfTextAtSize(generated, 8.5) - 36,
    y: 758,
    size: 8.5,
    font,
    color: textColor
  });
  page.drawLine({
    start: { x: 36, y: 700 },
    end: { x: pageWidth - 36, y: 700 },
    color: FORM_BORDER_COLOR,
    thickness: 1
  });

  return 680;
}

export async function buildCompletedEnrollmentPacketDocxData(input: CompletedEnrollmentPacketDocxInput) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const now = toEasternISO();
  const textColor = FORM_TEXT_COLOR;
  const blue = rgb(0.09, 0.24, 0.55);
  const logo = await loadCenterLogoImage(pdf);

  const newPage = () => {
    const page = pdf.addPage([612, 792]);
    const y = drawDocumentHeader({
      page,
      font: regular,
      fontBold: bold,
      textColor,
      brandColor: blue,
      logo,
      generatedAt: now
    });
    return { page, y };
  };

  let { page, y } = newPage();
  let hasDrawnDocument = false;

  const ensureSpace = (minimumY = 72) => {
    if (y >= minimumY) return;
    const next = newPage();
    page = next.page;
    y = next.y;
  };

  const startDocument = (title: string, subtitle?: string) => {
    if (hasDrawnDocument) {
      const next = newPage();
      page = next.page;
      y = next.y;
    } else {
      hasDrawnDocument = true;
    }

    page.drawText(title, { x: 36, y, size: 18, font: bold, color: blue });
    y -= 22;
    if (subtitle) {
      y =
        drawWrappedText({
          page,
          text: subtitle,
          x: 36,
          y,
          maxWidth: 540,
          lineHeight: 12,
          font: regular,
          size: 9,
          color: FORM_MUTED_COLOR
        }) - 6;
    }
    page.drawLine({
      start: { x: 36, y },
      end: { x: 576, y },
      color: FORM_BORDER_COLOR,
      thickness: 1
    });
    y -= 14;
  };

  const drawHeroLogo = () => {
    if (!logo) return;
    ensureSpace(250);
    const targetHeight = 150;
    const scaled = logo.scale(targetHeight / logo.height);
    const width = Math.min(scaled.width, 280);
    const height = (logo.height / logo.width) * width;
    page.drawImage(logo, {
      x: (page.getWidth() - width) / 2,
      y: y - height + 6,
      width,
      height
    });
    y -= height + 14;
  };

  const drawSectionHeading = (text: string) => {
    ensureSpace(96);
    page.drawText(text, { x: 36, y, size: 11, font: bold, color: blue });
    y -= 14;
  };

  const drawParagraph = (text: string, indent = 36) => {
    ensureSpace(90);
    y =
      drawWrappedText({
        page,
        text,
        x: indent,
        y,
        maxWidth: 576 - indent,
        lineHeight: 12,
        font: regular,
        size: 9.25,
        color: textColor
      }) - 4;
  };

  const drawBulletParagraph = (text: string, bullet = "•") => {
    ensureSpace(90);
    page.drawText(bullet, { x: 42, y, size: 10, font: bold, color: textColor });
    y =
      drawWrappedText({
        page,
        text: text.trim(),
        x: 56,
        y,
        maxWidth: 520,
        lineHeight: 12,
        font: regular,
        size: 9.25,
        color: textColor
      }) - 4;
  };

  const drawChecklistLine = (input: {
    label: string;
    checked?: boolean;
    details?: string | null;
    indent?: number;
  }) => {
    ensureSpace(84);
    const marker = checkboxMark(Boolean(input.checked));
    const prefix = `${marker} ${input.label}`;
    const detailText = clean(input.details, "");
    const body = detailText ? `${prefix}: ${detailText}` : prefix;
    y =
      drawWrappedText({
        page,
        text: body,
        x: input.indent ?? 48,
        y,
        maxWidth: 528,
        lineHeight: 12,
        font: regular,
        size: 9.25,
        color: textColor
      }) - 4;
  };

  const drawFieldLine = (label: string, value: string, bullet = "•") => {
    ensureSpace(84);
    const normalizedValue = clean(value);
    const labelText = `${bullet} ${label}:`;
    const labelWidth = bold.widthOfTextAtSize(labelText, 9.25);
    const valueX = 42 + labelWidth;
    const valueLines = wrapText(normalizedValue, 70);
    page.drawText(labelText, { x: 36, y, size: 9.25, font: bold, color: textColor });
    page.drawLine({
      start: { x: valueX, y: y + 2 },
      end: { x: 576, y: y + 2 },
      color: FORM_BORDER_COLOR,
      thickness: 1
    });
    page.drawText(valueLines[0] ?? "-", {
      x: valueX + 4,
      y: y + 4,
      size: 9.25,
      font: regular,
      color: textColor
    });
    y -= 14;
    if (valueLines.length > 1) {
      valueLines.slice(1).forEach((line) => {
        ensureSpace(84);
        page.drawLine({
          start: { x: valueX, y: y + 2 },
          end: { x: 576, y: y + 2 },
          color: FORM_BORDER_COLOR,
          thickness: 1
        });
        page.drawText(line, {
          x: valueX + 4,
          y: y + 4,
          size: 9.25,
          font: regular,
          color: textColor
        });
        y -= 14;
      });
    }
    y -= 2;
  };

  const drawSignatureBlock = (label: string, signatureName: string | null | undefined, signatureDate: string | null | undefined) => {
    ensureSpace(110);
    page.drawText(label, { x: 36, y, size: 10, font: bold, color: blue });
    y -= 16;
    page.drawText("Signature:", { x: 36, y, size: 9, font: bold, color: textColor });
    page.drawLine({
      start: { x: 94, y: y + 2 },
      end: { x: 320, y: y + 2 },
      color: FORM_BORDER_COLOR,
      thickness: 1
    });
    page.drawText(clean(signatureName), { x: 98, y: y + 4, size: 9, font: regular, color: textColor });
    page.drawText("Date:", { x: 352, y, size: 9, font: bold, color: textColor });
    page.drawLine({
      start: { x: 388, y: y + 2 },
      end: { x: 520, y: y + 2 },
      color: FORM_BORDER_COLOR,
      thickness: 1
    });
    page.drawText(clean(signatureDate), { x: 392, y: y + 4, size: 9, font: regular, color: textColor });
    y -= 18;
  };

  const drawLegalParagraphs = (paragraphs: readonly string[]) => {
    paragraphs.forEach((paragraph) => {
      const normalized = normalizeBulletParagraph(paragraph).trim();
      if (!normalized) return;
      if (/^[A-Z][A-Z\s&/'-]+:?$/u.test(normalized) && normalized.length < 90) {
        drawSectionHeading(normalized);
        return;
      }
      if (normalized.startsWith("• ")) {
        drawBulletParagraph(normalized.slice(2));
        return;
      }
      drawParagraph(normalized);
    });
  };

  const legalText = buildEnrollmentPacketLegalText({
    caregiverName: input.intakePayload.membershipGuarantorSignatureName ?? input.caregiverSignatureName,
    memberName: input.memberName,
    membershipSignatureName: input.intakePayload.membershipGuarantorSignatureName,
    membershipSignatureDate: input.intakePayload.membershipGuarantorSignatureDate,
    paymentMethodSelection: input.intakePayload.paymentMethodSelection,
    communityFee: input.intakePayload.communityFee,
    totalInitialEnrollmentAmount: input.intakePayload.totalInitialEnrollmentAmount,
    photoConsentChoice: input.intakePayload.photoConsentChoice
  });
  const primaryContactAddress = compactJoin([
    input.caregiverAddressLine1,
    input.caregiverAddressLine2,
    compactJoin([input.caregiverCity, input.caregiverState, input.caregiverZip], " ")
  ]);
  const secondaryContactAddress = compactJoin([
    input.intakePayload.secondaryContactAddressLine1 ?? input.intakePayload.secondaryContactAddress,
    compactJoin([
      input.intakePayload.secondaryContactCity,
      input.intakePayload.secondaryContactState,
      input.intakePayload.secondaryContactZip
    ], " ")
  ]);

  startDocument("1. Welcome Checklist");
  drawHeroLogo();
  drawParagraph("We are looking forward to seeing you at Town Square!");
  drawParagraph(
    "Town Square Fort Mill is a licensed Adult Day Center within South Carolina. To remain compliant with state regulations and to better know our new member, this finalized packet follows the same document order and formatting style as the current enrollment forms."
  );
  WELCOME_CHECKLIST_DOCUMENTS.forEach((item) =>
    drawChecklistLine({
      label: item,
      checked: true
    })
  );
  drawSectionHeading("Items needed prior to first day at the center");
  WELCOME_PRIOR_FIRST_DAY_ITEMS.forEach((item) =>
    drawChecklistLine({
      label: item,
      checked: true,
      indent: 60
    })
  );
  drawSectionHeading("Items needed on first day at the center");
  WELCOME_FIRST_DAY_ITEMS.forEach((item) =>
    drawChecklistLine({
      label: item,
      checked: false,
      indent: 60
    })
  );
  drawParagraph(
    "If you have any questions or concerns about completing the forms, please do not hesitate to contact the center and a staff member will be available to assist you."
  );

  startDocument(
    "2. New Member Face Sheet & Biography",
    `Completed packet for ${clean(input.memberName)} on ${toEasternDate(now)}`
  );
  drawSectionHeading("Member Information");
  drawFieldLine("Member First Name", clean(input.intakePayload.memberLegalFirstName));
  drawFieldLine("Member Last Name", clean(input.intakePayload.memberLegalLastName));
  drawFieldLine("Preferred Name", clean(input.intakePayload.memberPreferredName));
  drawFieldLine("Date of Birth", clean(input.intakePayload.memberDob));
  drawFieldLine("Gender", clean(input.intakePayload.memberGender));
  drawFieldLine("Social Security Number", clean(input.intakePayload.memberSsnLast4));
  drawFieldLine("Marital Status", clean(input.intakePayload.maritalStatus));
  drawFieldLine(
    "Address",
    compactJoin([
      input.intakePayload.memberAddressLine1,
      input.intakePayload.memberAddressLine2,
      compactJoin([input.intakePayload.memberCity, input.intakePayload.memberState, input.intakePayload.memberZip], " ")
    ])
  );

  drawSectionHeading("Schedule & Transportation");
  drawFieldLine("Requested Start Date", clean(input.intakePayload.requestedStartDate));
  drawFieldLine(
    "Days Attending",
    checkboxLine({ selectedValues: input.requestedDays, options: WEEKDAY_OPTIONS })
  );
  drawFieldLine("Transportation Needed", clean(input.transportation));

  drawSectionHeading("Insurance & Payment");
  drawFieldLine("Medicare #", clean(input.intakePayload.medicareNumber));
  drawFieldLine(
    "Private Insurance Name & Policy #",
    compactJoin([input.intakePayload.privateInsuranceName, input.intakePayload.privateInsurancePolicyNumber], " / ")
  );
  drawFieldLine("Veteran's Benefits", radioLine({ selectedValue: input.intakePayload.vaBenefits, options: ["Yes", "No"] }));
  drawFieldLine(
    "Member Representative / Guardian or POA",
    compactJoin([input.intakePayload.memberRepresentativeGuardianPoa, input.intakePayload.guardianPoaStatus], " / ")
  );
  drawFieldLine("Referred By", clean(input.intakePayload.referredBy));

  drawSectionHeading("Emergency & Contact Information");
  drawFieldLine("Primary Contact Name", clean(input.intakePayload.primaryContactName));
  drawFieldLine("Primary Contact Relationship", clean(input.intakePayload.primaryContactRelationship));
  drawFieldLine("Primary Contact Phone", cleanPhone(input.intakePayload.primaryContactPhone));
  drawFieldLine("Primary Contact Email", clean(input.intakePayload.primaryContactEmail));
  drawFieldLine("Primary Contact Address", primaryContactAddress);
  drawFieldLine("Secondary Contact Name", clean(input.secondaryContactName));
  drawFieldLine("Secondary Contact Relationship", clean(input.secondaryContactRelationship));
  drawFieldLine("Secondary Contact Phone", cleanPhone(input.secondaryContactPhone));
  drawFieldLine("Secondary Contact Email", clean(input.secondaryContactEmail));
  drawFieldLine("Secondary Contact Address", secondaryContactAddress);

  drawSectionHeading("Care Coordination");
  drawFieldLine("Primary Care Physician", clean(input.intakePayload.pcpName));
  drawFieldLine("PCP Phone", cleanPhone(input.intakePayload.pcpPhone));
  drawFieldLine("PCP Address", clean(input.intakePayload.pcpAddress));
  drawFieldLine("PCP Fax", cleanPhone(input.intakePayload.pcpFax));
  drawFieldLine("Preferred Hospital", clean(input.intakePayload.hospitalPreference));
  drawFieldLine("Other Physician(s)", clean(input.intakePayload.physicianName));
  drawFieldLine("Pharmacy", clean(input.intakePayload.pharmacy));
  drawFieldLine("Pharmacy Phone", cleanPhone(input.intakePayload.pharmacyPhone));
  drawFieldLine("Pharmacy Address", clean(input.intakePayload.pharmacyAddress));

  drawSectionHeading("Living Situation");
  drawFieldLine(
    "Living Situation",
    compactJoin([...(input.intakePayload.livingSituationOptions ?? []), input.intakePayload.livingSituationOther])
  );
  drawFieldLine("Pets", compactJoin([...(input.intakePayload.petTypes ?? []), input.intakePayload.petNames]));

  drawSectionHeading("Health & Abilities");
  drawFieldLine(
    "Medication Needed During Day",
    radioLine({ selectedValue: input.intakePayload.medicationNeededDuringDay, options: ["Yes", "No"] })
  );
  drawFieldLine("Medication Names", clean(input.intakePayload.medicationNamesDuringDay));
  drawFieldLine("Uses Oxygen Daily", radioLine({ selectedValue: input.intakePayload.oxygenUse, options: ["Yes", "No"] }));
  drawFieldLine("Oxygen Flow Rate", clean(input.intakePayload.oxygenFlowRate));
  drawFieldLine(
    "Mental Health / PTSD History",
    compactJoin([input.intakePayload.mentalHealthHistory, input.intakePayload.ptsdHistory])
  );
  drawFieldLine("Memory Stage", clean(input.intakePayload.memoryStage));
  drawFieldLine("Behavioral Notes", clean(input.intakePayload.behavioralNotes));
  drawFieldLine("History of Falls", radioLine({ selectedValue: input.intakePayload.fallsHistory, options: ["Yes", "No"] }));
  drawFieldLine(
    "Falls Within Last 3 Months",
    radioLine({ selectedValue: input.intakePayload.fallsWithinLast3Months, options: ["Yes", "No"] })
  );
  drawFieldLine("Physical Health Problems", clean(input.intakePayload.physicalHealthProblems));
  drawFieldLine("Communication Style", clean(input.intakePayload.communicationStyle));

  drawSectionHeading("Activities of Daily Living");
  drawFieldLine("Walking / Transferring", compactJoin([input.intakePayload.adlMobilityLevel, input.intakePayload.adlTransferLevel], " / "));
  drawFieldLine("Uses Cane / Walker", clean(input.intakePayload.caneWalkerUse));
  drawFieldLine("Uses Wheelchair", clean(input.intakePayload.wheelchairUse));
  drawFieldLine("Toileting / Bathing", compactJoin([input.intakePayload.adlToiletingLevel, input.intakePayload.adlBathingLevel], " / "));
  drawFieldLine("Incontinent", compactJoin(input.intakePayload.continenceSelections ?? []));
  drawFieldLine("Incontinence Products", clean(input.intakePayload.incontinenceProducts));
  drawFieldLine("Dresses Self / Feeds Self", compactJoin([input.intakePayload.adlDressingLevel, input.intakePayload.adlEatingLevel], " / "));
  drawFieldLine("Dietary Restrictions", clean(input.intakePayload.dietaryRestrictions));
  drawFieldLine(
    "Wears Dentures",
    compactJoin([input.intakePayload.dentures, compactJoin(input.intakePayload.dentureTypes ?? [])])
  );
  drawFieldLine("Speech", clean(input.intakePayload.speech));
  drawFieldLine("Hearing", clean(input.intakePayload.hearingStatus));
  drawFieldLine("Hearing Aids", clean(input.intakePayload.hearingAids));
  drawFieldLine("Vision", clean(input.intakePayload.vision));
  drawFieldLine("Glasses", clean(input.intakePayload.glasses));
  drawFieldLine("Cataracts", clean(input.intakePayload.cataracts));

  drawSectionHeading("Home Environment");
  drawFieldLine("Steps Outside / Inside", compactJoin([input.intakePayload.stepsOutside, input.intakePayload.stepsInside], " / "));
  drawFieldLine("Bed & Bath on Same Floor", clean(input.intakePayload.bedBathSameFloor));
  drawFieldLine("Safety Bars in Bathroom", clean(input.intakePayload.safetyBars));
  drawFieldLine("Uses Shower Chair", clean(input.intakePayload.showerChair));

  drawSectionHeading("Background & Preferences");
  drawFieldLine("Spouse / Partner Name", clean(input.intakePayload.spousePartner));
  drawFieldLine("Children / Grandchildren", clean(input.intakePayload.childrenGrandchildren));
  drawFieldLine("Important People", clean(input.intakePayload.importantPeople));
  drawFieldLine("Religion", clean(input.intakePayload.religion));
  drawFieldLine("Past Occupation", clean(input.intakePayload.pastOccupation));
  drawFieldLine("Favorite Activities / Preferences", compactJoin([
    input.intakePayload.favoriteHobby,
    input.intakePayload.favoriteMusic,
    input.intakePayload.favoriteMovie,
    input.intakePayload.favoriteBook,
    input.intakePayload.favoritePlace,
    input.intakePayload.favoriteColor,
    input.intakePayload.favoriteSport,
    input.intakePayload.favoriteExercise,
    input.intakePayload.favoriteSeason
  ]));
  drawFieldLine("Recreation Interests", formatEnrollmentPacketRecreationInterests(input.intakePayload.recreationInterests));

  startDocument("3. Membership Agreement");
  drawLegalParagraphs(legalText.membershipAgreement);
  drawSignatureBlock(
    "Responsible Party / Guarantor Acknowledgement",
    input.intakePayload.membershipGuarantorSignatureName,
    input.intakePayload.membershipGuarantorSignatureDate
  );

  startDocument("3A. Membership Agreement Exhibit A");
  drawLegalParagraphs(legalText.exhibitAPaymentAuthorizationCommon);
  drawSectionHeading("Payment Method Selection");
  drawFieldLine(
    "Selected Payment Method",
    radioLine({
      selectedValue: input.intakePayload.paymentMethodSelection,
      options: ["ACH", "Credit Card"]
    })
  );
  if ((input.intakePayload.paymentMethodSelection ?? "").trim() === "ACH") {
    drawSectionHeading("Recorded ACH Information");
    drawFieldLine("Bank Name", clean(input.intakePayload.bankName));
    drawFieldLine("City, State, Zip", clean(input.intakePayload.bankCityStateZip));
    drawFieldLine("Bank Transit / ABA #", clean(input.intakePayload.bankAba));
    drawFieldLine("Account #", clean(input.intakePayload.bankAccountNumber));
  } else if ((input.intakePayload.paymentMethodSelection ?? "").trim() === "Credit Card") {
    drawSectionHeading("Recorded Credit Card Information");
    drawFieldLine("Cardholder Name", clean(input.intakePayload.cardholderName));
    drawFieldLine("Card Type", clean(input.intakePayload.cardType));
    drawFieldLine("Card Number", clean(input.intakePayload.cardNumber));
    drawFieldLine("Expiration Date", clean(input.intakePayload.cardExpiration));
    drawFieldLine("CVV", clean(input.intakePayload.cardCvv));
    drawFieldLine(
      "Billing Address",
      compactJoin([
        input.intakePayload.cardBillingAddressLine1 ?? input.intakePayload.cardBillingAddress,
        compactJoin([
          input.intakePayload.cardBillingCity,
          input.intakePayload.cardBillingState,
          input.intakePayload.cardBillingZip
        ], " ")
      ])
    );
  }
  drawLegalParagraphs(legalText.exhibitAPaymentAuthorizationSelected);
  drawSignatureBlock(
    "Guarantor Acknowledgement",
    input.intakePayload.exhibitAGuarantorSignatureName,
    input.intakePayload.membershipGuarantorSignatureDate
  );

  startDocument("4. Notice of Privacy Practices");
  drawLegalParagraphs(legalText.privacyPractices);
  drawSignatureBlock(
    "Privacy Practices Acknowledgement",
    input.intakePayload.privacyAcknowledgmentSignatureName,
    input.intakePayload.privacyAcknowledgmentSignatureDate
  );

  startDocument("5. Statement of Rights of Adult Day Care Participants");
  drawLegalParagraphs(legalText.statementOfRights);
  drawSignatureBlock(
    "Statement of Rights Acknowledgement",
    input.intakePayload.rightsAcknowledgmentSignatureName,
    input.intakePayload.rightsAcknowledgmentSignatureDate
  );

  startDocument("6. Photo Consent");
  drawFieldLine(
    "Selected Consent",
    radioLine({
      selectedValue:
        input.intakePayload.photoConsentChoice === "Do Permit"
          ? "I do permit"
          : input.intakePayload.photoConsentChoice === "Do Not Permit"
            ? "I do not permit"
            : null,
      options: ["I do permit", "I do not permit"]
    })
  );
  drawLegalParagraphs(legalText.photoConsent);
  drawSignatureBlock(
    "Responsible Party / Guarantor",
    input.intakePayload.membershipGuarantorSignatureName,
    input.intakePayload.membershipGuarantorSignatureDate
  );

  startDocument("7. Ancillary Charges Notice");
  drawLegalParagraphs(legalText.ancillaryCharges);
  drawSignatureBlock(
    "Responsible Party / Guarantor",
    input.intakePayload.ancillaryChargesAcknowledgmentSignatureName,
    input.intakePayload.ancillaryChargesAcknowledgmentSignatureDate
  );
  drawFieldLine("Member Name", clean(input.memberName));

  startDocument("8. Insurance and POA Upload");
  drawParagraph("The following uploaded items were attached in Memory Lane and preserved with this completed enrollment packet.");
  drawChecklistLine({
    label: "Medicare card",
    checked: hasUploadedDocuments({ uploadedDocuments: input.uploadedDocuments, categories: ["medicare_card"] }),
    details: groupedUploadNames({ uploadedDocuments: input.uploadedDocuments, categories: ["medicare_card"] })
  });
  drawChecklistLine({
    label: "Private insurance cards",
    checked: hasUploadedDocuments({ uploadedDocuments: input.uploadedDocuments, categories: ["private_insurance"] }),
    details: groupedUploadNames({ uploadedDocuments: input.uploadedDocuments, categories: ["private_insurance"] })
  });
  drawChecklistLine({
    label: "Secondary / supplemental insurance cards",
    checked: hasUploadedDocuments({ uploadedDocuments: input.uploadedDocuments, categories: ["supplemental_insurance"] }),
    details: groupedUploadNames({ uploadedDocuments: input.uploadedDocuments, categories: ["supplemental_insurance"] })
  });
  drawChecklistLine({
    label: "POA / guardianship paperwork",
    checked: hasUploadedDocuments({ uploadedDocuments: input.uploadedDocuments, categories: ["poa", "poa_guardianship"] }),
    details: groupedUploadNames({ uploadedDocuments: input.uploadedDocuments, categories: ["poa", "poa_guardianship"] })
  });
  drawChecklistLine({
    label: "DNR / DNI / advance directive paperwork",
    checked: hasUploadedDocuments({
      uploadedDocuments: input.uploadedDocuments,
      categories: ["dnr_dni_advance_directive"]
    }),
    details: groupedUploadNames({
      uploadedDocuments: input.uploadedDocuments,
      categories: ["dnr_dni_advance_directive"]
    })
  });
  drawChecklistLine({
    label: "Additional supporting documents",
    checked: hasUploadedDocuments({ uploadedDocuments: input.uploadedDocuments, categories: ["insurance", "supporting"] }),
    details: groupedUploadNames({ uploadedDocuments: input.uploadedDocuments, categories: ["insurance", "supporting"] })
  });

  startDocument("9. Memory Lane Completion Summary");
  drawFieldLine("Packet ID", clean(input.packetId));
  drawFieldLine("Completed At (ET)", `${toEasternDate(now)} ${now.slice(11, 19)}`);
  drawFieldLine("Requested Days", input.requestedDays.length > 0 ? input.requestedDays.join(", ") : "-");
  drawFieldLine("Transportation", clean(input.transportation));
  drawFieldLine("Community Fee", moneyValue(input.communityFee));
  drawFieldLine("Daily Rate", moneyValue(input.dailyRate));
  drawFieldLine("Primary Contact", clean(input.caregiverName));
  drawFieldLine("Primary Contact Phone", cleanPhone(input.caregiverPhone));
  drawFieldLine("Primary Contact Email", clean(input.caregiverEmail));
  drawFieldLine("Primary Contact Address", primaryContactAddress);
  drawFieldLine("Secondary Contact", clean(input.secondaryContactName));
  drawFieldLine("Secondary Contact Phone", cleanPhone(input.secondaryContactPhone));
  drawFieldLine("Recreation Interests", formatEnrollmentPacketRecreationInterests(input.intakePayload.recreationInterests));
  drawSignatureBlock("Sender Signature Applied", input.senderSignatureName, toEasternDate(now));
  drawSignatureBlock("Caregiver Signature Applied", input.caregiverSignatureName, clean(input.intakePayload.guarantorSignatureDate, toEasternDate(now)));

  const bytes = Buffer.from(await pdf.save());
  return {
    bytes,
    contentType: "application/pdf",
    dataUrl: `data:application/pdf;base64,${bytes.toString("base64")}`,
    fileName: `Enrollment Packet Completed - ${safeFileName(input.memberName)} - ${toEasternDate(now)}.pdf`
  };
}
