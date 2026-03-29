import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

import { canAccessClinicalDocumentationForRole, canAccessModule, canPerformModuleAction, normalizeRoleKey } from "@/lib/permissions";
import { resolveCanonicalMemberId } from "@/lib/services/canonical-person-ref";
import { recordImmediateSystemAlert } from "@/lib/services/workflow-observability";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";
import { createClient } from "@/lib/supabase/server";
import { toEasternDate, toEasternISO } from "@/lib/timezone";

export const MEMBER_DOCUMENTS_BUCKET = "member-documents";
const UPSERT_MEMBER_FILE_BY_SOURCE_RPC = "rpc_upsert_member_file_by_source";
const DELETE_MEMBER_FILE_RECORD_RPC = "rpc_delete_member_file_record";
const MEMBER_FILE_RPC_MIGRATION = "0073_delivery_and_member_file_rpc_hardening.sql";

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

type SaveGeneratedMemberPdfInput = {
  memberId: string;
  memberName: string;
  documentLabel: string;
  fileNameOverride?: string | null;
  documentSource: string;
  carePlanId?: string | null;
  category: MemberFileCategory;
  categoryOther?: string | null;
  dataUrl: string;
  uploadedBy: {
    id: string;
    name: string;
  };
  generatedAtIso?: string;
  replaceExistingByDocumentSource?: boolean;
};

export function safeFileName(value: string) {
  return value.replace(/[<>:"/\\|?*]/g, "").trim();
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

function slugifyMemberFileSegment(value: string) {
  return safeFileName(value)
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function isUniqueViolation(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" && code === "23505";
}

type MemberFileMutationActor = {
  id: string;
  fullName: string;
  role: string;
  permissions?: Parameters<typeof canPerformModuleAction>[3];
};

function assertAuthorizedMemberFileMutator(actor: MemberFileMutationActor) {
  const normalizedRole = normalizeRoleKey(actor.role);
  const hasOperationsEdit = canPerformModuleAction(normalizedRole, "operations", "canEdit", actor.permissions);
  if (normalizedRole !== "admin" && normalizedRole !== "manager" && !hasOperationsEdit) {
    throw new Error("Only authorized operations editors can manage member files.");
  }
}

function assertAuthorizedMemberFileDownloader(
  actor: MemberFileMutationActor,
  category: string | null | undefined
) {
  const normalizedRole = normalizeRoleKey(actor.role);
  const hasOperationsView = canAccessModule(normalizedRole, "operations", actor.permissions);
  const hasClinicalAccess = canAccessClinicalDocumentationForRole(normalizedRole);
  const normalizedCategory = String(category ?? "").trim() as MemberFileCategory;

  if (!hasOperationsView && !hasClinicalAccess) {
    throw new Error("You do not have access to member files.");
  }

  if (CLINICAL_MEMBER_FILE_CATEGORIES.has(normalizedCategory) && !hasClinicalAccess) {
    throw new Error("You do not have access to clinical member files.");
  }
}

function buildManualUploadDocumentSource(uploadToken: string) {
  return `mcc_manual_upload:${uploadToken}`;
}

async function loadMemberFileRowById(memberFileId: string) {
  const normalized = String(memberFileId ?? "").trim();
  if (!normalized) return null;

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("member_files").select("*").eq("id", normalized).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function createSignedMemberDocumentUrl(objectPath: string, expiresInSeconds = 60 * 15) {
  const normalized = String(objectPath ?? "").trim();
  if (!normalized) throw new Error("Storage object path is required.");

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.storage.from(MEMBER_DOCUMENTS_BUCKET).createSignedUrl(normalized, expiresInSeconds);
  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? "Unable to create member file download URL.");
  }
  return data.signedUrl;
}

function isDataUrl(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase().startsWith("data:");
}

type LegacyMemberFileBackfillRow = {
  id: string;
  member_id: string;
  file_name: string | null;
  file_type: string | null;
  file_data_url: string | null;
  storage_object_path?: string | null;
};

export async function backfillLegacyMemberFileStorage(row: LegacyMemberFileBackfillRow) {
  const existingStoragePath = String(row.storage_object_path ?? "").trim();
  if (existingStoragePath) return existingStoragePath;

  const legacyValue = String(row.file_data_url ?? "").trim();
  if (!legacyValue) return null;

  let objectPath: string | null = parseMemberDocumentStorageUri(legacyValue);
  if (!objectPath) {
    if (!isDataUrl(legacyValue)) {
      throw new Error("Legacy member file data is neither a supported data URL nor a storage URI.");
    }
    const parsed = parseDataUrlPayload(legacyValue, "Stored member file data is invalid.");
    const objectName = slugifyMemberFileSegment(String(row.file_name ?? "").trim() || `${row.id}.pdf`) || `${row.id}.pdf`;
    objectPath = `members/${row.member_id}/member-files/legacy/${row.id}-${objectName}`;
    await uploadMemberDocumentObject({
      objectPath,
      bytes: parsed.bytes,
      contentType: String(row.file_type ?? "").trim() || parsed.contentType || "application/octet-stream"
    });
  }

  const admin = createSupabaseAdminClient();
  try {
    await invokeSupabaseRpcOrThrow<unknown>(admin, UPSERT_MEMBER_FILE_BY_SOURCE_RPC, {
      p_member_id: row.member_id,
      p_document_source: null,
      p_member_file_id: row.id,
      p_file_name: null,
      p_file_type: null,
      p_file_data_url: null,
      p_storage_object_path: objectPath,
      p_category: null,
      p_category_other: null,
      p_uploaded_by_user_id: null,
      p_uploaded_by_name: null,
      p_uploaded_at: null,
      p_updated_at: toEasternISO(),
      p_care_plan_id: null,
      p_pof_request_id: null,
      p_enrollment_packet_request_id: null
    });
  } catch (error) {
    const updateErrorMessage = error instanceof Error ? error.message : "Unable to update legacy member file storage.";
    if (isDataUrl(legacyValue)) {
      try {
        await deleteMemberDocumentObject(objectPath);
      } catch (cleanupError) {
        await recordImmediateSystemAlert({
          entityType: "member_file",
          entityId: row.id,
          severity: "high",
          alertKey: "member_file_legacy_backfill_cleanup_failed",
          metadata: {
            member_id: row.member_id,
            storage_object_path: objectPath,
            backfill_error: updateErrorMessage,
            cleanup_error: cleanupError instanceof Error ? cleanupError.message : "Unknown cleanup error."
          }
        });
      }
    }
    throw error;
  }

  return objectPath;
}

export async function backfillLegacyMemberFileStorageBatch(input?: {
  limit?: number;
  actorUserId?: string | null;
}) {
  const limit = Math.max(1, Math.min(500, Number(input?.limit ?? 100)));
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("member_files")
    .select("id, member_id, file_name, file_type, file_data_url, storage_object_path")
    .is("storage_object_path", null)
    .not("file_data_url", "is", null)
    .order("uploaded_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as LegacyMemberFileBackfillRow[];
  let repaired = 0;
  const failures: Array<{ id: string; error: string }> = [];

  for (const row of rows) {
    try {
      const repairedPath = await backfillLegacyMemberFileStorage(row);
      if (repairedPath) repaired += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown legacy member file backfill error.";
      failures.push({ id: row.id, error: message });
      await recordImmediateSystemAlert({
        entityType: "member_file",
        entityId: row.id,
        actorUserId: input?.actorUserId ?? null,
        severity: "high",
        alertKey: "member_file_legacy_backfill_failed",
        metadata: {
          member_id: row.member_id,
          file_name: row.file_name,
          error: message
        }
      });
    }
  }

  return {
    scanned: rows.length,
    repaired,
    failures
  };
}

export async function uploadMemberDocumentObject(input: {
  objectPath: string;
  bytes: Buffer;
  contentType: string;
}) {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.storage.from(MEMBER_DOCUMENTS_BUCKET).upload(input.objectPath, input.bytes, {
    contentType: input.contentType,
    upsert: true
  });
  if (error) throw new Error(error.message);
  return buildMemberDocumentStorageUri(input.objectPath);
}

export async function deleteMemberDocumentObject(objectPath: string) {
  const normalized = String(objectPath ?? "").trim();
  if (!normalized) return;

  const admin = createSupabaseAdminClient();
  const { error } = await admin.storage.from(MEMBER_DOCUMENTS_BUCKET).remove([normalized]);
  if (error) throw new Error(error.message);
}

export async function deleteMemberFileRecord(memberFileId: string) {
  const normalized = String(memberFileId ?? "").trim();
  if (!normalized) return;

  const admin = createSupabaseAdminClient();
  try {
    await invokeSupabaseRpcOrThrow<unknown>(admin, DELETE_MEMBER_FILE_RECORD_RPC, {
      p_member_file_id: normalized
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to delete member file record.";
    if (message.includes(DELETE_MEMBER_FILE_RECORD_RPC)) {
      throw new Error(
        `Member file delete RPC is not available. Apply Supabase migration ${MEMBER_FILE_RPC_MIGRATION} and refresh PostgREST schema cache.`
      );
    }
    throw error;
  }
}

export async function deleteMemberFileRecordAndStorage(input: {
  memberFileId: string;
  storageObjectPath?: string | null;
  actorUserId?: string | null;
  entityType: string;
  entityId?: string | null;
  alertKey: string;
  metadata?: Record<string, unknown>;
}) {
  const memberFileId = String(input.memberFileId ?? "").trim();
  if (!memberFileId) return { recordDeleted: false, storageDeleted: false };

  const storageObjectPath = String(input.storageObjectPath ?? "").trim() || null;
  if (storageObjectPath) {
    try {
      await deleteMemberDocumentObject(storageObjectPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to delete member file storage object.";
      await recordImmediateSystemAlert({
        entityType: input.entityType,
        entityId: input.entityId ?? memberFileId,
        actorUserId: input.actorUserId ?? null,
        severity: "high",
        alertKey: input.alertKey,
        metadata: {
          member_file_id: memberFileId,
          storage_object_path: storageObjectPath,
          delete_phase: "storage_cleanup",
          error: message,
          ...(input.metadata ?? {})
        }
      });
      throw new Error(
        "Member file delete stopped before removing the database row because storage cleanup failed. Review operational alerts before retrying."
      );
    }
  }

  try {
    await deleteMemberFileRecord(memberFileId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to delete member file record.";
    await recordImmediateSystemAlert({
      entityType: input.entityType,
      entityId: input.entityId ?? memberFileId,
      actorUserId: input.actorUserId ?? null,
      severity: "high",
      alertKey: `${input.alertKey}_record_delete_failed`,
      metadata: {
        member_file_id: memberFileId,
        storage_object_path: storageObjectPath,
        delete_phase: "record_delete",
        error: message,
        ...(input.metadata ?? {})
      }
    });
    throw new Error(
      storageObjectPath
        ? "Member file storage was deleted, but the database row could not be removed. Review operational alerts before considering the delete complete."
        : "Member file database row could not be removed."
    );
  }

  return {
    recordDeleted: true,
    storageDeleted: Boolean(storageObjectPath)
  };
}

export async function upsertMemberFileByDocumentSource(input: {
  memberId: string;
  documentSource: string;
  memberFileId?: string | null;
  fileName: string;
  fileType: string;
  dataUrl?: string | null;
  storageObjectPath?: string | null;
  category: string;
  categoryOther?: string | null;
  uploadedByUserId?: string | null;
  uploadedByName?: string | null;
  uploadedAtIso?: string | null;
  updatedAtIso?: string | null;
  additionalColumns?: Record<string, unknown>;
  supabase?: Awaited<ReturnType<typeof createClient>>;
}) {
  const now = input.updatedAtIso ?? input.uploadedAtIso ?? toEasternISO();
  const admin = input.supabase ?? createSupabaseAdminClient();
  type UpsertResultRow = {
    member_file_id: string;
    was_created: boolean;
  };

  try {
    const data = await invokeSupabaseRpcOrThrow<unknown>(admin, UPSERT_MEMBER_FILE_BY_SOURCE_RPC, {
      p_member_id: input.memberId,
      p_document_source: input.documentSource,
      p_member_file_id: input.memberFileId ?? null,
      p_file_name: input.fileName,
      p_file_type: input.fileType,
      p_file_data_url: input.dataUrl ?? null,
      p_storage_object_path: input.storageObjectPath ?? null,
      p_category: input.category,
      p_category_other: input.categoryOther ?? null,
      p_uploaded_by_user_id: input.uploadedByUserId ?? null,
      p_uploaded_by_name: input.uploadedByName ?? null,
      p_uploaded_at: input.uploadedAtIso ?? now,
      p_updated_at: now,
      p_care_plan_id: input.additionalColumns?.care_plan_id ?? null,
      p_pof_request_id: input.additionalColumns?.pof_request_id ?? null,
      p_enrollment_packet_request_id: input.additionalColumns?.enrollment_packet_request_id ?? null
    });
    const row = (Array.isArray(data) ? data[0] : null) as UpsertResultRow | null;
    if (!row?.member_file_id) {
      throw new Error("Member file upsert RPC did not return a member file id.");
    }
    return {
      id: row.member_file_id,
      created: row.was_created
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to upsert member file.";
    if (message.includes(UPSERT_MEMBER_FILE_BY_SOURCE_RPC)) {
      throw new Error(
        `Member file upsert RPC is not available. Apply Supabase migration ${MEMBER_FILE_RPC_MIGRATION} and refresh PostgREST schema cache.`
      );
    }
    if (isUniqueViolation(error)) {
      const { data: conflicted, error: conflictedError } = await admin
        .from("member_files")
        .select("id")
        .eq("member_id", input.memberId)
        .eq("document_source", input.documentSource)
        .maybeSingle();
      if (conflictedError) throw new Error(conflictedError.message);
      if (conflicted?.id) {
        return { id: String(conflicted.id), created: false as const };
      }
    }
    throw error;
  }
}

export async function saveCommandCenterMemberFileUpload(input: {
  actor: MemberFileMutationActor;
  memberId: string;
  fileName: string;
  fileType?: string | null;
  fileDataUrl: string;
  category: MemberFileCategory;
  categoryOther?: string | null;
  documentSource?: string | null;
  uploadToken: string;
}) {
  assertAuthorizedMemberFileMutator(input.actor);

  const memberId = await resolveCanonicalMemberId(input.memberId, {
    actionLabel: "saveCommandCenterMemberFileUpload"
  });
  const uploadToken = String(input.uploadToken ?? "").trim();
  if (!uploadToken) throw new Error("Upload token is required.");

  const now = toEasternISO();
  const fileName = safeFileName(input.fileName) || `member-file-${uploadToken}`;
  const categoryOther = input.category === "Other" ? String(input.categoryOther ?? "").trim() || null : null;
  const parsed = parseDataUrlPayload(input.fileDataUrl, "Unable to read uploaded member file.");
  const contentType = String(input.fileType ?? "").trim() || parsed.contentType || "application/octet-stream";
  const objectName = slugifyMemberFileSegment(fileName) || `member-file-${uploadToken}`;
  const objectPath = `members/${memberId}/member-files/manual/${uploadToken}-${objectName}`;
  const storageUri = await uploadMemberDocumentObject({
    objectPath,
    bytes: parsed.bytes,
    contentType
  });

  const documentSource = String(input.documentSource ?? "").trim() || buildManualUploadDocumentSource(uploadToken);
  let memberFile;
  try {
    memberFile = await upsertMemberFileByDocumentSource({
      memberId,
      documentSource,
      fileName,
      fileType: contentType,
      dataUrl: null,
      storageObjectPath: parseMemberDocumentStorageUri(storageUri),
      category: input.category,
      categoryOther,
      uploadedByUserId: input.actor.id,
      uploadedByName: input.actor.fullName,
      uploadedAtIso: now,
      updatedAtIso: now
    });
  } catch (error) {
    try {
      await deleteMemberDocumentObject(objectPath);
    } catch (cleanupError) {
      await recordImmediateSystemAlert({
        entityType: "member_file",
        entityId: null,
        actorUserId: input.actor.id,
        severity: "high",
        alertKey: "member_file_upload_cleanup_failed",
        metadata: {
          member_id: memberId,
          document_source: documentSource,
          storage_object_path: objectPath,
          upload_error: error instanceof Error ? error.message : "Unknown member file write error.",
          cleanup_error: cleanupError instanceof Error ? cleanupError.message : "Unknown cleanup error."
        }
      });
    }
    throw error;
  }

  const created = await loadMemberFileRowById(memberFile.id);
  if (!created) {
    throw new Error("Member file upload completed, but the saved row could not be loaded.");
  }
  return created;
}

export async function deleteCommandCenterMemberFile(input: {
  actor: MemberFileMutationActor;
  memberFileId: string;
  memberId?: string | null;
}) {
  assertAuthorizedMemberFileMutator(input.actor);

  const existing = await loadMemberFileRowById(input.memberFileId);
  if (!existing) return false;

  const expectedMemberId = String(input.memberId ?? "").trim();
  const canonicalExpectedMemberId = expectedMemberId
    ? await resolveCanonicalMemberId(expectedMemberId, {
        actionLabel: "deleteCommandCenterMemberFile"
      })
    : null;
  if (canonicalExpectedMemberId && String(existing.member_id ?? "").trim() !== canonicalExpectedMemberId) {
    throw new Error("Member file/member mismatch.");
  }

  const storageObjectPath = String(existing.storage_object_path ?? "").trim() || null;
  await deleteMemberFileRecordAndStorage({
    memberFileId: String(existing.id),
    storageObjectPath,
    actorUserId: input.actor.id,
    entityType: "member_file",
    entityId: String(existing.id),
    alertKey: "member_file_storage_cleanup_failed",
    metadata: {
      member_id: String(existing.member_id ?? "")
    }
  });

  return true;
}

export async function getMemberFileDownloadUrl(input: {
  actor: MemberFileMutationActor;
  memberFileId: string;
  memberId?: string | null;
  expiresInSeconds?: number;
}) {
  const existing = await loadMemberFileRowById(input.memberFileId);
  if (!existing) throw new Error("Member file was not found.");

  const expectedMemberId = String(input.memberId ?? "").trim();
  const canonicalExpectedMemberId = expectedMemberId
    ? await resolveCanonicalMemberId(expectedMemberId, {
        actionLabel: "getMemberFileDownloadUrl"
      })
    : null;
  if (canonicalExpectedMemberId && String(existing.member_id ?? "").trim() !== canonicalExpectedMemberId) {
    throw new Error("Member file/member mismatch.");
  }
  assertAuthorizedMemberFileDownloader(input.actor, String(existing.category ?? ""));

  const storageObjectPath = String(existing.storage_object_path ?? "").trim() || null;
  if (storageObjectPath) {
    return {
      url: await createSignedMemberDocumentUrl(storageObjectPath, input.expiresInSeconds ?? 60 * 15),
      fileName: String(existing.file_name ?? "member-file")
    };
  }

  const backfilledStoragePath = await backfillLegacyMemberFileStorage({
    id: String(existing.id),
    member_id: String(existing.member_id),
    file_name: String(existing.file_name ?? ""),
    file_type: String(existing.file_type ?? ""),
    file_data_url: String(existing.file_data_url ?? ""),
    storage_object_path: null
  });
  if (!backfilledStoragePath) {
    throw new Error("Member file is missing both storage and inline data.");
  }

  return {
    url: await createSignedMemberDocumentUrl(backfilledStoragePath, input.expiresInSeconds ?? 60 * 15),
    fileName: String(existing.file_name ?? "member-file")
  };
}

export async function saveGeneratedMemberPdfToFiles(input: SaveGeneratedMemberPdfInput) {
  const now = input.generatedAtIso ?? toEasternISO();
  const memberId = await resolveCanonicalMemberId(input.memberId, {
    actionLabel: "saveGeneratedMemberPdfToFiles"
  });
  const admin = createSupabaseAdminClient();
  const defaultName =
    safeFileName(input.fileNameOverride ?? "") || buildDatedPdfFileName(input.documentLabel, input.memberName, now);
  const categoryOther = input.category === "Other" ? input.categoryOther ?? null : null;
  const parsed = parseDataUrlPayload(input.dataUrl, "Invalid generated PDF payload.");

  async function uploadGeneratedPdfObject(memberFileId: string, fileName: string) {
    const objectName = slugifyMemberFileSegment(fileName) || `${memberFileId}.pdf`;
    const objectPath = `members/${memberId}/member-files/generated/${memberFileId}-${objectName}`;
    await uploadMemberDocumentObject({
      objectPath,
      bytes: parsed.bytes,
      contentType: "application/pdf"
    });
    return objectPath;
  }

  if (input.replaceExistingByDocumentSource) {
    const { data: existing, error: existingError } = await admin
      .from("member_files")
      .select("id")
      .eq("member_id", memberId)
      .eq("document_source", input.documentSource)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingError) {
      throw new Error(existingError.message);
    }

    if (existing) {
      const existingId = String(existing.id);
      const storageObjectPath = await uploadGeneratedPdfObject(existingId, defaultName);
      let updated;
      try {
        await upsertMemberFileByDocumentSource({
          memberId,
          memberFileId: existingId,
          documentSource: input.documentSource,
          fileName: defaultName,
          fileType: "application/pdf",
          dataUrl: null,
          storageObjectPath,
          category: input.category,
          categoryOther,
          uploadedByUserId: input.uploadedBy.id,
          uploadedByName: input.uploadedBy.name,
          uploadedAtIso: now,
          updatedAtIso: now,
          additionalColumns: {
            care_plan_id: input.carePlanId ?? null
          },
          supabase: admin
        });
        const { data, error } = await admin.from("member_files").select("*").eq("id", existingId).maybeSingle();
        if (error) throw new Error(error.message);
        updated = data;
      } catch (error) {
        try {
          await deleteMemberDocumentObject(storageObjectPath);
        } catch (cleanupError) {
          await recordImmediateSystemAlert({
            entityType: "member_file",
            entityId: existingId,
            severity: "high",
            alertKey: "generated_member_file_cleanup_failed",
            metadata: {
              member_id: memberId,
              document_source: input.documentSource,
              storage_object_path: storageObjectPath,
              save_error: error instanceof Error ? error.message : "Unknown save error.",
              cleanup_error: cleanupError instanceof Error ? cleanupError.message : "Unknown cleanup error."
            }
          });
        }
        throw error;
      }

      if (updated) {
        return {
          created: updated,
          fileName: defaultName,
          generatedAtIso: now
        };
      }
    }
  }

  const { data: duplicateRows, error: duplicateError } = await admin
    .from("member_files")
    .select("id")
    .eq("member_id", memberId)
    .eq("file_name", defaultName);

  if (duplicateError) {
    throw new Error(duplicateError.message);
  }

  const hasConflict = (duplicateRows ?? []).length > 0;
  const fileName = hasConflict ? withDuplicateFileSuffix(defaultName, now) : defaultName;
  const memberFileId = nextMemberFileId();
  const storageObjectPath = await uploadGeneratedPdfObject(memberFileId, fileName);

  let created;
  try {
    const upserted = await upsertMemberFileByDocumentSource({
      memberId,
      memberFileId,
      documentSource: input.documentSource,
      fileName,
      fileType: "application/pdf",
      dataUrl: null,
      storageObjectPath,
      category: input.category,
      categoryOther,
      uploadedByUserId: input.uploadedBy.id,
      uploadedByName: input.uploadedBy.name,
      uploadedAtIso: now,
      updatedAtIso: now,
      additionalColumns: {
        care_plan_id: input.carePlanId ?? null
      },
      supabase: admin
    });
    const persistedMemberFileId = String(upserted.id ?? memberFileId).trim() || memberFileId;
    const { data, error } = await admin.from("member_files").select("*").eq("id", persistedMemberFileId).single();
    if (error) throw new Error(error.message);
    created = data;
  } catch (error) {
    try {
      await deleteMemberDocumentObject(storageObjectPath);
    } catch (cleanupError) {
      await recordImmediateSystemAlert({
        entityType: "member_file",
        entityId: memberFileId,
        severity: "high",
        alertKey: "generated_member_file_cleanup_failed",
        metadata: {
          member_id: memberId,
          document_source: input.documentSource,
          storage_object_path: storageObjectPath,
          save_error: error instanceof Error ? error.message : "Unknown save error.",
          cleanup_error: cleanupError instanceof Error ? cleanupError.message : "Unknown cleanup error."
        }
      });
    }
    throw error;
  }

  return {
    created,
    fileName,
    generatedAtIso: now
  };
}
