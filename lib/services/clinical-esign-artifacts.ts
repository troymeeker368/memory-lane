import "server-only";

import {
  parseDataUrlPayload,
  uploadMemberDocumentObject,
  upsertMemberFileByDocumentSource
} from "@/lib/services/member-files";
import { toEasternDate } from "@/lib/timezone";

export type ClinicalEsignDomain = "intake-assessment" | "care-plan";

function clean(value: string | null | undefined) {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function parseSignatureDataUrl(dataUrl: string) {
  const normalized = clean(dataUrl);
  if (!normalized) throw new Error("Signature image is required.");
  const parsed = parseDataUrlPayload(normalized, "Signature image is invalid.");
  if (!parsed.contentType.startsWith("image/")) {
    throw new Error("Signature image format is invalid.");
  }
  return parsed;
}

function resolveObjectPath(domain: ClinicalEsignDomain, input: { memberId: string; recordId: string }) {
  if (domain === "intake-assessment") {
    return `members/${input.memberId}/intake-assessments/${input.recordId}/nurse-signature.png`;
  }
  return `members/${input.memberId}/care-plans/${input.recordId}/nurse-signature.png`;
}

function resolveDocumentSource(domain: ClinicalEsignDomain, recordId: string) {
  return domain === "intake-assessment"
    ? `Intake Assessment Nurse E-Sign:${recordId}`
    : `Care Plan Nurse E-Sign:${recordId}`;
}

function resolveFileName(domain: ClinicalEsignDomain, signedAtIso: string) {
  const date = toEasternDate(signedAtIso);
  return domain === "intake-assessment"
    ? `Intake Assessment Nurse E-Sign - ${date}.png`
    : `Care Plan Nurse E-Sign - ${date}.png`;
}

function resolveCategory(domain: ClinicalEsignDomain) {
  return domain === "intake-assessment" ? "Assessment" : "Care Plan";
}

export async function captureClinicalEsignArtifact(input: {
  domain: ClinicalEsignDomain;
  recordId: string;
  memberId: string;
  signedByUserId: string;
  signedByName: string;
  signedAtIso: string;
  signatureImageDataUrl: string;
}) {
  const domain = input.domain;
  const recordId = clean(input.recordId);
  const memberId = clean(input.memberId);
  const signedByUserId = clean(input.signedByUserId);
  const signedByName = clean(input.signedByName);
  const signedAtIso = clean(input.signedAtIso);
  if (!recordId) throw new Error("Record ID is required for e-sign artifact capture.");
  if (!memberId) throw new Error("Member ID is required for e-sign artifact capture.");
  if (!signedByUserId || !signedByName) throw new Error("Signer identity is required for e-sign artifact capture.");
  if (!signedAtIso) throw new Error("Signed-at timestamp is required for e-sign artifact capture.");

  const signature = parseSignatureDataUrl(input.signatureImageDataUrl);
  const storagePath = resolveObjectPath(domain, { memberId, recordId });
  await uploadMemberDocumentObject({
    objectPath: storagePath,
    bytes: signature.bytes,
    contentType: signature.contentType
  });

  const fileName = resolveFileName(domain, signedAtIso);
  const documentSource = resolveDocumentSource(domain, recordId);
  const category = resolveCategory(domain);
  const result = await upsertMemberFileByDocumentSource({
    memberId,
    documentSource,
    fileName,
    fileType: signature.contentType,
    dataUrl: null,
    storageObjectPath: storagePath,
    category,
    uploadedByUserId: signedByUserId,
    uploadedByName: signedByName,
    uploadedAtIso: signedAtIso,
    updatedAtIso: signedAtIso,
    additionalColumns: {
      care_plan_id: domain === "care-plan" ? recordId : null
    }
  });

  return {
    signatureArtifactStoragePath: storagePath,
    signatureArtifactMemberFileId: result.id
  };
}
