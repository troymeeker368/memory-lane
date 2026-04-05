import "server-only";

import { Buffer } from "node:buffer";

import {
  MEMBER_DOCUMENTS_BUCKET,
  deleteMemberDocumentObject,
  parseDataUrlPayload,
  saveGeneratedMemberPdfToFiles,
  uploadMemberDocumentObject
} from "@/lib/services/member-files";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { toEasternISO } from "@/lib/timezone";

function clean(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function parseSignatureImageDataUrl(dataUrl: string) {
  const normalized = clean(dataUrl);
  if (!normalized) throw new Error("Draw your signature before submitting this incident.");
  const parsed = parseDataUrlPayload(normalized, "Signature image is invalid.");
  if (!parsed.contentType.startsWith("image/")) {
    throw new Error("Signature image format is invalid.");
  }
  return parsed;
}

function buildIncidentSignatureStoragePath(incidentId: string, participantId?: string | null) {
  const memberScopedPath = clean(participantId)
    ? `members/${participantId}/incidents/${incidentId}/submitter-signature.png`
    : `incident-reports/${incidentId}/submitter-signature.png`;
  return memberScopedPath;
}

export async function saveIncidentSubmitterSignatureArtifact(input: {
  incidentId: string;
  participantId?: string | null;
  signatureImageDataUrl: string;
}) {
  const incidentId = clean(input.incidentId);
  if (!incidentId) throw new Error("Incident ID is required for signature capture.");

  const signature = parseSignatureImageDataUrl(input.signatureImageDataUrl);
  const storagePath = buildIncidentSignatureStoragePath(incidentId, input.participantId);
  await uploadMemberDocumentObject({
    objectPath: storagePath,
    bytes: signature.bytes,
    contentType: signature.contentType
  });

  return {
    storagePath
  };
}

export async function deleteIncidentSubmitterSignatureArtifact(storagePath: string | null | undefined) {
  const normalized = clean(storagePath);
  if (!normalized) return;
  await deleteMemberDocumentObject(normalized);
}

export async function loadIncidentSubmitterSignatureDataUrl(storagePath: string | null | undefined) {
  const normalized = clean(storagePath);
  if (!normalized) return null;

  const admin = createSupabaseAdminClient("incident_artifact_workflow");
  const { data, error } = await admin.storage.from(MEMBER_DOCUMENTS_BUCKET).download(normalized);
  if (error || !data) {
    throw new Error(error?.message ?? "Unable to load incident signature artifact.");
  }

  const buffer = Buffer.from(await data.arrayBuffer());
  const contentType = data.type || "image/png";
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

export async function saveFinalizedIncidentPdfToMemberFiles(input: {
  incidentId: string;
  memberId: string;
  memberName: string;
  dataUrl: string;
  uploadedBy: {
    id: string;
    name: string;
  };
}) {
  return saveGeneratedMemberPdfToFiles({
    memberId: input.memberId,
    memberName: input.memberName,
    documentLabel: "Incident Report",
    documentSource: `Incident Report:${input.incidentId}`,
    category: "Health Unit",
    dataUrl: input.dataUrl,
    uploadedBy: input.uploadedBy,
    generatedAtIso: toEasternISO(),
    replaceExistingByDocumentSource: true
  });
}
