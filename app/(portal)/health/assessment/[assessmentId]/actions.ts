"use server";

import { revalidatePath } from "next/cache";

import { requireRoles } from "@/lib/auth";
import { CLINICAL_DOCUMENTATION_ACCESS_ROLES } from "@/lib/permissions";
import {
  autoCreateDraftPhysicianOrderFromIntake,
  CommittedDraftPhysicianOrderReloadError,
  updateIntakeAssessmentDraftPofStatus
} from "@/lib/services/intake-pof-mhp-cascade";
import {
  claimIntakePostSignFollowUpTask,
  queueIntakePostSignFollowUpTask,
  releaseIntakePostSignFollowUpTaskClaim,
  resolveIntakePostSignFollowUpTask
} from "@/lib/services/intake-post-sign-follow-up";
import { getAssessmentDetail } from "@/lib/services/relations";
import { saveGeneratedMemberPdfToFiles } from "@/lib/services/member-files";
import { buildIntakeAssessmentPdfDataUrl } from "@/lib/services/intake-assessment-pdf";
import { getManagedUserSignatureName } from "@/lib/services/user-management";
import { toEasternISO } from "@/lib/timezone";

export async function generateAssessmentPdfAction(input: { assessmentId: string; persistToMemberFiles?: boolean }) {
  const profile = await requireRoles(CLINICAL_DOCUMENTATION_ACCESS_ROLES);
  const assessmentId = String(input.assessmentId ?? "").trim();
  const persistToMemberFiles = input.persistToMemberFiles !== false;
  if (!assessmentId) {
    return { ok: false, error: "Assessment is required." } as const;
  }

  const detail = await getAssessmentDetail(assessmentId);
  if (!detail) {
    return { ok: false, error: "Assessment not found." } as const;
  }

  const pdfFollowUpTask = detail.followUpTasks.find(
    (task) => task.taskType === "member_file_pdf_persistence" && task.status === "action_required"
  );
  let claimedPdfFollowUpTask = false;
  if (persistToMemberFiles && pdfFollowUpTask) {
    const claimed = await claimIntakePostSignFollowUpTask({
      assessmentId,
      taskType: "member_file_pdf_persistence",
      actorUserId: profile.id,
      actorName: profile.full_name
    });
    if (!claimed) {
      return {
        ok: false,
        error: pdfFollowUpTask.claimedAt
          ? `Assessment PDF retry is already in progress${pdfFollowUpTask.claimedByName ? ` by ${pdfFollowUpTask.claimedByName}` : ""}.`
          : "Assessment PDF follow-up no longer needs action."
      } as const;
    }
    claimedPdfFollowUpTask = true;
  }

  try {
    const generated = await buildIntakeAssessmentPdfDataUrl(assessmentId);
    let fileName = generated.fileName;

    if (persistToMemberFiles) {
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

      fileName = saved.fileName;
      revalidatePath(`/health/assessment/${assessmentId}`);
      revalidatePath(`/members/${detail.assessment.member_id}`);
      revalidatePath(`/health/member-health-profiles/${detail.assessment.member_id}`);
      revalidatePath(`/operations/member-command-center/${detail.assessment.member_id}`);
      if (claimedPdfFollowUpTask) {
        try {
          await resolveIntakePostSignFollowUpTask({
            assessmentId,
            taskType: "member_file_pdf_persistence",
            actorUserId: profile.id,
            actorName: profile.full_name,
            resolutionNote: "Assessment PDF regenerated and saved to Member Files."
          });
        } catch (error) {
          await releaseIntakePostSignFollowUpTaskClaim({
            assessmentId,
            taskType: "member_file_pdf_persistence"
          }).catch(() => null);
          return {
            ok: false,
            fileName,
            dataUrl: generated.dataUrl,
            error:
              error instanceof Error
                ? `Assessment PDF was saved to Member Files, but the follow-up task could not be closed (${error.message}). Refresh the assessment and verify the follow-up queue state.`
                : "Assessment PDF was saved to Member Files, but the follow-up task could not be closed."
          } as const;
        }
      }
    }

    return {
      ok: true,
      fileName,
      dataUrl: generated.dataUrl
    } as const;
  } catch (error) {
    if (!persistToMemberFiles) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Unable to generate assessment PDF."
      } as const;
    }
    const errorMessage = error instanceof Error ? error.message : "Unable to generate assessment PDF.";
    try {
      await queueIntakePostSignFollowUpTask({
        assessmentId,
        memberId: detail.assessment.member_id,
        taskType: "member_file_pdf_persistence",
        actorUserId: profile.id,
        actorName: profile.full_name,
        errorMessage
      });
    } catch (queueError) {
      if (claimedPdfFollowUpTask) {
        await releaseIntakePostSignFollowUpTaskClaim({
          assessmentId,
          taskType: "member_file_pdf_persistence"
        }).catch(() => null);
      }
      const queueErrorMessage =
        queueError instanceof Error ? queueError.message : "Unable to update intake post-sign follow-up queue.";
      return {
        ok: false,
        error: `${errorMessage} Follow-up queue update also failed (${queueErrorMessage}).`
      } as const;
    }
    return {
      ok: false,
      error: errorMessage
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
  if (detail.assessment.draft_pof_readiness_status !== "draft_pof_failed") {
    return {
      ok: false,
      error: "Draft POF retry is only available when the canonical intake draft POF follow-up is failed."
    } as const;
  }

  const draftPofTask = detail.followUpTasks.find(
    (task) => task.taskType === "draft_pof_creation" && task.status === "action_required"
  );
  if (!draftPofTask) {
    return {
      ok: false,
      error: "Draft POF retry requires an open intake post-sign follow-up task."
    } as const;
  }

  const claimed = await claimIntakePostSignFollowUpTask({
    assessmentId,
    taskType: "draft_pof_creation",
    actorUserId: profile.id,
    actorName: profile.full_name
  });
  if (!claimed) {
    return {
      ok: false,
      error: draftPofTask.claimedAt
        ? `Draft POF retry is already in progress${draftPofTask.claimedByName ? ` by ${draftPofTask.claimedByName}` : ""}.`
        : "Draft POF follow-up no longer needs action."
    } as const;
  }

  let createdPhysicianOrderId: string | null = null;
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
    createdPhysicianOrderId = created.id;

    revalidatePath(`/health/assessment/${assessmentId}`);
    revalidatePath("/health/assessment");
    revalidatePath("/health/physician-orders");
    revalidatePath(`/health/physician-orders/${created.id}`);
    revalidatePath(`/health/physician-orders?memberId=${detail.assessment.member_id}`);
    revalidatePath(`/health/member-health-profiles/${detail.assessment.member_id}`);
    revalidatePath(`/operations/member-command-center/${detail.assessment.member_id}`);
    try {
      await resolveIntakePostSignFollowUpTask({
        assessmentId,
        taskType: "draft_pof_creation",
        actorUserId: profile.id,
        actorName: profile.full_name,
        resolutionNote: "Draft POF recreated from signed intake assessment."
      });
    } catch (error) {
      await releaseIntakePostSignFollowUpTaskClaim({
        assessmentId,
        taskType: "draft_pof_creation"
      }).catch(() => null);
      return {
        ok: false,
        physicianOrderId: created.id,
        error:
          error instanceof Error
            ? `Draft POF was recreated, but the follow-up task could not be closed (${error.message}). Refresh the assessment and verify the follow-up queue state.`
            : "Draft POF was recreated, but the follow-up task could not be closed."
      } as const;
    }

    return {
      ok: true,
      physicianOrderId: created.id
    } as const;
  } catch (error) {
    const committedReloadMiss = error instanceof CommittedDraftPhysicianOrderReloadError;
    const errorMessage =
      error instanceof Error ? error.message : "Unable to retry draft POF creation.";
    if (committedReloadMiss) {
      await updateIntakeAssessmentDraftPofStatus({
        assessmentId,
        status: "created",
        attemptedAt: toEasternISO(),
        error: null
      });
      try {
        await queueIntakePostSignFollowUpTask({
          assessmentId,
          memberId: detail.assessment.member_id,
          taskType: "draft_pof_creation",
          actorUserId: profile.id,
          actorName: profile.full_name,
          errorMessage,
          titleOverride: "Draft POF Verification Follow-up Needed",
          messageOverride:
            "The draft POF was committed in Supabase, but the immediate readback could not verify it. Confirm the saved draft from Physician Orders before treating intake follow-up as complete."
        });
      } catch (queueError) {
        await releaseIntakePostSignFollowUpTaskClaim({
          assessmentId,
          taskType: "draft_pof_creation"
        }).catch(() => null);
        const queueErrorMessage =
          queueError instanceof Error ? queueError.message : "Unable to update intake post-sign follow-up queue.";
        return {
          ok: false,
          error: `${errorMessage} Follow-up queue update also failed (${queueErrorMessage}).`
        } as const;
      }

      revalidatePath(`/health/assessment/${assessmentId}`);
      revalidatePath("/health/assessment");
      revalidatePath("/health/physician-orders");
      revalidatePath(`/health/physician-orders?memberId=${detail.assessment.member_id}`);
      revalidatePath(`/health/member-health-profiles/${detail.assessment.member_id}`);
      revalidatePath(`/operations/member-command-center/${detail.assessment.member_id}`);
      return {
        ok: true,
        warning:
          "Draft POF was committed, but immediate verification still needs follow-up. Refreshing the assessment so staff can verify the saved draft."
      } as const;
    }
    if (createdPhysicianOrderId) {
      return {
        ok: false,
        physicianOrderId: createdPhysicianOrderId,
        error: errorMessage
      } as const;
    }
    try {
      await queueIntakePostSignFollowUpTask({
        assessmentId,
        memberId: detail.assessment.member_id,
        taskType: "draft_pof_creation",
        actorUserId: profile.id,
        actorName: profile.full_name,
        errorMessage
      });
    } catch (queueError) {
      await releaseIntakePostSignFollowUpTaskClaim({
        assessmentId,
        taskType: "draft_pof_creation"
      }).catch(() => null);
      const queueErrorMessage =
        queueError instanceof Error ? queueError.message : "Unable to update intake post-sign follow-up queue.";
      return {
        ok: false,
        error: `${errorMessage} Follow-up queue update also failed (${queueErrorMessage}).`
      } as const;
    }
    return {
      ok: false,
      error: errorMessage
    } as const;
  }
}

