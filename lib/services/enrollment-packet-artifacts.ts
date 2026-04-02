import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";

import { buildCompletedEnrollmentPacketDocxData } from "@/lib/services/enrollment-packet-docx";
import { buildIdempotencyHash } from "@/lib/services/idempotency";
import { type EnrollmentPacketIntakePayload } from "@/lib/services/enrollment-packet-intake-payload";
import {
  deleteMemberDocumentObject,
  deleteMemberFileRecordAndStorage,
  type MemberFileCategory,
  parseMemberDocumentStorageUri,
  safeFileName,
  uploadMemberDocumentObject,
  upsertMemberFileByDocumentSource
} from "@/lib/services/member-files";
import { recordImmediateSystemAlert } from "@/lib/services/workflow-observability";
import { buildMissingSchemaMessage, isMissingSchemaObjectError } from "@/lib/supabase/schema-errors";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { toEasternISO } from "@/lib/timezone";

const ENROLLMENT_PACKET_UPLOAD_SCHEMA_MIGRATION = "0027_enrollment_packet_intake_mapping.sql";

type EnrollmentPacketRequestLike = {
  id: string;
};

type EnrollmentPacketFieldsLike = {
  requested_days: string[] | null;
  transportation: string | null;
  community_fee: number | null;
  daily_rate: number | null;
  caregiver_name: string | null;
  caregiver_phone: string | null;
  caregiver_email: string | null;
  caregiver_address_line1: string | null;
  caregiver_address_line2: string | null;
  caregiver_city: string | null;
  caregiver_state: string | null;
  caregiver_zip: string | null;
  secondary_contact_name: string | null;
  secondary_contact_phone: string | null;
  secondary_contact_email: string | null;
  secondary_contact_relationship: string | null;
};

type EnrollmentPacketUploadCategory =
  | "insurance"
  | "poa"
  | "supporting"
  | "medicare_card"
  | "private_insurance"
  | "supplemental_insurance"
  | "poa_guardianship"
  | "dnr_dni_advance_directive"
  | "signed_membership_agreement"
  | "signed_exhibit_a_payment_authorization"
  | "completed_packet"
  | "signature_artifact";

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function safeNumber(value: number | null | undefined, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function buildEnrollmentPacketDocumentSource(input: {
  packetId: string;
  uploadCategory: EnrollmentPacketUploadCategory;
  fileName: string;
  uploadFingerprint?: string | null;
}) {
  if (input.uploadCategory === "completed_packet") {
    return `enrollment-packet:${input.packetId}:completed`;
  }
  if (input.uploadCategory === "signature_artifact") {
    return `enrollment-packet:${input.packetId}:signature`;
  }
  const slug = input.uploadFingerprint?.trim() || slugify(input.fileName) || "file";
  return `enrollment-packet:${input.packetId}:${input.uploadCategory}:${slug}`;
}

function buildEnrollmentPacketUploadFingerprint(input: {
  packetId: string;
  uploadCategory: EnrollmentPacketUploadCategory;
  fileName: string;
  contentType: string;
  bytes: Buffer;
  clientUploadId?: string | null;
}) {
  const byteHash = createHash("sha256").update(input.bytes).digest("hex");
  return buildIdempotencyHash("enrollment-packet:upload", {
    packetId: input.packetId,
    uploadCategory: input.uploadCategory,
    fileName: safeFileName(input.fileName),
    contentType: input.contentType.trim(),
    byteLength: input.bytes.length,
    byteHash,
    clientUploadId: String(input.clientUploadId ?? "").trim() || null
  });
}

function resolveEnrollmentPacketMemberFileCategory(
  uploadCategory: EnrollmentPacketUploadCategory
): MemberFileCategory {
  if (uploadCategory === "completed_packet") return "Enrollment Packet";
  if (
    [
      "insurance",
      "poa",
      "medicare_card",
      "private_insurance",
      "supplemental_insurance",
      "poa_guardianship",
      "dnr_dni_advance_directive",
      "signed_membership_agreement",
      "signed_exhibit_a_payment_authorization"
    ].includes(uploadCategory)
  ) {
    return "Legal";
  }
  return "Admin";
}

export async function buildCompletedPacketArtifactData(input: {
  memberName: string;
  request: EnrollmentPacketRequestLike;
  fields: EnrollmentPacketFieldsLike;
  intakePayload: EnrollmentPacketIntakePayload;
  caregiverSignatureName: string;
  senderSignatureName: string;
  uploadedDocuments?: Array<{
    category: EnrollmentPacketUploadCategory;
    fileName: string;
  }>;
}) {
  return buildCompletedEnrollmentPacketDocxData({
    memberName: input.memberName,
    packetId: input.request.id,
    requestedDays: input.fields.requested_days ?? [],
    transportation: input.fields.transportation,
    communityFee: safeNumber(input.fields.community_fee),
    dailyRate: safeNumber(input.fields.daily_rate),
    caregiverName: input.fields.caregiver_name,
    caregiverPhone: input.fields.caregiver_phone,
    caregiverEmail: input.fields.caregiver_email,
    caregiverAddressLine1: input.fields.caregiver_address_line1,
    caregiverAddressLine2: input.fields.caregiver_address_line2,
    caregiverCity: input.fields.caregiver_city,
    caregiverState: input.fields.caregiver_state,
    caregiverZip: input.fields.caregiver_zip,
    secondaryContactName: input.fields.secondary_contact_name,
    secondaryContactPhone: input.fields.secondary_contact_phone,
    secondaryContactEmail: input.fields.secondary_contact_email,
    secondaryContactRelationship: input.fields.secondary_contact_relationship,
    intakePayload: input.intakePayload,
    caregiverSignatureName: input.caregiverSignatureName,
    senderSignatureName: input.senderSignatureName,
    uploadedDocuments: input.uploadedDocuments ?? []
  });
}

async function upsertMemberFileBySource(input: {
  memberId: string;
  documentSource: string;
  fileName: string;
  fileType: string;
  dataUrl: string | null;
  storageUri: string | null;
  category: string;
  uploadedByUserId: string | null;
  uploadedByName: string | null;
  packetId: string;
}) {
  const now = toEasternISO();
  return upsertMemberFileByDocumentSource({
    memberId: input.memberId,
    documentSource: input.documentSource,
    fileName: input.fileName,
    fileType: input.fileType,
    dataUrl: input.dataUrl ?? null,
    storageObjectPath: parseMemberDocumentStorageUri(input.storageUri),
    category: input.category,
    uploadedByUserId: input.uploadedByUserId,
    uploadedByName: input.uploadedByName,
    uploadedAtIso: now,
    updatedAtIso: now,
    additionalColumns: {
      enrollment_packet_request_id: input.packetId
    }
  });
}

export async function repairEnrollmentPacketUploadMemberFileLinks(packetId: string) {
  const normalizedPacketId = String(packetId ?? "").trim();
  if (!normalizedPacketId) return 0;

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("enrollment_packet_uploads")
    .select("packet_id, member_id, member_file_id, file_name, file_type, file_path, upload_category")
    .eq("packet_id", normalizedPacketId)
    .not("member_file_id", "is", null);
  if (error) throw new Error(error.message);

  const rows = (data ??
    []) as Array<{
    packet_id: string;
    member_id: string;
    member_file_id: string | null;
    file_name: string | null;
    file_type: string | null;
    file_path: string | null;
    upload_category: EnrollmentPacketUploadCategory;
  }>;
  if (rows.length === 0) return 0;

  const now = toEasternISO();
  for (const row of rows) {
    const memberFileId = String(row.member_file_id ?? "").trim();
    if (!memberFileId) continue;
    const fileName = safeFileName(String(row.file_name ?? "").trim()) || `${memberFileId}.pdf`;
    await upsertMemberFileByDocumentSource({
      memberId: row.member_id,
      documentSource: buildEnrollmentPacketDocumentSource({
        packetId: row.packet_id,
        uploadCategory: row.upload_category,
        fileName
      }),
      memberFileId,
      fileName,
      fileType: String(row.file_type ?? "").trim() || "application/octet-stream",
      dataUrl: null,
      storageObjectPath: parseMemberDocumentStorageUri(row.file_path),
      category: resolveEnrollmentPacketMemberFileCategory(row.upload_category),
      updatedAtIso: now,
      additionalColumns: {
        enrollment_packet_request_id: row.packet_id
      }
    });
  }

  return rows.length;
}

export async function insertUploadAndFile(input: {
  packetId: string;
  memberId: string;
  batchId: string;
  fileName: string;
  contentType: string;
  bytes: Buffer;
  uploadCategory: EnrollmentPacketUploadCategory;
  uploadedByUserId: string | null;
  uploadedByName: string | null;
  dataUrl?: string | null;
  clientUploadId?: string | null;
}) {
  const safeName = safeFileName(input.fileName) || `upload-${randomUUID()}`;
  const uploadFingerprint = buildEnrollmentPacketUploadFingerprint({
    packetId: input.packetId,
    uploadCategory: input.uploadCategory,
    fileName: safeName,
    contentType: input.contentType,
    bytes: input.bytes,
    clientUploadId: input.clientUploadId ?? null
  });
  const objectPath = `members/${input.memberId}/enrollment-packets/${input.packetId}/${input.uploadCategory}/${uploadFingerprint}-${slugify(safeName)}`;
  const admin = createSupabaseAdminClient();
  const { data: existingUpload, error: existingUploadError } = await admin
    .from("enrollment_packet_uploads")
    .select("file_path, member_file_id")
    .eq("packet_id", input.packetId)
    .eq("upload_category", input.uploadCategory)
    .eq("upload_fingerprint", uploadFingerprint)
    .maybeSingle();
  if (existingUploadError) {
    if (isMissingSchemaObjectError(existingUploadError)) {
      throw new Error(
        buildMissingSchemaMessage({
          objectName: "enrollment_packet_uploads",
          migration: ENROLLMENT_PACKET_UPLOAD_SCHEMA_MIGRATION
        })
      );
    }
    throw new Error(existingUploadError.message);
  }
  const existingStorageUri = String((existingUpload as { file_path?: string | null } | null)?.file_path ?? "").trim();
  const existingMemberFileId = String((existingUpload as { member_file_id?: string | null } | null)?.member_file_id ?? "").trim();
  if (existingStorageUri && existingMemberFileId) {
    return {
      storageUri: existingStorageUri,
      objectPath: parseMemberDocumentStorageUri(existingStorageUri) ?? objectPath,
      memberFileId: existingMemberFileId,
      memberFileCreated: false
    };
  }
  const storageUri = await uploadMemberDocumentObject({
    objectPath,
    bytes: input.bytes,
    contentType: input.contentType
  });

  let memberFile;
  try {
    memberFile = await upsertMemberFileBySource({
      memberId: input.memberId,
      documentSource: buildEnrollmentPacketDocumentSource({
        packetId: input.packetId,
        uploadCategory: input.uploadCategory,
        fileName: safeName,
        uploadFingerprint
      }),
      fileName: safeName,
      fileType: input.contentType,
      dataUrl: input.dataUrl ?? null,
      storageUri,
      category: resolveEnrollmentPacketMemberFileCategory(input.uploadCategory),
      uploadedByUserId: input.uploadedByUserId,
      uploadedByName: input.uploadedByName,
      packetId: input.packetId
    });
  } catch (error) {
    try {
      await deleteMemberDocumentObject(objectPath);
    } catch (cleanupError) {
      console.error("[enrollment-packets] unable to cleanup orphaned upload object after member_files failure", cleanupError);
    }
    throw error;
  }

  const { error } = await admin
    .from("enrollment_packet_uploads")
    .upsert(
      {
        packet_id: input.packetId,
        member_id: input.memberId,
        file_path: storageUri,
        file_name: safeName,
        file_type: input.contentType,
        upload_category: input.uploadCategory,
        upload_fingerprint: uploadFingerprint,
        member_file_id: memberFile.id,
        finalization_batch_id: input.batchId,
        finalization_status: "staged",
        uploaded_at: toEasternISO()
      },
      {
        onConflict: "packet_id,upload_category,upload_fingerprint"
      }
    );
  if (error) {
    if (memberFile.created) {
      try {
        await deleteMemberFileRecordAndStorage({
          memberFileId: memberFile.id,
          storageObjectPath: objectPath,
          actorUserId: input.uploadedByUserId,
          entityType: "enrollment_packet_request",
          entityId: input.packetId,
          alertKey: "enrollment_packet_upload_storage_cleanup_failed",
          metadata: {
            member_id: input.memberId,
            upload_category: input.uploadCategory
          }
        });
      } catch (cleanupError) {
        console.error("[enrollment-packets] unable to cleanup upload artifacts after enrollment_packet_uploads failure", cleanupError);
      }
    } else {
      try {
        await recordImmediateSystemAlert({
          entityType: "enrollment_packet_request",
          entityId: input.packetId,
          severity: "high",
          alertKey: "enrollment_packet_upload_split_brain",
          metadata: {
            upload_category: input.uploadCategory,
            member_id: input.memberId,
            member_file_id: memberFile.id,
            storage_uri: storageUri
          }
        });
      } catch (alertError) {
        console.error("[enrollment-packets] unable to record split-brain alert", alertError);
      }
    }

    const text = String(error.message ?? "").toLowerCase();
    if (
      text.includes("enrollment_packet_uploads_upload_category_check") ||
      text.includes("upload_category") ||
      isMissingSchemaObjectError(error)
    ) {
      throw new Error(
        buildMissingSchemaMessage({
          objectName: "enrollment_packet_uploads",
          migration: ENROLLMENT_PACKET_UPLOAD_SCHEMA_MIGRATION
        })
      );
    }
    throw new Error(error.message);
  }

  return {
    storageUri,
    objectPath,
    memberFileId: memberFile.id,
    memberFileCreated: memberFile.created
  };
}

export async function cleanupEnrollmentPacketUploadArtifacts(input: {
  packetId: string;
  memberId: string;
  actorUserId: string | null;
  reason: string;
  batchId?: string | null;
  uploads: Array<{
    objectPath: string;
    memberFileId: string | null;
    memberFileCreated: boolean;
  }>;
}) {
  const batchId = String(input.batchId ?? "").trim() || null;
  const reusableArtifacts = input.uploads.filter((upload) => !upload.memberFileCreated && upload.memberFileId);
  if (reusableArtifacts.length > 0) {
    await recordImmediateSystemAlert({
      entityType: "enrollment_packet_request",
      entityId: input.packetId,
      actorUserId: input.actorUserId,
      severity: "high",
      alertKey: "enrollment_packet_finalize_split_brain",
      metadata: {
        member_id: input.memberId,
        reason: input.reason,
        reusable_member_file_ids: reusableArtifacts.map((upload) => upload.memberFileId)
      }
    });
  }

  if (batchId) {
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from("enrollment_packet_uploads")
      .delete()
      .eq("packet_id", input.packetId)
      .eq("finalization_status", "staged")
      .eq("finalization_batch_id", batchId);
    if (error) {
      await recordImmediateSystemAlert({
        entityType: "enrollment_packet_request",
        entityId: input.packetId,
        actorUserId: input.actorUserId,
        severity: "high",
        alertKey: "enrollment_packet_upload_row_cleanup_failed",
        metadata: {
          member_id: input.memberId,
          batch_id: batchId,
          reason: input.reason,
          error: error.message
        }
      });
    }
  }

  const cleanupTargets = input.uploads.filter((upload) => upload.memberFileCreated);
  for (const upload of cleanupTargets) {
    try {
      if (upload.memberFileId) {
        await deleteMemberFileRecordAndStorage({
          memberFileId: upload.memberFileId,
          storageObjectPath: upload.objectPath,
          actorUserId: input.actorUserId,
          entityType: "enrollment_packet_request",
          entityId: input.packetId,
          alertKey: "enrollment_packet_finalize_storage_cleanup_failed",
          metadata: {
            member_id: input.memberId,
            reason: input.reason
          }
        });
      } else {
        await deleteMemberDocumentObject(upload.objectPath);
      }
    } catch (cleanupError) {
      await recordImmediateSystemAlert({
        entityType: "enrollment_packet_request",
        entityId: input.packetId,
        actorUserId: input.actorUserId,
        severity: "high",
        alertKey: "enrollment_packet_finalize_cleanup_failed",
        metadata: {
          member_id: input.memberId,
          reason: input.reason,
          cleanup_error: cleanupError instanceof Error ? cleanupError.message : "Unknown cleanup error.",
          object_path: upload.objectPath,
          member_file_id: upload.memberFileId
        }
      });
    }
  }
}

export async function updateEnrollmentPacketMappingSyncState(input: {
  packetId: string;
  status: "pending" | "completed" | "failed";
  attemptedAt: string;
  error?: string | null;
  mappingRunId?: string | null;
  clearClaim?: boolean;
}) {
  const admin = createSupabaseAdminClient();
  const shouldClearClaim = input.clearClaim ?? input.status !== "pending";
  const { error } = await admin
    .from("enrollment_packet_requests")
    .update({
      mapping_sync_status: input.status,
      mapping_sync_attempted_at: input.attemptedAt,
      mapping_sync_error: input.status === "failed" ? String(input.error ?? "").trim() || null : null,
      latest_mapping_run_id: input.mappingRunId ?? null,
      mapping_sync_claimed_at: shouldClearClaim ? null : undefined,
      mapping_sync_claimed_by_user_id: shouldClearClaim ? null : undefined,
      mapping_sync_claimed_by_name: shouldClearClaim ? null : undefined,
      updated_at: input.attemptedAt
    })
    .eq("id", input.packetId);
  if (error) throw new Error(error.message);
}

export async function updateEnrollmentPacketCompletionFollowUpState(input: {
  packetId: string;
  status: "pending" | "completed" | "action_required";
  checkedAt: string;
  error?: string | null;
}) {
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("enrollment_packet_requests")
    .update({
      completion_follow_up_status: input.status,
      completion_follow_up_checked_at: input.checkedAt,
      completion_follow_up_error: input.status === "action_required" ? String(input.error ?? "").trim() || null : null,
      updated_at: input.checkedAt
    })
    .eq("id", input.packetId);
  if (error) throw new Error(error.message);
}

export async function releaseEnrollmentPacketMappingClaim(input: {
  packetId: string;
  updatedAt: string;
}) {
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("enrollment_packet_requests")
    .update({
      mapping_sync_claimed_at: null,
      mapping_sync_claimed_by_user_id: null,
      mapping_sync_claimed_by_name: null,
      updated_at: input.updatedAt
    })
    .eq("id", input.packetId);
  if (error) throw new Error(error.message);
}
