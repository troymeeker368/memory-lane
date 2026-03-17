"use server";

import { z } from "zod";

import { createSalesLeadActivityAction, saveSalesLeadAction } from "@/app/sales-lead-actions";
import {
  LEAD_FOLLOW_UP_TYPES,
  LEAD_LIKELIHOOD_OPTIONS,
  LEAD_LOST_REASON_OPTIONS,
  LEAD_SOURCE_OPTIONS,
  LEAD_STAGE_OPTIONS,
  LEAD_STATUS_OPTIONS,
  canonicalLeadStage,
  canonicalLeadStatus
} from "@/lib/canonical";
import { getSalesLeadByIdSupabase } from "@/lib/services/sales-crm-supabase";
import { legacyLeadActivityInputSchema, normalizeLegacyLeadActivityInput } from "@/lib/services/sales-lead-activities";
import { toEasternDate } from "@/lib/timezone";

import { requireManagerAdminEditor } from "@/app/action-helpers";

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
















































































