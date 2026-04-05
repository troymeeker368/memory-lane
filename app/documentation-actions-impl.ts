import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  insertDocumentationAudit,
  requireDocumentationManagerEditor
} from "@/app/documentation-action-support";
import {
  PARTICIPATION_MISSING_REASONS,
  TOILET_USE_TYPE_OPTIONS,
  TRANSPORT_PERIOD_OPTIONS,
  TRANSPORT_TYPE_OPTIONS
} from "@/lib/canonical";
import { updateToiletLogWithAncillarySync } from "@/lib/services/ancillary-write-supabase";
import {
  deleteWorkflowRecordSupabase,
  setAncillaryReconciliationSupabase,
  updateAncillaryLogNotesSupabase,
  updateBloodSugarLogSupabase,
  updateDailyActivityParticipationSupabase,
  updateShowerLogSupabase
} from "@/lib/services/documentation-write-supabase";
import { toEasternISO } from "@/lib/timezone";
import type { UserProfile } from "@/types/app";

export {
  createAncillaryChargeAction,
  createBloodSugarLogAction,
  createDailyActivityAction,
  createPhotoUploadAction,
  createPhotoUploadFormAction,
  createPhotoUploadsFormAction,
  createShowerLogAction,
  createToiletLogAction,
  createTransportationLogAction
} from "@/app/documentation-create-core";

type ActionErrorResult = {
  error: string;
  ok?: never;
};

type ActionSuccessResult<T extends object = object> = {
  ok: true;
  error?: undefined;
} & T;

const reviewStatusSchema = z.enum(["Pending", "Reviewed", "Needs Follow-up"]);

async function reviewDocumentationQueueItem<TInput extends Record<string, unknown>>(input: {
  raw: TInput;
  schema: z.ZodType<TInput>;
  invalidMessage: string;
  entityType: string;
  buildDetails: (payload: TInput, editor: UserProfile) => Record<string, unknown>;
  revalidatePaths: string[];
}): Promise<ActionErrorResult | ActionSuccessResult> {
  const payload = input.schema.safeParse(input.raw);
  if (!payload.success) return { error: input.invalidMessage };

  const editor = await requireDocumentationManagerEditor();
  if ("error" in editor) return editor;

  await insertDocumentationAudit("manager_review", input.entityType, null, input.buildDetails(payload.data, editor));
  input.revalidatePaths.forEach((path) => revalidatePath(path));
  return { ok: true };
}

const updateDailyActivitySchema = z
  .object({
    id: z.string(),
    activity1: z.number().min(0).max(100),
    reasonMissing1: z.enum(PARTICIPATION_MISSING_REASONS).optional().or(z.literal("")),
    activity2: z.number().min(0).max(100),
    reasonMissing2: z.enum(PARTICIPATION_MISSING_REASONS).optional().or(z.literal("")),
    activity3: z.number().min(0).max(100),
    reasonMissing3: z.enum(PARTICIPATION_MISSING_REASONS).optional().or(z.literal("")),
    activity4: z.number().min(0).max(100),
    reasonMissing4: z.enum(PARTICIPATION_MISSING_REASONS).optional().or(z.literal("")),
    activity5: z.number().min(0).max(100),
    reasonMissing5: z.enum(PARTICIPATION_MISSING_REASONS).optional().or(z.literal("")),
    notes: z.string().max(500).optional()
  })
  .superRefine((val, ctx) => {
    const checks = [
      { level: val.activity1, reason: val.reasonMissing1, path: "reasonMissing1" },
      { level: val.activity2, reason: val.reasonMissing2, path: "reasonMissing2" },
      { level: val.activity3, reason: val.reasonMissing3, path: "reasonMissing3" },
      { level: val.activity4, reason: val.reasonMissing4, path: "reasonMissing4" },
      { level: val.activity5, reason: val.reasonMissing5, path: "reasonMissing5" }
    ];

    checks.forEach((check) => {
      if (check.level === 0 && !check.reason?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [check.path],
          message: "Reason is required when activity participation is 0%."
        });
      }
    });
  });

export async function updateDailyActivityAction(raw: z.infer<typeof updateDailyActivitySchema>) {
  const payload = updateDailyActivitySchema.safeParse(raw);
  if (!payload.success) return { error: "Invalid participation log update." };
  const editor = await requireDocumentationManagerEditor();
  if ("error" in editor) return editor;

  const participation = Math.round(
    (payload.data.activity1 + payload.data.activity2 + payload.data.activity3 + payload.data.activity4 + payload.data.activity5) / 5
  );

  try {
    await updateDailyActivityParticipationSupabase({
      id: payload.data.id,
      activity1: payload.data.activity1,
      reasonMissing1: payload.data.reasonMissing1,
      activity2: payload.data.activity2,
      reasonMissing2: payload.data.reasonMissing2,
      activity3: payload.data.activity3,
      reasonMissing3: payload.data.reasonMissing3,
      activity4: payload.data.activity4,
      reasonMissing4: payload.data.reasonMissing4,
      activity5: payload.data.activity5,
      reasonMissing5: payload.data.reasonMissing5,
      notes: payload.data.notes ?? null
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to update participation log." };
  }
  await insertDocumentationAudit("manager_review", "daily_activity_log", payload.data.id, { participation });
  revalidatePath("/documentation/activity");
  revalidatePath("/documentation");
  return { ok: true };
}

const updateSimpleSchema = z.object({ id: z.string(), notes: z.string().max(500).optional() });
const toiletUseTypeSchema = z.enum(TOILET_USE_TYPE_OPTIONS);

export async function updateToiletLogAction(
  raw: z.infer<typeof updateSimpleSchema> & { useType: string; briefs: boolean; memberSupplied?: boolean }
) {
  const payload = z
    .object({
      id: z.string(),
      notes: z.string().max(500).optional(),
      useType: toiletUseTypeSchema,
      briefs: z.boolean(),
      memberSupplied: z.boolean().optional()
    })
    .safeParse(raw);
  if (!payload.success) return { error: "Invalid toilet update." };
  const editor = await requireDocumentationManagerEditor();
  if ("error" in editor) return editor;

  let result;
  try {
    result = await updateToiletLogWithAncillarySync({
      toiletLogId: payload.data.id,
      notes: payload.data.notes ?? null,
      useType: payload.data.useType,
      briefs: payload.data.briefs,
      memberSupplied: payload.data.memberSupplied,
      actorUserId: editor.id
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to update toilet log." };
  }

  await insertDocumentationAudit("manager_review", "toilet_log", payload.data.id, {
    useType: payload.data.useType,
    briefs: payload.data.briefs,
    memberSupplied: result.memberSupplied
  });
  revalidatePath("/documentation/toilet");
  revalidatePath("/documentation");
  revalidatePath("/ancillary");
  revalidatePath("/reports/monthly-ancillary");
  return result.warning ? { ok: true, warning: result.warning } : { ok: true };
}

export async function updateShowerLogAction(raw: z.infer<typeof updateSimpleSchema> & { laundry: boolean; briefs: boolean }) {
  const payload = z
    .object({ id: z.string(), notes: z.string().max(500).optional(), laundry: z.boolean(), briefs: z.boolean() })
    .safeParse(raw);
  if (!payload.success) return { error: "Invalid shower update." };
  const editor = await requireDocumentationManagerEditor();
  if ("error" in editor) return editor;

  try {
    await updateShowerLogSupabase({
      id: payload.data.id,
      laundry: payload.data.laundry,
      briefs: payload.data.briefs
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to update shower log." };
  }
  await insertDocumentationAudit("manager_review", "shower_log", payload.data.id, {
    laundry: payload.data.laundry,
    briefs: payload.data.briefs,
    notes: payload.data.notes ?? null
  });
  revalidatePath("/documentation/shower");
  revalidatePath("/documentation");
  return { ok: true };
}

export async function updateTransportationLogAction(raw: {
  id: string;
  period: (typeof TRANSPORT_PERIOD_OPTIONS)[number];
  transportType: (typeof TRANSPORT_TYPE_OPTIONS)[number];
}) {
  const payload = z
    .object({ id: z.string(), period: z.enum(TRANSPORT_PERIOD_OPTIONS), transportType: z.enum(TRANSPORT_TYPE_OPTIONS) })
    .safeParse(raw);
  if (!payload.success) return { error: "Invalid transportation update." };
  void payload;
  return {
    error: "Transportation corrections should be handled through Transportation Station so run history and billing stay aligned."
  };
}

export async function updateBloodSugarAction(raw: { id: string; readingMgDl: number; notes?: string }) {
  const payload = z
    .object({ id: z.string(), readingMgDl: z.number().min(20).max(600), notes: z.string().max(500).optional() })
    .safeParse(raw);
  if (!payload.success) return { error: "Invalid blood sugar update." };
  const editor = await requireDocumentationManagerEditor();
  if ("error" in editor) return editor;
  try {
    await updateBloodSugarLogSupabase({
      id: payload.data.id,
      readingMgDl: payload.data.readingMgDl,
      notes: payload.data.notes ?? null
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to update blood sugar log." };
  }
  await insertDocumentationAudit("manager_review", "blood_sugar_log", payload.data.id, {
    reading_mg_dl: payload.data.readingMgDl,
    notes: payload.data.notes ?? null
  });
  revalidatePath("/documentation/blood-sugar");
  revalidatePath("/health");
  return { ok: true };
}

export async function updateAncillaryAction(raw: { id: string; notes?: string }) {
  const payload = updateSimpleSchema.safeParse(raw);
  if (!payload.success) return { error: "Invalid ancillary update." };
  const editor = await requireDocumentationManagerEditor();
  if ("error" in editor) return editor;
  try {
    await updateAncillaryLogNotesSupabase({
      id: payload.data.id,
      notes: payload.data.notes ?? null
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to update ancillary entry." };
  }
  await insertDocumentationAudit("manager_review", "ancillary_charge", payload.data.id, { notes: payload.data.notes ?? null });
  revalidatePath("/ancillary");
  revalidatePath("/documentation");
  return { ok: true };
}

export async function setAncillaryReconciliationAction(raw: {
  id: string;
  status: "open" | "reconciled" | "void";
  note?: string;
}): Promise<ActionErrorResult | ActionSuccessResult> {
  const payload = z
    .object({
      id: z.string(),
      status: z.enum(["open", "reconciled", "void"]),
      note: z.string().max(500).optional()
    })
    .safeParse(raw);
  if (!payload.success) return { error: "Invalid reconciliation update." };

  const editor = await requireDocumentationManagerEditor();
  if ("error" in editor) return editor;
  try {
    await setAncillaryReconciliationSupabase({
      id: payload.data.id,
      status: payload.data.status,
      note: payload.data.note,
      actorName: editor.full_name
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to update ancillary reconciliation." };
  }
  await insertDocumentationAudit("manager_review", "ancillary_charge", payload.data.id, {
    reconciliation_status: payload.data.status,
    note: payload.data.note ?? null
  });

  revalidatePath("/ancillary");
  revalidatePath("/reports");
  revalidatePath("/reports/monthly-ancillary");
  revalidatePath("/admin-reports");
  return { ok: true };
}

export async function deleteWorkflowRecordAction(
  raw: { entity: string; id: string }
): Promise<ActionErrorResult | ActionSuccessResult> {
  const payload = z.object({ entity: z.string(), id: z.string() }).safeParse(raw);
  if (!payload.success) return { error: "Invalid delete request." };
  const editor = await requireDocumentationManagerEditor();
  if ("error" in editor) return editor;
  try {
    await deleteWorkflowRecordSupabase(payload.data);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to delete workflow record." };
  }
  await insertDocumentationAudit("manager_review", payload.data.entity, payload.data.id, { operation: "delete" });

  revalidatePath("/");
  revalidatePath("/documentation");
  revalidatePath("/documentation/activity");
  revalidatePath("/documentation/toilet");
  revalidatePath("/documentation/shower");
  revalidatePath("/documentation/transportation");
  revalidatePath("/documentation/photo-upload");
  return { ok: true };
}

export async function reviewTimeCardAction(raw: {
  staffName: string;
  payPeriod: string;
  status: "Pending" | "Reviewed" | "Needs Follow-up";
  notes?: string;
}) {
  return reviewDocumentationQueueItem({
    raw,
    schema: z.object({
      staffName: z.string().min(1),
      payPeriod: z.string().min(1),
      status: reviewStatusSchema,
      notes: z.string().max(500).optional()
    }),
    invalidMessage: "Invalid time review.",
    entityType: "time_review",
    buildDetails: (payload, editor) => ({
      staffName: payload.staffName,
      payPeriod: payload.payPeriod,
      status: payload.status,
      notes: payload.notes ?? "",
      reviewed_by: editor.full_name,
      reviewed_at: toEasternISO()
    }),
    revalidatePaths: ["/time-card"]
  });
}

export async function reviewDocumentationAction(raw: {
  staffName: string;
  periodLabel: string;
  status: "Pending" | "Reviewed" | "Needs Follow-up";
  notes?: string;
}) {
  return reviewDocumentationQueueItem({
    raw,
    schema: z.object({
      staffName: z.string().min(1),
      periodLabel: z.string().min(1),
      status: reviewStatusSchema,
      notes: z.string().max(500).optional()
    }),
    invalidMessage: "Invalid documentation review.",
    entityType: "documentation_review",
    buildDetails: (payload, editor) => ({
      staffName: payload.staffName,
      periodLabel: payload.periodLabel,
      status: payload.status,
      notes: payload.notes ?? "",
      reviewed_by: editor.full_name,
      reviewed_at: toEasternISO()
    }),
    revalidatePaths: ["/documentation", "/reports"]
  });
}
