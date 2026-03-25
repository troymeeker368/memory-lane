import "server-only";

import { Buffer } from "node:buffer";

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { formatPhoneDisplay } from "@/lib/phone";
import { toEasternDate, toEasternISO } from "@/lib/timezone";
import { buildEnrollmentPacketLegalText } from "@/lib/services/enrollment-packet-legal-text";
import {
  ENROLLMENT_PACKET_INTAKE_ARRAY_KEYS,
  ENROLLMENT_PACKET_INTAKE_TEXT_KEYS,
  type EnrollmentPacketIntakePayload
} from "@/lib/services/enrollment-packet-intake-payload";
import {
  ENROLLMENT_PACKET_SECTIONS,
  formatEnrollmentPacketValue
} from "@/lib/services/enrollment-packet-public-schema";
import { formatEnrollmentPacketRecreationInterests } from "@/lib/services/enrollment-packet-recreation";

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
};

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

function wrapText(text: string, maxChars = 105) {
  const normalized = text.trim();
  if (!normalized) return ["-"];
  const words = normalized.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars) {
      current = next;
      return;
    }
    if (current) lines.push(current);
    current = word;
  });
  if (current) lines.push(current);
  return lines.length > 0 ? lines : ["-"];
}

function toTitleCaseFromKey(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (value) => value.toUpperCase());
}

function displayPacketFieldValue(
  payload: EnrollmentPacketIntakePayload,
  key: (typeof ENROLLMENT_PACKET_INTAKE_TEXT_KEYS)[number] | (typeof ENROLLMENT_PACKET_INTAKE_ARRAY_KEYS)[number]
) {
  const raw = payload[key];
  if (Array.isArray(raw)) {
    return raw.length > 0 ? raw.join(", ") : "-";
  }

  if (typeof raw !== "string") return "-";
  const normalized = raw.trim();
  if (!normalized) return "-";

  if (
    key === "primaryContactPhone" ||
    key === "secondaryContactPhone" ||
    key === "pcpPhone" ||
    key === "pharmacyPhone" ||
    key === "pcpFax" ||
    key === "physicianPhone" ||
    key === "physicianFax"
  ) {
    return formatPhoneDisplay(normalized) || normalized;
  }

  return normalized;
}

export async function buildCompletedEnrollmentPacketDocxData(input: CompletedEnrollmentPacketDocxInput) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const now = toEasternISO();

  let page = pdf.addPage([612, 792]);
  let y = 756;

  const drawTitle = (text: string) => {
    if (y < 70) {
      page = pdf.addPage([612, 792]);
      y = 756;
    }
    page.drawText(text, { x: 36, y, size: 14, font: bold, color: rgb(0.1, 0.22, 0.49) });
    y -= 20;
  };

  const drawRow = (label: string, value: string) => {
    if (y < 70) {
      page = pdf.addPage([612, 792]);
      y = 756;
    }
    const lines = wrapText(value, 90);
    page.drawText(`${label}:`, { x: 36, y, size: 9, font: bold, color: rgb(0.1, 0.1, 0.1) });
    lines.forEach((line, index) => {
      page.drawText(line, { x: 200, y: y - index * 12, size: 9, font: regular, color: rgb(0.1, 0.1, 0.1) });
    });
    y -= Math.max(14, lines.length * 12 + 2);
  };

  const drawParagraph = (text: string) => {
    const lines = wrapText(text, 105);
    let currentY = y;
    lines.forEach((line) => {
      if (currentY < 70) {
        page = pdf.addPage([612, 792]);
        currentY = 756;
      }
      page.drawText(line, { x: 36, y: currentY, size: 9, font: regular, color: rgb(0.1, 0.1, 0.1) });
      currentY -= 12;
    });
    y = currentY - 4;
  };

  drawTitle("Town Square Fort Mill Enrollment Packet");
  drawRow("Member", clean(input.memberName));
  drawRow("Packet ID", clean(input.packetId));
  drawRow("Completed At (ET)", `${toEasternDate(now)} ${now.slice(11, 19)}`);
  drawRow("Requested Days", input.requestedDays.length > 0 ? input.requestedDays.join(", ") : "-");
  drawRow("Transportation", clean(input.transportation));
  drawRow("Community Fee", moneyValue(input.communityFee));
  drawRow("Daily Rate", moneyValue(input.dailyRate));
  drawRow("Primary Contact", clean(input.caregiverName));
  drawRow("Primary Contact Phone", clean(formatPhoneDisplay(input.caregiverPhone)));
  drawRow("Primary Contact Email", clean(input.caregiverEmail));
  drawRow(
    "Primary Contact Address",
    [input.caregiverAddressLine1, input.caregiverAddressLine2, [input.caregiverCity, input.caregiverState, input.caregiverZip].filter(Boolean).join(" ")]
      .filter(Boolean)
      .join(", ")
  );
  drawRow("Secondary Contact", clean(input.secondaryContactName));
  drawRow("Secondary Contact Relationship", clean(input.secondaryContactRelationship));
  drawRow("Secondary Contact Phone", clean(formatPhoneDisplay(input.secondaryContactPhone)));
  drawRow("Secondary Contact Email", clean(input.secondaryContactEmail));
  drawRow(
    "Recreation Interests",
    formatEnrollmentPacketRecreationInterests(input.intakePayload.recreationInterests)
  );

  drawTitle("Enrollment Form Data Record");
  drawRow("Record Scope", "All captured enrollment form fields at time of caregiver submission.");

  const renderedKeys = new Set<string>();

  ENROLLMENT_PACKET_SECTIONS.forEach((section) => {
    drawTitle(section.title);
    section.fields.forEach((field) => {
      renderedKeys.add(field.key);
      drawRow(field.label, formatEnrollmentPacketValue(input.intakePayload[field.key]));
    });
  });

  const additionalKeys = [...ENROLLMENT_PACKET_INTAKE_TEXT_KEYS, ...ENROLLMENT_PACKET_INTAKE_ARRAY_KEYS].filter(
    (key) => !renderedKeys.has(key)
  );
  if (additionalKeys.length > 0) {
    drawTitle("Additional Captured Fields");
    additionalKeys.forEach((key) => {
      drawRow(toTitleCaseFromKey(key), displayPacketFieldValue(input.intakePayload, key));
    });
  }

  const legalText = buildEnrollmentPacketLegalText({
    caregiverName: input.intakePayload.membershipGuarantorSignatureName ?? input.caregiverSignatureName,
    memberName: input.memberName,
    paymentMethodSelection: input.intakePayload.paymentMethodSelection,
    communityFee: input.intakePayload.communityFee,
    totalInitialEnrollmentAmount: input.intakePayload.totalInitialEnrollmentAmount,
    exhibitAAuthorizationAcknowledged: Boolean(input.intakePayload.exhibitAGuarantorSignatureName)
  });
  [
    { title: "Membership Agreement", paragraphs: legalText.membershipAgreement },
    { title: "Exhibit A - Payment Authorization", paragraphs: legalText.exhibitAPaymentAuthorization },
    { title: "Notice of Privacy Practices", paragraphs: legalText.privacyPractices },
    { title: "Statement of Rights", paragraphs: legalText.statementOfRights },
    { title: "Photo Consent", paragraphs: legalText.photoConsent },
    { title: "Ancillary Charges Notice", paragraphs: legalText.ancillaryCharges }
  ].forEach((section) => {
    drawTitle(section.title);
    section.paragraphs.forEach((paragraph) => drawParagraph(paragraph));
  });

  drawTitle("Signatures");
  drawRow("Sender Signature Applied", clean(input.senderSignatureName));
  drawRow("Caregiver Signature Applied", clean(input.caregiverSignatureName));

  const bytes = Buffer.from(await pdf.save());
  return {
    bytes,
    contentType: "application/pdf",
    dataUrl: `data:application/pdf;base64,${bytes.toString("base64")}`,
    fileName: `Enrollment Packet Completed - ${safeFileName(input.memberName)} - ${toEasternDate(now)}.pdf`
  };
}
