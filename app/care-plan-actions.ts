"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireCarePlanAuthorizedUser } from "@/lib/services/care-plan-authorization";
import { sendCarePlanToCaregiverForSignature } from "@/lib/services/care-plan-esign";
import { createCarePlan, reviewCarePlan, signCarePlanAsNurseAdmin } from "@/lib/services/care-plans";

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
    caregiverEmail: z.string().email()
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
  });

export async function createCarePlanAction(raw: z.infer<typeof createCarePlanSchema>) {
  const user = await requireCarePlanAuthorizedUser();
  const payload = createCarePlanSchema.safeParse(raw);
  if (!payload.success) return { error: "Invalid care plan submission." };

  const created = await createCarePlan({
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
    actor: {
      id: user.userId,
      fullName: user.fullName,
      signatureName: user.signatureName
    }
  });

  revalidatePath("/health");
  revalidatePath("/health/care-plans");
  revalidatePath("/health/care-plans/list");
  revalidatePath(`/health/care-plans/${created.id}`);
  revalidatePath(`/members/${created.memberId}`);
  return { ok: true, id: created.id } as const;
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
    caregiverEmail: z.string().email()
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
  });

export async function reviewCarePlanAction(raw: z.infer<typeof reviewCarePlanSchema>) {
  const user = await requireCarePlanAuthorizedUser();
  const payload = reviewCarePlanSchema.safeParse(raw);
  if (!payload.success) return { error: "Invalid care plan review submission." };

  const updated = await reviewCarePlan({
    carePlanId: payload.data.carePlanId,
    reviewDate: payload.data.reviewDate,
    noChangesNeeded: payload.data.noChangesNeeded,
    modificationsRequired: payload.data.modificationsRequired,
    modificationsDescription: payload.data.modificationsDescription || "",
    careTeamNotes: payload.data.careTeamNotes,
    caregiverName: payload.data.caregiverName,
    caregiverEmail: payload.data.caregiverEmail,
    actor: {
      id: user.userId,
      fullName: user.fullName,
      signatureName: user.signatureName
    }
  });

  revalidatePath("/health");
  revalidatePath("/health/care-plans");
  revalidatePath("/health/care-plans/list");
  revalidatePath("/health/care-plans/due-report");
  revalidatePath(`/health/care-plans/${updated.id}`);
  revalidatePath(`/members/${updated.memberId}`);
  return { ok: true } as const;
}

const signCarePlanSchema = z.object({
  carePlanId: z.string().min(1)
});

export async function signCarePlanAction(raw: z.infer<typeof signCarePlanSchema>) {
  const user = await requireCarePlanAuthorizedUser();
  const payload = signCarePlanSchema.safeParse(raw);
  if (!payload.success) return { ok: false, error: "Care plan is required." } as const;
  const updated = await signCarePlanAsNurseAdmin({
    carePlanId: payload.data.carePlanId,
    actor: {
      id: user.userId,
      fullName: user.fullName,
      signatureName: user.signatureName
    }
  });
  revalidatePath(`/health/care-plans/${updated.id}`);
  revalidatePath(`/members/${updated.memberId}`);
  return { ok: true } as const;
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
    revalidatePath(`/members/${updated.memberId}`);
    return { ok: true, status: updated.caregiverSignatureStatus } as const;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to send caregiver signature request."
    } as const;
  }
}
