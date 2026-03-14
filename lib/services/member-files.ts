import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

import { resolveCanonicalMemberRef } from "@/lib/services/canonical-person-ref";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
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
  const match = /^data:([^;]+);base64,(.+)$/.exec(normalized);
  if (!match) throw new Error(errorMessage);
  return {
    contentType: match[1],
    bytes: Buffer.from(match[2], "base64")
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
  if (insertError) throw new Error(insertError.message);
  return { id: memberFileId, created: true as const };
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
  const supabase = await createClient();
  const defaultName =
    safeFileName(input.fileNameOverride ?? "") || buildDatedPdfFileName(input.documentLabel, input.memberName, now);
  const categoryOther = input.category === "Other" ? input.categoryOther ?? null : null;

  if (input.replaceExistingByDocumentSource) {
    const { data: existing, error: existingError } = await supabase
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
      const { data: updated, error: updateError } = await supabase
        .from("member_files")
        .update({
          file_name: defaultName,
          file_type: "application/pdf",
          file_data_url: input.dataUrl,
          care_plan_id: input.carePlanId ?? null,
          category: input.category,
          category_other: categoryOther,
          document_source: input.documentSource,
          uploaded_by_user_id: input.uploadedBy.id,
          uploaded_by_name: input.uploadedBy.name,
          uploaded_at: now,
          updated_at: now
        })
        .eq("id", existing.id)
        .select("*")
        .maybeSingle();

      if (updateError) {
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

  const { data: duplicateRows, error: duplicateError } = await supabase
    .from("member_files")
    .select("id")
    .eq("member_id", memberId)
    .eq("file_name", defaultName);

  if (duplicateError) {
    throw new Error(duplicateError.message);
  }

  const hasConflict = (duplicateRows ?? []).length > 0;
  const fileName = hasConflict ? withDuplicateFileSuffix(defaultName, now) : defaultName;

  const { data: created, error: createError } = await supabase
    .from("member_files")
    .insert({
      id: nextMemberFileId(),
      member_id: memberId,
      file_name: fileName,
      file_type: "application/pdf",
      file_data_url: input.dataUrl,
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
    throw new Error(createError.message);
  }

  return {
    created,
    fileName,
    generatedAtIso: now
  };
}
