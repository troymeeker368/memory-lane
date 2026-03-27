"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getCurrentProfile } from "@/lib/auth";
import { saveGeneratedMemberPdfToFiles } from "@/lib/services/member-files";
import {
  autoCreateDraftPhysicianOrderFromIntake,
  CommittedDraftPhysicianOrderReloadError,
  createIntakeAssessmentWithResponses,
  updateIntakeAssessmentDraftPofStatus
} from "@/lib/services/intake-pof-mhp-cascade";
import { normalizeIntakeAssistiveDeviceFields } from "@/lib/services/intake-pof-shared";
import { buildIntakeAssessmentPdfDataUrl } from "@/lib/services/intake-assessment-pdf";
import {
  isAuthorizedIntakeAssessmentSignerRole,
  signIntakeAssessment
} from "@/lib/services/intake-assessment-esign";
import {
  resolveIntakeDraftPofReadiness,
  type IntakeDraftPofReadinessStatus
} from "@/lib/services/intake-draft-pof-readiness";
import { getLeadRecordById } from "@/lib/services/leads-read";
import { queueIntakePostSignFollowUpTask } from "@/lib/services/intake-post-sign-follow-up";
import {
  resolveIntakePostSignReadiness,
  type IntakePostSignReadinessStatus
} from "@/lib/services/intake-post-sign-readiness";
import { buildCommittedWorkflowActionState } from "@/lib/services/committed-workflow-state";
import { getManagedUserSignatureName } from "@/lib/services/user-management";
import { toEasternISO } from "@/lib/timezone";

import { resolveActionMemberIdentity } from "@/app/action-helpers";

const assessmentScoreSchema = z.union([z.literal(15), z.literal(10), z.literal(5)]);

function buildIntakePostSignState(input: {
  signatureStatus: "unsigned" | "signed";
  draftPofStatus: "pending" | "created" | "failed";
  openFollowUpTaskTypes?: Array<"draft_pof_creation" | "member_file_pdf_persistence">;
}) {
  const draftPofReadinessStatus = resolveIntakeDraftPofReadiness({
    signatureStatus: input.signatureStatus,
    draftPofStatus: input.draftPofStatus
  });
  const postSignReadinessStatus = resolveIntakePostSignReadiness({
    signatureStatus: input.signatureStatus,
    draftPofStatus: input.draftPofStatus,
    openFollowUpTaskTypes: input.openFollowUpTaskTypes ?? []
  });
  return {
    draftPofReadinessStatus,
    postSignReadinessStatus,
    postSignReady: postSignReadinessStatus === "post_sign_ready"
  } satisfies {
    draftPofReadinessStatus: IntakeDraftPofReadinessStatus;
    postSignReadinessStatus: IntakePostSignReadinessStatus;
    postSignReady: boolean;
  };
}

const assessmentSchema = z
  .object({
    sourceType: z.enum(["lead", "member"]).optional(),
    selectedRefId: z.string().uuid().optional().or(z.literal("")),
    memberId: z.string().uuid().optional().or(z.literal("")),
    leadId: z.string().min(1),
    leadStage: z.string().optional().or(z.literal("")),
    leadStatus: z.string().optional().or(z.literal("")),
    assessmentDate: z.string(),
    completedBy: z.string().min(1),
    signatureAttested: z.boolean(),
    signatureImageDataUrl: z.string().min(1),
    complete: z.boolean(),
    feelingToday: z.string().min(1),
    healthLately: z.string().min(1),
    allergies: z.string().min(1),
    codeStatus: z.enum(["DNR", "Full Code"]),
    orientationDobVerified: z.boolean(),
    orientationCityVerified: z.boolean(),
    orientationYearVerified: z.boolean(),
    orientationOccupationVerified: z.boolean(),
    orientationNotes: z.string().optional().or(z.literal("")),
    medicationManagementStatus: z.string().min(1),
    dressingSupportStatus: z.string().min(1),
    assistiveDevices: z.string().optional().or(z.literal("")),
    incontinenceProducts: z.string().optional().or(z.literal("")),
    onSiteMedicationUse: z.string().optional().or(z.literal("")),
    onSiteMedicationList: z.string().optional().or(z.literal("")),
    independenceNotes: z.string().optional().or(z.literal("")),
    dietType: z.string().min(1),
    dietOther: z.string().optional().or(z.literal("")),
    dietRestrictionsNotes: z.string().optional().or(z.literal("")),
    mobilitySteadiness: z.string().min(1),
    fallsHistory: z.string().optional().or(z.literal("")),
    mobilityAids: z.string().optional().or(z.literal("")),
    mobilitySafetyNotes: z.string().optional().or(z.literal("")),
    overwhelmedByNoise: z.boolean(),
    socialTriggers: z.string().optional().or(z.literal("")),
    emotionalWellnessNotes: z.string().optional().or(z.literal("")),
    joySparks: z.string().optional().or(z.literal("")),
    personalNotes: z.string().optional().or(z.literal("")),
    scoreOrientationGeneralHealth: assessmentScoreSchema,
    scoreDailyRoutinesIndependence: assessmentScoreSchema,
    scoreNutritionDietaryNeeds: assessmentScoreSchema,
    scoreMobilitySafety: assessmentScoreSchema,
    scoreSocialEmotionalWellness: assessmentScoreSchema,
    transportCanEnterExitVehicle: z.string().min(1),
    transportAssistanceLevel: z.string().min(1),
    transportMobilityAid: z.string().optional().or(z.literal("")),
    transportCanRemainSeatedBuckled: z.boolean(),
    transportBehaviorConcern: z.string().optional().or(z.literal("")),
    transportAppropriate: z.boolean(),
    transportNotes: z.string().optional().or(z.literal("")),
    vitalsHr: z.number().min(1).max(250),
    vitalsBp: z.string().min(1),
    vitalsO2Percent: z.number().min(1).max(100),
    vitalsRr: z.number().min(1).max(80),
    notes: z.string().max(2000).optional().or(z.literal(""))
  })
  .superRefine((val, ctx) => {
    if (!val.signatureAttested) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["signatureAttested"],
        message: "Electronic signature attestation is required."
      });
    }

    if (val.onSiteMedicationUse === "Yes" && !val.onSiteMedicationList?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["onSiteMedicationList"],
        message: "On-site medication names are required when on-site meds is Yes."
      });
    }

    if (!/^\d{2,3}\s*\/\s*\d{2,3}$/.test(val.vitalsBp.trim())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["vitalsBp"],
        message: "BP must use systolic/diastolic format (e.g., 120/80)."
      });
    }

    if (!val.signatureImageDataUrl.trim().startsWith("data:image/")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["signatureImageDataUrl"],
        message: "A valid drawn nurse/admin signature image is required."
      });
    }
  });

export async function createAssessmentAction(raw: z.infer<typeof assessmentSchema>) {
  const payload = assessmentSchema.safeParse(raw);
  if (!payload.success) {
    return { ok: false as const, error: "Invalid assessment." };
  }

  const profile = await getCurrentProfile();
  if (!isAuthorizedIntakeAssessmentSignerRole(profile.role)) {
    return { ok: false as const, error: "Only nurse or admin users may electronically sign Intake Assessments." };
  }

  const signerName = await getManagedUserSignatureName(profile.id, profile.full_name);
  let canonicalIdentity: Awaited<ReturnType<typeof resolveActionMemberIdentity>>;
  try {
    canonicalIdentity = await resolveActionMemberIdentity({
      actionLabel: "createAssessmentAction",
      sourceType: payload.data.sourceType,
      selectedRefId: payload.data.selectedRefId,
      memberId: payload.data.memberId,
      leadId: payload.data.leadId
    });
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Unable to resolve canonical intake identity." };
  }

  if (!canonicalIdentity.memberId) {
    return { ok: false as const, error: "createAssessmentAction expected member.id but canonical member resolution returned empty memberId." };
  }
  if (!canonicalIdentity.leadId) {
    return {
      ok: false as const,
      error: "createAssessmentAction expected lead.id but selected intake record is not linked to a canonical lead."
    };
  }

  const effectiveMemberId = canonicalIdentity.memberId;
  const leadId = canonicalIdentity.leadId;
  let leadRow: Awaited<ReturnType<typeof getLeadRecordById>> = null;
  try {
    leadRow = await getLeadRecordById(leadId);
  } catch (error) {
    return {
      ok: false as const,
      error: `Unable to resolve canonical lead.id for intake assessment. ${error instanceof Error ? error.message : "Unknown error"}`
    };
  }
  if (!leadRow) {
    return { ok: false as const, error: "createAssessmentAction expected lead.id, but canonical lead lookup returned no row." };
  }

  const leadStage = leadRow.stage ?? payload.data.leadStage ?? null;
  const leadStatus = leadRow.status ?? payload.data.leadStatus ?? null;

  let created: Awaited<ReturnType<typeof createIntakeAssessmentWithResponses>> | null = null;
  try {
    const normalizedAssistiveSelections = normalizeIntakeAssistiveDeviceFields({
      assistiveDevices: payload.data.assistiveDevices || "",
      mobilityAids: payload.data.mobilityAids || "",
      transportMobilityAid: payload.data.transportMobilityAid || ""
    });

    created = await createIntakeAssessmentWithResponses({
      payload: {
        memberId: effectiveMemberId,
        leadId,
        assessmentDate: payload.data.assessmentDate,
        complete: payload.data.complete,
        feelingToday: payload.data.feelingToday,
        healthLately: payload.data.healthLately,
        allergies: payload.data.allergies,
        codeStatus: payload.data.codeStatus || "",
        orientationDobVerified: payload.data.orientationDobVerified,
        orientationCityVerified: payload.data.orientationCityVerified,
        orientationYearVerified: payload.data.orientationYearVerified,
        orientationOccupationVerified: payload.data.orientationOccupationVerified,
        orientationNotes: payload.data.orientationNotes || "",
        medicationManagementStatus: payload.data.medicationManagementStatus,
        dressingSupportStatus: payload.data.dressingSupportStatus,
        assistiveDevices: normalizedAssistiveSelections.assistiveDevices,
        incontinenceProducts: payload.data.incontinenceProducts || "",
        onSiteMedicationUse: payload.data.onSiteMedicationUse || "",
        onSiteMedicationList: payload.data.onSiteMedicationList?.trim() || "",
        independenceNotes: payload.data.independenceNotes || "",
        dietType: payload.data.dietType,
        dietOther: payload.data.dietOther || "",
        dietRestrictionsNotes: payload.data.dietRestrictionsNotes || "",
        mobilitySteadiness: payload.data.mobilitySteadiness,
        fallsHistory: payload.data.fallsHistory || "",
        mobilityAids: normalizedAssistiveSelections.mobilityAids,
        mobilitySafetyNotes: payload.data.mobilitySafetyNotes || "",
        overwhelmedByNoise: payload.data.overwhelmedByNoise,
        socialTriggers: payload.data.socialTriggers || "",
        emotionalWellnessNotes: payload.data.emotionalWellnessNotes || "",
        joySparks: payload.data.joySparks || "",
        personalNotes: payload.data.personalNotes || "",
        scoreOrientationGeneralHealth: payload.data.scoreOrientationGeneralHealth,
        scoreDailyRoutinesIndependence: payload.data.scoreDailyRoutinesIndependence,
        scoreNutritionDietaryNeeds: payload.data.scoreNutritionDietaryNeeds,
        scoreMobilitySafety: payload.data.scoreMobilitySafety,
        scoreSocialEmotionalWellness: payload.data.scoreSocialEmotionalWellness,
        transportCanEnterExitVehicle: payload.data.transportCanEnterExitVehicle,
        transportAssistanceLevel: payload.data.transportAssistanceLevel,
        transportMobilityAid: normalizedAssistiveSelections.transportMobilityAid,
        transportCanRemainSeatedBuckled: payload.data.transportCanRemainSeatedBuckled,
        transportBehaviorConcern: payload.data.transportBehaviorConcern || "",
        transportAppropriate: payload.data.transportAppropriate,
        transportNotes: payload.data.transportNotes || "",
        vitalsHr: payload.data.vitalsHr,
        vitalsBp: payload.data.vitalsBp.trim(),
        vitalsO2Percent: payload.data.vitalsO2Percent,
        vitalsRr: payload.data.vitalsRr,
        notes: payload.data.notes || ""
      },
      actor: { id: profile.id, fullName: profile.full_name, signoffName: signerName },
      responseContext: {
        leadStage: leadStage ?? payload.data.leadStage ?? "",
        leadStatus: leadStatus ?? payload.data.leadStatus ?? ""
      },
      serviceRole: true
    });
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Unable to save intake assessment." };
  }

  try {
    await signIntakeAssessment({
      assessmentId: created.id,
      actor: {
        id: profile.id,
        fullName: profile.full_name,
        role: profile.role,
        signoffName: signerName
      },
      attested: payload.data.signatureAttested,
      signatureImageDataUrl: payload.data.signatureImageDataUrl,
      metadata: {
        module: "intake-assessment",
        signedFrom: "createAssessmentAction"
      },
      serviceRole: true
    });
  } catch (error) {
    const readiness = buildIntakePostSignState({
      signatureStatus: "unsigned",
      draftPofStatus: "pending"
    });
    revalidatePath("/health/assessment");
    revalidatePath(`/health/assessment/${created.id}`);
    revalidatePath(`/reports/assessments/${created.id}`);
    return {
      ok: true as const,
      assessmentId: created.id,
      ...readiness,
      ...buildCommittedWorkflowActionState({
        operationalStatus: readiness.postSignReadinessStatus,
        operationallyReady: readiness.postSignReady,
        actionNeededMessage:
          error instanceof Error
            ? `Intake Assessment was created, but nurse/admin e-signature finalization failed (${error.message}). Open the saved assessment and retry the signature.`
            : "Intake Assessment was created, but nurse/admin e-signature finalization failed."
      })
    };
  }

  const draftPofAttemptedAt = toEasternISO();
  try {
    await autoCreateDraftPhysicianOrderFromIntake({
      assessment: created,
      actor: { id: profile.id, fullName: profile.full_name, signoffName: signerName }
    });
  } catch (error) {
    const committedReloadMiss = error instanceof CommittedDraftPhysicianOrderReloadError;
    const message = error instanceof Error ? error.message : "Unable to create draft physician order from intake.";
    const queueTitleOverride = committedReloadMiss ? "Draft POF Verification Follow-up Needed" : null;
    const queueMessageOverride = committedReloadMiss
      ? "The intake assessment signed successfully and a draft POF was committed in Supabase, but the immediate readback could not verify it. Confirm the saved draft from Physician Orders before treating intake follow-up as complete."
      : null;
    await updateIntakeAssessmentDraftPofStatus({
      assessmentId: created.id,
      status: committedReloadMiss ? "created" : "failed",
      attemptedAt: draftPofAttemptedAt,
      error: committedReloadMiss ? null : message
    });
    let followUpQueueError: string | null = null;
    try {
      await queueIntakePostSignFollowUpTask({
        assessmentId: created.id,
        memberId: effectiveMemberId,
        taskType: "draft_pof_creation",
        actorUserId: profile.id,
        actorName: profile.full_name,
        errorMessage: message,
        titleOverride: queueTitleOverride,
        messageOverride: queueMessageOverride
      });
    } catch (queueError) {
      followUpQueueError =
        queueError instanceof Error ? queueError.message : "Unable to queue intake post-sign follow-up task.";
    }
    revalidatePath("/health/assessment");
    revalidatePath(`/health/assessment/${created.id}`);
    revalidatePath(`/reports/assessments/${created.id}`);
    const readiness = buildIntakePostSignState({
      signatureStatus: "signed",
      draftPofStatus: committedReloadMiss ? "created" : "failed",
      openFollowUpTaskTypes: ["draft_pof_creation"]
    });
    return {
      ok: true as const,
      assessmentId: created.id,
      followUpTaskType: followUpQueueError ? undefined : ("draft_pof_creation" as const),
      ...readiness,
      ...buildCommittedWorkflowActionState({
        operationalStatus: readiness.postSignReadinessStatus,
        operationallyReady: readiness.postSignReady,
        actionNeededMessage: committedReloadMiss
          ? followUpQueueError
            ? `Intake Assessment was signed and the draft POF was committed, but immediate readback verification failed (${message}). Follow-up queue creation also failed (${followUpQueueError}).`
            : `Intake Assessment was signed and the draft POF was committed, but immediate readback verification still needs follow-up (${message}).`
          : followUpQueueError
            ? `Intake Assessment was signed and draft POF creation failed (${message}). Follow-up queue creation also failed (${followUpQueueError}).`
            : `Intake Assessment was signed, but draft POF creation failed (${message}).`
      })
    };
  }

  try {
    const generated = await buildIntakeAssessmentPdfDataUrl(created.id);
    await saveGeneratedMemberPdfToFiles({
      memberId: effectiveMemberId,
      memberName: canonicalIdentity.displayName || "Member",
      documentLabel: "Intake Assessment",
      documentSource: `Intake Assessment:${created.id}`,
      category: "Assessment",
      dataUrl: generated.dataUrl,
      uploadedBy: {
        id: profile.id,
        name: profile.full_name
      },
      generatedAtIso: toEasternISO(),
      replaceExistingByDocumentSource: true
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown PDF generation error.";
    let followUpQueueError: string | null = null;
    try {
      await queueIntakePostSignFollowUpTask({
        assessmentId: created.id,
        memberId: effectiveMemberId,
        taskType: "member_file_pdf_persistence",
        actorUserId: profile.id,
        actorName: profile.full_name,
        errorMessage: message
      });
    } catch (queueError) {
      followUpQueueError =
        queueError instanceof Error ? queueError.message : "Unable to queue intake post-sign follow-up task.";
    }
    return {
      ok: true as const,
      assessmentId: created.id,
      followUpTaskType: followUpQueueError ? undefined : ("member_file_pdf_persistence" as const),
      ...buildCommittedWorkflowActionState({
        operationalStatus: followUpQueueError ? "signed_pending_member_file_pdf" : "signed_pending_member_file_pdf",
        operationallyReady: false,
        actionNeededMessage: followUpQueueError
          ? `Intake Assessment PDF save to Member Files failed (${message}). Follow-up queue creation also failed (${followUpQueueError}).`
          : `Intake Assessment was created, but saving its PDF to member files failed (${message}).`
      }),
      ...(followUpQueueError
        ? {}
        : buildIntakePostSignState({
            signatureStatus: "signed",
            draftPofStatus: "created",
            openFollowUpTaskTypes: ["member_file_pdf_persistence"]
          }))
    };
  }

  revalidatePath("/health");
  revalidatePath("/health/assessment");
  revalidatePath(`/health/assessment/${created.id}`);
  revalidatePath("/health/member-health-profiles");
  revalidatePath(`/health/member-health-profiles/${effectiveMemberId}`);
  revalidatePath("/health/physician-orders");
  revalidatePath(`/health/physician-orders?memberId=${effectiveMemberId}`);
  revalidatePath(`/operations/member-command-center/${effectiveMemberId}`);
  revalidatePath(`/members/${effectiveMemberId}`);
  revalidatePath(`/reports/assessments/${created.id}`);
  return {
    ok: true,
    assessmentId: created.id,
    ...(() => {
      const readiness = buildIntakePostSignState({
        signatureStatus: "signed",
        draftPofStatus: "created"
      });
      return {
        ...readiness,
        ...buildCommittedWorkflowActionState({
          operationalStatus: readiness.postSignReadinessStatus,
          operationallyReady: readiness.postSignReady
        })
      };
    })()
  };
}
