import type { Buffer } from "node:buffer";

import {
  parseDataUrlPayload,
  parseMemberDocumentStorageUri,
  slugifyMemberFileSegment
} from "@/lib/services/member-files-core";
import {
  createMemberFilesRecordClient,
  deleteMemberDocumentObject,
  uploadMemberDocumentObject
} from "@/lib/services/member-files-repository";
import { recordImmediateSystemAlert } from "@/lib/services/workflow-observability";
import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";
import { toEasternISO } from "@/lib/timezone";

const UPSERT_MEMBER_FILE_BY_SOURCE_RPC = "rpc_upsert_member_file_by_source";

type LegacyMemberFileBackfillRow = {
  id: string;
  member_id: string;
  file_name: string | null;
  file_type: string | null;
  file_data_url: string | null;
  storage_object_path?: string | null;
};

function isDataUrl(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase().startsWith("data:");
}

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
      bytes: parsed.bytes as Buffer,
      contentType: String(row.file_type ?? "").trim() || parsed.contentType || "application/octet-stream"
    });
  }

  const admin = createMemberFilesRecordClient();
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
  const admin = createMemberFilesRecordClient();
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
