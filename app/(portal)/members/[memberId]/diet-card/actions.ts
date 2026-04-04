"use server";

import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/auth";
import { canGenerateMemberDocumentForRole } from "@/lib/permissions";
import {
  buildGeneratedMemberFilePersistenceState,
  saveGeneratedMemberPdfToFiles
} from "@/lib/services/member-files";
import { toEasternISO } from "@/lib/timezone";

async function loadDietCardPdfBuilder() {
  const { buildDietCardPdf } = await import("@/lib/documents/member/diet-card-pdf");
  return buildDietCardPdf;
}

export async function generateMemberDietCardPdfAction(input: { memberId: string }) {
  const profile = await getCurrentProfile();
  if (!canGenerateMemberDocumentForRole(profile.role)) {
    return { ok: false, status: "error" as const, error: "You do not have access to generate diet cards." } as const;
  }

  const memberId = String(input.memberId ?? "").trim();
  if (!memberId) {
    return { ok: false, status: "error" as const, error: "Member is required." } as const;
  }

  try {
    const buildDietCardPdf = await loadDietCardPdfBuilder();
    const built = await buildDietCardPdf(memberId);
    if ("error" in built) {
      return { ok: false, status: "error" as const, error: built.error } as const;
    }

    const saved = await saveGeneratedMemberPdfToFiles({
      memberId,
      memberName: built.dietCard.member.name,
      documentLabel: "Diet Card",
      documentSource: "Diet Card Generator",
      category: "Other",
      categoryOther: "Diet Card",
      bytes: built.pdfBytes,
      contentType: "application/pdf",
      uploadedBy: {
        id: profile.id,
        name: profile.full_name
      },
      generatedAtIso: toEasternISO()
    });

    revalidatePath(`/members/${memberId}/diet-card`);
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
        documentLabel: "Diet Card",
        verifiedPersisted: saved.verifiedPersisted
      })
    } as const;
  } catch (error) {
    return {
      ok: false,
      status: "error" as const,
      error: error instanceof Error ? error.message : "Unable to generate diet card PDF."
    } as const;
  }
}

