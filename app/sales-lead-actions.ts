"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getCurrentProfile } from "@/lib/auth";
import {
  LEAD_FOLLOW_UP_TYPES,
  LEAD_LIKELIHOOD_OPTIONS,
  LEAD_LOST_REASON_OPTIONS,
  LEAD_SOURCE_OPTIONS,
  LEAD_STAGE_OPTIONS,
  LEAD_STATUS_OPTIONS,
  resolveCanonicalLeadState
} from "@/lib/canonical";
import { normalizeRoleKey } from "@/lib/permissions";
import { createSalesLeadActivity, salesLeadActivityInputSchema } from "@/lib/services/sales-lead-activities";
import { createLeadWithMemberConversionSupabase } from "@/lib/services/sales-lead-conversion-supabase";
import {
  createSalesLeadSupabase,
  insertSalesAuditLogSupabase
} from "@/lib/services/sales-crm-supabase";
import { getLeadEnrollmentSnapshot, getLeadReferralLinkage } from "@/lib/services/leads-read";
import { applyLeadStageTransitionSupabase } from "@/lib/services/sales-lead-stage-supabase";
import { toEasternDate, toEasternISO } from "@/lib/timezone";

import {
  applyClosedWonLeadConversion,
  normalizePhone,
  optionalString,
  requireSalesRoles,
  resolveLostReason,
  resolveSalesLeadId,
  revalidateSalesLeadViews
} from "@/app/sales-action-helpers";
import { recordImmediateSystemAlert } from "@/lib/services/workflow-observability";

const salesLeadSchema = z
  .object({
    leadId: optionalString,
    submissionMode: z.enum(["create", "edit"]).optional(),
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
    const { status } = resolveCanonicalLeadState({
      requestedStage: val.stage,
      requestedStatus: val.status
    });
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

function resolveLeadSubmissionMode(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "create";
  const submissionMode = (raw as { submissionMode?: unknown }).submissionMode;
  return submissionMode === "edit" ? "edit" : "create";
}

export async function saveSalesLeadAction(raw: z.infer<typeof salesLeadSchema>) {
  await requireSalesRoles();
  const submissionMode = resolveLeadSubmissionMode(raw);
  const payload = salesLeadSchema.safeParse(raw);
  if (!payload.success) {
    return {
      error: submissionMode === "edit" ? "Invalid lead update." : "Invalid inquiry submission."
    };
  }

  const profile = await getCurrentProfile();
  const { stage, status, dbStatus } = resolveCanonicalLeadState({
    requestedStage: payload.data.stage,
    requestedStatus: payload.data.status
  });
  const isLostStatus = status === "Lost";
  const isEipStage = stage === "Enrollment in Progress";
  const resolvedLostReason = isLostStatus ? resolveLostReason(payload.data.lostReason, payload.data.lostReasonOther) : null;

  const requestedPartner = payload.data.partnerId?.trim() || null;
  const requestedSource = payload.data.referralSourceId?.trim() || null;
  let selectedPartner: { id: string; partner_id: string } | null = null;
  let selectedReferralSource: { id: string; partner_id: string; referral_source_id: string; contact_name: string } | null = null;
  try {
    const resolved = await getLeadReferralLinkage({
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
  let createRootDedupeKey: string | null = null;
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
  } else if (status === "Won") {
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
      createRootDedupeKey = `lead-create-convert:${conversion.idempotencyKey}`;
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
      createRootDedupeKey = `lead-create:${created.idempotencyKey}`;
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Unable to create lead." };
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
      },
      dedupeKey: payload.data.leadId ? null : createRootDedupeKey
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to write lead audit log.";
    console.error("[sales-lead-actions] lead audit log insert failed after lead write", {
      leadId,
      message
    });
    try {
      await recordImmediateSystemAlert({
        entityType: "lead",
        entityId: leadId,
        actorUserId: profile.id,
        severity: "medium",
        alertKey: "sales_lead_audit_log_failed",
        metadata: {
          operation: "saveSalesLeadAction",
          audit_action: "upsert_lead",
          error: message
        }
      });
    } catch (alertError) {
      const alertMessage = alertError instanceof Error ? alertError.message : "Unknown system alert error.";
      console.error("[sales-lead-actions] lead alert insert failed after lead audit log failure", {
        leadId,
        message: alertMessage
      });
    }
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
    lead = await getLeadEnrollmentSnapshot(canonicalLeadId);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to load lead for enrollment." };
  }
  if (!lead) return { error: "Lead not found." };
  if (
    resolveCanonicalLeadState({
      requestedStage: lead.stage,
      requestedStatus: lead.status
    }).stage !== "Enrollment in Progress"
  ) {
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
    const message = error instanceof Error ? error.message : "Unable to write lead conversion audit log.";
    console.error("[sales-lead-actions] lead conversion audit log insert failed after conversion", {
      leadId: lead.id,
      memberId,
      message
    });
    try {
      await recordImmediateSystemAlert({
        entityType: "lead",
        entityId: lead.id,
        actorUserId: profile.id,
        severity: "medium",
        alertKey: "sales_lead_audit_log_failed",
        metadata: {
          operation: "enrollMemberFromLeadAction",
          audit_action: "manager_review",
          member_id: memberId,
          error: message
        }
      });
    } catch (alertError) {
      const alertMessage = alertError instanceof Error ? alertError.message : "Unknown system alert error.";
      console.error("[sales-lead-actions] lead alert insert failed after conversion audit log failure", {
        leadId: lead.id,
        memberId,
        message: alertMessage
      });
    }
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
  return { ok: true };
}

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
