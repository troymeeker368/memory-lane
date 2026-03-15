"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getCurrentProfile, requireRoles } from "@/lib/auth";
import { insertAuditLogEntry } from "@/lib/services/audit-log-service";
import { normalizeRoleKey } from "@/lib/permissions";
import {
  createEnrollmentPricingCommunityFee,
  createEnrollmentPricingDailyRate,
  setEnrollmentPricingCommunityFeeActive,
  setEnrollmentPricingDailyRateActive,
  updateEnrollmentPricingCommunityFee,
  updateEnrollmentPricingDailyRate
} from "@/lib/services/enrollment-pricing";

const optionalString = z.string().optional().or(z.literal(""));

const communityFeeSchema = z.object({
  id: optionalString,
  amount: z.coerce.number().min(0),
  effectiveStartDate: z.string().min(1),
  effectiveEndDate: optionalString,
  isActive: z.boolean().default(true),
  notes: optionalString
});

const dailyRateSchema = z
  .object({
    id: optionalString,
    label: z.string().min(1),
    minDaysPerWeek: z.coerce.number().int().min(1).max(7),
    maxDaysPerWeek: z.coerce.number().int().min(1).max(7),
    dailyRate: z.coerce.number().min(0),
    effectiveStartDate: z.string().min(1),
    effectiveEndDate: optionalString,
    isActive: z.boolean().default(true),
    displayOrder: z.coerce.number().int().min(0).max(9999),
    notes: optionalString
  })
  .superRefine((val, ctx) => {
    if (val.maxDaysPerWeek < val.minDaysPerWeek) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxDaysPerWeek"],
        message: "Max days/week cannot be less than min days/week."
      });
    }
  });

const activeToggleSchema = z.object({
  id: z.string().uuid(),
  isActive: z.boolean()
});

async function requirePricingEditors() {
  await requireRoles(["admin", "director"]);
}

async function insertPricingAudit(input: {
  action: string;
  entityType: string;
  entityId: string;
  details: Record<string, unknown>;
}) {
  const profile = await getCurrentProfile();
  await insertAuditLogEntry({
    actorUserId: profile.id,
    actorRole: normalizeRoleKey(profile.role),
    action: "manager_review",
    entityType: input.entityType,
    entityId: input.entityId,
    details: {
      operation: input.action,
      ...input.details
    }
  });
}

function revalidatePricingConsumers() {
  revalidatePath("/operations/pricing");
  revalidatePath("/sales");
  revalidatePath("/sales/new-entries/send-enrollment-packet");
}

export async function upsertEnrollmentPricingCommunityFeeAction(raw: z.infer<typeof communityFeeSchema>) {
  await requirePricingEditors();

  const payload = communityFeeSchema.safeParse(raw);
  if (!payload.success) {
    return { ok: false as const, error: "Invalid community fee input." };
  }

  try {
    const profile = await getCurrentProfile();
    const id = (payload.data.id ?? "").trim();
    const saved = id
      ? await updateEnrollmentPricingCommunityFee({
          id,
          amount: payload.data.amount,
          effectiveStartDate: payload.data.effectiveStartDate,
          effectiveEndDate: payload.data.effectiveEndDate || null,
          isActive: payload.data.isActive,
          notes: payload.data.notes || null,
          actorUserId: profile.id
        })
      : await createEnrollmentPricingCommunityFee({
          amount: payload.data.amount,
          effectiveStartDate: payload.data.effectiveStartDate,
          effectiveEndDate: payload.data.effectiveEndDate || null,
          isActive: payload.data.isActive,
          notes: payload.data.notes || null,
          actorUserId: profile.id
        });

    await insertPricingAudit({
      action: id ? "update" : "create",
      entityType: "enrollment_pricing_community_fee",
      entityId: saved.id,
      details: {
        amount: saved.amount,
        effectiveStartDate: saved.effectiveStartDate,
        effectiveEndDate: saved.effectiveEndDate,
        isActive: saved.isActive
      }
    });

    revalidatePricingConsumers();
    return { ok: true as const, id: saved.id };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Unable to save community fee pricing."
    };
  }
}

export async function setEnrollmentPricingCommunityFeeActiveAction(raw: z.infer<typeof activeToggleSchema>) {
  await requirePricingEditors();

  const payload = activeToggleSchema.safeParse(raw);
  if (!payload.success) {
    return { ok: false as const, error: "Invalid community fee action." };
  }

  try {
    const profile = await getCurrentProfile();
    const saved = await setEnrollmentPricingCommunityFeeActive({
      id: payload.data.id,
      isActive: payload.data.isActive,
      actorUserId: profile.id
    });

    await insertPricingAudit({
      action: payload.data.isActive ? "activate" : "deactivate",
      entityType: "enrollment_pricing_community_fee",
      entityId: saved.id,
      details: {
        isActive: saved.isActive,
        amount: saved.amount,
        effectiveStartDate: saved.effectiveStartDate,
        effectiveEndDate: saved.effectiveEndDate
      }
    });

    revalidatePricingConsumers();
    return { ok: true as const };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Unable to update community fee status."
    };
  }
}

export async function upsertEnrollmentPricingDailyRateAction(raw: z.infer<typeof dailyRateSchema>) {
  await requirePricingEditors();

  const payload = dailyRateSchema.safeParse(raw);
  if (!payload.success) {
    return { ok: false as const, error: "Invalid daily rate input." };
  }

  try {
    const profile = await getCurrentProfile();
    const id = (payload.data.id ?? "").trim();
    const saved = id
      ? await updateEnrollmentPricingDailyRate({
          id,
          label: payload.data.label,
          minDaysPerWeek: payload.data.minDaysPerWeek,
          maxDaysPerWeek: payload.data.maxDaysPerWeek,
          dailyRate: payload.data.dailyRate,
          effectiveStartDate: payload.data.effectiveStartDate,
          effectiveEndDate: payload.data.effectiveEndDate || null,
          isActive: payload.data.isActive,
          displayOrder: payload.data.displayOrder,
          notes: payload.data.notes || null,
          actorUserId: profile.id
        })
      : await createEnrollmentPricingDailyRate({
          label: payload.data.label,
          minDaysPerWeek: payload.data.minDaysPerWeek,
          maxDaysPerWeek: payload.data.maxDaysPerWeek,
          dailyRate: payload.data.dailyRate,
          effectiveStartDate: payload.data.effectiveStartDate,
          effectiveEndDate: payload.data.effectiveEndDate || null,
          isActive: payload.data.isActive,
          displayOrder: payload.data.displayOrder,
          notes: payload.data.notes || null,
          actorUserId: profile.id
        });

    await insertPricingAudit({
      action: id ? "update" : "create",
      entityType: "enrollment_pricing_daily_rate",
      entityId: saved.id,
      details: {
        label: saved.label,
        minDaysPerWeek: saved.minDaysPerWeek,
        maxDaysPerWeek: saved.maxDaysPerWeek,
        dailyRate: saved.dailyRate,
        effectiveStartDate: saved.effectiveStartDate,
        effectiveEndDate: saved.effectiveEndDate,
        isActive: saved.isActive,
        displayOrder: saved.displayOrder
      }
    });

    revalidatePricingConsumers();
    return { ok: true as const, id: saved.id };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Unable to save daily rate pricing."
    };
  }
}

export async function setEnrollmentPricingDailyRateActiveAction(raw: z.infer<typeof activeToggleSchema>) {
  await requirePricingEditors();

  const payload = activeToggleSchema.safeParse(raw);
  if (!payload.success) {
    return { ok: false as const, error: "Invalid daily rate action." };
  }

  try {
    const profile = await getCurrentProfile();
    const saved = await setEnrollmentPricingDailyRateActive({
      id: payload.data.id,
      isActive: payload.data.isActive,
      actorUserId: profile.id
    });

    await insertPricingAudit({
      action: payload.data.isActive ? "activate" : "deactivate",
      entityType: "enrollment_pricing_daily_rate",
      entityId: saved.id,
      details: {
        isActive: saved.isActive,
        label: saved.label,
        minDaysPerWeek: saved.minDaysPerWeek,
        maxDaysPerWeek: saved.maxDaysPerWeek,
        dailyRate: saved.dailyRate
      }
    });

    revalidatePricingConsumers();
    return { ok: true as const };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Unable to update daily rate status."
    };
  }
}
