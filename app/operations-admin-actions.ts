"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { parseBusNumbersInput, updateOperationalSettings } from "@/lib/services/operations-settings";
import { updateAncillaryCategoryPriceSupabase } from "@/lib/services/ancillary-write-supabase";

import {
  type ActionErrorResult,
  type ActionSuccessResult,
  insertAudit,
  requireAdminEditor
} from "@/app/action-helpers";

const ancillaryPricingSchema = z.object({
  categoryId: z.string().uuid(),
  unitPriceDollars: z.coerce.number().min(0).max(9999)
});

export async function updateAncillaryCategoryPriceAction(
  raw: z.infer<typeof ancillaryPricingSchema>
): Promise<ActionErrorResult | ActionSuccessResult> {
  const payload = ancillaryPricingSchema.safeParse(raw);
  if (!payload.success) {
    return { error: "Invalid ancillary pricing update." };
  }

  const editor = await requireAdminEditor();
  if ("error" in editor) return editor;

  const nextPriceCents = Math.round(payload.data.unitPriceDollars * 100);
  let updated;
  try {
    updated = await updateAncillaryCategoryPriceSupabase({
      categoryId: payload.data.categoryId,
      priceCents: nextPriceCents
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to update ancillary pricing." };
  }

  await insertAudit("manager_review", "ancillary_category", updated.id, {
    categoryName: updated.name,
    unitPriceDollars: payload.data.unitPriceDollars,
    unitPriceCents: nextPriceCents
  });

  revalidatePath("/operations/additional-charges");
  revalidatePath("/operations/additional-charges/manage-ancillary-pricing");
  revalidatePath("/ancillary");
  revalidatePath("/reports");
  revalidatePath("/reports/monthly-ancillary");

  return { ok: true };
}

const operationalSettingsSchema = z.object({
  busNumbersCsv: z.string().optional().default(""),
  makeupPolicy: z.enum(["rolling_30_day_expiration", "running_total"]),
  latePickupGraceStartTime: z.string().regex(/^\d{2}:\d{2}$/),
  latePickupFirstWindowMinutes: z.coerce.number().int().min(1).max(180),
  latePickupFirstWindowFeeDollars: z.coerce.number().min(0).max(9999),
  latePickupAdditionalPerMinuteDollars: z.coerce.number().min(0).max(999),
  latePickupAdditionalMinutesCap: z.coerce.number().int().min(0).max(240)
});

export async function updateOperationalSettingsAction(
  raw: z.infer<typeof operationalSettingsSchema>
): Promise<ActionErrorResult | ActionSuccessResult<{ settings: Awaited<ReturnType<typeof updateOperationalSettings>> }>> {
  const payload = operationalSettingsSchema.safeParse(raw);
  if (!payload.success) {
    return { error: "Invalid operations settings update." };
  }

  const editor = await requireAdminEditor();
  if ("error" in editor) return editor;

  const busNumbers = parseBusNumbersInput(payload.data.busNumbersCsv);
  const settings = await updateOperationalSettings({
    busNumbers,
    makeupPolicy: payload.data.makeupPolicy,
    latePickupRules: {
      graceStartTime: payload.data.latePickupGraceStartTime,
      firstWindowMinutes: payload.data.latePickupFirstWindowMinutes,
      firstWindowFeeCents: Math.round(payload.data.latePickupFirstWindowFeeDollars * 100),
      additionalPerMinuteCents: Math.round(payload.data.latePickupAdditionalPerMinuteDollars * 100),
      additionalMinutesCap: payload.data.latePickupAdditionalMinutesCap
    }
  });

  await insertAudit("manager_review", "operations_settings", null, {
    busNumbers: settings.busNumbers,
    makeupPolicy: settings.makeupPolicy,
    latePickupRules: settings.latePickupRules
  });

  revalidatePath("/operations/additional-charges/manage-ancillary-pricing");
  revalidatePath("/operations/transportation-station");
  revalidatePath("/operations/transportation-station/print");
  revalidatePath("/operations/member-command-center");
  revalidatePath("/operations/attendance");
  revalidatePath("/operations/holds");
  revalidatePath("/ancillary");
  revalidatePath("/reports");
  revalidatePath("/reports/monthly-ancillary");

  return { ok: true, settings };
}
