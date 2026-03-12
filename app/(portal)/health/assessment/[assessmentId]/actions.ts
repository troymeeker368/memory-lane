"use server";

import { revalidatePath } from "next/cache";

import { requireRoles } from "@/lib/auth";
import { getAssessmentDetail } from "@/lib/services/relations";
import { saveGeneratedMemberPdfToFiles } from "@/lib/services/member-files";
import { buildIntakeAssessmentPdfDataUrl } from "@/lib/services/intake-assessment-pdf";
import { toEasternISO } from "@/lib/timezone";

export async function generateAssessmentPdfAction(input: { assessmentId: string }) {
  const profile = await requireRoles(["admin", "manager", "nurse"]);
  const assessmentId = String(input.assessmentId ?? "").trim();
  if (!assessmentId) {
    return { ok: false, error: "Assessment is required." } as const;
  }

  const detail = await getAssessmentDetail(assessmentId);
  if (!detail) {
    return { ok: false, error: "Assessment not found." } as const;
  }

  try {
    const generated = await buildIntakeAssessmentPdfDataUrl(assessmentId);
    const saved = await saveGeneratedMemberPdfToFiles({
      memberId: detail.assessment.member_id,
      memberName: detail.assessment.member_name,
      documentLabel: "Intake Assessment",
      documentSource: `Intake Assessment:${assessmentId}`,
      category: "Assessment",
      dataUrl: generated.dataUrl,
      uploadedBy: {
        id: profile.id,
        name: profile.full_name
      },
      generatedAtIso: toEasternISO(),
      replaceExistingByDocumentSource: true
    });

    revalidatePath(`/health/assessment/${assessmentId}`);
    revalidatePath(`/members/${detail.assessment.member_id}`);
    revalidatePath(`/health/member-health-profiles/${detail.assessment.member_id}`);
    revalidatePath(`/operations/member-command-center/${detail.assessment.member_id}`);

    return {
      ok: true,
      fileName: saved.fileName,
      dataUrl: generated.dataUrl
    } as const;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to generate assessment PDF."
    } as const;
  }
}

