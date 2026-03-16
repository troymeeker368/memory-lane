"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";

import { getCurrentProfile, requireModuleAction } from "@/lib/auth";
import {
  LEAD_ACTIVITY_TYPES,
  LEAD_FOLLOW_UP_TYPES,
  LEAD_LIKELIHOOD_OPTIONS,
  LEAD_LOST_REASON_OPTIONS,
  LEAD_SOURCE_OPTIONS,
  LEAD_STAGE_OPTIONS,
  LEAD_STATUS_OPTIONS,
  canonicalLeadStage,
  canonicalLeadStatus
} from "@/lib/canonical";
import { normalizeRoleKey } from "@/lib/permissions";
import { resolveCanonicalLeadRef } from "@/lib/services/canonical-person-ref";
import {
  getEnrollmentPacketSenderSignatureProfile,
  sendEnrollmentPacketRequest,
  upsertEnrollmentPacketSenderSignatureProfile
} from "@/lib/services/enrollment-packets-sender";
import { createSalesLeadActivity, salesLeadActivityInputSchema } from "@/lib/services/sales-lead-activities";
import { WorkflowDeliveryError } from "@/lib/services/send-workflow-state";
import {
  applyLeadStageTransitionWithMemberUpsertSupabase,
  createLeadWithMemberConversionSupabase
} from "@/lib/services/sales-lead-conversion-supabase";
import {
  createCommunityPartnerSupabase,
  createPartnerActivitySupabase,
  createReferralSourceSupabase,
  createSalesLeadSupabase,
  getSalesFormLookupsSupabase,
  getSalesLeadForEnrollmentSupabase,
  insertSalesAuditLogSupabase,
  resolveSalesPartnerAndReferralSupabase
} from "@/lib/services/sales-crm-supabase";
import { applyLeadStageTransitionSupabase } from "@/lib/services/sales-lead-stage-supabase";
import { normalizePhoneForStorage } from "@/lib/phone";
import { toEasternDate, toEasternDateTimeLocal, toEasternISO } from "@/lib/timezone";

const optionalString = z.string().optional().or(z.literal(""));

async function requireSalesRoles() {
  await requireModuleAction("sales", "canEdit");
}

function revalidateSalesLeadViews(leadId?: string) {
  const basePaths = [
    "/sales",
    "/sales/activities",
    "/sales/pipeline",
    "/sales/pipeline/leads-table",
    "/sales/pipeline/by-stage",
    "/sales/pipeline/follow-up-dashboard",
    "/sales/pipeline/inquiry",
    "/sales/pipeline/tour",
    "/sales/pipeline/eip",
    "/sales/pipeline/nurture",
    "/sales/pipeline/closed-won",
    "/sales/pipeline/closed-lost",
    "/sales/pipeline-table",
    "/sales/pipeline-by-stage",
    "/sales/summary"
  ];

  basePaths.forEach((path) => revalidatePath(path));

  if (leadId) {
    revalidatePath(`/sales/leads/${leadId}`);
    revalidatePath(`/sales/leads/${leadId}/edit`);
  }
}

function normalizePhone(phone: string | undefined) {
  return normalizePhoneForStorage(phone) ?? "";
}

async function resolveSalesLeadId(rawLeadId: string, actionLabel: string) {
  const leadId = rawLeadId.trim();
  const canonical = await resolveCanonicalLeadRef(
    {
      sourceType: "lead",
      leadId,
      selectedId: leadId
    },
    { actionLabel }
  );
  if (!canonical.leadId) {
    throw new Error(`${actionLabel} expected lead.id but canonical lead resolution returned empty leadId.`);
  }
  return {
    leadId: canonical.leadId,
    memberId: canonical.memberId
  };
}

async function resolveRequestAppBaseUrl() {
  const headerMap = await headers();
  const origin = (headerMap.get("origin") ?? "").trim();
  if (origin) return origin;

  const forwardedHost = (headerMap.get("x-forwarded-host") ?? "").trim();
  const host = forwardedHost || (headerMap.get("host") ?? "").trim();
  if (!host) return null;
  const forwardedProto = (headerMap.get("x-forwarded-proto") ?? "").trim();
  const proto =
    forwardedProto.split(",")[0]?.trim() ||
    (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${proto}://${host}`;
}

function resolveLostReason(lostReason?: string, lostReasonOther?: string) {
  const reason = (lostReason ?? "").trim();
  if (!reason) return null;
  if (reason === "Other") {
    const other = (lostReasonOther ?? "").trim();
    return other || null;
  }
  return reason;
}

async function applyClosedWonLeadConversion(input: {
  leadId: string;
  actorUserId: string;
  actorName: string;
  source: string;
  reason: string;
  memberDisplayName: string;
  memberDob?: string | null;
  memberEnrollmentDate: string;
  existingMemberId?: string | null;
  additionalLeadPatch?: Record<string, any>;
}) {
  return applyLeadStageTransitionWithMemberUpsertSupabase({
    leadId: input.leadId,
    requestedStage: "Closed - Won",
    requestedStatus: "Won",
    actorUserId: input.actorUserId,
    actorName: input.actorName,
    source: input.source,
    reason: input.reason,
    memberDisplayName: input.memberDisplayName,
    memberDob: input.memberDob ?? null,
    memberEnrollmentDate: input.memberEnrollmentDate,
    existingMemberId: input.existingMemberId ?? null,
    additionalLeadPatch: input.additionalLeadPatch ?? undefined
  });
}

const salesLeadSchema = z
  .object({
    leadId: optionalString,
    stage: z.enum(LEAD_STAGE_OPTIONS),
    status: z.enum(LEAD_STATUS_OPTIONS),
    inquiryDate: z.string().min(1),
    caregiverName: z.string().min(1),
    caregiverRelationship: optionalString,
    caregiverEmail: optionalString,
    caregiverPhone: z.string().min(7),
    memberName: z.string().min(1),
    memberDob: optionalString,
    leadSource: z.enum(LEAD_SOURCE_OPTIONS),
    leadSourceOther: optionalString,
    partnerId: optionalString,
    referralSourceId: optionalString,
    referralName: optionalString,
    likelihood: z.enum(LEAD_LIKELIHOOD_OPTIONS).optional().or(z.literal("")),
    nextFollowUpDate: optionalString,
    nextFollowUpType: z.enum(LEAD_FOLLOW_UP_TYPES).optional().or(z.literal("")),
    tourDate: optionalString,
    tourCompleted: z.boolean().optional(),
    discoveryDate: optionalString,
    memberStartDate: optionalString,
    notesSummary: optionalString,
    lostReason: optionalString,
    lostReasonOther: optionalString,
    closedDate: optionalString,
    duplicateDecision: z.enum(["keep-separate", "merge"]).optional().or(z.literal("")),
    mergeTargetLeadId: optionalString,
    allowUnlinkedReferral: z.boolean().optional(),
    skipDuplicateReview: z.boolean().optional()
  })
  .superRefine((val, ctx) => {
    const stage = canonicalLeadStage(val.stage);
    const status = stage === "Closed - Lost" ? "Lost" : canonicalLeadStatus(val.status, stage);
    const requireLinkedReferral = val.leadSource === "Referral" && !val.allowUnlinkedReferral;

    if (val.leadSource === "Referral" && !val.referralName?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["referralName"],
        message: "Referral Name is required when Lead Source is Referral."
      });
    }

    if (requireLinkedReferral && !val.partnerId?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["partnerId"],
        message: "Community Partner Organization is required when Lead Source is Referral."
      });
    }

    if (requireLinkedReferral && !val.referralSourceId?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["referralSourceId"],
        message: "Referral Source is required when Lead Source is Referral."
      });
    }

    if (val.leadSource === "Other" && !val.leadSourceOther?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["leadSourceOther"],
        message: "Lead Source Other is required when Lead Source is Other."
      });
    }

    if (val.tourDate?.trim() && typeof val.tourCompleted !== "boolean") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tourCompleted"],
        message: "Tour Completed is required when Tour Date has a value."
      });
    }

    if (status === "Lost") {
      if (!val.lostReason?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["lostReason"],
          message: "Lost Reason is required when Status is Lost."
        });
      }

      if (!val.closedDate?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["closedDate"],
          message: "Closed Date is required when Status is Lost."
        });
      }

      if (val.lostReason === "Other" && !val.lostReasonOther?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["lostReasonOther"],
          message: "Enter Lost Reason details when Other is selected."
        });
      }

      if (
        val.lostReason &&
        val.lostReason !== "Other" &&
        !LEAD_LOST_REASON_OPTIONS.includes(val.lostReason as (typeof LEAD_LOST_REASON_OPTIONS)[number])
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["lostReason"],
          message: "Select a valid Lost Reason option."
        });
      }
    }

    if (val.memberDob?.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(val.memberDob.trim())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["memberDob"],
        message: "Date of birth must be in YYYY-MM-DD format."
      });
    }

    if (val.duplicateDecision === "merge" && !val.mergeTargetLeadId?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mergeTargetLeadId"],
        message: "Select a lead to merge into."
      });
    }
  });

export async function saveSalesLeadAction(raw: z.infer<typeof salesLeadSchema>) {
  await requireSalesRoles();
  const payload = salesLeadSchema.safeParse(raw);
  if (!payload.success) {
    return { error: "Invalid inquiry submission." };
  }

  const profile = await getCurrentProfile();
  let stage = canonicalLeadStage(payload.data.stage);
  let status = canonicalLeadStatus(payload.data.status, stage);
  if (stage === "Closed - Lost") status = "Lost";
  if (status === "Lost") stage = "Closed - Lost";
  if (status === "Won") stage = "Closed - Won";
  if (status === "Nurture" && stage !== "Nurture") stage = "Nurture";
  status = canonicalLeadStatus(status, stage);
  const dbStatus: "open" | "won" | "lost" = status === "Won" ? "won" : status === "Lost" ? "lost" : "open";
  const isLostStatus = status === "Lost";
  const isEipStage = stage === "Enrollment in Progress";
  const resolvedLostReason = isLostStatus ? resolveLostReason(payload.data.lostReason, payload.data.lostReasonOther) : null;

  const requestedPartner = payload.data.partnerId?.trim() || null;
  const requestedSource = payload.data.referralSourceId?.trim() || null;
  let selectedPartner: { id: string; partner_id: string } | null = null;
  let selectedReferralSource: { id: string; partner_id: string; referral_source_id: string; contact_name: string } | null = null;
  try {
    const resolved = await resolveSalesPartnerAndReferralSupabase({
      partnerId: requestedPartner,
      referralSourceId: requestedSource
    });
    selectedPartner = resolved.partner
      ? {
          id: resolved.partner.id,
          partner_id: resolved.partner.partner_id
        }
      : null;
    selectedReferralSource = resolved.referralSource
      ? {
          id: resolved.referralSource.id,
          partner_id: resolved.referralSource.partner_id,
          referral_source_id: resolved.referralSource.referral_source_id,
          contact_name: resolved.referralSource.contact_name
        }
      : null;
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to resolve referral linkage." };
  }

  const resolvedPartnerId = selectedPartner?.partner_id ?? null;
  const resolvedReferralSourceId = selectedReferralSource?.referral_source_id ?? null;
  const resolvedReferralName = payload.data.referralName?.trim() || selectedReferralSource?.contact_name || null;

  const leadPatch = {
    stage,
    status: dbStatus,
    stage_updated_at: toEasternISO(),
    inquiry_date: payload.data.inquiryDate,
    tour_date: payload.data.tourDate?.trim() || null,
    tour_completed: payload.data.tourDate?.trim() ? Boolean(payload.data.tourCompleted) : false,
    discovery_date: payload.data.discoveryDate?.trim() || null,
    member_start_date: isEipStage ? payload.data.memberStartDate?.trim() || null : null,
    caregiver_name: payload.data.caregiverName.trim(),
    caregiver_relationship: payload.data.caregiverRelationship?.trim() || null,
    caregiver_email: payload.data.caregiverEmail?.trim() || null,
    caregiver_phone: normalizePhone(payload.data.caregiverPhone),
    member_name: payload.data.memberName.trim(),
    member_dob: payload.data.memberDob?.trim() || null,
    lead_source: payload.data.leadSource,
    lead_source_other: payload.data.leadSource === "Other" ? payload.data.leadSourceOther?.trim() || null : null,
    partner_id: resolvedPartnerId,
    referral_source_id: resolvedReferralSourceId,
    referral_name: resolvedReferralName,
    likelihood: payload.data.likelihood || null,
    next_follow_up_date: isLostStatus ? null : payload.data.nextFollowUpDate || null,
    next_follow_up_type: isLostStatus ? null : payload.data.nextFollowUpType || null,
    notes_summary: payload.data.notesSummary || null,
    lost_reason: resolvedLostReason,
    closed_date: isLostStatus ? payload.data.closedDate?.trim() || toEasternDate() : status === "Won" ? toEasternDate() : null,
    updated_at: toEasternISO()
  };

  let leadId = payload.data.leadId?.trim() || "";
  let canonicalMemberId: string | null = null;
  let wonConversionHandled = false;
  if (leadId) {
    try {
      const canonicalLead = await resolveSalesLeadId(leadId, "saveSalesLeadAction");
      leadId = canonicalLead.leadId;
      canonicalMemberId = canonicalLead.memberId;
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Unable to resolve canonical lead identity." };
    }
    try {
      if (status === "Won") {
        await applyClosedWonLeadConversion({
          leadId,
          actorUserId: profile.id,
          actorName: profile.full_name,
          source: "saveSalesLeadAction",
          reason: "Lead updated from sales intake form.",
          memberDisplayName: payload.data.memberName.trim(),
          memberDob: payload.data.memberDob?.trim() || null,
          memberEnrollmentDate: payload.data.memberStartDate?.trim() || toEasternDate(),
          existingMemberId: canonicalMemberId,
          additionalLeadPatch: leadPatch
        });
        wonConversionHandled = true;
      } else {
        await applyLeadStageTransitionSupabase({
          leadId,
          requestedStage: stage,
          requestedStatus: status,
          actorUserId: profile.id,
          actorName: profile.full_name,
          source: "saveSalesLeadAction",
          reason: "Lead updated from sales intake form.",
          additionalLeadPatch: leadPatch
        });
      }
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Unable to update lead." };
    }
  } else {
    if (status === "Won") {
      try {
        const conversion = await createLeadWithMemberConversionSupabase({
          requestedStage: stage,
          requestedStatus: status,
          createdByUserId: profile.id,
          actorUserId: profile.id,
          actorName: profile.full_name,
          source: "saveSalesLeadAction",
          reason: "Lead updated from sales intake form.",
          memberDisplayName: payload.data.memberName.trim(),
          memberDob: payload.data.memberDob?.trim() || null,
          memberEnrollmentDate: payload.data.memberStartDate?.trim() || toEasternDate(),
          leadPatch
        });
        leadId = conversion.leadId;
        wonConversionHandled = true;
      } catch (error) {
        return { error: error instanceof Error ? error.message : "Unable to create and convert lead." };
      }
    } else {
      try {
        const created = await createSalesLeadSupabase({
          leadPatch,
          createdByUserId: profile.id
        });
        leadId = created.id;
      } catch (error) {
        return { error: error instanceof Error ? error.message : "Unable to create lead." };
      }
    }
  }

  if (status === "Won" && !wonConversionHandled) {
    const enrollmentDate = payload.data.memberStartDate?.trim() || toEasternDate();
    try {
      const canonicalLead = await resolveSalesLeadId(leadId, "saveSalesLeadAction:closed-won");
      await applyClosedWonLeadConversion({
        leadId,
        actorUserId: profile.id,
        actorName: profile.full_name,
        source: "saveSalesLeadAction",
        reason: "Lead updated from sales intake form.",
        memberDisplayName: payload.data.memberName.trim(),
        memberDob: payload.data.memberDob?.trim() || null,
        memberEnrollmentDate: enrollmentDate,
        existingMemberId: canonicalLead.memberId
      });
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Unable to convert lead to member." };
    }
  }

  try {
    await insertSalesAuditLogSupabase({
      actorUserId: profile.id,
      actorRole: normalizeRoleKey(profile.role),
      action: "upsert_lead",
      entityType: "lead",
      entityId: leadId,
      details: {
        stage,
        status,
        leadSource: payload.data.leadSource
      }
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to write lead audit log." };
  }

  revalidateSalesLeadViews(leadId);
  return { ok: true, id: leadId };
}

const enrollLeadSchema = z.object({
  leadId: z.string().min(1)
});

export async function enrollMemberFromLeadAction(raw: z.infer<typeof enrollLeadSchema>) {
  await requireSalesRoles();
  const payload = enrollLeadSchema.safeParse(raw);
  if (!payload.success) {
    return { error: "Invalid lead conversion request." };
  }

  let canonicalLeadId = "";
  let canonicalMemberIdFromLead: string | null = null;
  try {
    const canonicalLead = await resolveSalesLeadId(payload.data.leadId, "enrollMemberFromLeadAction");
    canonicalLeadId = canonicalLead.leadId;
    canonicalMemberIdFromLead = canonicalLead.memberId;
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to resolve canonical lead identity." };
  }

  const profile = await getCurrentProfile();
  let lead;
  try {
    lead = await getSalesLeadForEnrollmentSupabase(canonicalLeadId);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to load lead for enrollment." };
  }
  if (!lead) return { error: "Lead not found." };
  if (canonicalLeadStage(lead.stage) !== "Enrollment in Progress") {
    return { error: "Enroll Member is only available for leads in Enrollment in Progress." };
  }

  const enrollmentDate = lead.member_start_date?.trim() || toEasternDate();
  let memberId = "";
  try {
    const conversion = await applyClosedWonLeadConversion({
      leadId: lead.id,
      actorUserId: profile.id,
      actorName: profile.full_name,
      source: "enrollMemberFromLeadAction",
      reason: "Enrollment in progress lead converted to member.",
      memberDisplayName: String(lead.member_name ?? "").trim(),
      memberDob: lead.member_dob ?? null,
      memberEnrollmentDate: enrollmentDate,
      existingMemberId: canonicalMemberIdFromLead,
      additionalLeadPatch: {
        member_start_date: enrollmentDate
      }
    });
    memberId = conversion.memberId;
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to convert lead to member." };
  }

  try {
    await insertSalesAuditLogSupabase({
      actorUserId: profile.id,
      actorRole: normalizeRoleKey(profile.role),
      action: "manager_review",
      entityType: "lead",
      entityId: lead.id,
      details: {
        operation: "enroll-member",
        convertedMemberId: memberId,
        convertedMemberName: lead.member_name
      }
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to write lead conversion audit log." };
  }

  revalidateSalesLeadViews(lead.id);
  revalidatePath("/members");
  revalidatePath(`/members/${memberId}`);
  revalidatePath("/operations/member-command-center");
  revalidatePath(`/operations/member-command-center/${memberId}`);
  revalidatePath("/health/member-health-profiles");
  revalidatePath(`/health/member-health-profiles/${memberId}`);
  return { ok: true, leadId: lead.id, memberId };
}

export async function createSalesLeadActivityAction(raw: z.infer<typeof salesLeadActivityInputSchema>) {
  await requireSalesRoles();
  const payload = salesLeadActivityInputSchema.safeParse(raw);
  if (!payload.success) {
    return { error: "Invalid lead activity." };
  }

  const profile = await getCurrentProfile();
  let created;
  try {
    created = await createSalesLeadActivity({
      activity: payload.data,
      actor: {
        id: profile.id,
        fullName: profile.full_name,
        role: profile.role
      },
      source: "createSalesLeadActivityAction"
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to create lead activity." };
  }

    revalidatePath("/sales/activities");
    revalidatePath("/sales/new-entries/log-lead-activity");
    revalidatePath(`/sales/leads/${created.leadId}`);
    revalidatePath("/sales/pipeline/leads-table");
    revalidatePath("/sales/pipeline/by-stage");
    return { ok: true };}

const quickContactSchema = z.object({
  leadId: z.string().min(1),
  channel: z.enum(["call", "email"])
});

export async function createLeadQuickContactActivityAction(raw: z.infer<typeof quickContactSchema>) {
  await requireSalesRoles();
  const payload = quickContactSchema.safeParse(raw);
  if (!payload.success) {
    return { error: "Invalid quick contact action." };
  }

  let leadId = "";
  try {
    leadId = (await resolveSalesLeadId(payload.data.leadId, "createLeadQuickContactActivityAction")).leadId;
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to resolve canonical lead identity." };
  }

  const profile = await getCurrentProfile();
  const isCall = payload.data.channel === "call";
  let created;
  try {
    created = await createSalesLeadActivity({
      activity: {
        leadId,
        activityAt: toEasternISO(),
        activityType: isCall ? "Call" : "Email",
        outcome: isCall ? "No answer" : "Sent info/packet",
        lostReason: "",
        notes: isCall
          ? "Quick Call action launched from lead detail. Add call notes after completion."
          : "Quick Email action launched from lead detail. Add message notes after sending.",
        nextFollowUpDate: "",
        nextFollowUpType: "",
        partnerId: "",
        referralSourceId: ""
      },
      actor: {
        id: profile.id,
        fullName: profile.full_name,
        role: profile.role
      },
      source: "createLeadQuickContactActivityAction"
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to create quick contact activity." };
  }

  revalidatePath("/sales/activities");
  revalidatePath("/sales/new-entries/log-lead-activity");
  revalidatePath("/sales/pipeline/follow-up-dashboard");
  revalidatePath(`/sales/leads/${created.leadId}`);

  return { ok: true, id: created.activityId };
}

const partnerActivitySchema = z.object({
  partnerId: z.string().min(1),
  referralSourceId: z.string().min(1),
  leadId: optionalString,
  activityAt: optionalString,
  activityType: z.enum(LEAD_ACTIVITY_TYPES),
  notes: optionalString,
  nextFollowUpDate: optionalString,
  nextFollowUpType: z.enum(LEAD_FOLLOW_UP_TYPES).optional().or(z.literal(""))
});

export async function createPartnerActivityAction(raw: z.infer<typeof partnerActivitySchema>) {
  await requireSalesRoles();
  const payload = partnerActivitySchema.safeParse(raw);
  if (!payload.success) {
    return { error: "Invalid partner activity." };
  }

  const profile = await getCurrentProfile();
  let created;
  try {
    created = await createPartnerActivitySupabase({
      partnerId: payload.data.partnerId,
      referralSourceId: payload.data.referralSourceId,
      activityAt: payload.data.activityAt || null,
      activityType: payload.data.activityType,
      notes: payload.data.notes || null,
      nextFollowUpDate: payload.data.nextFollowUpDate || null,
      nextFollowUpType: payload.data.nextFollowUpType || null,
      completedByName: profile.full_name
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to create partner activity." };
  }

  revalidatePath("/sales/community-partners");
  revalidatePath("/sales/new-entries/log-partner-activities");
  revalidatePath("/sales/activities");
  revalidatePath(`/sales/community-partners/organizations/${created.partner.id}`);
  revalidatePath(`/sales/community-partners/referral-sources/${created.referralSource.id}`);
  return { ok: true };
}

const communityPartnerSchema = z.object({
  organizationName: z.string().min(1),
  referralSourceCategory: z.string().min(1),
  location: optionalString,
  primaryPhone: optionalString,
  secondaryPhone: optionalString,
  primaryEmail: optionalString,
  contactName: optionalString,
  notes: optionalString,
  active: z.boolean().default(true)
});

export async function createCommunityPartnerAction(raw: z.infer<typeof communityPartnerSchema>) {
  await requireSalesRoles();
  const payload = communityPartnerSchema.safeParse(raw);
  if (!payload.success) {
    return { error: "Invalid community partner entry." };
  }

  let created;
  try {
    created = await createCommunityPartnerSupabase({
      organizationName: payload.data.organizationName,
      referralSourceCategory: payload.data.referralSourceCategory,
      location: payload.data.location || null,
      primaryPhone: payload.data.primaryPhone || null,
      secondaryPhone: payload.data.secondaryPhone || null,
      primaryEmail: payload.data.primaryEmail || null,
      notes: payload.data.notes || null,
      active: payload.data.active
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to create community partner." };
  }

  revalidatePath("/sales/community-partners/organizations");
  revalidatePath("/sales/new-entries/new-community-partner");
  return {
    ok: true,
    id: created.id,
    partner: created.partner
  };
}

const referralSourceSchema = z.object({
  partnerId: z.string().min(1),
  contactName: z.string().min(1),
  jobTitle: optionalString,
  primaryPhone: optionalString,
  secondaryPhone: optionalString,
  primaryEmail: optionalString,
  preferredContactMethod: optionalString,
  notes: optionalString,
  active: z.boolean().default(true)
});

export async function createReferralSourceAction(raw: z.infer<typeof referralSourceSchema>) {
  await requireSalesRoles();
  const payload = referralSourceSchema.safeParse(raw);
  if (!payload.success) {
    return { error: "Invalid referral source entry." };
  }

  let created;
  try {
    created = await createReferralSourceSupabase({
      partnerId: payload.data.partnerId,
      contactName: payload.data.contactName,
      jobTitle: payload.data.jobTitle || null,
      primaryPhone: payload.data.primaryPhone || null,
      secondaryPhone: payload.data.secondaryPhone || null,
      primaryEmail: payload.data.primaryEmail || null,
      preferredContactMethod: payload.data.preferredContactMethod || null,
      notes: payload.data.notes || null,
      active: payload.data.active
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to create referral source." };
  }

  revalidatePath("/sales/community-partners/referral-sources");
  revalidatePath("/sales/new-entries/new-referral-source");
  return {
    ok: true,
    id: created.id,
    source: created.source
  };
}

export async function getSalesFormLookups() {
  await requireSalesRoles();
  return getSalesFormLookupsSupabase();
}

const enrollmentPacketSendSchema = z.object({
  leadId: z.string().uuid(),
  caregiverEmail: optionalString,
  requestedStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  requestedDays: z.array(z.string().min(1)).min(1),
  transportation: z.enum(["None", "Door to Door", "Bus Stop", "Mixed"]),
  communityFee: z.number().finite().nonnegative().optional().nullable(),
  dailyRate: z.number().finite().nonnegative().optional().nullable(),
  totalInitialEnrollmentAmount: z.number().finite().nonnegative().optional().nullable(),
  optionalMessage: optionalString
});

export async function sendEnrollmentPacketAction(raw: z.infer<typeof enrollmentPacketSendSchema>) {
  await requireSalesRoles();
  const payload = enrollmentPacketSendSchema.safeParse(raw);
  if (!payload.success) {
    return { ok: false, error: "Invalid enrollment packet request." } as const;
  }

  try {
    const canonicalLead = await resolveCanonicalLeadRef(
      {
        sourceType: "lead",
        leadId: payload.data.leadId,
        selectedId: payload.data.leadId
      },
      {
        actionLabel: "sendEnrollmentPacketAction"
      }
    );
    if (!canonicalLead.leadId) {
      return { ok: false, error: "sendEnrollmentPacketAction expected lead.id but canonical lead resolution returned empty leadId." } as const;
    }

    const profile = await getCurrentProfile();
    const sent = await sendEnrollmentPacketRequest({
      leadId: canonicalLead.leadId,
      senderUserId: profile.id,
      senderFullName: profile.full_name,
      caregiverEmail: payload.data.caregiverEmail || null,
      requestedStartDate: payload.data.requestedStartDate,
      requestedDays: payload.data.requestedDays.map((day) => day.trim()).filter(Boolean),
      transportation: payload.data.transportation,
      communityFeeOverride: payload.data.communityFee ?? null,
      dailyRateOverride: payload.data.dailyRate ?? null,
      totalInitialEnrollmentAmountOverride: payload.data.totalInitialEnrollmentAmount ?? null,
      optionalMessage: payload.data.optionalMessage || null,
      appBaseUrl: await resolveRequestAppBaseUrl()
    });

    revalidateSalesLeadViews(sent.request.leadId || undefined);
    revalidatePath("/sales/new-entries/send-enrollment-packet");
    revalidatePath("/operations/member-command-center");
    revalidatePath(`/operations/member-command-center/${sent.request.memberId}`);
    revalidatePath(`/members/${sent.request.memberId}`);

    return {
      ok: true,
      requestId: sent.request.id,
      requestUrl: sent.requestUrl
    } as const;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to send enrollment packet.";
    const code = typeof error === "object" && error !== null ? String((error as { code?: string }).code ?? "") : "";
    if (code === "signature_setup_required") {
      return {
        ok: false,
        error: message,
        code,
        redirectTo: "/sales/new-entries/enrollment-signature-setup"
      } as const;
    }
    if (error instanceof WorkflowDeliveryError) {
      return {
        ok: false,
        error: message,
        code: error.code,
        retryable: error.retryable,
        requestId: error.requestId,
        requestUrl: error.requestUrl,
        deliveryStatus: error.deliveryStatus
      } as const;
    }
    return { ok: false, error: message } as const;
  }
}

const enrollmentSignatureSchema = z.object({
  signatureName: z.string().min(1),
  signatureImageDataUrl: z.string().min(1)
});

export async function getEnrollmentPacketSenderSignatureProfileAction() {
  await requireSalesRoles();
  const profile = await getCurrentProfile();
  const signature = await getEnrollmentPacketSenderSignatureProfile(profile.id);
  if (!signature) return null;
  return {
    signatureName: signature.signature_name,
    signatureImageDataUrl: signature.signature_blob,
    updatedAt: signature.updated_at
  };
}

export async function saveEnrollmentPacketSenderSignatureProfileAction(raw: z.infer<typeof enrollmentSignatureSchema>) {
  await requireSalesRoles();
  const payload = enrollmentSignatureSchema.safeParse(raw);
  if (!payload.success) {
    return { ok: false, error: "Invalid signature setup input." } as const;
  }
  try {
    const profile = await getCurrentProfile();
    const saved = await upsertEnrollmentPacketSenderSignatureProfile({
      userId: profile.id,
      signatureName: payload.data.signatureName,
      signatureImageDataUrl: payload.data.signatureImageDataUrl
    });
    revalidatePath("/sales/new-entries/enrollment-signature-setup");
    return {
      ok: true,
      signatureName: saved.signature_name,
      updatedAt: saved.updated_at
    } as const;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to save signature setup."
    } as const;
  }
}

export async function getSalesNowLocalAction() {
  return { now: toEasternDateTimeLocal() };
}










