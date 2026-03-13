import "server-only";

import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { toEasternDate } from "@/lib/timezone";

const STORAGE_BUCKET = "member-documents";

export type ClinicalEsignDomain = "intake-assessment" | "care-plan";

function clean(value: string | null | undefined) {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function parseSignatureDataUrl(dataUrl: string) {
  const normalized = clean(dataUrl);
  if (!normalized) throw new Error("Signature image is required.");
  const match = /^data:([^;]+);base64,(.+)$/.exec(normalized);
  if (!match) throw new Error("Signature image is invalid.");
  if (!match[1].startsWith("image/")) {
    throw new Error("Signature image format is invalid.");
  }
  return {
    contentType: match[1],
    bytes: Buffer.from(match[2], "base64")
  };
}

function nextMemberFileId() {
  return `mf_${randomUUID().replace(/-/g, "")}`;
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
  const admin = createSupabaseAdminClient();
  const storagePath = resolveObjectPath(domain, { memberId, recordId });

  const { error: uploadError } = await admin.storage.from(STORAGE_BUCKET).upload(storagePath, signature.bytes, {
    contentType: signature.contentType,
    upsert: true
  });
  if (uploadError) throw new Error(uploadError.message);

  const fileName = resolveFileName(domain, signedAtIso);
  const documentSource = resolveDocumentSource(domain, recordId);
  const category = resolveCategory(domain);

  const { data: existing, error: existingError } = await admin
    .from("member_files")
    .select("id")
    .eq("member_id", memberId)
    .eq("document_source", documentSource)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);

  if (existing?.id) {
    const { error: updateError } = await admin
      .from("member_files")
      .update({
        file_name: fileName,
        file_type: signature.contentType,
        file_data_url: null,
        category,
        category_other: null,
        document_source: documentSource,
        care_plan_id: domain === "care-plan" ? recordId : null,
        storage_object_path: storagePath,
        uploaded_by_user_id: signedByUserId,
        uploaded_by_name: signedByName,
        uploaded_at: signedAtIso,
        updated_at: signedAtIso
      })
      .eq("id", existing.id);
    if (updateError) throw new Error(updateError.message);
    return {
      signatureArtifactStoragePath: storagePath,
      signatureArtifactMemberFileId: String(existing.id)
    };
  }

  const memberFileId = nextMemberFileId();
  const { error: insertError } = await admin.from("member_files").insert({
    id: memberFileId,
    member_id: memberId,
    file_name: fileName,
    file_type: signature.contentType,
    file_data_url: null,
    category,
    category_other: null,
    document_source: documentSource,
    care_plan_id: domain === "care-plan" ? recordId : null,
    storage_object_path: storagePath,
    uploaded_by_user_id: signedByUserId,
    uploaded_by_name: signedByName,
    uploaded_at: signedAtIso,
    updated_at: signedAtIso
  });
  if (insertError) throw new Error(insertError.message);

  return {
    signatureArtifactStoragePath: storagePath,
    signatureArtifactMemberFileId: memberFileId
  };
}
