"use server";

import { Buffer } from "node:buffer";

import { headers } from "next/headers";

import { normalizePhoneForStorage } from "@/lib/phone";
import {
  normalizeEnrollmentPacketIntakePayload,
  normalizeEnrollmentPacketTextInput
} from "@/lib/services/enrollment-packet-intake-payload";

type PublicEnrollmentPacketUploadCategory =
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

async function loadEnrollmentPacketPublicService() {
  return import("@/lib/services/enrollment-packets-public");
}

async function recordUploadGuardFailure(input: {
  token: string;
  caregiverIp: string | null;
  caregiverUserAgent: string | null;
  message: string;
}) {
  try {
    const { recordPublicEnrollmentPacketGuardFailure } = await loadEnrollmentPacketPublicService();
    await recordPublicEnrollmentPacketGuardFailure({
      token: input.token,
      caregiverIp: input.caregiverIp,
      caregiverUserAgent: input.caregiverUserAgent,
      failureType: input.message.includes("too large")
        ? "upload_file_size_limit_exceeded"
        : input.message.includes("unsupported file type")
          ? "upload_type_rejected"
          : "upload_validation_rejected",
      message: input.message,
      severity: input.message.includes("too large") ? "high" : "medium"
    });
  } catch (loggingError) {
    console.error("[enrollment-packet] unable to record public upload guard failure", loggingError);
  }
}

function asString(formData: FormData, key: string) {
  return normalizeEnrollmentPacketTextInput(formData.get(key)) ?? "";
}

function asPhone(formData: FormData, key: string) {
  return normalizePhoneForStorage(asString(formData, key)) ?? "";
}

class InvalidEnrollmentPacketIntakePayloadError extends Error {
  constructor() {
    super("Enrollment packet answers are invalid. Refresh the form and try again.");
    this.name = "InvalidEnrollmentPacketIntakePayloadError";
  }
}

function parseIntakePayload(formData: FormData) {
  const raw = asString(formData, "intakePayload");
  if (!raw) {
    throw new InvalidEnrollmentPacketIntakePayloadError();
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new InvalidEnrollmentPacketIntakePayloadError();
    }
    return normalizeEnrollmentPacketIntakePayload(parsed);
  } catch {
    throw new InvalidEnrollmentPacketIntakePayloadError();
  }
}

async function getPublicRequestMetadata() {
  const headerMap = await headers();
  const forwardedFor = headerMap.get("x-forwarded-for");
  return {
    caregiverIp: forwardedFor ? forwardedFor.split(",")[0].trim() : null,
    caregiverUserAgent: headerMap.get("user-agent")
  };
}

async function recordInvalidPayloadGuardFailure(input: {
  token: string;
  caregiverIp: string | null;
  caregiverUserAgent: string | null;
}) {
  try {
    const { recordPublicEnrollmentPacketGuardFailure } = await loadEnrollmentPacketPublicService();
    await recordPublicEnrollmentPacketGuardFailure({
      token: input.token,
      caregiverIp: input.caregiverIp,
      caregiverUserAgent: input.caregiverUserAgent,
      failureType: "invalid_intake_payload_json",
      message: "Public enrollment packet submission included malformed intakePayload JSON.",
      severity: "medium"
    });
  } catch (loggingError) {
    console.error("[enrollment-packet] unable to record malformed intake payload guard failure", loggingError);
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
    const requestMetadata = await getPublicRequestMetadata();
    const token = asString(formData, "token");
    const { savePublicEnrollmentPacketProgress } = await loadEnrollmentPacketPublicService();
    let intakePayload;
    try {
      intakePayload = parseIntakePayload(formData);
    } catch (error) {
      if (error instanceof InvalidEnrollmentPacketIntakePayloadError) {
        await recordInvalidPayloadGuardFailure({
          token,
          caregiverIp: requestMetadata.caregiverIp,
          caregiverUserAgent: requestMetadata.caregiverUserAgent
        });
      }
      throw error;
    }
    await savePublicEnrollmentPacketProgress({
      token,
      caregiverName: asString(formData, "caregiverName"),
      caregiverPhone: asPhone(formData, "caregiverPhone"),
      caregiverEmail: asString(formData, "caregiverEmail"),
      primaryContactAddress: asString(formData, "primaryContactAddress"),
      primaryContactAddressLine1: asString(formData, "primaryContactAddressLine1"),
      primaryContactCity: asString(formData, "primaryContactCity"),
      primaryContactState: asString(formData, "primaryContactState"),
      primaryContactZip: asString(formData, "primaryContactZip"),
      caregiverAddressLine1: asString(formData, "caregiverAddressLine1"),
      caregiverAddressLine2: asString(formData, "caregiverAddressLine2"),
      caregiverCity: asString(formData, "caregiverCity"),
      caregiverState: asString(formData, "caregiverState"),
      caregiverZip: asString(formData, "caregiverZip"),
      secondaryContactName: asString(formData, "secondaryContactName"),
      secondaryContactPhone: asPhone(formData, "secondaryContactPhone"),
      secondaryContactEmail: asString(formData, "secondaryContactEmail"),
      secondaryContactRelationship: asString(formData, "secondaryContactRelationship"),
      secondaryContactAddress: asString(formData, "secondaryContactAddress"),
      secondaryContactAddressLine1: asString(formData, "secondaryContactAddressLine1"),
      secondaryContactCity: asString(formData, "secondaryContactCity"),
      secondaryContactState: asString(formData, "secondaryContactState"),
      secondaryContactZip: asString(formData, "secondaryContactZip"),
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
    const { submitPublicEnrollmentPacket } = await loadEnrollmentPacketPublicService();
    const requestMetadata = await getPublicRequestMetadata();
    const { caregiverIp, caregiverUserAgent } = requestMetadata;
    const token = asString(formData, "token");
    let intakePayload;
    try {
      intakePayload = parseIntakePayload(formData);
    } catch (error) {
      if (error instanceof InvalidEnrollmentPacketIntakePayloadError) {
        await recordInvalidPayloadGuardFailure({
          token,
          caregiverIp,
          caregiverUserAgent
        });
      }
      throw error;
    }

    let medicareCardUploads;
    let primaryInsuranceCardUploads;
    let secondaryInsuranceCardUploads;
    let poaUploads;
    let dnrUploads;
    let advanceDirectiveUploads;
    try {
      [
        medicareCardUploads,
        primaryInsuranceCardUploads,
        secondaryInsuranceCardUploads,
        poaUploads,
        dnrUploads,
        advanceDirectiveUploads
      ] = await Promise.all([
        parseFileUploads(formData, "medicareCardUploads", "medicare_card"),
        parseFileUploads(formData, "primaryInsuranceCardUploads", "private_insurance"),
        parseFileUploads(formData, "secondaryInsuranceCardUploads", "supplemental_insurance"),
        parseFileUploads(formData, "poaUploads", "poa_guardianship"),
        parseFileUploads(formData, "dnrUploads", "dnr_dni_advance_directive"),
        parseFileUploads(formData, "advanceDirectiveUploads", "dnr_dni_advance_directive")
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to validate enrollment packet uploads.";
      await recordUploadGuardFailure({
        token,
        caregiverIp,
        caregiverUserAgent,
        message
      });
      throw error;
    }

    const result = await submitPublicEnrollmentPacket({
      token,
      caregiverTypedName: asString(formData, "caregiverTypedName"),
      caregiverSignatureImageDataUrl: asString(formData, "caregiverSignatureImageDataUrl"),
      attested: asString(formData, "attested") === "true",
      caregiverIp,
      caregiverUserAgent,
      caregiverName: asString(formData, "caregiverName"),
      caregiverPhone: asPhone(formData, "caregiverPhone"),
      caregiverEmail: asString(formData, "caregiverEmail"),
      primaryContactAddress: asString(formData, "primaryContactAddress"),
      primaryContactAddressLine1: asString(formData, "primaryContactAddressLine1"),
      primaryContactCity: asString(formData, "primaryContactCity"),
      primaryContactState: asString(formData, "primaryContactState"),
      primaryContactZip: asString(formData, "primaryContactZip"),
      caregiverAddressLine1: asString(formData, "caregiverAddressLine1"),
      caregiverAddressLine2: asString(formData, "caregiverAddressLine2"),
      caregiverCity: asString(formData, "caregiverCity"),
      caregiverState: asString(formData, "caregiverState"),
      caregiverZip: asString(formData, "caregiverZip"),
      secondaryContactName: asString(formData, "secondaryContactName"),
      secondaryContactPhone: asPhone(formData, "secondaryContactPhone"),
      secondaryContactEmail: asString(formData, "secondaryContactEmail"),
      secondaryContactRelationship: asString(formData, "secondaryContactRelationship"),
      secondaryContactAddress: asString(formData, "secondaryContactAddress"),
      secondaryContactAddressLine1: asString(formData, "secondaryContactAddressLine1"),
      secondaryContactCity: asString(formData, "secondaryContactCity"),
      secondaryContactState: asString(formData, "secondaryContactState"),
      secondaryContactZip: asString(formData, "secondaryContactZip"),
      notes: asString(formData, "notes"),
      intakePayload,
      uploads: [
        ...medicareCardUploads,
        ...primaryInsuranceCardUploads,
        ...secondaryInsuranceCardUploads,
        ...poaUploads,
        ...dnrUploads,
        ...advanceDirectiveUploads
      ]
    });
    const redirectParams = new URLSearchParams();
    if (result.operationalReadinessStatus !== "operationally_ready") {
      redirectParams.set("status", "follow-up-required");
    }
    if (result.wasAlreadyFiled) {
      redirectParams.set("replayed", "1");
    }
    const redirectSuffix = redirectParams.size > 0 ? `?${redirectParams.toString()}` : "";
    return {
      ok: true,
      redirectUrl: `/sign/enrollment-packet/${encodeURIComponent(token)}/confirmation${redirectSuffix}`
    } as const;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to complete enrollment packet."
    } as const;
  }
}
