import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

import { canPerformModuleAction, normalizeRoleKey } from "@/lib/permissions";
import { resolveCanonicalMemberRef } from "@/lib/services/canonical-person-ref";
import { recordImmediateSystemAlert } from "@/lib/services/workflow-observability";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { toEasternDate, toEasternISO } from "@/lib/timezone";

export const MEMBER_DOCUMENTS_BUCKET = "member-documents";

export type MemberFileCategory =
  | "Health Unit"
  | "Legal"
  | "Admin"
  | "Assessment"
  | "Care Plan"
  | "Orders / POF"
  | "Billing"
  | "Name Badge"
  | "Other";

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
  const { error: updateError } = await admin
    .from("member_files")
    .update({
      storage_object_path: objectPath,
      file_data_url: null,
      updated_at: toEasternISO()
    })
    .eq("id", row.id);
  if (updateError) {
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
            backfill_error: updateError.message,
            cleanup_error: cleanupError instanceof Error ? cleanupError.message : "Unknown cleanup error."
          }
        });
      }
    }
    throw new Error(updateError.message);
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
  const { error } = await admin.from("member_files").delete().eq("id", normalized);
  if (error) throw new Error(error.message);
}

export async function upsertMemberFileByDocumentSource(input: {
  memberId: string;
  documentSource: string;
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
  supabase?: any;
}) {
  const now = input.updatedAtIso ?? input.uploadedAtIso ?? toEasternISO();
  const admin = input.supabase ?? createSupabaseAdminClient();
  const { data: existing, error: existingError } = await admin
    .from("member_files")
    .select("id")
    .eq("member_id", input.memberId)
    .eq("document_source", input.documentSource)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);

  const patch = {
    file_name: input.fileName,
    file_type: input.fileType,
    file_data_url: input.dataUrl ?? null,
    storage_object_path: input.storageObjectPath ?? null,
    category: input.category,
    category_other: input.categoryOther ?? null,
    document_source: input.documentSource,
    uploaded_by_user_id: input.uploadedByUserId ?? null,
    uploaded_by_name: input.uploadedByName ?? null,
    uploaded_at: input.uploadedAtIso ?? now,
    updated_at: now,
    ...(input.additionalColumns ?? {})
  };

  if (existing?.id) {
    const { error: updateError } = await admin.from("member_files").update(patch).eq("id", String(existing.id));
    if (updateError) throw new Error(updateError.message);
    return { id: String(existing.id), created: false as const };
  }

  const memberFileId = nextMemberFileId();
  const { error: insertError } = await admin.from("member_files").insert({
    id: memberFileId,
    member_id: input.memberId,
    ...patch
  });
  if (insertError) {
    if (isUniqueViolation(insertError)) {
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
    throw new Error(insertError.message);
  }
  return { id: memberFileId, created: true as const };
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

  const canonical = await resolveCanonicalMemberRef(
    {
      sourceType: "member",
      memberId: input.memberId,
      selectedId: input.memberId
    },
    {
      actionLabel: "saveCommandCenterMemberFileUpload"
    }
  );
  if (!canonical.memberId) {
    throw new Error("Member ID is required to upload a member file.");
  }

  const memberId = canonical.memberId;
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
  if (expectedMemberId && String(existing.member_id ?? "").trim() !== expectedMemberId) {
    throw new Error("Member file/member mismatch.");
  }

  const storageObjectPath = String(existing.storage_object_path ?? "").trim() || null;
  if (storageObjectPath) {
    await deleteMemberDocumentObject(storageObjectPath);
  }

  try {
    await deleteMemberFileRecord(String(existing.id));
  } catch (error) {
    if (storageObjectPath) {
      await recordImmediateSystemAlert({
        entityType: "member_file",
        entityId: String(existing.id),
        actorUserId: input.actor.id,
        severity: "high",
        alertKey: "member_file_delete_split_brain",
        metadata: {
          member_id: String(existing.member_id ?? ""),
          storage_object_path: storageObjectPath,
          error: error instanceof Error ? error.message : "Unable to delete member file row after storage cleanup."
        }
      });
    }
    throw error;
  }

  return true;
}

export async function getMemberFileDownloadUrl(input: {
  memberFileId: string;
  memberId?: string | null;
  expiresInSeconds?: number;
}) {
  const existing = await loadMemberFileRowById(input.memberFileId);
  if (!existing) throw new Error("Member file was not found.");

  const expectedMemberId = String(input.memberId ?? "").trim();
  if (expectedMemberId && String(existing.member_id ?? "").trim() !== expectedMemberId) {
    throw new Error("Member file/member mismatch.");
  }

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
  const canonical = await resolveCanonicalMemberRef(
    {
      sourceType: "member",
      memberId: input.memberId,
      selectedId: input.memberId
    },
    {
      actionLabel: "saveGeneratedMemberPdfToFiles"
    }
  );
  if (!canonical.memberId) {
    throw new Error("saveGeneratedMemberPdfToFiles expected member.id but canonical member resolution returned empty memberId.");
  }
  const memberId = canonical.memberId;
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
      const { data: updated, error: updateError } = await admin
        .from("member_files")
        .update({
          file_name: defaultName,
          file_type: "application/pdf",
          file_data_url: null,
          storage_object_path: storageObjectPath,
          care_plan_id: input.carePlanId ?? null,
          category: input.category,
          category_other: categoryOther,
          document_source: input.documentSource,
          uploaded_by_user_id: input.uploadedBy.id,
          uploaded_by_name: input.uploadedBy.name,
          uploaded_at: now,
          updated_at: now
        })
        .eq("id", existingId)
        .select("*")
        .maybeSingle();

      if (updateError) {
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
              save_error: updateError.message,
              cleanup_error: cleanupError instanceof Error ? cleanupError.message : "Unknown cleanup error."
            }
          });
        }
        throw new Error(updateError.message);
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

  const { data: created, error: createError } = await admin
    .from("member_files")
    .insert({
      id: memberFileId,
      member_id: memberId,
      file_name: fileName,
      file_type: "application/pdf",
      file_data_url: null,
      storage_object_path: storageObjectPath,
      care_plan_id: input.carePlanId ?? null,
      category: input.category,
      category_other: categoryOther,
      document_source: input.documentSource,
      uploaded_by_user_id: input.uploadedBy.id,
      uploaded_by_name: input.uploadedBy.name,
      uploaded_at: now,
      updated_at: now
    })
    .select("*")
    .single();

  if (createError) {
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
          save_error: createError.message,
          cleanup_error: cleanupError instanceof Error ? cleanupError.message : "Unknown cleanup error."
        }
      });
    }
    throw new Error(createError.message);
  }

  return {
    created,
    fileName,
    generatedAtIso: now
  };
}
