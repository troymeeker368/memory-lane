import "server-only";

import type { EnrollmentPacketIntakePayload } from "@/lib/services/enrollment-packet-intake-payload";
import type { EnrollmentPacketUploadCategory } from "@/lib/services/enrollment-packet-types";

export type CompletedEnrollmentPacketDocxInput = {
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

async function loadCompletedEnrollmentPacketPdfModule() {
  return import("@/lib/documents/enrollment-packet/completed-packet-pdf");
}

export async function buildCompletedEnrollmentPacketDocxData(input: CompletedEnrollmentPacketDocxInput) {
  const { buildCompletedEnrollmentPacketDocxData } = await loadCompletedEnrollmentPacketPdfModule();
  return buildCompletedEnrollmentPacketDocxData(input);
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
