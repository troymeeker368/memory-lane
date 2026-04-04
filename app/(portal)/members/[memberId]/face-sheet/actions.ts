"use server";

import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/auth";
import { canGenerateMemberDocumentForRole } from "@/lib/permissions";
import {
  buildGeneratedMemberFilePersistenceState,
  saveGeneratedMemberPdfToFiles
} from "@/lib/services/member-files";
import { toEasternISO } from "@/lib/timezone";

async function loadFaceSheetPdfBuilder() {
  const { buildFaceSheetPdf } = await import("@/lib/documents/member/face-sheet-pdf");
  return buildFaceSheetPdf;
}

export async function generateMemberFaceSheetPdfAction(input: { memberId: string }) {
  const profile = await getCurrentProfile();
  if (!canGenerateMemberDocumentForRole(profile.role)) {
    return { ok: false, status: "error" as const, error: "You do not have access to generate face sheets." } as const;
  }

  const memberId = String(input.memberId ?? "").trim();
  if (!memberId) {
    return { ok: false, status: "error" as const, error: "Member is required." } as const;
  }

  try {
    const buildFaceSheetPdf = await loadFaceSheetPdfBuilder();
    const built = await buildFaceSheetPdf(memberId);
    if ("error" in built) {
      return { ok: false, status: "error" as const, error: built.error } as const;
    }

    const saved = await saveGeneratedMemberPdfToFiles({
      memberId,
      memberName: built.faceSheet.member.name,
      documentLabel: "Face Sheet",
      documentSource: "Face Sheet Generator",
      category: "Health Unit",
      bytes: built.pdfBytes,
      contentType: "application/pdf",
      uploadedBy: {
        id: profile.id,
        name: profile.full_name
      },
      generatedAtIso: toEasternISO(),
      replaceExistingByDocumentSource: true
    });

    revalidatePath(`/members/${memberId}/face-sheet`);
    revalidatePath(`/operations/member-command-center/${memberId}`);
    revalidatePath(`/health/member-health-profiles/${memberId}`);

    return {
      ok: saved.verifiedPersisted,
      status: saved.verifiedPersisted ? ("verified" as const) : ("follow-up-needed" as const),
      fileName: saved.fileName,
      downloadUrl: saved.downloadUrl,
      pdfGenerated: true as const,
      storageUploaded: true as const,
      memberFilesVerified: saved.verifiedPersisted,
      ...buildGeneratedMemberFilePersistenceState({
        documentLabel: "Face Sheet",
        verifiedPersisted: saved.verifiedPersisted
      })
    } as const;
  } catch (error) {
    return {
      ok: false,
      status: "error" as const,
      error: error instanceof Error ? error.message : "Unable to generate face sheet PDF."
    } as const;
  }
}
