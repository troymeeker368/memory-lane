"use server";

import { revalidatePath } from "next/cache";

import { requireRoles } from "@/lib/auth";
import { CLINICAL_DOCUMENTATION_ACCESS_ROLES } from "@/lib/permissions";
import { autoCreateDraftPhysicianOrderFromIntake } from "@/lib/services/intake-pof-mhp-cascade";
import {
  queueIntakePostSignFollowUpTask,
  resolveIntakePostSignFollowUpTask
} from "@/lib/services/intake-post-sign-follow-up";
import { getAssessmentDetail } from "@/lib/services/relations";
import { saveGeneratedMemberPdfToFiles } from "@/lib/services/member-files";
import { buildIntakeAssessmentPdfDataUrl } from "@/lib/services/intake-assessment-pdf";
import { getManagedUserSignatureName } from "@/lib/services/user-management";
import { toEasternISO } from "@/lib/timezone";

export async function generateAssessmentPdfAction(input: { assessmentId: string }) {
  const profile = await requireRoles(CLINICAL_DOCUMENTATION_ACCESS_ROLES);
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
    await resolveIntakePostSignFollowUpTask({
      assessmentId,
      taskType: "member_file_pdf_persistence",
      actorUserId: profile.id,
      actorName: profile.full_name,
      resolutionNote: "Assessment PDF regenerated and saved to Member Files."
    });

    return {
      ok: true,
      fileName: saved.fileName,
      dataUrl: generated.dataUrl
    } as const;
  } catch (error) {
    await queueIntakePostSignFollowUpTask({
      assessmentId,
      memberId: detail.assessment.member_id,
      taskType: "member_file_pdf_persistence",
      actorUserId: profile.id,
      actorName: profile.full_name,
      errorMessage: error instanceof Error ? error.message : "Unable to generate assessment PDF."
    });
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to generate assessment PDF."
    } as const;
  }
}

export async function retryAssessmentDraftPofAction(input: { assessmentId: string }) {
  const profile = await requireRoles(CLINICAL_DOCUMENTATION_ACCESS_ROLES);
  const assessmentId = String(input.assessmentId ?? "").trim();
  if (!assessmentId) {
    return { ok: false, error: "Assessment is required." } as const;
  }

  const detail = await getAssessmentDetail(assessmentId);
  if (!detail) {
    return { ok: false, error: "Assessment not found." } as const;
  }
  if (detail.signature.status !== "signed") {
    return { ok: false, error: "Draft POF retry is only available after intake signature is completed." } as const;
  }

  try {
    const signatureName = await getManagedUserSignatureName(profile.id, profile.full_name);
    const created = await autoCreateDraftPhysicianOrderFromIntake({
      assessment: detail.assessment,
      actor: {
        id: profile.id,
        fullName: profile.full_name,
        signoffName: signatureName
      }
    });

    revalidatePath(`/health/assessment/${assessmentId}`);
    revalidatePath("/health/assessment");
    revalidatePath("/health/physician-orders");
    revalidatePath(`/health/physician-orders/${created.id}`);
    revalidatePath(`/health/physician-orders?memberId=${detail.assessment.member_id}`);
    revalidatePath(`/health/member-health-profiles/${detail.assessment.member_id}`);
    revalidatePath(`/operations/member-command-center/${detail.assessment.member_id}`);
    await resolveIntakePostSignFollowUpTask({
      assessmentId,
      taskType: "draft_pof_creation",
      actorUserId: profile.id,
      actorName: profile.full_name,
      resolutionNote: "Draft POF recreated from signed intake assessment."
    });

    return {
      ok: true,
      physicianOrderId: created.id
    } as const;
  } catch (error) {
    await queueIntakePostSignFollowUpTask({
      assessmentId,
      memberId: detail.assessment.member_id,
      taskType: "draft_pof_creation",
      actorUserId: profile.id,
      actorName: profile.full_name,
      errorMessage: error instanceof Error ? error.message : "Unable to retry draft POF creation."
    });
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to retry draft POF creation."
    } as const;
  }
}

