"use server";

import { Buffer } from "node:buffer";

import { headers } from "next/headers";

import { normalizeEnrollmentPacketIntakePayload } from "@/lib/services/enrollment-packet-intake-payload";
import {
  savePublicEnrollmentPacketProgress,
  submitPublicEnrollmentPacket
} from "@/lib/services/enrollment-packets";

type PublicEnrollmentPacketUploadCategory =
  | "insurance"
  | "poa"
  | "supporting"
  | "medicare_card"
  | "private_insurance"
  | "supplemental_insurance"
  | "poa_guardianship"
  | "dnr_dni_advance_directive";

const MAX_ENROLLMENT_PACKET_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_ENROLLMENT_PACKET_UPLOAD_MB = MAX_ENROLLMENT_PACKET_UPLOAD_BYTES / (1024 * 1024);
const ALLOWED_ENROLLMENT_PACKET_UPLOAD_LABEL = "PDF, DOC, DOCX, JPG, JPEG, PNG, HEIC, HEIF, WEBP, GIF, TIF, TIFF";
const ALLOWED_ENROLLMENT_PACKET_UPLOAD_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/heic",
  "image/heif",
  "image/webp",
  "image/gif",
  "image/tiff"
]);
const ENROLLMENT_PACKET_UPLOAD_EXTENSION_TO_MIME: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  heic: "image/heic",
  heif: "image/heif",
  webp: "image/webp",
  gif: "image/gif",
  tif: "image/tiff",
  tiff: "image/tiff"
};

function asString(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function parseIntakePayload(formData: FormData) {
  const raw = asString(formData, "intakePayload");
  if (!raw) return normalizeEnrollmentPacketIntakePayload({});
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return normalizeEnrollmentPacketIntakePayload(parsed);
  } catch {
    return normalizeEnrollmentPacketIntakePayload({});
  }
}

function extractUploadExtension(fileName: string) {
  const normalized = fileName.trim().toLowerCase();
  const index = normalized.lastIndexOf(".");
  if (index < 0 || index === normalized.length - 1) return null;
  return normalized.slice(index + 1);
}

function resolveUploadContentType(entry: File) {
  const providedType = entry.type.trim().toLowerCase();
  if (providedType && ALLOWED_ENROLLMENT_PACKET_UPLOAD_MIME_TYPES.has(providedType)) {
    return providedType;
  }

  const extension = extractUploadExtension(entry.name);
  if (!extension) return null;
  const inferredType = ENROLLMENT_PACKET_UPLOAD_EXTENSION_TO_MIME[extension];
  if (!inferredType) return null;

  if (!providedType || providedType === "application/octet-stream" || providedType === inferredType) {
    return inferredType;
  }

  return null;
}

function validateEnrollmentPacketUpload(entry: File, category: PublicEnrollmentPacketUploadCategory) {
  const normalizedName = entry.name.trim();
  const fileName = normalizedName || `${category}-${Date.now()}`;

  if (entry.size > MAX_ENROLLMENT_PACKET_UPLOAD_BYTES) {
    throw new Error(`"${fileName}" is too large. Maximum file size is ${MAX_ENROLLMENT_PACKET_UPLOAD_MB}MB.`);
  }

  const contentType = resolveUploadContentType(entry);
  if (!contentType) {
    throw new Error(
      `"${fileName}" has an unsupported file type. Allowed file types: ${ALLOWED_ENROLLMENT_PACKET_UPLOAD_LABEL}.`
    );
  }

  return { fileName, contentType };
}

async function parseFileUploads(
  formData: FormData,
  key: string,
  category: PublicEnrollmentPacketUploadCategory
) {
  const entries = formData.getAll(key);
  const uploads: Array<{
    fileName: string;
    contentType: string;
    bytes: Buffer;
    category: PublicEnrollmentPacketUploadCategory;
  }> = [];
  for (const entry of entries) {
    if (!(entry instanceof File)) continue;
    if (entry.size <= 0) continue;
    const { fileName, contentType } = validateEnrollmentPacketUpload(entry, category);
    const bytes = Buffer.from(await entry.arrayBuffer());
    uploads.push({
      fileName,
      contentType,
      bytes,
      category
    });
  }
  return uploads;
}

export async function savePublicEnrollmentPacketProgressAction(formData: FormData) {
  try {
    const intakePayload = parseIntakePayload(formData);
    await savePublicEnrollmentPacketProgress({
      token: asString(formData, "token"),
      caregiverName: asString(formData, "caregiverName"),
      caregiverPhone: asString(formData, "caregiverPhone"),
      caregiverEmail: asString(formData, "caregiverEmail"),
      caregiverAddressLine1: asString(formData, "caregiverAddressLine1"),
      caregiverAddressLine2: asString(formData, "caregiverAddressLine2"),
      caregiverCity: asString(formData, "caregiverCity"),
      caregiverState: asString(formData, "caregiverState"),
      caregiverZip: asString(formData, "caregiverZip"),
      secondaryContactName: asString(formData, "secondaryContactName"),
      secondaryContactPhone: asString(formData, "secondaryContactPhone"),
      secondaryContactEmail: asString(formData, "secondaryContactEmail"),
      secondaryContactRelationship: asString(formData, "secondaryContactRelationship"),
      notes: asString(formData, "notes"),
      intakePayload
    });
    return { ok: true } as const;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to save enrollment packet progress."
    } as const;
  }
}

export async function submitPublicEnrollmentPacketAction(formData: FormData) {
  try {
    const headerMap = await headers();
    const forwardedFor = headerMap.get("x-forwarded-for");
    const caregiverIp = forwardedFor ? forwardedFor.split(",")[0].trim() : null;
    const caregiverUserAgent = headerMap.get("user-agent");
    const intakePayload = parseIntakePayload(formData);

    const [
      insuranceUploads,
      poaUploads,
      supportingUploads,
      medicareCardUploads,
      privateInsuranceUploads,
      supplementalInsuranceUploads,
      poaGuardianshipUploads,
      advanceDirectiveUploads
    ] = await Promise.all([
      parseFileUploads(formData, "insuranceUploads", "insurance"),
      parseFileUploads(formData, "poaUploads", "poa"),
      parseFileUploads(formData, "supportingUploads", "supporting"),
      parseFileUploads(formData, "medicareCardUploads", "medicare_card"),
      parseFileUploads(formData, "privateInsuranceCardUploads", "private_insurance"),
      parseFileUploads(formData, "supplementalInsuranceCardUploads", "supplemental_insurance"),
      parseFileUploads(formData, "poaGuardianshipUploads", "poa_guardianship"),
      parseFileUploads(formData, "advanceDirectiveUploads", "dnr_dni_advance_directive")
    ]);

    await submitPublicEnrollmentPacket({
      token: asString(formData, "token"),
      caregiverTypedName: asString(formData, "caregiverTypedName"),
      caregiverSignatureImageDataUrl: asString(formData, "caregiverSignatureImageDataUrl"),
      attested: asString(formData, "attested") === "true",
      caregiverIp,
      caregiverUserAgent,
      caregiverName: asString(formData, "caregiverName"),
      caregiverPhone: asString(formData, "caregiverPhone"),
      caregiverEmail: asString(formData, "caregiverEmail"),
      caregiverAddressLine1: asString(formData, "caregiverAddressLine1"),
      caregiverAddressLine2: asString(formData, "caregiverAddressLine2"),
      caregiverCity: asString(formData, "caregiverCity"),
      caregiverState: asString(formData, "caregiverState"),
      caregiverZip: asString(formData, "caregiverZip"),
      secondaryContactName: asString(formData, "secondaryContactName"),
      secondaryContactPhone: asString(formData, "secondaryContactPhone"),
      secondaryContactEmail: asString(formData, "secondaryContactEmail"),
      secondaryContactRelationship: asString(formData, "secondaryContactRelationship"),
      notes: asString(formData, "notes"),
      intakePayload,
      uploads: [
        ...insuranceUploads,
        ...poaUploads,
        ...supportingUploads,
        ...medicareCardUploads,
        ...privateInsuranceUploads,
        ...supplementalInsuranceUploads,
        ...poaGuardianshipUploads,
        ...advanceDirectiveUploads
      ]
    });
    return { ok: true } as const;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to complete enrollment packet."
    } as const;
  }
}
