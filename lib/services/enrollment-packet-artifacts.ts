import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

import { buildCompletedEnrollmentPacketDocxData } from "@/lib/services/enrollment-packet-docx";
import { type EnrollmentPacketIntakePayload } from "@/lib/services/enrollment-packet-intake-payload";
import {
  deleteMemberDocumentObject,
  deleteMemberFileRecordAndStorage,
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

export async function buildCompletedPacketArtifactData(input: {
  memberName: string;
  request: EnrollmentPacketRequestLike;
  fields: EnrollmentPacketFieldsLike;
  intakePayload: EnrollmentPacketIntakePayload;
  caregiverSignatureName: string;
  senderSignatureName: string;
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
    senderSignatureName: input.senderSignatureName
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
}) {
  const safeName = safeFileName(input.fileName) || `upload-${randomUUID()}`;
  const objectPath = `members/${input.memberId}/enrollment-packets/${input.packetId}/${input.uploadCategory}/${randomUUID()}-${slugify(safeName)}`;
  const storageUri = await uploadMemberDocumentObject({
    objectPath,
    bytes: input.bytes,
    contentType: input.contentType
  });

  let memberFile;
  try {
    memberFile = await upsertMemberFileBySource({
      memberId: input.memberId,
      documentSource: `Enrollment Packet ${input.uploadCategory}:${input.packetId}:${input.batchId}:${safeName}`,
      fileName: safeName,
      fileType: input.contentType,
      dataUrl: input.dataUrl ?? null,
      storageUri,
      category: [
        "insurance",
        "poa",
        "medicare_card",
        "private_insurance",
        "supplemental_insurance",
        "poa_guardianship",
        "dnr_dni_advance_directive",
        "signed_membership_agreement",
        "signed_exhibit_a_payment_authorization"
      ].includes(input.uploadCategory)
        ? "Legal"
        : "Admin",
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

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("enrollment_packet_uploads").insert({
    packet_id: input.packetId,
    member_id: input.memberId,
    file_path: storageUri,
    file_name: safeName,
    file_type: input.contentType,
    upload_category: input.uploadCategory,
    member_file_id: memberFile.id,
    finalization_batch_id: input.batchId,
    finalization_status: "staged",
    uploaded_at: toEasternISO()
  });
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
}) {
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("enrollment_packet_requests")
    .update({
      mapping_sync_status: input.status,
      mapping_sync_attempted_at: input.attemptedAt,
      mapping_sync_error: input.status === "failed" ? String(input.error ?? "").trim() || null : null,
      latest_mapping_run_id: input.mappingRunId ?? null,
      updated_at: input.attemptedAt
    })
    .eq("id", input.packetId);
  if (error) throw new Error(error.message);
}
