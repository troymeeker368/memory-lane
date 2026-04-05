import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

import { buildMemberDocumentStorageUri, MEMBER_DOCUMENTS_BUCKET } from "@/lib/services/member-files-core";

const MEMBER_FILE_ROW_SELECT =
  "id, member_id, file_name, file_type, storage_object_path, category, category_other, document_source, pof_request_id, uploaded_by_user_id, uploaded_by_name, uploaded_at, updated_at" as const;

export type MemberFilesClient = Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createServiceRoleClient>;

export function createMemberFilesRecordClient() {
  // Member file RPC/database mutations are service-only so storage and row state stay aligned.
  return createServiceRoleClient("member_file_record_rpc");
}

function createMemberFilesStorageClient() {
  // Signed URLs and object mutations must stay server-only and outside uploader-scoped RLS.
  return createServiceRoleClient("member_file_storage");
}

export async function loadMemberFileRowById(memberFileId: string, options?: { supabase?: MemberFilesClient }) {
  const normalized = String(memberFileId ?? "").trim();
  if (!normalized) return null;

  const supabase = options?.supabase ?? (await createClient());
  const { data, error } = await supabase
    .from("member_files")
    .select(MEMBER_FILE_ROW_SELECT)
    .eq("id", normalized)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function loadMemberFileRowByDocumentSource(input: {
  memberId: string;
  documentSource: string;
  supabase?: MemberFilesClient;
}) {
  const memberId = String(input.memberId ?? "").trim();
  const documentSource = String(input.documentSource ?? "").trim();
  if (!memberId || !documentSource) return null;

  const supabase = input.supabase ?? (await createClient());
  const { data, error } = await supabase
    .from("member_files")
    .select(MEMBER_FILE_ROW_SELECT)
    .eq("member_id", memberId)
    .eq("document_source", documentSource)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function createSignedMemberDocumentUrl(objectPath: string, expiresInSeconds = 60 * 15) {
  const normalized = String(objectPath ?? "").trim();
  if (!normalized) throw new Error("Storage object path is required.");

  const admin = createMemberFilesStorageClient();
  const { data, error } = await admin.storage.from(MEMBER_DOCUMENTS_BUCKET).createSignedUrl(normalized, expiresInSeconds);
  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? "Unable to create member file download URL.");
  }
  return data.signedUrl;
}

export async function uploadMemberDocumentObject(input: {
  objectPath: string;
  bytes: Uint8Array | Buffer;
  contentType: string;
}) {
  const admin = createMemberFilesStorageClient();
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
  const admin = createMemberFilesStorageClient();
  const { error } = await admin.storage.from(MEMBER_DOCUMENTS_BUCKET).remove([normalized]);
  if (error) throw new Error(error.message);
}
