"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createSalesLeadActivityAction, saveSalesLeadAction } from "@/app/sales-actions";
import { getCurrentProfile } from "@/lib/auth";
import {
  LEAD_ACTIVITY_OUTCOMES,
  LEAD_ACTIVITY_TYPES,
  LEAD_FOLLOW_UP_TYPES,
  LEAD_LIKELIHOOD_OPTIONS,
  LEAD_LOST_REASON_OPTIONS,
  LEAD_SOURCE_OPTIONS,
  LEAD_STAGE_OPTIONS,
  LEAD_STATUS_OPTIONS,
  MEMBER_DISCHARGE_REASON_OPTIONS,
  MEMBER_DISPOSITION_OPTIONS,
  PARTICIPATION_MISSING_REASONS,
  TOILET_USE_TYPE_OPTIONS,
  TRANSPORT_PERIOD_OPTIONS,
  TRANSPORT_TYPE_OPTIONS,
  canonicalLeadStage,
  canonicalLeadStatus
} from "@/lib/canonical";
import { saveGeneratedMemberPdfToFiles } from "@/lib/services/member-files";
import { resolveCanonicalMemberRef } from "@/lib/services/canonical-person-ref";
import {
  autoCreateDraftPhysicianOrderFromIntake,
  createIntakeAssessmentWithResponses
} from "@/lib/services/intake-pof-mhp-cascade";
import { normalizeIntakeAssistiveDeviceFields } from "@/lib/services/intake-pof-shared";
import { buildIntakeAssessmentPdfDataUrl } from "@/lib/services/intake-assessment-pdf";
import {
  isAuthorizedIntakeAssessmentSignerRole,
  signIntakeAssessment
} from "@/lib/services/intake-assessment-esign";
import { calculateLatePickupFee, getOperationalSettings, parseBusNumbersInput, updateOperationalSettings } from "@/lib/services/operations-settings";
import { getManagedUserSignatureName } from "@/lib/services/user-management";
import { normalizeRoleKey } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { toEasternDate, toEasternISO } from "@/lib/timezone";
import type { AuditAction } from "@/types/app";
import type { CanonicalPersonSourceType } from "@/types/identity";

function isPostgresColumnMissingError(error: unknown, columnName: string) {
  const candidate = error as { code?: string; message?: string } | null;
  return (
    candidate?.code === "42703" &&
    typeof candidate.message === "string" &&
    candidate.message.toLowerCase().includes(columnName.toLowerCase())
  );
}

function schemaDependencyError(details: string) {
  return {
    error: `Missing Supabase schema dependency: ${details}`
  } as const;
}

async function insertAudit(action: AuditAction, entityType: string, entityId: string | null, details: Record<string, unknown>) {
  const profile = await getCurrentProfile();
  const supabase = await createClient();

  await supabase.from("audit_logs").insert({
    actor_user_id: profile.id,
    actor_role: profile.role,
    action,
    entity_type: entityType,
    entity_id: entityId,
    details
  });
}

async function requireManagerAdminEditor() {
  const profile = await getCurrentProfile();
  const role = normalizeRoleKey(profile.role);
  if (role !== "admin" && role !== "manager" && role !== "director") {
    return { error: "Only manager/director/admin can edit submitted entries." } as const;
  }
  return profile;
}

async function requireAdminEditor() {
  const profile = await getCurrentProfile();
  if (profile.role !== "admin") {
    return { error: "Only admin can manage ancillary pricing." } as const;
  }
  return profile;
}

async function resolveActionMemberIdentity(input: {
  actionLabel: string;
  memberId?: string | null;
  leadId?: string | null;
  sourceType?: CanonicalPersonSourceType | null;
  selectedRefId?: string | null;
}) {
  const canonical = await resolveCanonicalMemberRef(
    {
      sourceType: input.sourceType,
      selectedId: input.selectedRefId,
      memberId: input.memberId,
      leadId: input.leadId
    },
    { actionLabel: input.actionLabel }
  );
  return canonical;
}

function leadProgressRank(stage: string, status: string) {
  const normalizedStage = canonicalLeadStage(stage);
  const normalizedStatus = canonicalLeadStatus(status, normalizedStage);

  if (normalizedStatus === "Won" || normalizedStatus === "Lost") return 5;
  if (normalizedStage === "Enrollment in Progress") return 4;
  if (normalizedStage === "Nurture") return 3;
  if (normalizedStage === "Tour") return 2;
  return 1;
}

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

export async function signInAction(formData: FormData) {
  const payload = credentialsSchema.safeParse({
    email: String(formData.get("email") || ""),
    password: String(formData.get("password") || "")
  });

  if (!payload.success) {
    return { error: "Please enter a valid email and password." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(payload.data);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/");
  return { ok: true };
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/login");
}

const timePunchSchema = z.object({
  punchType: z.enum(["in", "out"]),
  lat: z.number().optional(),
  lng: z.number().optional(),
  note: z.string().max(500).optional()
});

export async function timePunchAction(raw: z.infer<typeof timePunchSchema>) {
  const payload = timePunchSchema.safeParse(raw);
  if (!payload.success) {
    return { error: "Invalid time punch." };
  }

  const profile = await getCurrentProfile();
  if (normalizeRoleKey(profile.role) !== "program-assistant") {
    return { error: "Clock in/out is only available for Program Assistant users." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("time_punches")
    .insert({
      staff_user_id: profile.id,
      punch_type: payload.data.punchType,
      punch_at: toEasternISO(),
      lat: payload.data.lat ?? null,
      lng: payload.data.lng ?? null,
      note: payload.data.note ?? null
    })
    .select("id")
    .single();

  if (error) {
    return { error: error.message };
  }

  await insertAudit(payload.data.punchType === "in" ? "clock_in" : "clock_out", "time_punch", data.id, payload.data);
  revalidatePath("/time-card");
  revalidatePath("/time-card/punch-history");
  revalidatePath("/");
  return { ok: true };
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
  const participation = Math.round(
    (payload.data.activity1 + payload.data.activity2 + payload.data.activity3 + payload.data.activity4 + payload.data.activity5) / 5
  );

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
  const memberId = canonicalMember.memberId;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("daily_activity_logs")
    .insert({
      member_id: memberId,
      activity_date: payload.data.activityDate,
      staff_user_id: profile.id,
      activity_1_level: payload.data.activity1,
      missing_reason_1: payload.data.activity1 === 0 ? payload.data.reasonMissing1?.trim() ?? null : null,
      activity_2_level: payload.data.activity2,
      missing_reason_2: payload.data.activity2 === 0 ? payload.data.reasonMissing2?.trim() ?? null : null,
      activity_3_level: payload.data.activity3,
      missing_reason_3: payload.data.activity3 === 0 ? payload.data.reasonMissing3?.trim() ?? null : null,
      activity_4_level: payload.data.activity4,
      missing_reason_4: payload.data.activity4 === 0 ? payload.data.reasonMissing4?.trim() ?? null : null,
      activity_5_level: payload.data.activity5,
      missing_reason_5: payload.data.activity5 === 0 ? payload.data.reasonMissing5?.trim() ?? null : null,
      notes: payload.data.notes ?? null
    })
    .select("id")
    .single();

  if (error) {
    return { error: error.message };
  }

  await insertAudit("create_log", "daily_activity_log", data.id, payload.data);
  revalidatePath("/documentation");
  revalidatePath("/");
  return { ok: true };
}

function normalizeLegacyLeadStageOption(stage: string): (typeof LEAD_STAGE_OPTIONS)[number] {
  const normalized = canonicalLeadStage(stage);
  return LEAD_STAGE_OPTIONS.includes(normalized as (typeof LEAD_STAGE_OPTIONS)[number])
    ? (normalized as (typeof LEAD_STAGE_OPTIONS)[number])
    : "Inquiry";
}

function normalizeLegacyLeadStatusOption(status: string, stage: string): (typeof LEAD_STATUS_OPTIONS)[number] {
  const normalized = canonicalLeadStatus(status, stage);
  return LEAD_STATUS_OPTIONS.includes(normalized) ? normalized : "Open";
}

function normalizeLegacyLeadSourceOption(leadSource: string | null | undefined): (typeof LEAD_SOURCE_OPTIONS)[number] {
  const normalized = (leadSource ?? "").trim();
  return LEAD_SOURCE_OPTIONS.includes(normalized as (typeof LEAD_SOURCE_OPTIONS)[number])
    ? (normalized as (typeof LEAD_SOURCE_OPTIONS)[number])
    : "Other";
}

function normalizeLegacyLikelihoodOption(likelihood: string | null | undefined): (typeof LEAD_LIKELIHOOD_OPTIONS)[number] | "" {
  const normalized = (likelihood ?? "").trim();
  return LEAD_LIKELIHOOD_OPTIONS.includes(normalized as (typeof LEAD_LIKELIHOOD_OPTIONS)[number])
    ? (normalized as (typeof LEAD_LIKELIHOOD_OPTIONS)[number])
    : "";
}

function normalizeLegacyFollowUpTypeOption(followUpType: string | null | undefined): (typeof LEAD_FOLLOW_UP_TYPES)[number] | "" {
  const normalized = (followUpType ?? "").trim();
  return LEAD_FOLLOW_UP_TYPES.includes(normalized as (typeof LEAD_FOLLOW_UP_TYPES)[number])
    ? (normalized as (typeof LEAD_FOLLOW_UP_TYPES)[number])
    : "";
}

function splitLegacyLostReasonParts(lostReason: string | null | undefined) {
  const normalized = (lostReason ?? "").trim();
  if (!normalized) {
    return { lostReason: "", lostReasonOther: "" };
  }
  if (LEAD_LOST_REASON_OPTIONS.includes(normalized as (typeof LEAD_LOST_REASON_OPTIONS)[number])) {
    return { lostReason: normalized, lostReasonOther: "" };
  }
  return { lostReason: "Other", lostReasonOther: normalized };
}

function resolveLegacyReferralLookup(input: { partnerId?: string | null; referralSourceId?: string | null; referralName?: string | null }) {
  const requestedPartnerId = (input.partnerId ?? "").trim();
  const requestedReferralSourceId = (input.referralSourceId ?? "").trim();
  return {
    partnerId: requestedPartnerId,
    referralSourceId: requestedReferralSourceId
  };
}

type LegacyLeadSaveInput = {
  leadId?: string;
  stage: string;
  status: string;
  inquiryDate: string;
  caregiverName: string;
  caregiverRelationship?: string | null;
  caregiverEmail?: string | null;
  caregiverPhone: string;
  memberName: string;
  memberDob?: string | null;
  leadSource?: string | null;
  leadSourceOther?: string | null;
  partnerId?: string | null;
  referralSourceId?: string | null;
  referralName?: string | null;
  likelihood?: string | null;
  nextFollowUpDate?: string | null;
  nextFollowUpType?: string | null;
  tourDate?: string | null;
  tourCompleted?: boolean;
  discoveryDate?: string | null;
  memberStartDate?: string | null;
  notesSummary?: string | null;
  lostReason?: string | null;
  closedDate?: string | null;
  allowUnlinkedReferral?: boolean;
};

type LegacyLeadRecord = {
  id: string;
  stage: string;
  status: string;
  inquiry_date: string;
  caregiver_name: string;
  caregiver_relationship: string | null;
  caregiver_email: string | null;
  caregiver_phone: string;
  member_name: string;
  member_dob: string | null;
  lead_source: string;
  lead_source_other: string | null;
  partner_id: string | null;
  referral_source_id: string | null;
  referral_name: string | null;
  likelihood: string | null;
  next_follow_up_date: string | null;
  next_follow_up_type: string | null;
  tour_date: string | null;
  tour_completed: boolean;
  discovery_date: string | null;
  member_start_date: string | null;
  notes_summary: string | null;
  lost_reason: string | null;
  closed_date: string | null;
};

async function getLegacyLeadRecordById(leadId: string): Promise<{ lead: LegacyLeadRecord | null; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leads")
    .select(
      "id, stage, status, inquiry_date, caregiver_name, caregiver_relationship, caregiver_email, caregiver_phone, member_name, member_dob, lead_source, lead_source_other, partner_id, referral_source_id, referral_name, likelihood, next_follow_up_date, next_follow_up_type, tour_date, tour_completed, discovery_date, member_start_date, notes_summary, lost_reason, closed_date"
    )
    .eq("id", leadId)
    .maybeSingle();

  if (error) return { lead: null, error: error.message };
  return { lead: (data as LegacyLeadRecord | null) ?? null };
}

function buildLegacyLeadSavePayload(input: LegacyLeadSaveInput): Parameters<typeof saveSalesLeadAction>[0] {
  const stage = normalizeLegacyLeadStageOption(input.stage);
  const status = normalizeLegacyLeadStatusOption(input.status, stage);
  const leadSource = normalizeLegacyLeadSourceOption(input.leadSource);
  const isLost = canonicalLeadStatus(status, stage) === "Lost";
  const lostReasonParts = splitLegacyLostReasonParts(input.lostReason);
  const referralLookup = resolveLegacyReferralLookup({
    partnerId: input.partnerId,
    referralSourceId: input.referralSourceId,
    referralName: input.referralName
  });
  const leadSourceOther =
    leadSource === "Other"
      ? ((input.leadSourceOther ?? "").trim() || ((input.leadSource ?? "").trim() !== "Other" ? (input.leadSource ?? "").trim() : ""))
      : "";
  const lostReason = isLost ? lostReasonParts.lostReason || "Other" : "";
  const lostReasonOther =
    isLost && lostReason === "Other"
      ? lostReasonParts.lostReasonOther || "Legacy update without explicit lost reason."
      : "";

  return {
    leadId: input.leadId ?? "",
    stage,
    status,
    inquiryDate: input.inquiryDate,
    caregiverName: input.caregiverName,
    caregiverRelationship: input.caregiverRelationship ?? "",
    caregiverEmail: input.caregiverEmail ?? "",
    caregiverPhone: input.caregiverPhone,
    memberName: input.memberName,
    memberDob: input.memberDob ?? "",
    leadSource,
    leadSourceOther,
    partnerId: referralLookup.partnerId,
    referralSourceId: referralLookup.referralSourceId,
    referralName: input.referralName ?? "",
    likelihood: normalizeLegacyLikelihoodOption(input.likelihood),
    nextFollowUpDate: isLost ? "" : input.nextFollowUpDate ?? "",
    nextFollowUpType: isLost ? "" : normalizeLegacyFollowUpTypeOption(input.nextFollowUpType),
    tourDate: input.tourDate ?? "",
    tourCompleted: input.tourDate ? Boolean(input.tourCompleted) : undefined,
    discoveryDate: input.discoveryDate ?? "",
    memberStartDate: stage === "Enrollment in Progress" ? input.memberStartDate ?? "" : "",
    notesSummary: input.notesSummary ?? "",
    lostReason,
    lostReasonOther,
    closedDate: isLost ? input.closedDate ?? toEasternDate() : "",
    duplicateDecision: "" as const,
    mergeTargetLeadId: "",
    allowUnlinkedReferral: input.allowUnlinkedReferral ?? false,
    skipDuplicateReview: true
  };
}

const leadSchema = z
  .object({
    stage: z.enum(LEAD_STAGE_OPTIONS),
    status: z.enum(LEAD_STATUS_OPTIONS),
    inquiryDate: z.string(),
    caregiverName: z.string().min(1),
    caregiverRelationship: z.string().min(1).optional().or(z.literal("")),
    caregiverEmail: z.string().email().optional().or(z.literal("")),
    caregiverPhone: z.string().min(7),
    memberName: z.string().min(1),
    leadSource: z.enum(LEAD_SOURCE_OPTIONS),
    referralName: z.string().optional().or(z.literal("")),
    likelihood: z.enum(LEAD_LIKELIHOOD_OPTIONS).optional().or(z.literal("")),
    nextFollowUpDate: z.string().optional().or(z.literal("")),
    nextFollowUpType: z.enum(LEAD_FOLLOW_UP_TYPES).optional().or(z.literal("")),
    tourDate: z.string().optional().or(z.literal("")),
    lostReason: z.enum(LEAD_LOST_REASON_OPTIONS).optional().or(z.literal("")),
    notes: z.string().max(1000).optional()
  })
  .superRefine((val, ctx) => {
    const stage = canonicalLeadStage(val.stage);
    const status = canonicalLeadStatus(val.status, stage);
    if ((stage === "Closed - Lost" || status === "Lost") && !val.lostReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lostReason"],
        message: "Lost reason is required when lead is Closed - Lost."
      });
    }
  });

export async function createLeadAction(raw: z.infer<typeof leadSchema>) {
  const payload = leadSchema.safeParse(raw);
  if (!payload.success) {
    return { error: "Invalid lead data." };
  }

  return saveSalesLeadAction(
    buildLegacyLeadSavePayload({
      stage: payload.data.stage,
      status: payload.data.status,
      inquiryDate: payload.data.inquiryDate,
      caregiverName: payload.data.caregiverName,
      caregiverRelationship: payload.data.caregiverRelationship,
      caregiverEmail: payload.data.caregiverEmail,
      caregiverPhone: payload.data.caregiverPhone,
      memberName: payload.data.memberName,
      leadSource: payload.data.leadSource,
      referralName: payload.data.referralName,
      likelihood: payload.data.likelihood,
      nextFollowUpDate: payload.data.nextFollowUpDate,
      nextFollowUpType: payload.data.nextFollowUpType,
      tourDate: payload.data.tourDate,
      tourCompleted: Boolean(payload.data.tourDate),
      notesSummary: payload.data.notes,
      lostReason: payload.data.lostReason,
      closedDate: payload.data.lostReason ? payload.data.inquiryDate : "",
      allowUnlinkedReferral: true
    })
  );
}

const ancillarySchema = z.object({
  memberId: z.string().uuid(),
  categoryId: z.string().uuid(),
  serviceDate: z.string(),
  latePickupTime: z.string().optional().or(z.literal("")),
  notes: z.string().max(300).optional(),
  sourceEntity: z.string().optional(),
  sourceEntityId: z.string().optional()
});

export async function createAncillaryChargeAction(raw: z.infer<typeof ancillarySchema>) {
  const payload = ancillarySchema.safeParse(raw);
  if (!payload.success) {
    return { error: "Invalid ancillary charge." };
  }

  const profile = await getCurrentProfile();
  const isLatePickupCategory = (categoryName?: string | null) => {
    const normalized = (categoryName ?? "").toLowerCase();
    return normalized.includes("late pick-up") || normalized.includes("late pickup");
  };

  let canonicalMember: Awaited<ReturnType<typeof resolveActionMemberIdentity>>;
  try {
    canonicalMember = await resolveActionMemberIdentity({
      actionLabel: "createAncillaryChargeAction",
      memberId: payload.data.memberId
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "createAncillaryChargeAction expected member.id." };
  }
  if (!canonicalMember.memberId) {
    return { error: "createAncillaryChargeAction expected member.id but canonical member resolution returned empty memberId." };
  }
  const memberId = canonicalMember.memberId;

  const supabase = await createClient();
  const { data: category, error: categoryError } = await supabase
    .from("ancillary_charge_categories")
    .select("id, name, price_cents")
    .eq("id", payload.data.categoryId)
    .maybeSingle();
  if (categoryError) {
    return { error: categoryError.message };
  }
  if (!category) {
    return { error: "Ancillary charge category not found." };
  }

  const requiresLatePickupTime = isLatePickupCategory(category?.name);
  if (requiresLatePickupTime && !payload.data.latePickupTime?.trim()) {
    return { error: "Late pick-up time is required for late pick-up charges." };
  }

  const latePickupTime = requiresLatePickupTime ? payload.data.latePickupTime?.trim() || null : null;
  let amountCents = Number(category.price_cents ?? 0);
  if (requiresLatePickupTime) {
    const fee = calculateLatePickupFee({
      latePickupTime: latePickupTime ?? "",
      rules: (await getOperationalSettings()).latePickupRules
    });
    if (!fee) {
      return { error: "Invalid late pick-up time." };
    }
    if (fee.amountCents <= 0) {
      return { error: "Selected pick-up time is not later than the configured late threshold." };
    }
    amountCents = fee.amountCents;
  }

  const sourceEntity = payload.data.sourceEntity?.trim() || null;
  const sourceEntityId = payload.data.sourceEntityId?.trim() || null;
  const duplicateBaseQuery = supabase
    .from("ancillary_charge_logs")
    .select("id")
    .eq("member_id", memberId)
    .eq("category_id", payload.data.categoryId)
    .eq("service_date", payload.data.serviceDate);
  const duplicateQuery =
    sourceEntity || sourceEntityId
      ? duplicateBaseQuery.eq("source_entity", sourceEntity).eq("source_entity_id", sourceEntityId)
      : duplicateBaseQuery.is("source_entity", null).is("source_entity_id", null);
  const { data: duplicate, error: duplicateError } = await duplicateQuery.limit(1).maybeSingle();
  if (duplicateError) {
    if (
      isPostgresColumnMissingError(duplicateError, "source_entity") ||
      isPostgresColumnMissingError(duplicateError, "source_entity_id")
    ) {
      return schemaDependencyError(
        "public.ancillary_charge_logs requires source_entity text and source_entity_id text for de-duplication and workflow linkage."
      );
    }
    return { error: duplicateError.message };
  }
  if (duplicate) {
    return { error: "Duplicate ancillary charge detected for this member/date/category/source." };
  }

  const quantity = 1;
  const unitRate = Number((amountCents / 100).toFixed(2));
  const amount = Number((unitRate * quantity).toFixed(2));
  const { data, error } = await supabase
    .from("ancillary_charge_logs")
    .insert({
      member_id: memberId,
      category_id: payload.data.categoryId,
      service_date: payload.data.serviceDate,
      late_pickup_time: latePickupTime,
      staff_user_id: profile.id,
      notes: payload.data.notes ?? null,
      source_entity: sourceEntity,
      source_entity_id: sourceEntityId,
      quantity,
      unit_rate: unitRate,
      amount,
      billing_status: "Unbilled"
    })
    .select("id")
    .single();

  if (error) {
    if (
      isPostgresColumnMissingError(error, "source_entity") ||
      isPostgresColumnMissingError(error, "source_entity_id")
    ) {
      return schemaDependencyError(
        "public.ancillary_charge_logs requires source_entity text and source_entity_id text for workflow linkage."
      );
    }
    return { error: error.message };
  }

  await insertAudit("create_log", "ancillary_charge", data.id, payload.data);
  revalidatePath("/ancillary");
  revalidatePath("/documentation/ancillary");
  revalidatePath("/reports/monthly-ancillary");
  return { ok: true, ancillaryChargeId: data.id };
}

const ancillaryPricingSchema = z.object({
  categoryId: z.string().uuid(),
  unitPriceDollars: z.coerce.number().min(0).max(9999)
});

export async function updateAncillaryCategoryPriceAction(raw: z.infer<typeof ancillaryPricingSchema>) {
  const payload = ancillaryPricingSchema.safeParse(raw);
  if (!payload.success) {
    return { error: "Invalid ancillary pricing update." };
  }

  const editor = await requireAdminEditor();
  if ("error" in editor) return editor;

  const supabase = await createClient();
  const nextPriceCents = Math.round(payload.data.unitPriceDollars * 100);
  const { data: updated, error } = await supabase
    .from("ancillary_charge_categories")
    .update({ price_cents: nextPriceCents })
    .eq("id", payload.data.categoryId)
    .select("id, name")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!updated) return { error: "Ancillary charge category not found." };
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

export async function updateOperationalSettingsAction(raw: z.infer<typeof operationalSettingsSchema>) {
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
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("toilet_logs")
    .insert({
      member_id: memberId,
      event_at: payload.data.eventAt,
      briefs: payload.data.briefs,
      member_supplied: payload.data.memberSupplied,
      use_type: payload.data.useType,
      staff_user_id: profile.id,
      notes: payload.data.notes ?? null
    })
    .select("id")
    .single();

  if (error) {
    return { error: error.message };
  }

  await insertAudit("create_log", "toilet_log", data.id, payload.data);
  let warning: string | null = null;

  if (payload.data.briefs && !payload.data.memberSupplied) {
    const { data: briefsCategory, error: briefsCategoryError } = await supabase
      .from("ancillary_charge_categories")
      .select("id, name")
      .ilike("name", "briefs")
      .maybeSingle();
    if (briefsCategoryError) {
      warning = `Toilet log saved, but briefs ancillary category lookup failed (${briefsCategoryError.message}).`;
    }
    if (briefsCategory && !warning) {
      const ancillaryResult = await createAncillaryChargeAction({
        memberId,
        categoryId: briefsCategory.id,
        serviceDate: payload.data.eventAt.slice(0, 10),
        latePickupTime: "",
        notes: "Auto-generated from Toilet Log (briefs changed and not member supplied)",
        sourceEntity: "toiletLogs",
        sourceEntityId: data.id
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
  const memberId = canonicalMember.memberId;

  const profile = await getCurrentProfile();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("shower_logs")
    .insert({
      member_id: memberId,
      event_at: payload.data.eventAt,
      laundry: payload.data.laundry,
      briefs: payload.data.briefs,
      staff_user_id: profile.id
    })
    .select("id")
    .single();

  if (error) {
    return { error: error.message };
  }

  await insertAudit("create_log", "shower_log", data.id, payload.data);
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

  let canonicalMember: Awaited<ReturnType<typeof resolveActionMemberIdentity>>;
  try {
    canonicalMember = await resolveActionMemberIdentity({
      actionLabel: "createTransportationLogAction",
      memberId: payload.data.memberId
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "createTransportationLogAction expected member.id." };
  }
  if (!canonicalMember.memberId) {
    return { error: "createTransportationLogAction expected member.id but canonical member resolution returned empty memberId." };
  }
  const memberId = canonicalMember.memberId;

  const profile = await getCurrentProfile();
  const supabase = await createClient();
  const { data: memberRow, error: memberRowError } = await supabase
    .from("members")
    .select("display_name")
    .eq("id", memberId)
    .maybeSingle();
  if (memberRowError) {
    return { error: `Unable to load member for transportation log: ${memberRowError.message}` };
  }
  if (!memberRow) {
    return { error: "Unable to load member for transportation log." };
  }
  const firstName = String(memberRow?.display_name ?? "").trim().split(/\s+/)[0] ?? "";

  const { data, error } = await supabase
    .from("transportation_logs")
    .insert({
      member_id: memberId,
      first_name: firstName,
      period: payload.data.period,
      transport_type: payload.data.transportType,
      service_date: payload.data.serviceDate,
      staff_user_id: profile.id
    })
    .select("id")
    .single();

  if (error) {
    return { error: error.message };
  }

  await supabase.from("documentation_events").insert({
    event_type: "transportation_logs",
    event_table: "transportation_logs",
    event_row_id: data.id,
    member_id: memberId,
    staff_user_id: profile.id,
    event_at: toEasternISO()
  });

  await insertAudit("create_log", "transportation_log", data.id, payload.data);

  revalidatePath("/documentation/transportation");
  revalidatePath("/documentation");
  revalidatePath("/");
  return { ok: true };
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

  const profile = await getCurrentProfile();
  const uploadedAt = toEasternISO();
  const photoUrl = photoDataUrl;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("member_photo_uploads")
    .insert({
      member_id: null,
      photo_url: photoUrl,
      uploaded_by: profile.id,
      uploaded_at: uploadedAt
    })
    .select("id")
    .single();

  if (error) {
    return { error: error.message };
  }

  await supabase.from("documentation_events").insert({
    event_type: "member_photo_uploads",
    event_table: "member_photo_uploads",
    event_row_id: data.id,
    member_id: null,
    staff_user_id: profile.id,
    event_at: uploadedAt
  });

  await insertAudit("create_log", "member_photo_upload", data.id, {
    fileName: buildPhotoFileName(payload.data.fileName, uploadedAt),
    fileType: payload.data.fileType ?? inferPhotoMimeType(payload.data.fileDataUrl)
  });

  revalidatePath("/documentation/photo-upload");
  revalidatePath("/documentation");
  revalidatePath("/");
  return { ok: true };
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
  const memberId = canonicalMember.memberId;

  const profile = await getCurrentProfile();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("blood_sugar_logs")
    .insert({
      member_id: memberId,
      checked_at: payload.data.checkedAt,
      reading_mg_dl: payload.data.readingMgDl,
      nurse_user_id: profile.id,
      notes: payload.data.notes ?? null
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  await insertAudit("create_log", "blood_sugar_log", data.id, payload.data);

  revalidatePath("/health");
  revalidatePath("/documentation/blood-sugar");
  return { ok: true };
}

const assessmentScoreSchema = z.union([z.literal(15), z.literal(10), z.literal(5)]);

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
    return { error: "Invalid assessment." };
  }

  const profile = await getCurrentProfile();
  if (!isAuthorizedIntakeAssessmentSignerRole(profile.role)) {
    return { error: "Only nurse or admin users may electronically sign Intake Assessments." };
  }
  const signerName = await getManagedUserSignatureName(profile.id, profile.full_name);
  const supabase = await createClient();
  if (process.env.NODE_ENV !== "production") {
    console.info("[createAssessmentAction] selected identity payload", {
      sourceType: payload.data.sourceType ?? "",
      selectedRefId: payload.data.selectedRefId?.trim() ?? "",
      memberId: payload.data.memberId?.trim() ?? "",
      leadId: payload.data.leadId?.trim() ?? "",
      leadStage: payload.data.leadStage?.trim() ?? "",
      leadStatus: payload.data.leadStatus?.trim() ?? ""
    });
  }

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
    return { error: error instanceof Error ? error.message : "Unable to resolve canonical intake identity." };
  }

  if (!canonicalIdentity.memberId) {
    return { error: "createAssessmentAction expected member.id but canonical member resolution returned empty memberId." };
  }
  if (!canonicalIdentity.leadId) {
    return { error: "createAssessmentAction expected lead.id but selected intake record is not linked to a canonical lead." };
  }
  if (process.env.NODE_ENV !== "production") {
    console.info("[createAssessmentAction] canonical identity resolved", {
      memberId: canonicalIdentity.memberId,
      leadId: canonicalIdentity.leadId,
      sourceType: canonicalIdentity.sourceType,
      workflowType: canonicalIdentity.safeWorkflowType
    });
  }

  const effectiveMemberId = canonicalIdentity.memberId;
  const leadId = canonicalIdentity.leadId;
  const { data: leadRow, error: leadLookupError } = await supabase
    .from("leads")
    .select("id, stage, status")
    .eq("id", leadId)
    .maybeSingle();
  if (leadLookupError) {
    return { error: `Unable to resolve canonical lead.id for intake assessment. ${leadLookupError.message}` };
  }
  if (!leadRow) {
    return { error: "createAssessmentAction expected lead.id, but canonical lead lookup returned no row." };
  }
  const leadStage = leadRow.stage ?? payload.data.leadStage ?? null;
  const leadStatus = leadRow.status ?? payload.data.leadStatus ?? null;

  let created: any = null;
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
      }
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to save intake assessment." };
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
      }
    });
  } catch (error) {
    const { error: rollbackError } = await supabase.from("intake_assessments").delete().eq("id", created.id);
    if (rollbackError) {
      const signatureError = error instanceof Error ? error.message : "Unknown signature persistence error.";
      return {
        error: `Unable to persist Intake Assessment e-signature (${signatureError}). Rollback failed: ${rollbackError.message}`
      };
    }
    return {
      error: error instanceof Error ? error.message : "Unable to persist Intake Assessment e-signature."
    };
  }

  await autoCreateDraftPhysicianOrderFromIntake({
    assessment: created,
    actor: { id: profile.id, fullName: profile.full_name, signoffName: signerName }
  });

  let pdfWarning: string | null = null;
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
      generatedAtIso: created.created_at,
      replaceExistingByDocumentSource: true
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown PDF generation error.";
    pdfWarning = `Assessment saved, but Intake Assessment PDF could not be saved to member files (${message}).`;
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
  return pdfWarning ? { ok: true, assessmentId: created.id, warning: pdfWarning } : { ok: true, assessmentId: created.id };
}

const leadActivitySchema = z
  .object({
    leadId: z.string(),
    activityType: z.enum(LEAD_ACTIVITY_TYPES),
    outcome: z.enum(LEAD_ACTIVITY_OUTCOMES),
    lostReason: z.enum(LEAD_LOST_REASON_OPTIONS).optional().or(z.literal("")),
    nextFollowUpDate: z.string().optional().or(z.literal("")),
    nextFollowUpType: z.enum(LEAD_FOLLOW_UP_TYPES).optional().or(z.literal("")),
    notes: z.string().max(500).optional()
  })
  .superRefine((val, ctx) => {
    if (val.outcome === "Not a fit" && !val.lostReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lostReason"],
        message: "Lost reason is required when outcome is Not a fit."
      });
    }
  });

export async function createLeadActivityAction(raw: z.infer<typeof leadActivitySchema>) {
  const payload = leadActivitySchema.safeParse(raw);
  if (!payload.success) {
    return { error: "Invalid lead activity." };
  }

  return createSalesLeadActivityAction({
    leadId: payload.data.leadId,
    activityAt: "",
    activityType: payload.data.activityType,
    outcome: payload.data.outcome,
    lostReason: payload.data.lostReason || "",
    notes: payload.data.notes ?? "",
    nextFollowUpDate: payload.data.nextFollowUpDate || "",
    nextFollowUpType: payload.data.nextFollowUpType || "",
    partnerId: "",
    referralSourceId: ""
  });
}

const leadStatusSchema = z.object({
  leadId: z.string(),
  status: z.enum(LEAD_STATUS_OPTIONS),
  stage: z.string().min(1)
});

export async function updateLeadStatusAction(raw: z.infer<typeof leadStatusSchema>) {
  const payload = leadStatusSchema.safeParse(raw);
  if (!payload.success) {
    return { error: "Invalid lead status update." };
  }

  const supabase = await createClient();
  const { data: lead, error } = await supabase.from("leads").select("*").eq("id", payload.data.leadId).maybeSingle();
  if (error) return { error: error.message };
  if (!lead) return { error: "Lead not found." };
  const nextStage = normalizeLegacyLeadStageOption(payload.data.stage);
  const nextStatus = normalizeLegacyLeadStatusOption(payload.data.status, nextStage);
  const isLost = canonicalLeadStatus(nextStatus, nextStage) === "Lost";
  return saveSalesLeadAction(
    buildLegacyLeadSavePayload({
      leadId: lead.id,
      stage: nextStage,
      status: nextStatus,
      inquiryDate: lead.inquiry_date,
      caregiverName: lead.caregiver_name,
      caregiverRelationship: lead.caregiver_relationship,
      caregiverEmail: lead.caregiver_email,
      caregiverPhone: lead.caregiver_phone,
      memberName: lead.member_name,
      memberDob: lead.member_dob,
      leadSource: lead.lead_source,
      leadSourceOther: lead.lead_source_other,
      partnerId: lead.partner_id,
      referralSourceId: lead.referral_source_id,
      referralName: lead.referral_name,
      likelihood: lead.likelihood,
      nextFollowUpDate: lead.next_follow_up_date,
      nextFollowUpType: lead.next_follow_up_type,
      tourDate: lead.tour_date,
      tourCompleted: lead.tour_completed,
      discoveryDate: lead.discovery_date,
      memberStartDate: lead.member_start_date,
      notesSummary: lead.notes_summary,
      lostReason: isLost ? lead.lost_reason || "Other" : "",
      closedDate: isLost ? lead.closed_date || toEasternDate() : "",
      allowUnlinkedReferral: true
    })
  );
}

export async function getStaffLookup() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("profiles").select("id, full_name, role").order("full_name");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({ id: row.id, full_name: row.full_name, role: row.role }));
}

export async function getMemberLookup() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("members").select("id, display_name, status").eq("status", "active");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({ id: row.id, display_name: row.display_name }));
}

export async function resolveStaffName(staffId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("profiles").select("full_name").eq("id", staffId).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.full_name ?? null;
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
  const editor = await requireManagerAdminEditor();
  if ("error" in editor) return editor;

  const participation = Math.round(
    (payload.data.activity1 + payload.data.activity2 + payload.data.activity3 + payload.data.activity4 + payload.data.activity5) / 5
  );

  const supabase = await createClient();
  const { error } = await supabase
    .from("daily_activity_logs")
    .update({
      activity_1_level: payload.data.activity1,
      missing_reason_1: payload.data.activity1 === 0 ? payload.data.reasonMissing1?.trim() ?? null : null,
      activity_2_level: payload.data.activity2,
      missing_reason_2: payload.data.activity2 === 0 ? payload.data.reasonMissing2?.trim() ?? null : null,
      activity_3_level: payload.data.activity3,
      missing_reason_3: payload.data.activity3 === 0 ? payload.data.reasonMissing3?.trim() ?? null : null,
      activity_4_level: payload.data.activity4,
      missing_reason_4: payload.data.activity4 === 0 ? payload.data.reasonMissing4?.trim() ?? null : null,
      activity_5_level: payload.data.activity5,
      missing_reason_5: payload.data.activity5 === 0 ? payload.data.reasonMissing5?.trim() ?? null : null,
      notes: payload.data.notes ?? null
    });
  if (error) return { error: error.message };
  await insertAudit("manager_review", "daily_activity_log", payload.data.id, { participation });
  revalidatePath("/documentation/activity");
  revalidatePath("/documentation");
  return { ok: true };
}

const updateSimpleSchema = z.object({ id: z.string(), notes: z.string().max(500).optional() });

export async function updateToiletLogAction(raw: z.infer<typeof updateSimpleSchema> & { useType: string; briefs: boolean; memberSupplied?: boolean }) {
  const payload = z.object({ id: z.string(), notes: z.string().max(500).optional(), useType: toiletUseTypeSchema, briefs: z.boolean(), memberSupplied: z.boolean().optional() }).safeParse(raw);
  if (!payload.success) return { error: "Invalid toilet update." };
  const editor = await requireManagerAdminEditor();
  if ("error" in editor) return editor;

  const supabase = await createClient();
  const { data: existingRow, error: existingError } = await supabase
    .from("toilet_logs")
    .select("id, member_id, event_at, member_supplied")
    .eq("id", payload.data.id)
    .maybeSingle();
  if (existingError) return { error: existingError.message };
  if (!existingRow) return { error: "Record not found." };

  const memberSupplied = payload.data.memberSupplied ?? Boolean(existingRow.member_supplied);
  const { error } = await supabase
    .from("toilet_logs")
    .update({
      notes: payload.data.notes ?? null,
      use_type: payload.data.useType,
      briefs: payload.data.briefs,
      member_supplied: memberSupplied
    })
    .eq("id", payload.data.id);
  if (error) return { error: error.message };

  const shouldHaveBriefsCharge = payload.data.briefs && !memberSupplied;
  let warning: string | null = null;
  if (shouldHaveBriefsCharge) {
    const { data: briefsCategory, error: briefsCategoryError } = await supabase
      .from("ancillary_charge_categories")
      .select("id")
      .ilike("name", "briefs")
      .maybeSingle();
    if (briefsCategoryError) {
      warning = `Toilet log updated, but briefs ancillary category lookup failed (${briefsCategoryError.message}).`;
    }

    if (briefsCategory && !warning) {
      const { data: existingCharge, error: chargeLookupError } = await supabase
        .from("ancillary_charge_logs")
        .select("id")
        .eq("source_entity", "toiletLogs")
        .eq("source_entity_id", payload.data.id)
        .eq("category_id", briefsCategory.id)
        .maybeSingle();
      if (chargeLookupError) {
        if (
          isPostgresColumnMissingError(chargeLookupError, "source_entity") ||
          isPostgresColumnMissingError(chargeLookupError, "source_entity_id")
        ) {
          warning =
            "Toilet log updated, but linked ancillary sync requires public.ancillary_charge_logs columns source_entity text and source_entity_id text.";
        } else {
          warning = `Toilet log updated, but linked ancillary lookup failed (${chargeLookupError.message}).`;
        }
      }

      if (!existingCharge && !warning) {
        const ancillaryResult = await createAncillaryChargeAction({
          memberId: existingRow.member_id,
          categoryId: briefsCategory.id,
          serviceDate: String(existingRow.event_at).slice(0, 10),
          latePickupTime: "",
          notes: "Auto-generated from Toilet Log edit (briefs changed and not member supplied)",
          sourceEntity: "toiletLogs",
          sourceEntityId: payload.data.id
        });
        if ("error" in ancillaryResult) {
          warning = `Toilet log updated, but linked ancillary charge could not be created (${ancillaryResult.error}).`;
        }
      }
    }
  } else {
    const { data: linkedCharges, error: linkedError } = await supabase
      .from("ancillary_charge_logs")
      .select("id")
      .eq("source_entity", "toiletLogs")
      .eq("source_entity_id", payload.data.id);
    if (linkedError) {
      if (
        isPostgresColumnMissingError(linkedError, "source_entity") ||
        isPostgresColumnMissingError(linkedError, "source_entity_id")
      ) {
        warning =
          "Toilet log updated, but linked ancillary sync requires public.ancillary_charge_logs columns source_entity text and source_entity_id text.";
      } else {
        warning = `Toilet log updated, but linked ancillary lookup failed (${linkedError.message}).`;
      }
    }
    const chargeIds = !warning ? (linkedCharges ?? []).map((row) => row.id) : [];
    if (chargeIds.length > 0) {
      const { error: deleteChargeError } = await supabase.from("ancillary_charge_logs").delete().in("id", chargeIds);
      if (deleteChargeError) {
        warning = `Toilet log updated, but linked ancillary removal failed (${deleteChargeError.message}).`;
      }
    }
  }

  await insertAudit("manager_review", "toilet_log", payload.data.id, {
    useType: payload.data.useType,
    briefs: payload.data.briefs,
    memberSupplied
  });
  revalidatePath("/documentation/toilet");
  revalidatePath("/documentation");
  revalidatePath("/ancillary");
  revalidatePath("/reports/monthly-ancillary");
  return warning ? { ok: true, warning } : { ok: true };
}

export async function updateShowerLogAction(raw: z.infer<typeof updateSimpleSchema> & { laundry: boolean; briefs: boolean }) {
  const payload = z.object({ id: z.string(), notes: z.string().max(500).optional(), laundry: z.boolean(), briefs: z.boolean() }).safeParse(raw);
  if (!payload.success) return { error: "Invalid shower update." };
  const editor = await requireManagerAdminEditor();
  if ("error" in editor) return editor;

  const supabase = await createClient();
  const { error } = await supabase
    .from("shower_logs")
    .update({ laundry: payload.data.laundry, briefs: payload.data.briefs })
    .eq("id", payload.data.id);
  if (error) return { error: error.message };
  await insertAudit("manager_review", "shower_log", payload.data.id, {
    laundry: payload.data.laundry,
    briefs: payload.data.briefs,
    notes: payload.data.notes ?? null
  });
  revalidatePath("/documentation/shower");
  revalidatePath("/documentation");
  return { ok: true };
}

export async function updateTransportationLogAction(raw: { id: string; period: (typeof TRANSPORT_PERIOD_OPTIONS)[number]; transportType: (typeof TRANSPORT_TYPE_OPTIONS)[number] }) {
  const payload = z.object({ id: z.string(), period: z.enum(TRANSPORT_PERIOD_OPTIONS), transportType: z.enum(TRANSPORT_TYPE_OPTIONS) }).safeParse(raw);
  if (!payload.success) return { error: "Invalid transportation update." };
  const editor = await requireManagerAdminEditor();
  if ("error" in editor) return editor;

  const supabase = await createClient();
  const { error } = await supabase
    .from("transportation_logs")
    .update({
      period: payload.data.period,
      transport_type: payload.data.transportType
    })
    .eq("id", payload.data.id);
  if (error) return { error: error.message };
  await insertAudit("manager_review", "transportation_log", payload.data.id, payload.data);
  revalidatePath("/documentation/transportation");
  revalidatePath("/documentation");
  return { ok: true };
}

export async function updateBloodSugarAction(raw: { id: string; readingMgDl: number; notes?: string }) {
  const payload = z.object({ id: z.string(), readingMgDl: z.number().min(20).max(600), notes: z.string().max(500).optional() }).safeParse(raw);
  if (!payload.success) return { error: "Invalid blood sugar update." };
  const editor = await requireManagerAdminEditor();
  if ("error" in editor) return editor;
  const supabase = await createClient();
  const { error } = await supabase
    .from("blood_sugar_logs")
    .update({ reading_mg_dl: payload.data.readingMgDl, notes: payload.data.notes ?? null })
    .eq("id", payload.data.id);
  if (error) return { error: error.message };
  await insertAudit("manager_review", "blood_sugar_log", payload.data.id, {
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
  const editor = await requireManagerAdminEditor();
  if ("error" in editor) return editor;
  const supabase = await createClient();
  const { error } = await supabase
    .from("ancillary_charge_logs")
    .update({ notes: payload.data.notes ?? null })
    .eq("id", payload.data.id);
  if (error) return { error: error.message };
  await insertAudit("manager_review", "ancillary_charge", payload.data.id, { notes: payload.data.notes ?? null });
  revalidatePath("/ancillary");
  revalidatePath("/documentation");
  return { ok: true };
}

export async function setAncillaryReconciliationAction(raw: {
  id: string;
  status: "open" | "reconciled" | "void";
  note?: string;
}) {
  const payload = z
    .object({
      id: z.string(),
      status: z.enum(["open", "reconciled", "void"]),
      note: z.string().max(500).optional()
    })
    .safeParse(raw);
  if (!payload.success) return { error: "Invalid reconciliation update." };

  const editor = await requireManagerAdminEditor();
  if ("error" in editor) return editor;
  const supabase = await createClient();
  const nextPatch =
    payload.data.status === "reconciled"
      ? {
          reconciliation_status: "reconciled",
          reconciled_by: editor.full_name,
          reconciled_at: toEasternISO(),
          reconciliation_note: payload.data.note?.trim() || "Reconciled by manager/admin review."
        }
      : {
          reconciliation_status: payload.data.status,
          reconciled_by: null,
          reconciled_at: null,
          reconciliation_note:
            payload.data.status === "void"
              ? payload.data.note?.trim() || "Voided during reconciliation review."
              : payload.data.note?.trim() || null
        };
  const { error } = await supabase.from("ancillary_charge_logs").update(nextPatch).eq("id", payload.data.id);
  if (error) return { error: error.message };
  await insertAudit("manager_review", "ancillary_charge", payload.data.id, {
    reconciliation_status: payload.data.status,
    note: payload.data.note ?? null
  });

  revalidatePath("/ancillary");
  revalidatePath("/reports");
  revalidatePath("/reports/monthly-ancillary");
  revalidatePath("/admin-reports");
  return { ok: true };
}

export async function updateLeadDetailsAction(raw: { id: string; stage: string; status: (typeof LEAD_STATUS_OPTIONS)[number]; notes?: string }) {
  const payload = z.object({ id: z.string(), stage: z.string().min(1), status: z.enum(LEAD_STATUS_OPTIONS), notes: z.string().max(1000).optional() }).safeParse(raw);
  if (!payload.success) return { error: "Invalid lead update." };
  const editor = await requireManagerAdminEditor();
  if ("error" in editor) return editor;
  const supabase = await createClient();
  const { data: existingLead, error } = await supabase.from("leads").select("*").eq("id", payload.data.id).maybeSingle();
  if (error) return { error: error.message };
  if (!existingLead) return { error: "Lead not found." };
  const nextStage = normalizeLegacyLeadStageOption(payload.data.stage);
  const nextStatus = normalizeLegacyLeadStatusOption(payload.data.status, nextStage);
  const isLost = canonicalLeadStatus(nextStatus, nextStage) === "Lost";

  return saveSalesLeadAction(
    buildLegacyLeadSavePayload({
      leadId: existingLead.id,
      stage: nextStage,
      status: nextStatus,
      inquiryDate: existingLead.inquiry_date,
      caregiverName: existingLead.caregiver_name,
      caregiverRelationship: existingLead.caregiver_relationship,
      caregiverEmail: existingLead.caregiver_email,
      caregiverPhone: existingLead.caregiver_phone,
      memberName: existingLead.member_name,
      memberDob: existingLead.member_dob,
      leadSource: existingLead.lead_source,
      leadSourceOther: existingLead.lead_source_other,
      partnerId: existingLead.partner_id,
      referralSourceId: existingLead.referral_source_id,
      referralName: existingLead.referral_name,
      likelihood: existingLead.likelihood,
      nextFollowUpDate: existingLead.next_follow_up_date,
      nextFollowUpType: existingLead.next_follow_up_type,
      tourDate: existingLead.tour_date,
      tourCompleted: existingLead.tour_completed,
      discoveryDate: existingLead.discovery_date,
      memberStartDate: existingLead.member_start_date,
      notesSummary: payload.data.notes ?? existingLead.notes_summary,
      lostReason: isLost ? existingLead.lost_reason || "Other" : "",
      closedDate: isLost ? existingLead.closed_date || toEasternDate() : "",
      allowUnlinkedReferral: true
    })
  );
}

export async function setMemberStatusAction(raw: {
  memberId: string;
  status: "active" | "inactive";
  dischargeReason?: string;
  dischargeDisposition?: string;
}) {
  const payload = z
    .object({
      memberId: z.string().min(1),
      status: z.enum(["active", "inactive"]),
      dischargeReason: z.string().trim().optional(),
      dischargeDisposition: z.string().trim().optional()
    })
    .superRefine((val, ctx) => {
      if (val.status !== "inactive") return;
      if (!val.dischargeReason || !MEMBER_DISCHARGE_REASON_OPTIONS.includes(val.dischargeReason as (typeof MEMBER_DISCHARGE_REASON_OPTIONS)[number])) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["dischargeReason"],
          message: "Discharge reason is required."
        });
      }
      if (!val.dischargeDisposition || !MEMBER_DISPOSITION_OPTIONS.includes(val.dischargeDisposition as (typeof MEMBER_DISPOSITION_OPTIONS)[number])) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["dischargeDisposition"],
          message: "Discharge disposition is required."
        });
      }
    })
    .safeParse(raw);
  if (!payload.success) return { error: "Invalid member status update." };

  const editor = await requireManagerAdminEditor();
  if ("error" in editor) return editor;
  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from("members")
    .update({
      status: payload.data.status,
      discharge_reason: payload.data.dischargeReason ?? null,
      discharge_disposition: payload.data.dischargeDisposition ?? null,
      discharge_date: payload.data.status === "inactive" ? toEasternDate() : null,
      updated_at: toEasternISO()
    })
    .eq("id", payload.data.memberId)
    .select("id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!updated) return { error: "Member not found." };
  await insertAudit("manager_review", "member", payload.data.memberId, {
    status: payload.data.status,
    dischargeReason: payload.data.dischargeReason ?? null,
    dischargeDisposition: payload.data.dischargeDisposition ?? null
  });

  revalidatePath("/members");
  revalidatePath(`/members/${payload.data.memberId}`);
  revalidatePath("/reports/member-summary");
  revalidatePath("/operations/member-command-center");
  revalidatePath(`/operations/member-command-center/${payload.data.memberId}`);
  revalidatePath("/operations/holds");
  revalidatePath("/operations/attendance");
  revalidatePath("/operations/transportation-station");
  revalidatePath("/operations/transportation-station/print");
  revalidatePath("/operations/locker-assignments");
  revalidatePath("/health/member-health-profiles");
  revalidatePath(`/health/member-health-profiles/${payload.data.memberId}`);
  return { ok: true };
}

export async function deleteWorkflowRecordAction(raw: { entity: string; id: string }) {
  const payload = z.object({ entity: z.string(), id: z.string() }).safeParse(raw);
  if (!payload.success) return { error: "Invalid delete request." };
  const editor = await requireManagerAdminEditor();
  if ("error" in editor) return editor;
  const supabase = await createClient();
  const tableMap: Record<string, string> = {
    dailyActivities: "daily_activity_logs",
    toiletLogs: "toilet_logs",
    showerLogs: "shower_logs",
    transportationLogs: "transportation_logs",
    photoUploads: "member_photo_uploads",
    bloodSugarLogs: "blood_sugar_logs",
    ancillaryLogs: "ancillary_charge_logs",
    leads: "leads",
    leadActivities: "lead_activities",
    assessments: "intake_assessments"
  };
  const table = tableMap[payload.data.entity];
  if (!table) return { error: "Unknown entity." };
  const { error } = await supabase.from(table).delete().eq("id", payload.data.id);
  if (error) return { error: error.message };
  await insertAudit("manager_review", payload.data.entity, payload.data.id, { operation: "delete" });

  revalidatePath("/");
  revalidatePath("/documentation");
  revalidatePath("/documentation/activity");
  revalidatePath("/documentation/toilet");
  revalidatePath("/documentation/shower");
  revalidatePath("/documentation/transportation");
  revalidatePath("/documentation/photo-upload");
  return { ok: true };
}

export async function reviewTimeCardAction(raw: { staffName: string; payPeriod: string; status: "Pending" | "Reviewed" | "Needs Follow-up"; notes?: string }) {
  const payload = z.object({ staffName: z.string().min(1), payPeriod: z.string().min(1), status: z.enum(["Pending", "Reviewed", "Needs Follow-up"]), notes: z.string().max(500).optional() }).safeParse(raw);
  if (!payload.success) return { error: "Invalid time review." };
  const editor = await requireManagerAdminEditor();
  if ("error" in editor) return editor;
  await insertAudit("manager_review", "time_review", null, {
    staffName: payload.data.staffName,
    payPeriod: payload.data.payPeriod,
    status: payload.data.status,
    notes: payload.data.notes ?? "",
    reviewed_by: editor.full_name,
    reviewed_at: toEasternISO()
  });
  revalidatePath("/time-card");
  return { ok: true };
}

export async function reviewDocumentationAction(raw: { staffName: string; periodLabel: string; status: "Pending" | "Reviewed" | "Needs Follow-up"; notes?: string }) {
  const payload = z.object({ staffName: z.string().min(1), periodLabel: z.string().min(1), status: z.enum(["Pending", "Reviewed", "Needs Follow-up"]), notes: z.string().max(500).optional() }).safeParse(raw);
  if (!payload.success) return { error: "Invalid documentation review." };
  const editor = await requireManagerAdminEditor();
  if ("error" in editor) return editor;
  await insertAudit("manager_review", "documentation_review", null, {
    staffName: payload.data.staffName,
    periodLabel: payload.data.periodLabel,
    status: payload.data.status,
    notes: payload.data.notes ?? "",
    reviewed_by: editor.full_name,
    reviewed_at: toEasternISO()
  });
  revalidatePath("/documentation");
  revalidatePath("/reports");
  return { ok: true };
}














































































