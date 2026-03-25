import type { EnrollmentPacketIntakeFieldKey } from "@/lib/services/enrollment-packet-intake-payload";

export type EnrollmentPacketSourceDocument =
  | "Face Sheet and Biography"
  | "Membership Agreement"
  | "Membership Agreement Exhibit A"
  | "Notice of Privacy Practices"
  | "Statement of Rights of Adult Day Care Participants"
  | "Photo Consent"
  | "Ancillary Charges Notice"
  | "Insurance and Legal Uploads";

export type EnrollmentPacketFieldType =
  | "text"
  | "email"
  | "tel"
  | "date"
  | "number"
  | "textarea"
  | "select"
  | "radio"
  | "checkbox-group"
  | "categorized-checkbox-group";

export type EnrollmentPacketFieldDefinition = {
  key: EnrollmentPacketIntakeFieldKey;
  label: string;
  type: EnrollmentPacketFieldType;
  sourceDocument: EnrollmentPacketSourceDocument;
  required?: boolean;
  staffPrepared?: boolean;
  options?: string[];
  columns?: 1 | 2;
};

export type EnrollmentPacketSectionDefinition = {
  id: string;
  title: string;
  description: string;
  sourceDocuments: EnrollmentPacketSourceDocument[];
  fields: EnrollmentPacketFieldDefinition[];
};

export type EnrollmentPacketUploadDefinition = {
  key:
    | "medicareCardUploads"
    | "primaryInsuranceCardUploads"
    | "secondaryInsuranceCardUploads"
    | "poaUploads"
    | "dnrUploads"
    | "advanceDirectiveUploads";
  category:
    | "medicare_card"
    | "private_insurance"
    | "supplemental_insurance"
    | "poa_guardianship"
    | "dnr_dni_advance_directive";
  label: string;
  sourceDocument: EnrollmentPacketSourceDocument;
};
