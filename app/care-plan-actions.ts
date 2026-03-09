"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireRoles } from "@/lib/auth";
import { CARE_PLAN_SECTION_TYPES, createCarePlan, reviewCarePlan } from "@/lib/services/care-plans";
import { getManagedUserSignatureName } from "@/lib/services/user-management";
import { toEasternDate } from "@/lib/timezone";

const sectionSchema = z.object({
  sectionType: z.enum(CARE_PLAN_SECTION_TYPES),
  shortTermGoals: z.string().min(1),
  longTermGoals: z.string().min(1),
  displayOrder: z.number().int().min(1)
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
    completedBy: z.string().optional(),
    dateOfCompletion: z.string().optional(),
    responsiblePartySignature: z.string().optional(),
    responsiblePartySignatureDate: z.string().optional(),
    administratorSignature: z.string().optional(),
    administratorSignatureDate: z.string().optional(),
    sections: z.array(sectionSchema).min(1)
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
  const profile = await requireRoles(["admin", "manager", "nurse"]);
  const payload = createCarePlanSchema.safeParse(raw);
  if (!payload.success) {
    return { error: "Invalid care plan submission." };
  }

  const signerName = getManagedUserSignatureName(profile.id, profile.full_name);
  const completedDate = payload.data.dateOfCompletion || payload.data.reviewDate || toEasternDate();
  const created = createCarePlan({
    ...payload.data,
    completedBy: signerName,
    dateOfCompletion: completedDate,
    administratorSignature: signerName,
    administratorSignatureDate: payload.data.administratorSignatureDate || completedDate
  });
  revalidatePath("/health");
  revalidatePath("/health/care-plans");
  revalidatePath("/health/care-plans/list");
  revalidatePath(`/health/care-plans/${created.id}`);
  revalidatePath(`/members/${created.memberId}`);
  return { ok: true, id: created.id };
}

const reviewSectionSchema = z.object({
  id: z.string(),
  shortTermGoals: z.string().min(1),
  longTermGoals: z.string().min(1)
});

const reviewCarePlanSchema = z
  .object({
    carePlanId: z.string().min(1),
    reviewDate: z.string().min(1),
    reviewedBy: z.string().min(1),
    noChangesNeeded: z.boolean(),
    modificationsRequired: z.boolean(),
    modificationsDescription: z.string().optional().or(z.literal("")),
    careTeamNotes: z.string().min(1),
    responsiblePartySignature: z.string().optional(),
    responsiblePartySignatureDate: z.string().optional(),
    administratorSignature: z.string().optional(),
    administratorSignatureDate: z.string().optional(),
    sections: z.array(reviewSectionSchema).min(1)
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
  const profile = await requireRoles(["admin", "manager", "nurse"]);
  const payload = reviewCarePlanSchema.safeParse(raw);
  if (!payload.success) {
    return { error: "Invalid care plan review submission." };
  }

  const signerName = getManagedUserSignatureName(profile.id, profile.full_name);
  const updated = reviewCarePlan({
    ...payload.data,
    reviewedBy: signerName,
    administratorSignature: signerName,
    administratorSignatureDate: payload.data.administratorSignatureDate || payload.data.reviewDate,
    modificationsDescription: payload.data.modificationsDescription || ""
  });

  revalidatePath("/health");
  revalidatePath("/health/care-plans");
  revalidatePath("/health/care-plans/list");
  revalidatePath("/health/care-plans/due-report");
  revalidatePath(`/health/care-plans/${updated.id}`);
  revalidatePath(`/members/${updated.memberId}`);
  return { ok: true };
}

