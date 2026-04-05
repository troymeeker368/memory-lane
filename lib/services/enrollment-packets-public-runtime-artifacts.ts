import "server-only";

import type { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

import { getPublicEnrollmentPacketContext } from "@/lib/services/enrollment-packets-public-runtime-context";
import { loadEnrollmentPacketArtifactOps } from "@/lib/services/enrollment-packet-mapping-runtime";
import {
  clean,
  createCompletedPacketDownloadToken,
  normalizeStoredIntakePayload,
  throwEnrollmentPacketSchemaError,
  verifyCompletedPacketDownloadToken
} from "@/lib/services/enrollment-packet-core";
import { parseMemberDocumentStorageUri } from "@/lib/services/member-files";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { toEasternDate, toEasternISO } from "@/lib/timezone";
import type {
  EnrollmentPacketFieldsRow,
  EnrollmentPacketRequestRow,
  EnrollmentPacketUploadCategory,
  MemberRow,
  PacketFileUpload
} from "@/lib/services/enrollment-packet-types";

export type PersistedPublicEnrollmentPacketUpload = {
  uploadCategory: EnrollmentPacketUploadCategory;
  objectPath: string;
  memberFileId: string | null;
  memberFileCreated: boolean;
};

export type PersistedPublicEnrollmentPacketArtifact = {
  uploadCategory: EnrollmentPacketUploadCategory;
  memberFileId: string | null;
};

async function loadCompletedPacketDownloadAuthorizedRequest(rawToken: string) {
  const claims = verifyCompletedPacketDownloadToken(rawToken);
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("enrollment_packet_requests")
    .select("*")
    .eq("id", claims.packetId)
    .eq("member_id", claims.memberId)
    .eq("status", "completed")
    .maybeSingle();
  if (error) throwEnrollmentPacketSchemaError(error, "enrollment_packet_requests");

  const request = (data as EnrollmentPacketRequestRow | null) ?? null;
  if (!request) return null;
  if (clean(request.completed_at) !== claims.completedAt) {
    throw new Error("Completed enrollment packet download authorization is invalid.");
  }
  return request;
}

async function loadLatestCompletedPacketArtifact(packetId: string) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("enrollment_packet_uploads")
    .select("file_path, file_name, file_type, uploaded_at")
    .eq("packet_id", packetId)
    .eq("upload_category", "completed_packet")
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throwEnrollmentPacketSchemaError(error, "enrollment_packet_uploads");
  if (!data) {
    throw new Error("Completed enrollment packet PDF could not be found.");
  }

  const objectPath = parseMemberDocumentStorageUri(data.file_path);
  if (!objectPath) {
    throw new Error("Completed enrollment packet PDF storage path is invalid.");
  }

  return {
    fileName: clean(data.file_name) ?? `Enrollment Packet Completed - ${packetId}.pdf`,
    fileType: clean(data.file_type) ?? "application/pdf",
    objectPath
  };
}

export async function issuePublicCompletedEnrollmentPacketDownloadToken(input: {
  token: string;
}) {
  const context = await getPublicEnrollmentPacketContext(input.token);
  if (context.state !== "completed") {
    throw new Error("Completed enrollment packet is not available.");
  }

  return {
    packetId: context.request.id,
    downloadToken: createCompletedPacketDownloadToken({
      packetId: context.request.id,
      memberId: context.request.memberId,
      completedAt: context.request.completedAt
    })
  };
}

export async function getPublicCompletedEnrollmentPacketArtifact(input: {
  token: string;
}) {
  const request = await loadCompletedPacketDownloadAuthorizedRequest(input.token);
  if (!request) {
    throw new Error("Completed enrollment packet is not available.");
  }

  const artifact = await loadLatestCompletedPacketArtifact(request.id);

  return {
    packetId: request.id,
    fileName: artifact.fileName,
    fileType: artifact.fileType,
    objectPath: artifact.objectPath
  };
}

export async function persistFinalizedPublicEnrollmentPacketArtifacts(input: {
  request: EnrollmentPacketRequestRow;
  member: MemberRow;
  artifactFields: EnrollmentPacketFieldsRow;
  caregiverTypedName: string;
  senderSignatureName: string;
  caregiverSignatureDataUrl: string;
  caregiverSignature: {
    contentType: string;
    bytes: Buffer;
  };
  uploads: PacketFileUpload[];
  finalizedAt: string;
}) {
  const artifactOps = await loadEnrollmentPacketArtifactOps();
  const uploadBatchId = randomUUID();
  const stagedUploads: PersistedPublicEnrollmentPacketUpload[] = [];
  const uploadedArtifacts: PersistedPublicEnrollmentPacketArtifact[] = [];

  const signatureArtifact = await artifactOps.insertUploadAndFile({
    packetId: input.request.id,
    memberId: input.member.id,
    batchId: uploadBatchId,
    fileName: `Enrollment Packet Signature - ${toEasternDate(input.finalizedAt ?? toEasternISO())}.png`,
    contentType: input.caregiverSignature.contentType,
    bytes: input.caregiverSignature.bytes,
    uploadCategory: "signature_artifact",
    uploadedByUserId: null,
    uploadedByName: input.caregiverTypedName,
    dataUrl: input.caregiverSignatureDataUrl.trim(),
    finalizationStatus: "finalized",
    finalizedAt: input.finalizedAt
  });
  stagedUploads.push({
    uploadCategory: "signature_artifact",
    objectPath: signatureArtifact.objectPath,
    memberFileId: signatureArtifact.memberFileId,
    memberFileCreated: signatureArtifact.memberFileCreated
  });
  uploadedArtifacts.push({
    uploadCategory: "signature_artifact",
    memberFileId: signatureArtifact.memberFileId
  });

  for (const upload of input.uploads) {
    const uploadBytes = await upload.readBytes();
    const artifact = await artifactOps.insertUploadAndFile({
      packetId: input.request.id,
      memberId: input.member.id,
      batchId: uploadBatchId,
      fileName: upload.fileName,
      contentType: upload.contentType,
      bytes: uploadBytes,
      uploadCategory: upload.category,
      uploadedByUserId: null,
      uploadedByName: input.caregiverTypedName,
      finalizationStatus: "finalized",
      finalizedAt: input.finalizedAt
    });
    stagedUploads.push({
      uploadCategory: upload.category,
      objectPath: artifact.objectPath,
      memberFileId: artifact.memberFileId,
      memberFileCreated: artifact.memberFileCreated
    });
    uploadedArtifacts.push({
      uploadCategory: upload.category,
      memberFileId: artifact.memberFileId
    });
  }

  const packetDocx = await artifactOps.buildCompletedPacketArtifactData({
    memberName: input.member.display_name,
    request: input.request,
    fields: input.artifactFields,
    intakePayload: normalizeStoredIntakePayload(input.artifactFields),
    caregiverSignatureName: input.caregiverTypedName,
    senderSignatureName: input.senderSignatureName,
    uploadedDocuments: input.uploads.map((upload) => ({
      category: upload.category,
      fileName: upload.fileName
    }))
  });
  const finalPacketArtifact = await artifactOps.insertUploadAndFile({
    packetId: input.request.id,
    memberId: input.member.id,
    batchId: uploadBatchId,
    fileName: packetDocx.fileName,
    contentType: packetDocx.contentType,
    bytes: packetDocx.bytes,
    uploadCategory: "completed_packet",
    uploadedByUserId: null,
    uploadedByName: input.caregiverTypedName,
    dataUrl: packetDocx.dataUrl,
    finalizationStatus: "finalized",
    finalizedAt: input.finalizedAt
  });
  stagedUploads.push({
    uploadCategory: "completed_packet",
    objectPath: finalPacketArtifact.objectPath,
    memberFileId: finalPacketArtifact.memberFileId,
    memberFileCreated: finalPacketArtifact.memberFileCreated
  });
  uploadedArtifacts.push({
    uploadCategory: "completed_packet",
    memberFileId: finalPacketArtifact.memberFileId
  });

  return {
    uploadBatchId,
    stagedUploads,
    uploadedArtifacts
  };
}

export async function cleanupFinalizedPublicEnrollmentPacketArtifacts(input: {
  packetId: string;
  memberId: string;
  actorUserId: string;
  reason: string;
  uploadBatchId: string | null;
  stagedUploads: PersistedPublicEnrollmentPacketUpload[];
}) {
  if (input.stagedUploads.length === 0) return;

  const artifactOps = await loadEnrollmentPacketArtifactOps();
  await artifactOps.cleanupEnrollmentPacketUploadArtifacts({
    packetId: input.packetId,
    memberId: input.memberId,
    actorUserId: input.actorUserId,
    reason: input.reason,
    batchId: input.uploadBatchId,
    uploads: input.stagedUploads
  });
}
