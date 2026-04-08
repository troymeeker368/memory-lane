"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireCarePlanAuthorizedUser } from "@/lib/services/care-plan-authorization";
import { buildCommittedWorkflowActionState } from "@/lib/services/committed-workflow-state";
import {
  buildCommittedCarePlanActionState
} from "@/lib/services/care-plan-post-sign-readiness";
import { CARE_PLAN_SECTION_TYPES } from "@/lib/services/care-plan-track-definitions";

async function loadCarePlanWriteService() {
  return import("@/lib/services/care-plans-write");
}

async function loadCarePlanReadService() {
  return import("@/lib/services/care-plans-read");
}

async function loadCarePlanEsignService() {
  return import("@/lib/services/care-plan-esign");
}

async function buildPersistedCarePlanActionState(input: {
  carePlanId: string;
  fallbackOperationalStatus: string;
  actionNeededMessage?: string | null;
  failureRequiresStaffFollowUp?: boolean;
}) {
  try {
    const { getCarePlanDispatchState } = await loadCarePlanReadService();
    const state = await getCarePlanDispatchState(input.carePlanId, { serviceRole: true });
    if (state?.postSignReadinessStatus) {
      return buildCommittedCarePlanActionState({
        status: state.postSignReadinessStatus,
        failureRequiresStaffFollowUp: input.failureRequiresStaffFollowUp,
        actionNeededMessage: input.actionNeededMessage
      });
    }
  } catch (error) {
    console.error("[care-plan-actions] unable to reload persisted care plan readiness", {
      carePlanId: input.carePlanId,
      message: error instanceof Error ? error.message : "Unknown care plan readiness reload error."
    });
  }

  return buildCommittedWorkflowActionState({
    operationalStatus: input.fallbackOperationalStatus,
    readinessStage: "follow_up_required",
    actionNeededMessage: input.actionNeededMessage
  });
}

function getCommittedCarePlanId(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { carePlanId?: string | null; partiallyCommitted?: boolean | null };
  if (candidate.partiallyCommitted !== true) return null;
  const carePlanId = String(candidate.carePlanId ?? "").trim();
  return carePlanId.length > 0 ? carePlanId : null;
}

const carePlanSectionSchema = z.object({
  sectionType: z.enum(CARE_PLAN_SECTION_TYPES),
  shortTermGoals: z.string().min(1),
  longTermGoals: z.string().min(1)
});

const createCarePlanSchema = z
  .object({
    memberId: z.string().min(1),
    track: z.enum(["Track 1", "Track 2", "Track 3"]),
    enrollmentDate: z.string().min(1),
    reviewDate: z.string().min(1),
    noChangesNeeded: z.boolean(),
    modificationsRequired: z.boolean(),
    modificationsDescription: z.string().optional().or(z.literal("")),
    careTeamNotes: z.string().default(""),
    caregiverName: z.string().min(1),
    caregiverEmail: z.string().email(),
    sections: z.array(carePlanSectionSchema).min(1),
    signatureAttested: z.boolean(),
    signatureImageDataUrl: z.string().min(1)
  })
  .superRefine((value, ctx) => {
    if (!value.noChangesNeeded && !value.modificationsRequired) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["noChangesNeeded"],
        message: "Select no changes needed or modifications required."
      });
    }
    if (value.modificationsRequired && !value.modificationsDescription?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["modificationsDescription"],
        message: "Modification description is required when modifications are marked required."
      });
    }
    if (!value.signatureAttested) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["signatureAttested"],
        message: "Electronic signature attestation is required."
      });
    }
    if (!value.signatureImageDataUrl.trim().startsWith("data:image/")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["signatureImageDataUrl"],
        message: "A valid drawn nurse/admin signature image is required."
      });
    }
  });

export async function createCarePlanAction(raw: z.infer<typeof createCarePlanSchema>) {
  const user = await requireCarePlanAuthorizedUser();
  const payload = createCarePlanSchema.safeParse(raw);
  if (!payload.success) return { ok: false as const, error: "Invalid care plan submission." };

  let created: { id: string; memberId: string } | null = null;
  try {
    const { createCarePlan } = await loadCarePlanWriteService();
    created = await createCarePlan({
      memberId: payload.data.memberId,
      track: payload.data.track,
      enrollmentDate: payload.data.enrollmentDate,
      reviewDate: payload.data.reviewDate,
      noChangesNeeded: payload.data.noChangesNeeded,
      modificationsRequired: payload.data.modificationsRequired,
      modificationsDescription: payload.data.modificationsDescription || "",
      careTeamNotes: payload.data.careTeamNotes,
      caregiverName: payload.data.caregiverName,
      caregiverEmail: payload.data.caregiverEmail,
      sections: payload.data.sections,
      signatureAttested: payload.data.signatureAttested,
      signatureImageDataUrl: payload.data.signatureImageDataUrl,
      actor: {
        id: user.userId,
        fullName: user.fullName,
        signatureName: user.signatureName,
        role: user.role
      }
    });
  } catch (error) {
    const carePlanId =
      error && typeof error === "object" && "carePlanId" in error ? String((error as { carePlanId?: string }).carePlanId ?? "") : "";
    if (carePlanId) {
      revalidatePath(`/health/care-plans/${carePlanId}`);
    }
    return {
      ok: Boolean(carePlanId) as true | false,
      ...(carePlanId
        ? await buildPersistedCarePlanActionState({
            carePlanId,
            fallbackOperationalStatus: "follow_up_required",
            actionNeededMessage: error instanceof Error ? error.message : "Unable to create care plan.",
            failureRequiresStaffFollowUp: true
          })
        : {}),
      ...(carePlanId ? { error: null } : { error: error instanceof Error ? error.message : "Unable to create care plan." }),
      ...(carePlanId ? { id: carePlanId } : {})
    };
  }

  const createdCarePlan = created as { id: string; memberId: string };
  revalidatePath("/health");
  revalidatePath("/health/care-plans");
  revalidatePath("/health/care-plans/list");
  revalidatePath(`/health/care-plans/${createdCarePlan.id}`);
  revalidatePath(`/health/member-health-profiles/${createdCarePlan.memberId}`);
  revalidatePath(`/members/${createdCarePlan.memberId}`);
  return {
    ok: true as const,
    error: null,
    id: createdCarePlan.id,
    ...await buildPersistedCarePlanActionState({
      carePlanId: createdCarePlan.id,
      fallbackOperationalStatus: "ready"
    })
  };
}

const reviewCarePlanSchema = z
  .object({
    carePlanId: z.string().min(1),
    reviewDate: z.string().min(1),
    noChangesNeeded: z.boolean(),
    modificationsRequired: z.boolean(),
    modificationsDescription: z.string().optional().or(z.literal("")),
    careTeamNotes: z.string().default(""),
    caregiverName: z.string().min(1),
    caregiverEmail: z.string().email(),
    sections: z.array(carePlanSectionSchema).min(1),
    signatureAttested: z.boolean(),
    signatureImageDataUrl: z.string().min(1)
  })
  .superRefine((value, ctx) => {
    if (!value.noChangesNeeded && !value.modificationsRequired) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["noChangesNeeded"],
        message: "Select no changes needed or modifications required."
      });
    }
    if (value.modificationsRequired && !value.modificationsDescription?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["modificationsDescription"],
        message: "Modification description is required when modifications are marked required."
      });
    }
    if (!value.signatureAttested) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["signatureAttested"],
        message: "Electronic signature attestation is required."
      });
    }
    if (!value.signatureImageDataUrl.trim().startsWith("data:image/")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["signatureImageDataUrl"],
        message: "A valid drawn nurse/admin signature image is required."
      });
    }
  });

export async function reviewCarePlanAction(raw: z.infer<typeof reviewCarePlanSchema>) {
  const user = await requireCarePlanAuthorizedUser();
  const payload = reviewCarePlanSchema.safeParse(raw);
  if (!payload.success) return { ok: false as const, error: "Invalid care plan review submission." };

  let updated: { id: string; memberId: string } | null = null;
  try {
    const { reviewCarePlan } = await loadCarePlanWriteService();
    updated = await reviewCarePlan({
      carePlanId: payload.data.carePlanId,
      reviewDate: payload.data.reviewDate,
      noChangesNeeded: payload.data.noChangesNeeded,
      modificationsRequired: payload.data.modificationsRequired,
      modificationsDescription: payload.data.modificationsDescription || "",
      careTeamNotes: payload.data.careTeamNotes,
      caregiverName: payload.data.caregiverName,
      caregiverEmail: payload.data.caregiverEmail,
      sections: payload.data.sections,
      signatureAttested: payload.data.signatureAttested,
      signatureImageDataUrl: payload.data.signatureImageDataUrl,
      actor: {
        id: user.userId,
        fullName: user.fullName,
        signatureName: user.signatureName,
        role: user.role
      }
    });
  } catch (error) {
    const committedCarePlanId = getCommittedCarePlanId(error);
    if (!committedCarePlanId) {
      return {
        ok: false as const,
        error: error instanceof Error ? error.message : "Unable to review care plan."
      };
    }
    revalidatePath(`/health/care-plans/${committedCarePlanId}`);
    return {
      ok: true as const,
      error: null,
      id: committedCarePlanId,
      ...await buildPersistedCarePlanActionState({
        carePlanId: committedCarePlanId,
        fallbackOperationalStatus: "follow_up_required",
        actionNeededMessage: error instanceof Error ? error.message : "Unable to review care plan.",
        failureRequiresStaffFollowUp: true
      })
    } as const;
  }

  const reviewedCarePlan = updated as { id: string; memberId: string };
  revalidatePath("/health");
  revalidatePath("/health/care-plans");
  revalidatePath("/health/care-plans/list");
  revalidatePath("/health/care-plans/due-report");
  revalidatePath(`/health/care-plans/${reviewedCarePlan.id}`);
  revalidatePath(`/health/member-health-profiles/${reviewedCarePlan.memberId}`);
  revalidatePath(`/members/${reviewedCarePlan.memberId}`);
  return {
    ok: true as const,
    error: null,
    ...await buildPersistedCarePlanActionState({
      carePlanId: reviewedCarePlan.id,
      fallbackOperationalStatus: "ready"
    })
  };
}

const signCarePlanSchema = z.object({
  carePlanId: z.string().min(1),
  attested: z.boolean(),
  signatureImageDataUrl: z.string().min(1)
});

export async function signCarePlanAction(raw: z.infer<typeof signCarePlanSchema>) {
  const user = await requireCarePlanAuthorizedUser();
  const payload = signCarePlanSchema.safeParse(raw);
  if (!payload.success) {
    const attested = typeof (raw as { attested?: unknown }).attested === "boolean"
      ? (raw as { attested?: boolean }).attested
      : false;
    if (!attested) {
      return { ok: false, error: "Electronic signature attestation is required." } as const;
    }
    const signatureImageDataUrl = typeof (raw as { signatureImageDataUrl?: unknown }).signatureImageDataUrl === "string"
      ? ((raw as { signatureImageDataUrl?: string }).signatureImageDataUrl ?? "").trim()
      : "";
    if (!signatureImageDataUrl) {
      return { ok: false, error: "Draw nurse/admin signature before signing." } as const;
    }
     return { ok: false, error: "Care plan is required." } as const;
  }
  if (!payload.data.signatureImageDataUrl.trim().startsWith("data:image/")) {
    return { ok: false, error: "A valid drawn nurse/admin signature image is required." } as const;
  }
  let updated: {
    id: string;
    memberId: string;
    caregiverSignatureStatus: string;
  } | null = null;
  try {
    const { signCarePlanAsNurseAdmin } = await loadCarePlanWriteService();
    updated = await signCarePlanAsNurseAdmin({
      carePlanId: payload.data.carePlanId,
      actor: {
        id: user.userId,
        fullName: user.fullName,
        signatureName: user.signatureName,
        role: user.role
      },
      attested: payload.data.attested,
      signatureImageDataUrl: payload.data.signatureImageDataUrl
    });
  } catch (error) {
    const committedCarePlanId = getCommittedCarePlanId(error);
    if (!committedCarePlanId) {
      return {
        ok: false as const,
        error: error instanceof Error ? error.message : "Unable to sign care plan."
      };
    }
    revalidatePath(`/health/care-plans/${committedCarePlanId}`);
    return {
      ok: true as const,
      error: null,
      id: committedCarePlanId,
      ...await buildPersistedCarePlanActionState({
        carePlanId: committedCarePlanId,
        fallbackOperationalStatus: "follow_up_required",
        actionNeededMessage: error instanceof Error ? error.message : "Unable to sign care plan.",
        failureRequiresStaffFollowUp: true
      })
    } as const;
  }
  const signedCarePlan = updated as {
    id: string;
    memberId: string;
    caregiverSignatureStatus: string;
  };
  revalidatePath(`/health/care-plans/${signedCarePlan.id}`);
  revalidatePath(`/health/member-health-profiles/${signedCarePlan.memberId}`);
  revalidatePath(`/members/${signedCarePlan.memberId}`);
  return {
    ok: true as const,
    error: null,
    status: signedCarePlan.caregiverSignatureStatus,
    ...await buildPersistedCarePlanActionState({
      carePlanId: signedCarePlan.id,
      fallbackOperationalStatus: "ready"
    })
  };
}

const sendCaregiverSignatureSchema = z.object({
  carePlanId: z.string().min(1),
  caregiverName: z.string().min(1),
  caregiverEmail: z.string().email(),
  optionalMessage: z.string().optional().or(z.literal("")),
  expiresOnDate: z.string().min(1)
});

export async function sendCarePlanToCaregiverAction(raw: z.infer<typeof sendCaregiverSignatureSchema>) {
  const user = await requireCarePlanAuthorizedUser();
  const payload = sendCaregiverSignatureSchema.safeParse(raw);
  if (!payload.success) {
    return { ok: false, error: "Invalid caregiver signature send request." } as const;
  }

  try {
    const { sendCarePlanToCaregiverForSignature } = await loadCarePlanEsignService();
    const updated = await sendCarePlanToCaregiverForSignature({
      carePlanId: payload.data.carePlanId,
      caregiverName: payload.data.caregiverName,
      caregiverEmail: payload.data.caregiverEmail,
      optionalMessage: payload.data.optionalMessage || null,
      expiresOnDate: payload.data.expiresOnDate,
      actor: {
        id: user.userId,
        fullName: user.fullName,
        signatureName: user.signatureName
      }
    });

    revalidatePath(`/health/care-plans/${updated.id}`);
    revalidatePath(`/health/member-health-profiles/${updated.memberId}`);
    revalidatePath(`/members/${updated.memberId}`);
    return { ok: true, status: updated.caregiverSignatureStatus } as const;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to send caregiver signature request."
    } as const;
  }
}
