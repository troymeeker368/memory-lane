import type { EnrollmentPacketUploadDefinition } from "@/lib/services/enrollment-packet-public-schema";

export const ENROLLMENT_PACKET_UPLOAD_FIELDS: EnrollmentPacketUploadDefinition[] = [
  {
    key: "medicareCardUploads",
    category: "medicare_card",
    label: "Medicare Card",
    sourceDocument: "Insurance and Legal Uploads"
  },
  {
    key: "primaryInsuranceCardUploads",
    category: "private_insurance",
    label: "Primary Private Insurance Card (if applicable)",
    sourceDocument: "Insurance and Legal Uploads"
  },
  {
    key: "secondaryInsuranceCardUploads",
    category: "supplemental_insurance",
    label: "Secondary Insurance Card (if applicable)",
    sourceDocument: "Insurance and Legal Uploads"
  },
  {
    key: "poaUploads",
    category: "poa_guardianship",
    label: "Power of Attorney (POA) Documentation",
    sourceDocument: "Insurance and Legal Uploads"
  },
  {
    key: "dnrUploads",
    category: "dnr_dni_advance_directive",
    label: "DNR / DNI Paperwork",
    sourceDocument: "Insurance and Legal Uploads"
  },
  {
    key: "advanceDirectiveUploads",
    category: "dnr_dni_advance_directive",
    label: "Advance Directives",
    sourceDocument: "Insurance and Legal Uploads"
  }
];
