"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createSalesLeadActivityAction, saveSalesLeadAction } from "@/app/sales-actions";
import { getCurrentProfile, getCurrentProfileForRolesOrError } from "@/lib/auth";
import { signInAction as canonicalSignInAction } from "@/lib/actions/auth";
import {
  LEAD_FOLLOW_UP_TYPES,
  LEAD_LIKELIHOOD_OPTIONS,
  LEAD_LOST_REASON_OPTIONS,
  LEAD_SOURCE_OPTIONS,
  LEAD_STAGE_OPTIONS,
  LEAD_STATUS_OPTIONS,
  MEMBER_DISCHARGE_REASON_OPTIONS,
  MEMBER_DISPOSITION_OPTIONS,
  canonicalLeadStage,
  canonicalLeadStatus
} from "@/lib/canonical";
import { saveGeneratedMemberPdfToFiles } from "@/lib/services/member-files";
import { updateAncillaryCategoryPriceSupabase } from "@/lib/services/ancillary-write-supabase";
import { insertAuditLogEntry } from "@/lib/services/audit-log-service";
import { resolveCanonicalMemberRef } from "@/lib/services/canonical-person-ref";
import {
  autoCreateDraftPhysicianOrderFromIntake,
  createIntakeAssessmentWithResponses,
  updateIntakeAssessmentDraftPofStatus
} from "@/lib/services/intake-pof-mhp-cascade";
import { normalizeIntakeAssistiveDeviceFields } from "@/lib/services/intake-pof-shared";
import { buildIntakeAssessmentPdfDataUrl } from "@/lib/services/intake-assessment-pdf";
import {
  isAuthorizedIntakeAssessmentSignerRole,
  signIntakeAssessment
} from "@/lib/services/intake-assessment-esign";
import { parseBusNumbersInput, updateOperationalSettings } from "@/lib/services/operations-settings";
import { updateMemberStatusSupabase } from "@/lib/services/member-status-supabase";
import {
  getStaffNameByIdSupabase,
  listActiveMemberLookupSupabase,
  listStaffLookupSupabase
} from "@/lib/services/shared-lookups-supabase";
import { getSalesLeadByIdSupabase } from "@/lib/services/sales-crm-supabase";
import { legacyLeadActivityInputSchema, normalizeLegacyLeadActivityInput } from "@/lib/services/sales-lead-activities";
import { createTimePunchSupabase } from "@/lib/services/time-punches";
import { getManagedUserSignatureName } from "@/lib/services/user-management";
import { normalizeRoleKey } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { toEasternDate, toEasternISO } from "@/lib/timezone";
import type { AuditAction } from "@/types/app";
import type { CanonicalPersonSourceType } from "@/types/identity";

type ActionErrorResult = {
  error: string;
  ok?: never;
};

type ActionSuccessResult<T extends object = object> = {
  ok: true;
  error?: undefined;
} & T;

export async function signInAction(formData: FormData) {
  return canonicalSignInAction(formData);
}

async function insertAudit(action: AuditAction, entityType: string, entityId: string | null, details: Record<string, unknown>) {
  const profile = await getCurrentProfile();
  await insertAuditLogEntry({
    actorUserId: profile.id,
    actorRole: profile.role,
    action,
    entityType,
    entityId,
    details
  });
}

async function requireManagerAdminEditor() {
  return getCurrentProfileForRolesOrError(["admin", "manager", "director"], "Only manager/director/admin can edit submitted entries.");
}

async function requireAdminEditor() {
  return getCurrentProfileForRolesOrError(["admin"], "Only admin can manage ancillary pricing.");
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

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/");
  revalidatePath("/login");
  redirect("/login");
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

  let created;
  try {
    created = await createTimePunchSupabase({
      staffUserId: profile.id,
      punchType: payload.data.punchType,
      punchAtIso: toEasternISO(),
      lat: payload.data.lat ?? null,
      lng: payload.data.lng ?? null,
      note: payload.data.note ?? null
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to save time punch." };
  }

  await insertAudit(payload.data.punchType === "in" ? "clock_in" : "clock_out", "time_punch", created.id, payload.data);
  revalidatePath("/time-card");
  revalidatePath("/time-card/punch-history");
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
  try {
    const lead = await getSalesLeadByIdSupabase(leadId);
    if (!lead) return { lead: null };
    return {
      lead: {
        id: lead.id,
        stage: lead.stage,
        status: lead.status,
        inquiry_date: lead.inquiry_date ?? "",
        caregiver_name: lead.caregiver_name ?? "",
        caregiver_relationship: lead.caregiver_relationship,
        caregiver_email: lead.caregiver_email,
        caregiver_phone: lead.caregiver_phone ?? "",
        member_name: lead.member_name ?? "",
        member_dob: lead.member_dob,
        lead_source: lead.lead_source ?? "",
        lead_source_other: lead.lead_source_other,
        partner_id: lead.partner_id,
        referral_source_id: lead.referral_source_id,
        referral_name: lead.referral_name,
        likelihood: lead.likelihood,
        next_follow_up_date: lead.next_follow_up_date,
        next_follow_up_type: lead.next_follow_up_type,
        tour_date: lead.tour_date,
        tour_completed: Boolean(lead.tour_completed),
        discovery_date: lead.discovery_date,
        member_start_date: lead.member_start_date,
        notes_summary: lead.notes_summary,
        lost_reason: lead.lost_reason,
        closed_date: lead.closed_date
      }
    };
  } catch (error) {
    return { lead: null, error: error instanceof Error ? error.message : "Unable to load lead." };
  }
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
  let leadRow: Awaited<ReturnType<typeof getSalesLeadByIdSupabase>> = null;
  try {
    leadRow = await getSalesLeadByIdSupabase(leadId);
  } catch (error) {
    return { error: `Unable to resolve canonical lead.id for intake assessment. ${error instanceof Error ? error.message : "Unknown error"}` };
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
    revalidatePath("/health/assessment");
    revalidatePath(`/health/assessment/${created.id}`);
    revalidatePath(`/reports/assessments/${created.id}`);
    return {
      error:
        error instanceof Error
          ? `Intake Assessment was created, but nurse/admin e-signature finalization failed (${error.message}). Open the saved assessment and retry the signature.`
          : "Intake Assessment was created, but nurse/admin e-signature finalization failed.",
      assessmentId: created.id
    };
  }

  const draftPofAttemptedAt = toEasternISO();
  try {
    await autoCreateDraftPhysicianOrderFromIntake({
      assessment: created,
      actor: { id: profile.id, fullName: profile.full_name, signoffName: signerName }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create draft physician order from intake.";
    await updateIntakeAssessmentDraftPofStatus({
      assessmentId: created.id,
      status: "failed",
      attemptedAt: draftPofAttemptedAt,
      error: message
    });
    revalidatePath("/health/assessment");
    revalidatePath(`/health/assessment/${created.id}`);
    revalidatePath(`/reports/assessments/${created.id}`);
    return {
      error: `Intake Assessment was signed, but draft POF creation failed (${message}).`,
      assessmentId: created.id
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
      generatedAtIso: created.created_at,
      replaceExistingByDocumentSource: true
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown PDF generation error.";
    return {
      error: `Intake Assessment was created, but saving its PDF to member files failed (${message}).`,
      assessmentId: created.id
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
  return { ok: true, assessmentId: created.id };
}

export async function createLeadActivityAction(raw: z.infer<typeof legacyLeadActivityInputSchema>) {
  const payload = legacyLeadActivityInputSchema.safeParse(raw);
  if (!payload.success) {
    return { error: "Invalid lead activity." };
  }

  return createSalesLeadActivityAction(normalizeLegacyLeadActivityInput(payload.data));
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

  const { lead, error } = await getLegacyLeadRecordById(payload.data.leadId);
  if (error) return { error };
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
  return listStaffLookupSupabase();
}

export async function getMemberLookup() {
  return listActiveMemberLookupSupabase();
}

export async function resolveStaffName(staffId: string) {
  return getStaffNameByIdSupabase(staffId);
}

export async function updateLeadDetailsAction(raw: { id: string; stage: string; status: (typeof LEAD_STATUS_OPTIONS)[number]; notes?: string }) {
  const payload = z.object({ id: z.string(), stage: z.string().min(1), status: z.enum(LEAD_STATUS_OPTIONS), notes: z.string().max(1000).optional() }).safeParse(raw);
  if (!payload.success) return { error: "Invalid lead update." };
  const editor = await requireManagerAdminEditor();
  if ("error" in editor) return editor;
  const { lead: existingLead, error } = await getLegacyLeadRecordById(payload.data.id);
  if (error) return { error };
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
}): Promise<ActionErrorResult | ActionSuccessResult> {
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
  try {
    await updateMemberStatusSupabase({
      memberId: payload.data.memberId,
      status: payload.data.status,
      dischargeReason: payload.data.dischargeReason ?? null,
      dischargeDisposition: payload.data.dischargeDisposition ?? null
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to update member status." };
  }
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















































































