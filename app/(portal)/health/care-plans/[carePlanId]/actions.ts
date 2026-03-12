"use server";

import { revalidatePath } from "next/cache";

import { requireCarePlanAuthorizedUser } from "@/lib/services/care-plan-authorization";
import { saveGeneratedMemberPdfToFiles } from "@/lib/services/member-files";
import { buildCarePlanPdfDataUrl } from "@/lib/services/care-plan-pdf";
import { toEasternISO } from "@/lib/timezone";

export async function generateCarePlanPdfAction(input: { carePlanId: string }) {
  const user = await requireCarePlanAuthorizedUser();
  const carePlanId = String(input.carePlanId ?? "").trim();
  if (!carePlanId) {
    return { ok: false, error: "Care plan is required." } as const;
  }

  try {
    const generated = await buildCarePlanPdfDataUrl(carePlanId);
    const saved = await saveGeneratedMemberPdfToFiles({
      memberId: generated.carePlan.memberId,
      memberName: generated.carePlan.memberName,
      documentLabel: "Care Plan",
      documentSource: `Care Plan:${carePlanId}`,
      category: "Care Plan",
      dataUrl: generated.dataUrl,
      uploadedBy: {
        id: user.userId,
        name: user.signatureName
      },
      carePlanId: generated.carePlan.id,
      generatedAtIso: toEasternISO(),
      replaceExistingByDocumentSource: true
    });

    revalidatePath(`/health/care-plans/${carePlanId}`);
    revalidatePath(`/members/${generated.carePlan.memberId}`);
    revalidatePath(`/health/member-health-profiles/${generated.carePlan.memberId}`);
    revalidatePath(`/operations/member-command-center/${generated.carePlan.memberId}`);

    return {
      ok: true,
      fileName: saved.fileName,
      dataUrl: generated.dataUrl
    } as const;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to generate care plan PDF."
    } as const;
  }
}

