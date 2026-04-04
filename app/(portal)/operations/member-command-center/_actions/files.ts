import { Buffer } from "node:buffer";

import "server-only";

import {
  MEMBER_FILE_CATEGORY_OPTIONS
} from "@/lib/canonical";
import {
  deleteCommandCenterMemberFile,
  getMemberFileDownloadUrl,
  saveCommandCenterMemberFileUpload
} from "@/lib/services/member-files";

import {
  requireCommandCenterEditor,
  requireCommandCenterViewer,
  revalidateCommandCenter
} from "./shared";

type AddMemberFileInput = {
  memberId: string;
  fileName: string;
  fileType?: string;
  fileDataUrl?: string;
  category: string;
  categoryOther?: string;
  documentSource?: string;
  uploadToken?: string;
};

type NormalizedMemberFileUploadInput = {
  memberId: string;
  fileName: string;
  normalizedCategory: (typeof MEMBER_FILE_CATEGORY_OPTIONS)[number];
  categoryOther: string | null;
  documentSource: string | null;
  uploadToken: string;
};

function normalizeMemberFileUploadInput(raw: {
  memberId?: string | null;
  fileName?: string | null;
  category?: string | null;
  categoryOther?: string | null;
  documentSource?: string | null;
  uploadToken?: string | null;
}) {
  const memberId = raw.memberId?.trim();
  const fileName = raw.fileName?.trim();
  const category = raw.category?.trim();

  if (!memberId || !fileName || !category) {
    return { error: "Member, file, and category are required." } as const;
  }

  const normalizedCategory = MEMBER_FILE_CATEGORY_OPTIONS.includes(category as (typeof MEMBER_FILE_CATEGORY_OPTIONS)[number])
    ? (category as (typeof MEMBER_FILE_CATEGORY_OPTIONS)[number])
    : "Other";
  const categoryOther = raw.categoryOther?.trim() || null;
  if (normalizedCategory === "Other" && !categoryOther) {
    return { error: "Custom file category is required when category is Other." } as const;
  }

  const uploadToken = raw.uploadToken?.trim();
  if (!uploadToken) {
    return { error: "Upload token is required." } as const;
  }

  return {
    memberId,
    fileName,
    normalizedCategory,
    categoryOther,
    documentSource: raw.documentSource?.trim() || null,
    uploadToken
  } satisfies NormalizedMemberFileUploadInput;
}

export async function addMemberFileAction(raw: AddMemberFileInput) {
  try {
    const actor = await requireCommandCenterEditor();
    const normalized = normalizeMemberFileUploadInput(raw);
    if ("error" in normalized) return normalized;

    const fileDataUrl = raw.fileDataUrl?.trim() || "";
    if (!fileDataUrl) {
      return { error: "A file payload is required." };
    }

    const created = await saveCommandCenterMemberFileUpload({
      actor: {
        id: actor.id,
        fullName: actor.full_name,
        role: actor.role,
        permissions: actor.permissions
      },
      memberId: normalized.memberId,
      fileName: normalized.fileName,
      fileType: raw.fileType?.trim() || "application/octet-stream",
      fileDataUrl,
      category: normalized.normalizedCategory,
      categoryOther: normalized.normalizedCategory === "Other" ? normalized.categoryOther : null,
      documentSource: normalized.documentSource,
      uploadToken: normalized.uploadToken
    });

    revalidateCommandCenter(normalized.memberId);
    return { ok: true, row: created };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to upload file." };
  }
}

export async function addMemberFileFormAction(formData: FormData) {
  try {
    const actor = await requireCommandCenterEditor();
    const file = formData.get("file");
    if (!(file instanceof File) || file.size <= 0) {
      return { error: "Please choose a file to upload." };
    }

    const memberIdEntry = formData.get("memberId");
    const categoryEntry = formData.get("category");
    const categoryOtherEntry = formData.get("categoryOther");
    const documentSourceEntry = formData.get("documentSource");
    const uploadTokenEntry = formData.get("uploadToken");

    const normalized = normalizeMemberFileUploadInput({
      memberId: typeof memberIdEntry === "string" ? memberIdEntry : null,
      fileName: file.name,
      category: typeof categoryEntry === "string" ? categoryEntry : null,
      categoryOther: typeof categoryOtherEntry === "string" ? categoryOtherEntry : null,
      documentSource: typeof documentSourceEntry === "string" ? documentSourceEntry : null,
      uploadToken: typeof uploadTokenEntry === "string" ? uploadTokenEntry : null
    });
    if ("error" in normalized) return normalized;

    const created = await saveCommandCenterMemberFileUpload({
      actor: {
        id: actor.id,
        fullName: actor.full_name,
        role: actor.role,
        permissions: actor.permissions
      },
      memberId: normalized.memberId,
      fileName: normalized.fileName,
      fileType: file.type?.trim() || "application/octet-stream",
      fileBytes: Buffer.from(await file.arrayBuffer()),
      category: normalized.normalizedCategory,
      categoryOther: normalized.normalizedCategory === "Other" ? normalized.categoryOther : null,
      documentSource: normalized.documentSource,
      uploadToken: normalized.uploadToken
    });

    revalidateCommandCenter(normalized.memberId);
    return { ok: true, row: created };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to upload file." };
  }
}

export async function deleteMemberFileAction(raw: { id: string; memberId: string }) {
  try {
    const actor = await requireCommandCenterEditor();
    const id = raw.id?.trim();
    const memberId = raw.memberId?.trim();
    if (!id || !memberId) return { error: "Invalid file delete request." };

    await deleteCommandCenterMemberFile({
      actor: {
        id: actor.id,
        fullName: actor.full_name,
        role: actor.role,
        permissions: actor.permissions
      },
      memberFileId: id,
      memberId
    });

    revalidateCommandCenter(memberId);
    return { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to delete file." };
  }
}

export async function getMemberFileDownloadUrlAction(raw: { id: string; memberId: string }) {
  try {
    const viewer = await requireCommandCenterViewer();
    const id = raw.id?.trim();
    const memberId = raw.memberId?.trim();
    if (!id || !memberId) return { ok: false, error: "Invalid file download request." } as const;

    const result = await getMemberFileDownloadUrl({
      actor: {
        id: viewer.id,
        fullName: viewer.full_name,
        role: viewer.role,
        permissions: viewer.permissions
      },
      memberFileId: id,
      memberId
    });

    return { ok: true, signedUrl: result.url, fileName: result.fileName } as const;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to fetch member file download URL."
    } as const;
  }
}
