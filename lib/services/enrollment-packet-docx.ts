import "server-only";

import { Buffer } from "node:buffer";

import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";

import { toEasternDate, toEasternISO } from "@/lib/timezone";

const COMPLETED_PACKET_TEMPLATE = {
  title: "Memory Lane Enrollment Packet",
  sections: {
    enrollmentInputs: "Enrollment Inputs",
    caregiverInformation: "Caregiver Information",
    secondaryContact: "Secondary Contact",
    packetForms: "Included Packet Forms",
    signatures: "Signatures"
  },
  includedForms: [
    "1. TS Welcome Checklist",
    "2. Face Sheet and Biography",
    "3. Membership Agreement",
    "3a. Membership Agreement Exhibit A",
    "4. Notice of Privacy Practices",
    "5. Statement of Rights of Adult Day Care Participants",
    "6. Photo Consent",
    "7. Ancillary Charges Notice",
    "8. Insurance and POA Upload",
    "TSFM Welcome Guide"
  ]
} as const;

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
  senderSignatureName: string;
  caregiverSignatureName: string;
};

function textValue(value: string | null | undefined, fallback = "-") {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 ? normalized : fallback;
}

function moneyValue(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "$0.00";
  return `$${value.toFixed(2)}`;
}

function safeFileName(value: string) {
  return value.replace(/[<>:"/\\|?*]/g, "").trim();
}

function line(label: string, value: string) {
  return new Paragraph({
    spacing: { after: 100 },
    children: [new TextRun({ text: `${label}: `, bold: true }), new TextRun(value)]
  });
}

function sectionHeading(label: string) {
  return new Paragraph({
    text: label,
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 220, after: 120 }
  });
}

function compactAddress(input: CompletedEnrollmentPacketDocxInput) {
  const line1 = textValue(input.caregiverAddressLine1, "");
  const line2 = textValue(input.caregiverAddressLine2, "");
  const city = textValue(input.caregiverCity, "");
  const state = textValue(input.caregiverState, "");
  const zip = textValue(input.caregiverZip, "");
  const first = [line1, line2].filter(Boolean).join(", ");
  const second = [city, state, zip].filter(Boolean).join(" ");
  return [first, second].filter(Boolean).join(", ") || "-";
}

export async function buildCompletedEnrollmentPacketDocxData(input: CompletedEnrollmentPacketDocxInput) {
  const now = toEasternISO();
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            text: COMPLETED_PACKET_TEMPLATE.title,
            heading: HeadingLevel.TITLE,
            alignment: AlignmentType.LEFT
          }),
          line("Member", textValue(input.memberName)),
          line("Packet ID", textValue(input.packetId)),
          line("Completed At (ET)", `${toEasternDate(now)} ${now.slice(11, 19)}`),

          sectionHeading(COMPLETED_PACKET_TEMPLATE.sections.enrollmentInputs),
          line("Requested Days", input.requestedDays.length > 0 ? input.requestedDays.join(", ") : "-"),
          line("Transportation", textValue(input.transportation)),
          line("Community Fee", moneyValue(input.communityFee)),
          line("Daily Rate", moneyValue(input.dailyRate)),

          sectionHeading(COMPLETED_PACKET_TEMPLATE.sections.caregiverInformation),
          line("Name", textValue(input.caregiverName)),
          line("Phone", textValue(input.caregiverPhone)),
          line("Email", textValue(input.caregiverEmail)),
          line("Address", compactAddress(input)),

          sectionHeading(COMPLETED_PACKET_TEMPLATE.sections.secondaryContact),
          line("Name", textValue(input.secondaryContactName)),
          line("Relationship", textValue(input.secondaryContactRelationship)),
          line("Phone", textValue(input.secondaryContactPhone)),
          line("Email", textValue(input.secondaryContactEmail)),

          sectionHeading(COMPLETED_PACKET_TEMPLATE.sections.packetForms),
          ...COMPLETED_PACKET_TEMPLATE.includedForms.map(
            (formLabel) =>
              new Paragraph({
                text: formLabel,
                bullet: { level: 0 },
                spacing: { after: 60 }
              })
          ),

          sectionHeading(COMPLETED_PACKET_TEMPLATE.sections.signatures),
          line("Sender Signature Applied", textValue(input.senderSignatureName)),
          line("Caregiver Signature Applied", textValue(input.caregiverSignatureName))
        ]
      }
    ]
  });

  const bytes = Buffer.from(await Packer.toBuffer(doc));
  return {
    bytes,
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    dataUrl: `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${bytes.toString("base64")}`,
    fileName: `Enrollment Packet Completed - ${safeFileName(input.memberName)} - ${toEasternDate(now)}.docx`
  };
}
