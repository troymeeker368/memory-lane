import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

import { toEasternDate } from "@/lib/timezone";

export const MEMBER_DOCUMENTS_BUCKET = "member-documents";

export type MemberFileCategory =
  | "Health Unit"
  | "Legal"
  | "Admin"
  | "Enrollment Packet"
  | "Assessment"
  | "Care Plan"
  | "Orders / POF"
  | "Billing"
  | "Name Badge"
  | "Other";

const CLINICAL_MEMBER_FILE_CATEGORIES = new Set<MemberFileCategory>([
  "Assessment",
  "Care Plan",
  "Orders / POF",
  "Health Unit"
]);

export type GeneratedMemberFilePersistenceState = {
  memberFilesStatus: "verified" | "follow-up-needed";
  memberFilesMessage: string | null;
};

export function buildGeneratedMemberFilePersistenceState(input: {
  documentLabel: string;
  verifiedPersisted: boolean;
}): GeneratedMemberFilePersistenceState {
  if (input.verifiedPersisted) {
    return {
      memberFilesStatus: "verified",
      memberFilesMessage: null
    };
  }

  return {
    memberFilesStatus: "follow-up-needed",
    memberFilesMessage:
      `${input.documentLabel} PDF was generated and uploaded to storage, but the canonical Member Files record could not be verified yet. ` +
      "Staff should treat this as follow-up needed until the document appears in Member Files."
  };
}

export function safeFileName(value: string) {
  return value.replace(/[<>:\"/\\|?*]/g, "").trim();
}

export function buildDatedPdfFileName(documentLabel: string, memberName: string, whenIso: string, extension = ".pdf") {
  const day = toEasternDate(whenIso);
  return `${safeFileName(documentLabel)} - ${safeFileName(memberName)} - ${day}${extension}`;
}

export function withDuplicateFileSuffix(fileName: string, timestampIso: string) {
  const extension = ".pdf";
  if (!fileName.toLowerCase().endsWith(extension)) return fileName;
  const root = fileName.slice(0, -extension.length);
  const suffix = timestampIso.slice(11, 19).replaceAll(":", "");
  return `${root} - ${suffix}${extension}`;
}

export function nextMemberFileId() {
  return `mf_${randomUUID().replace(/-/g, "")}`;
}

export function parseDataUrlPayload(dataUrl: string, errorMessage = "Invalid data URL payload.") {
  const normalized = dataUrl.trim();
  const base64Match = /^data:([^;,]+)(?:;charset=[^;,]+)?;base64,(.+)$/i.exec(normalized);
  if (base64Match) {
    return {
      contentType: base64Match[1],
      bytes: Buffer.from(base64Match[2], "base64")
    };
  }
  const plainMatch = /^data:([^;,]+)(?:;charset=[^;,]+)?,(.*)$/i.exec(normalized);
  if (!plainMatch) throw new Error(errorMessage);
  return {
    contentType: plainMatch[1],
    bytes: Buffer.from(decodeURIComponent(plainMatch[2]), "utf8")
  };
}

export function buildMemberDocumentStorageUri(objectPath: string) {
  return `storage://${MEMBER_DOCUMENTS_BUCKET}/${objectPath}`;
}

export function parseMemberDocumentStorageUri(storageUri: string | null | undefined) {
  const normalized = String(storageUri ?? "").trim();
  if (!normalized) return null;
  const prefix = `storage://${MEMBER_DOCUMENTS_BUCKET}/`;
  if (!normalized.startsWith(prefix)) return null;
  return normalized.slice(prefix.length);
}

export function slugifyMemberFileSegment(value: string) {
  return safeFileName(value)
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function isClinicalMemberFileCategory(category: string | null | undefined) {
  return CLINICAL_MEMBER_FILE_CATEGORIES.has(String(category ?? "").trim() as MemberFileCategory);
}
