"use server";

import { Buffer } from "node:buffer";

import { headers } from "next/headers";

import {
  extractPublicEnrollmentPacketActionToken,
  parsePublicEnrollmentPacketProgressActionPayload,
  parsePublicEnrollmentPacketSubmitActionPayload,
  InvalidEnrollmentPacketActionPayloadError
} from "@/lib/services/enrollment-packet-public-action-payload-schema";
import { buildCommittedWorkflowActionState } from "@/lib/services/committed-workflow-state";
import type { PacketFileUpload } from "@/lib/services/enrollment-packet-types";

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
      message: "Public enrollment packet request included invalid payload JSON.",
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
  const uploads: PacketFileUpload[] = [];
  for (const entry of entries) {
    if (!(entry instanceof File)) continue;
    if (entry.size <= 0) continue;
    const { fileName, contentType } = validateEnrollmentPacketUpload(entry, category);
    uploads.push({
      fileName,
      contentType,
      byteSize: entry.size,
      readBytes: async () => Buffer.from(await entry.arrayBuffer()),
      category
    });
  }
  return uploads;
}

export async function savePublicEnrollmentPacketProgressAction(formData: FormData) {
  try {
    const requestMetadata = await getPublicRequestMetadata();
    const token = extractPublicEnrollmentPacketActionToken(formData);
    const { savePublicEnrollmentPacketProgress } = await loadEnrollmentPacketPublicService();
    let payload;
    try {
      payload = parsePublicEnrollmentPacketProgressActionPayload(formData);
    } catch (error) {
      if (error instanceof InvalidEnrollmentPacketActionPayloadError) {
        await recordInvalidPayloadGuardFailure({
          token,
          caregiverIp: requestMetadata.caregiverIp,
          caregiverUserAgent: requestMetadata.caregiverUserAgent
        });
      }
      throw error;
    }
    await savePublicEnrollmentPacketProgress({
      token: payload.token,
      intakePayload: payload.intakePayload
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
    const token = extractPublicEnrollmentPacketActionToken(formData);
    let payload;
    try {
      payload = parsePublicEnrollmentPacketSubmitActionPayload(formData);
    } catch (error) {
      if (error instanceof InvalidEnrollmentPacketActionPayloadError) {
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
        token: payload.token,
        caregiverIp,
        caregiverUserAgent,
        message
      });
      throw error;
    }

    const result = await submitPublicEnrollmentPacket({
      token: payload.token,
      caregiverTypedName: payload.caregiverTypedName,
      caregiverSignatureImageDataUrl: payload.caregiverSignatureImageDataUrl,
      attested: payload.attested,
      caregiverIp,
      caregiverUserAgent,
      intakePayload: payload.intakePayload,
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
    if (result.actionNeeded) {
      redirectParams.set("status", "follow-up-required");
    }
    if (result.wasAlreadyFiled) {
      redirectParams.set("replayed", "1");
    }
    const redirectSuffix = redirectParams.size > 0 ? `?${redirectParams.toString()}` : "";
    return {
      ok: true,
      ...buildCommittedWorkflowActionState({
        operationalStatus: result.operationalReadinessStatus,
        readinessStage: result.readinessStage,
        actionNeededMessage: result.actionNeededMessage
      }),
      redirectUrl: `/sign/enrollment-packet/${encodeURIComponent(payload.token)}/confirmation${redirectSuffix}`
    } as const;
  } catch (error) {
    console.error("[enrollment-packet] public submit action failed", error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to complete enrollment packet."
    } as const;
  }
}
