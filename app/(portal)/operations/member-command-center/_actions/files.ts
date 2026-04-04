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

export async function addMemberFileAction(raw: AddMemberFileInput) {
  try {
    const actor = await requireCommandCenterEditor();
    const memberId = raw.memberId?.trim();
    const fileName = raw.fileName?.trim();
    const category = raw.category?.trim();

    if (!memberId || !fileName || !category) {
      return { error: "Member, file, and category are required." };
    }

    const normalizedCategory = MEMBER_FILE_CATEGORY_OPTIONS.includes(category as (typeof MEMBER_FILE_CATEGORY_OPTIONS)[number])
      ? category
      : "Other";
    const categoryOther = raw.categoryOther?.trim() || null;
    if (normalizedCategory === "Other" && !categoryOther) {
      return { error: "Custom file category is required when category is Other." };
    }

    const fileDataUrl = raw.fileDataUrl?.trim() || "";
    if (!fileDataUrl) {
      return { error: "A file payload is required." };
    }

    const uploadToken = raw.uploadToken?.trim();
    if (!uploadToken) {
      return { error: "Upload token is required." };
    }

    const created = await saveCommandCenterMemberFileUpload({
      actor: {
        id: actor.id,
        fullName: actor.full_name,
        role: actor.role,
        permissions: actor.permissions
      },
      memberId,
      fileName,
      fileType: raw.fileType?.trim() || "application/octet-stream",
      fileDataUrl,
      category: normalizedCategory as (typeof MEMBER_FILE_CATEGORY_OPTIONS)[number],
      categoryOther: normalizedCategory === "Other" ? categoryOther : null,
      documentSource: raw.documentSource?.trim() || null,
      uploadToken
    });

    revalidateCommandCenter(memberId);
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
