import { Buffer } from "node:buffer";

import "server-only";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { insertDocumentationAudit } from "@/app/documentation-action-support";
import { resolveActionMemberIdentity } from "@/app/action-helpers";
import { getCurrentProfile } from "@/lib/auth";
import {
  PARTICIPATION_MISSING_REASONS,
  TOILET_USE_TYPE_OPTIONS,
  TRANSPORT_PERIOD_OPTIONS,
  TRANSPORT_TYPE_OPTIONS
} from "@/lib/canonical";
import {
  createAncillaryChargeSupabase,
  getAncillaryChargeCategoryByNameSupabase
} from "@/lib/services/ancillary-write-supabase";
import {
  createBloodSugarLogSupabase,
  createDailyActivityLogSupabase,
  createPhotoUploadSupabase,
  createShowerLogSupabase,
  createToiletLogSupabase
} from "@/lib/services/documentation-write-supabase";
import { toEasternISO } from "@/lib/timezone";

type ActionErrorResult = {
  error: string;
  ok?: never;
};

type ActionSuccessResult<T extends object = object> = {
  ok: true;
  error?: undefined;
} & T;

const ancillarySchema = z.object({
  memberId: z.string().uuid(),
  categoryId: z.string().uuid(),
  serviceDate: z.string(),
  latePickupTime: z.string().optional().or(z.literal("")),
  notes: z.string().max(300).optional(),
  sourceEntity: z.string().optional(),
  sourceEntityId: z.string().optional()
});

export async function createAncillaryChargeAction(
  raw: z.infer<typeof ancillarySchema>
): Promise<ActionErrorResult | ActionSuccessResult<{ ancillaryChargeId: string }>> {
  const payload = ancillarySchema.safeParse(raw);
  if (!payload.success) {
    return { error: "Invalid ancillary charge." };
  }

  const profile = await getCurrentProfile();
  let created;
  try {
    created = await createAncillaryChargeSupabase({
      memberId: payload.data.memberId,
      categoryId: payload.data.categoryId,
      serviceDate: payload.data.serviceDate,
      latePickupTime: payload.data.latePickupTime ?? null,
      notes: payload.data.notes ?? null,
      sourceEntity: payload.data.sourceEntity ?? null,
      sourceEntityId: payload.data.sourceEntityId ?? null,
      actorUserId: profile.id
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to create ancillary charge." };
  }

  await insertDocumentationAudit("create_log", "ancillary_charge", created.ancillaryChargeId, payload.data);
  revalidatePath("/ancillary");
  revalidatePath("/documentation/ancillary");
  revalidatePath("/operations/member-command-center");
  revalidatePath(`/operations/member-command-center/${payload.data.memberId}`);
  revalidatePath("/reports/monthly-ancillary");
  return { ok: true, ancillaryChargeId: created.ancillaryChargeId };
}

const dailyActivitySchema = z
  .object({
    memberId: z.string().uuid().optional().or(z.literal("")),
    activityDate: z.string(),
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

export async function createDailyActivityAction(raw: z.infer<typeof dailyActivitySchema>) {
  const payload = dailyActivitySchema.safeParse(raw);
  if (!payload.success) {
    return { error: "Invalid activity log." };
  }

  const profile = await getCurrentProfile();

  let canonicalMember: Awaited<ReturnType<typeof resolveActionMemberIdentity>>;
  try {
    canonicalMember = await resolveActionMemberIdentity({
      actionLabel: "createDailyActivityAction",
      memberId: payload.data.memberId ?? null
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "createDailyActivityAction expected member.id." };
  }

  if (!canonicalMember.memberId) {
    return { error: "createDailyActivityAction expected member.id but canonical member resolution returned empty memberId." };
  }

  let created;
  try {
    created = await createDailyActivityLogSupabase({
      memberId: canonicalMember.memberId,
      activityDate: payload.data.activityDate,
      staffUserId: profile.id,
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
    return { error: error instanceof Error ? error.message : "Unable to create daily activity log." };
  }

  await insertDocumentationAudit("create_log", "daily_activity_log", created.id, payload.data);
  revalidatePath("/documentation");
  revalidatePath("/");
  return { ok: true };
}

const toiletUseTypeSchema = z.enum(TOILET_USE_TYPE_OPTIONS);
const toiletSchema = z.object({
  memberId: z.string().uuid(),
  eventAt: z.string(),
  briefs: z.boolean(),
  memberSupplied: z.boolean(),
  useType: toiletUseTypeSchema,
  notes: z.string().max(500).optional()
});

export async function createToiletLogAction(raw: z.infer<typeof toiletSchema>) {
  const payload = toiletSchema.safeParse(raw);
  if (!payload.success) {
    return { error: "Invalid toilet log." };
  }

  let canonicalMember: Awaited<ReturnType<typeof resolveActionMemberIdentity>>;
  try {
    canonicalMember = await resolveActionMemberIdentity({
      actionLabel: "createToiletLogAction",
      memberId: payload.data.memberId
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "createToiletLogAction expected member.id." };
  }
  if (!canonicalMember.memberId) {
    return { error: "createToiletLogAction expected member.id but canonical member resolution returned empty memberId." };
  }
  const memberId = canonicalMember.memberId;

  const profile = await getCurrentProfile();
  let created;
  try {
    created = await createToiletLogSupabase({
      memberId,
      eventAt: payload.data.eventAt,
      briefs: payload.data.briefs,
      memberSupplied: payload.data.memberSupplied,
      useType: payload.data.useType,
      staffUserId: profile.id,
      notes: payload.data.notes ?? null
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to create toilet log." };
  }

  await insertDocumentationAudit("create_log", "toilet_log", created.id, payload.data);
  let warning: string | null = null;

  if (payload.data.briefs && !payload.data.memberSupplied) {
    let briefsCategory: Awaited<ReturnType<typeof getAncillaryChargeCategoryByNameSupabase>> = null;
    try {
      briefsCategory = await getAncillaryChargeCategoryByNameSupabase("briefs");
    } catch (error) {
      warning = `Toilet log saved, but briefs ancillary category lookup failed (${error instanceof Error ? error.message : "Unknown error"}).`;
    }
    if (briefsCategory && !warning) {
      const ancillaryResult = await createAncillaryChargeAction({
        memberId,
        categoryId: briefsCategory.id,
        serviceDate: payload.data.eventAt.slice(0, 10),
        latePickupTime: "",
        notes: "Auto-generated from Toilet Log (briefs changed and not member supplied)",
        sourceEntity: "toiletLogs",
        sourceEntityId: created.id
      });
      if ("error" in ancillaryResult) {
        warning = `Toilet log saved, but linked ancillary charge could not be created (${ancillaryResult.error}).`;
      }
    }
  }

  revalidatePath("/documentation/toilet");
  revalidatePath("/documentation");
  revalidatePath("/ancillary");
  revalidatePath("/reports/monthly-ancillary");
  return warning ? { ok: true, warning } : { ok: true };
}

const showerSchema = z.object({
  memberId: z.string().uuid(),
  eventAt: z.string(),
  laundry: z.boolean(),
  briefs: z.boolean(),
  notes: z.string().max(500).optional()
});

export async function createShowerLogAction(raw: z.infer<typeof showerSchema>) {
  const payload = showerSchema.safeParse(raw);
  if (!payload.success) {
    return { error: "Invalid shower log." };
  }

  let canonicalMember: Awaited<ReturnType<typeof resolveActionMemberIdentity>>;
  try {
    canonicalMember = await resolveActionMemberIdentity({
      actionLabel: "createShowerLogAction",
      memberId: payload.data.memberId
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "createShowerLogAction expected member.id." };
  }
  if (!canonicalMember.memberId) {
    return { error: "createShowerLogAction expected member.id but canonical member resolution returned empty memberId." };
  }

  const profile = await getCurrentProfile();
  let created;
  try {
    created = await createShowerLogSupabase({
      memberId: canonicalMember.memberId,
      eventAt: payload.data.eventAt,
      laundry: payload.data.laundry,
      briefs: payload.data.briefs,
      staffUserId: profile.id
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to create shower log." };
  }

  await insertDocumentationAudit("create_log", "shower_log", created.id, payload.data);
  revalidatePath("/documentation/shower");
  revalidatePath("/documentation");
  return { ok: true };
}

const transportationSchema = z.object({
  memberId: z.string().uuid(),
  period: z.enum(TRANSPORT_PERIOD_OPTIONS),
  transportType: z.enum(TRANSPORT_TYPE_OPTIONS),
  serviceDate: z.string()
});

export async function createTransportationLogAction(raw: z.infer<typeof transportationSchema>) {
  const payload = transportationSchema.safeParse(raw);
  if (!payload.success) {
    return { error: "Invalid transportation log." };
  }
  void payload;
  return {
    error: "Individual transportation log entry is disabled. Use Transportation Station to post the run manifest in one batch."
  };
}

const photoSchema = z.object({
  fileName: z.string().min(1),
  fileType: z.string().optional(),
  fileDataUrl: z.string().optional(),
  notes: z.string().max(500).optional()
});

const MAX_PHOTO_UPLOAD_BYTES = 5 * 1024 * 1024;

function estimateDataUrlBytes(dataUrl: string) {
  const payload = dataUrl.split(",")[1] ?? "";
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

function inferPhotoMimeType(dataUrl?: string) {
  if (!dataUrl?.startsWith("data:")) return "image/*";
  const marker = dataUrl.slice(5, dataUrl.indexOf(";"));
  return marker || "image/*";
}

function buildPhotoFileName(rawFileName: string, uploadedAtIso: string) {
  const trimmed = rawFileName.trim();
  if (trimmed) return trimmed;
  return `photo-upload-${uploadedAtIso.slice(0, 10)}.img`;
}

async function persistPhotoUploadRecord(input: {
  fileName: string;
  fileType?: string | null;
  photoDataUrl: string;
}) {
  const profile = await getCurrentProfile();
  const uploadedAt = toEasternISO();
  let created;
  try {
    created = await createPhotoUploadSupabase({
      uploadedByUserId: profile.id,
      uploadedAt,
      photoUrl: input.photoDataUrl
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to create photo upload." };
  }

  await insertDocumentationAudit("create_log", "member_photo_upload", created.id, {
    fileName: buildPhotoFileName(input.fileName, uploadedAt),
    fileType: input.fileType ?? inferPhotoMimeType(input.photoDataUrl)
  });

  return { ok: true, createdId: created.id } as const;
}

async function toPhotoDataUrl(file: File) {
  if (!file.type.startsWith("image/")) {
    throw new Error(`"${file.name}" must be an image file.`);
  }
  if (file.size > MAX_PHOTO_UPLOAD_BYTES) {
    throw new Error(`"${file.name}" is too large. Max allowed per photo is 5MB.`);
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  return `data:${file.type};base64,${bytes.toString("base64")}`;
}

export async function createPhotoUploadAction(raw: z.infer<typeof photoSchema>) {
  const payload = photoSchema.safeParse(raw);
  if (!payload.success) {
    return { error: "Invalid photo upload." };
  }

  const photoDataUrl = payload.data.fileDataUrl?.trim() ?? "";
  if (!photoDataUrl) {
    return { error: "Photo upload requires image data." };
  }
  if (payload.data.fileDataUrl) {
    const estimatedBytes = estimateDataUrlBytes(payload.data.fileDataUrl);
    if (estimatedBytes > MAX_PHOTO_UPLOAD_BYTES) {
      return { error: "Photo is too large. Max allowed per photo is 5MB." };
    }
  }

  const persisted = await persistPhotoUploadRecord({
    fileName: payload.data.fileName,
    fileType: payload.data.fileType,
    photoDataUrl
  });
  if ("error" in persisted) {
    return persisted;
  }

  revalidatePath("/documentation/photo-upload");
  revalidatePath("/documentation");
  revalidatePath("/");
  return { ok: true };
}

export async function createPhotoUploadsFormAction(formData: FormData) {
  const files = formData.getAll("photoFiles").filter((entry): entry is File => entry instanceof File && entry.size > 0);
  if (files.length === 0) {
    return { error: "Select at least one photo to upload." };
  }

  let savedCount = 0;
  const failures: string[] = [];

  for (const file of files) {
    try {
      const photoDataUrl = await toPhotoDataUrl(file);
      const persisted = await persistPhotoUploadRecord({
        fileName: file.name,
        fileType: file.type,
        photoDataUrl
      });
      if ("error" in persisted) {
        failures.push(`${file.name}: ${persisted.error}`);
        continue;
      }
      savedCount += 1;
    } catch (error) {
      failures.push(`${file.name}: ${error instanceof Error ? error.message : "Unable to process file."}`);
    }
  }

  if (savedCount === 0) {
    return { error: failures[0] ?? "No photos were saved." };
  }

  revalidatePath("/documentation/photo-upload");
  revalidatePath("/documentation");
  revalidatePath("/");

  return {
    ok: true,
    savedCount,
    failedCount: failures.length,
    failures,
    message:
      failures.length === 0
        ? `Saved ${savedCount} photo upload${savedCount === 1 ? "" : "s"}.`
        : `Saved ${savedCount} photo upload${savedCount === 1 ? "" : "s"}. ${failures.length} file(s) still need attention.`
  };
}

export async function createPhotoUploadFormAction(formData: FormData) {
  const file = formData.get("photoFile");
  if (!(file instanceof File) || file.size <= 0) {
    return { error: "Photo upload requires an image file." };
  }
  if (!file.type.startsWith("image/")) {
    return { error: "Only image uploads are supported." };
  }
  if (file.size > MAX_PHOTO_UPLOAD_BYTES) {
    return { error: "Photo is too large. Max allowed per photo is 5MB." };
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const fileDataUrl = `data:${file.type || "image/*"};base64,${bytes.toString("base64")}`;

  return createPhotoUploadAction({
    fileName: file.name,
    fileType: file.type || "image/*",
    fileDataUrl,
    notes: typeof formData.get("notes") === "string" ? String(formData.get("notes")) : undefined
  });
}

const bloodSugarSchema = z.object({
  memberId: z.string().uuid(),
  checkedAt: z.string(),
  readingMgDl: z.number().min(20).max(600),
  notes: z.string().max(500).optional()
});

export async function createBloodSugarLogAction(raw: z.infer<typeof bloodSugarSchema>) {
  const payload = bloodSugarSchema.safeParse(raw);
  if (!payload.success) {
    return { error: "Invalid blood sugar log." };
  }

  let canonicalMember: Awaited<ReturnType<typeof resolveActionMemberIdentity>>;
  try {
    canonicalMember = await resolveActionMemberIdentity({
      actionLabel: "createBloodSugarLogAction",
      memberId: payload.data.memberId
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "createBloodSugarLogAction expected member.id." };
  }
  if (!canonicalMember.memberId) {
    return { error: "createBloodSugarLogAction expected member.id but canonical member resolution returned empty memberId." };
  }

  const profile = await getCurrentProfile();
  let created;
  try {
    created = await createBloodSugarLogSupabase({
      memberId: canonicalMember.memberId,
      checkedAt: payload.data.checkedAt,
      readingMgDl: payload.data.readingMgDl,
      nurseUserId: profile.id,
      notes: payload.data.notes ?? null
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to create blood sugar log." };
  }

  await insertDocumentationAudit("create_log", "blood_sugar_log", created.id, payload.data);
  revalidatePath("/health");
  revalidatePath("/documentation/blood-sugar");
  return { ok: true };
}
