"use server";

import { Buffer } from "node:buffer";
import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/auth";
import { canGenerateMemberDocumentForRole } from "@/lib/permissions";
import {
  buildGeneratedMemberFilePersistenceState,
  saveGeneratedMemberPdfToFiles
} from "@/lib/services/member-files";
import { getMemberDietCard } from "@/lib/services/member-diet-card";
import { toEasternISO } from "@/lib/timezone";

function lineOrDash(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : "-";
}

async function buildDietCardPdf(memberId: string) {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const dietCard = await getMemberDietCard(memberId);
  if (!dietCard) {
    return { error: "Member diet card data not found." } as const;
  }

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 396]);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const black = rgb(0.1, 0.1, 0.1);

  let y = 350;
  const left = 48;

  const writeRow = (label: string, value: string) => {
    page.drawText(label, { x: left, y, size: 13, font: bold, color: black });
    page.drawText(value, { x: 220, y, size: 13, font: regular, color: black });
    y -= 34;
  };

  page.drawText("Diet Card", { x: left, y, size: 22, font: bold, color: black });
  y -= 34;
  writeRow("Member Name", lineOrDash(dietCard.member.name));
  writeRow("Assistance Required", lineOrDash(dietCard.assistanceRequired));
  writeRow("Diet", lineOrDash(dietCard.diet));
  writeRow("Allergies", lineOrDash(dietCard.allergies));
  writeRow("Texture", lineOrDash(dietCard.texture));
  writeRow("Notes", lineOrDash(dietCard.notes));

  const pdfBytes = await pdf.save();
  return {
    dietCard,
    pdfBytes: Buffer.from(pdfBytes)
  } as const;
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

