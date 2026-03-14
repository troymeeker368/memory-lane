import "server-only";

import { Buffer } from "node:buffer";

import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";

import {
  ENROLLMENT_PACKET_SECTIONS,
  formatEnrollmentPacketValue
} from "@/lib/services/enrollment-packet-public-schema";
import type { EnrollmentPacketIntakePayload } from "@/lib/services/enrollment-packet-intake-payload";
import { toEasternDate, toEasternISO } from "@/lib/timezone";

const COMPLETED_PACKET_TEMPLATE = {
  title: "Town Square Fort Mill Enrollment Packet",
  sections: {
    enrollmentInputs: "Enrollment Inputs",
    signatures: "Signatures"
  }
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
  intakePayload: EnrollmentPacketIntakePayload;
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
          line("Primary Contact", textValue(input.caregiverName)),
          line("Primary Contact Phone", textValue(input.caregiverPhone)),
          line("Primary Contact Email", textValue(input.caregiverEmail)),
          line("Primary Contact Address", compactAddress(input)),
          line("Secondary Contact", textValue(input.secondaryContactName)),
          line("Secondary Contact Relationship", textValue(input.secondaryContactRelationship)),
          line("Secondary Contact Phone", textValue(input.secondaryContactPhone)),
          line("Secondary Contact Email", textValue(input.secondaryContactEmail)),

          ...ENROLLMENT_PACKET_SECTIONS.flatMap((section) => {
            if (section.fields.length === 0) return [];
            const rows = section.fields.map((field) =>
              line(field.label, formatEnrollmentPacketValue(input.intakePayload[field.key]))
            );
            return [sectionHeading(section.title), ...rows];
          }),

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
