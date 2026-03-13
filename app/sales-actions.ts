"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";

import { getCurrentProfile, requireModuleAction } from "@/lib/auth";
import {
  LEAD_ACTIVITY_OUTCOMES,
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
import { resolveCanonicalLeadRef, resolveCanonicalPersonRef } from "@/lib/services/canonical-person-ref";
import {
  getEnrollmentPacketSenderSignatureProfile,
  sendEnrollmentPacketRequest,
  upsertEnrollmentPacketSenderSignatureProfile
} from "@/lib/services/enrollment-packets";
import { applyLeadStageTransitionSupabase } from "@/lib/services/sales-lead-stage-supabase";
import { createClient } from "@/lib/supabase/server";
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
    revalidatePath(`/sales/pipeline/leads/${leadId}`);
  }
}

function normalizePhone(phone: string | undefined) {
  return (phone ?? "").trim();
}

function normalizePhoneDigits(phone: string | null | undefined) {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return digits.slice(1);
  }
  return digits;
}

function normalizeText(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function makeShortId(prefix: string) {
  const random = Math.random().toString(16).slice(2, 10);
  return `${prefix}-${random}`;
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

      const supabase = await createClient();
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
    const selectedPartnerResult = requestedPartner
      ? await supabase
          .from("community_partner_organizations")
          .select("id, partner_id")
          .or(`id.eq.${requestedPartner},partner_id.eq.${requestedPartner}`)
          .maybeSingle()
      : { data: null, error: null };
    if (selectedPartnerResult.error) return { error: selectedPartnerResult.error.message };
    const selectedPartner = selectedPartnerResult.data ?? null;
    const selectedReferralSourceResult = requestedSource
      ? await supabase
          .from("referral_sources")
          .select("id, partner_id, referral_source_id, contact_name")
          .or(`id.eq.${requestedSource},referral_source_id.eq.${requestedSource}`)
          .maybeSingle()
      : { data: null, error: null };
    if (selectedReferralSourceResult.error) return { error: selectedReferralSourceResult.error.message };
    const selectedReferralSource = selectedReferralSourceResult.data ?? null;

    if (requestedPartner && !selectedPartner) return { error: "Community partner organization not found." };
    if (requestedSource && !selectedReferralSource) return { error: "Referral source not found." };

    if (payload.data.leadSource === "Referral" && selectedPartner && selectedReferralSource && selectedReferralSource.partner_id !== selectedPartner.id) {
      return { error: "Referral Source must belong to the selected Community Partner Organization." };
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
    if (leadId) {
      try {
        leadId = (await resolveSalesLeadId(leadId, "saveSalesLeadAction")).leadId;
      } catch (error) {
        return { error: error instanceof Error ? error.message : "Unable to resolve canonical lead identity." };
      }
      try {
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
      } catch (error) {
        return { error: error instanceof Error ? error.message : "Unable to update lead." };
      }
    } else {
      const { data, error } = await supabase
        .from("leads")
        .insert({
          ...leadPatch,
          status: dbStatus,
          created_by_user_id: profile.id
        })
        .select("id")
        .single();
      if (error) return { error: error.message };
      leadId = data.id;
    }

    if (status === "Won") {
      const enrollmentDate = payload.data.memberStartDate?.trim() || toEasternDate();
      const canonicalLead = await resolveSalesLeadId(leadId, "saveSalesLeadAction:closed-won");
      if (canonicalLead.memberId) {
        const { error: memberUpdateError } = await supabase
          .from("members")
          .update({
            display_name: payload.data.memberName.trim(),
            status: "active",
            enrollment_date: enrollmentDate,
            dob: payload.data.memberDob?.trim() || null,
            updated_at: toEasternISO()
          })
          .eq("id", canonicalLead.memberId);
        if (memberUpdateError) return { error: memberUpdateError.message };
      } else {
        const { error: memberInsertError } = await supabase.from("members").insert({
          display_name: payload.data.memberName.trim(),
          status: "active",
          enrollment_date: enrollmentDate,
          dob: payload.data.memberDob?.trim() || null,
          source_lead_id: leadId
        });
        if (memberInsertError) return { error: memberInsertError.message };
      }
    }

    const { error: auditInsertError } = await supabase.from("audit_logs").insert({
      actor_user_id: profile.id,
      actor_role: normalizeRoleKey(profile.role),
      action: "upsert_lead",
      entity_type: "lead",
      entity_id: leadId,
      details: {
        stage,
        status,
        leadSource: payload.data.leadSource
      }
    });
    if (auditInsertError) return { error: auditInsertError.message };

    revalidateSalesLeadViews(leadId);
    return { ok: true, id: leadId };}

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

      const supabase = await createClient();
    const profile = await getCurrentProfile();
    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .select("id, stage, status, member_name, member_dob, lead_source, member_start_date")
      .eq("id", canonicalLeadId)
      .maybeSingle();
    if (leadError) return { error: leadError.message };
    if (!lead) return { error: "Lead not found." };
    if (canonicalLeadStage(lead.stage) !== "Enrollment in Progress") {
      return { error: "Enroll Member is only available for leads in Enrollment in Progress." };
    }

    const enrollmentDate = lead.member_start_date?.trim() || toEasternDate();
    let memberId = canonicalMemberIdFromLead ?? "";
    if (memberId) {
      const { error: memberUpdateError } = await supabase
        .from("members")
        .update({
          display_name: lead.member_name,
          status: "active",
          enrollment_date: enrollmentDate,
          dob: lead.member_dob ?? null,
          updated_at: toEasternISO()
        })
        .eq("id", memberId);
      if (memberUpdateError) return { error: memberUpdateError.message };
    } else {
      const { data: insertedMember, error: memberInsertError } = await supabase
        .from("members")
        .insert({
          display_name: lead.member_name,
          status: "active",
          enrollment_date: enrollmentDate,
          dob: lead.member_dob ?? null,
          source_lead_id: lead.id
        })
        .select("id")
        .single();
      if (memberInsertError) return { error: memberInsertError.message };
      memberId = insertedMember.id;
    }

    try {
      await applyLeadStageTransitionSupabase({
        leadId: lead.id,
        requestedStage: "Closed - Won",
        requestedStatus: "Won",
        actorUserId: profile.id,
        actorName: profile.full_name,
        source: "enrollMemberFromLeadAction",
        reason: "Enrollment in progress lead converted to member.",
        additionalLeadPatch: {
          member_start_date: enrollmentDate
        }
      });
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Unable to transition lead to Closed - Won." };
    }

    const { error: auditInsertError } = await supabase.from("audit_logs").insert({
      actor_user_id: profile.id,
      actor_role: normalizeRoleKey(profile.role),
      action: "manager_review",
      entity_type: "lead",
      entity_id: lead.id,
      details: {
        operation: "enroll-member",
        convertedMemberId: memberId,
        convertedMemberName: lead.member_name
      }
    });
    if (auditInsertError) return { error: auditInsertError.message };

    revalidateSalesLeadViews(lead.id);
    revalidatePath("/members");
    revalidatePath(`/members/${memberId}`);
    revalidatePath("/operations/member-command-center");
    revalidatePath(`/operations/member-command-center/${memberId}`);
    revalidatePath("/health/member-health-profiles");
    revalidatePath(`/health/member-health-profiles/${memberId}`);
    return { ok: true, leadId: lead.id, memberId };}

const leadActivitySchema = z
  .object({
    leadId: z.string().min(1),
    activityAt: optionalString,
    activityType: z.enum(LEAD_ACTIVITY_TYPES),
    outcome: z.enum(LEAD_ACTIVITY_OUTCOMES),
    lostReason: z.enum(LEAD_LOST_REASON_OPTIONS).optional().or(z.literal("")),
    notes: optionalString,
    nextFollowUpDate: optionalString,
    nextFollowUpType: z.enum(LEAD_FOLLOW_UP_TYPES).optional().or(z.literal("")),
    partnerId: optionalString,
    referralSourceId: optionalString
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

export async function createSalesLeadActivityAction(raw: z.infer<typeof leadActivitySchema>) {
  await requireSalesRoles();
  const payload = leadActivitySchema.safeParse(raw);
  if (!payload.success) {
    return { error: "Invalid lead activity." };
  }

    let leadId = "";
    try {
      leadId = (await resolveSalesLeadId(payload.data.leadId, "createSalesLeadActivityAction")).leadId;
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Unable to resolve canonical lead identity." };
    }

      const supabase = await createClient();
    const profile = await getCurrentProfile();
    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .select("id, member_name, stage, status, partner_id, referral_source_id")
      .eq("id", leadId)
      .maybeSingle();
    if (leadError) return { error: leadError.message };
    if (!lead) return { error: "Lead not found." };

    const partnerId = payload.data.partnerId?.trim() || lead.partner_id || null;
    const referralSourceId = payload.data.referralSourceId?.trim() || lead.referral_source_id || null;
    const { error: insertError } = await supabase.from("lead_activities").insert({
      lead_id: leadId,
      member_name: lead.member_name,
      activity_at: payload.data.activityAt || toEasternISO(),
      activity_type: payload.data.activityType,
      outcome: payload.data.outcome,
      lost_reason: payload.data.lostReason || null,
      notes: payload.data.notes || null,
      next_follow_up_date: payload.data.nextFollowUpDate || null,
      next_follow_up_type: payload.data.nextFollowUpType || null,
      completed_by_user_id: profile.id,
      completed_by_name: profile.full_name,
      partner_id: partnerId,
      referral_source_id: referralSourceId
    });
    if (insertError) return { error: insertError.message };

    if (payload.data.outcome === "Not a fit") {
      try {
        await applyLeadStageTransitionSupabase({
          leadId: lead.id,
          requestedStage: "Closed - Lost",
          requestedStatus: "Lost",
          actorUserId: profile.id,
          actorName: profile.full_name,
          source: "createSalesLeadActivityAction",
          reason: "Lead activity outcome marked as Not a fit.",
          additionalLeadPatch: {
            lost_reason: payload.data.lostReason || null,
            next_follow_up_date: null,
            next_follow_up_type: null
          }
        });
      } catch (error) {
        return { error: error instanceof Error ? error.message : "Unable to transition lead to Closed - Lost." };
      }
    }

    if (payload.data.outcome === "Enrollment completed" || payload.data.outcome === "Member start confirmed") {
      try {
        await applyLeadStageTransitionSupabase({
          leadId: lead.id,
          requestedStage: "Closed - Won",
          requestedStatus: "Won",
          actorUserId: profile.id,
          actorName: profile.full_name,
          source: "createSalesLeadActivityAction",
          reason: `Lead activity outcome: ${payload.data.outcome}.`
        });
      } catch (error) {
        return { error: error instanceof Error ? error.message : "Unable to transition lead to Closed - Won." };
      }
    }

    await supabase.from("audit_logs").insert({
      actor_user_id: profile.id,
      actor_role: normalizeRoleKey(profile.role),
      action: "create_log",
      entity_type: "lead_activity",
      entity_id: leadId,
      details: {
        activityType: payload.data.activityType,
        outcome: payload.data.outcome
      }
    });

    revalidatePath("/sales/activities");
    revalidatePath("/sales/new-entries/log-lead-activity");
    revalidatePath(`/sales/leads/${lead.id}`);
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

      const supabase = await createClient();
    const profile = await getCurrentProfile();
    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .select("id, member_name, next_follow_up_date, next_follow_up_type, partner_id, referral_source_id")
      .eq("id", leadId)
      .maybeSingle();
    if (leadError) return { error: leadError.message };
    if (!lead) return { error: "Lead not found." };

    const isCall = payload.data.channel === "call";
    const { data: created, error: insertError } = await supabase
      .from("lead_activities")
      .insert({
        lead_id: leadId,
        member_name: lead.member_name,
        activity_at: toEasternISO(),
        activity_type: isCall ? "Call" : "Email",
        outcome: isCall ? "No answer" : "Sent info/packet",
        lost_reason: null,
        notes: isCall
          ? "Quick Call action launched from lead detail. Add call notes after completion."
          : "Quick Email action launched from lead detail. Add message notes after sending.",
        next_follow_up_date: lead.next_follow_up_date ?? null,
        next_follow_up_type: lead.next_follow_up_type ?? null,
        completed_by_user_id: profile.id,
        completed_by_name: profile.full_name,
        partner_id: lead.partner_id ?? null,
        referral_source_id: lead.referral_source_id ?? null
      })
      .select("id")
      .single();
    if (insertError) return { error: insertError.message };

    revalidatePath("/sales/activities");
    revalidatePath("/sales/new-entries/log-lead-activity");
    revalidatePath("/sales/pipeline/follow-up-dashboard");
    revalidatePath(`/sales/leads/${lead.id}`);

    return { ok: true, id: created.id };}

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

      const supabase = await createClient();
    const profile = await getCurrentProfile();

    const [{ data: partner, error: partnerError }, { data: source, error: sourceError }] = await Promise.all([
      supabase
        .from("community_partner_organizations")
        .select("id, partner_id, organization_name")
        .or(`id.eq.${payload.data.partnerId},partner_id.eq.${payload.data.partnerId}`)
        .maybeSingle(),
      supabase
        .from("referral_sources")
        .select("id, partner_id, contact_name, referral_source_id")
        .or(`id.eq.${payload.data.referralSourceId},referral_source_id.eq.${payload.data.referralSourceId}`)
        .maybeSingle()
    ]);
    if (partnerError) return { error: partnerError.message };
    if (sourceError) return { error: sourceError.message };
    if (!partner) return { error: "Community partner organization not found." };
    if (!source) return { error: "Referral source not found." };
    if (source.partner_id !== partner.id) {
      return { error: "Referral source must belong to the selected organization." };
    }

    const { error: insertError } = await supabase.from("partner_activities").insert({
      referral_source_id: source.id,
      partner_id: partner.id,
      organization_name: partner.organization_name,
      contact_name: source.contact_name,
      activity_at: payload.data.activityAt || toEasternISO(),
      activity_type: payload.data.activityType,
      notes: payload.data.notes || null,
      completed_by_name: profile.full_name,
      next_follow_up_date: payload.data.nextFollowUpDate || null,
      next_follow_up_type: payload.data.nextFollowUpType || null,
      last_touched: toEasternDate()
    });
    if (insertError) return { error: insertError.message };

    await Promise.all([
      supabase.from("community_partner_organizations").update({ last_touched: toEasternDate() }).eq("id", partner.id),
      supabase.from("referral_sources").update({ last_touched: toEasternDate() }).eq("id", source.id)
    ]);

    revalidatePath("/sales/community-partners");
    revalidatePath("/sales/new-entries/log-partner-activities");
    revalidatePath("/sales/activities");
    revalidatePath(`/sales/community-partners/organizations/${partner.id}`);
    revalidatePath(`/sales/community-partners/referral-sources/${source.id}`);
    return { ok: true };}

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

  const supabase = await createClient();
  const partnerCode = makeShortId("P").toUpperCase();
  const { data: partner, error } = await supabase
    .from("community_partner_organizations")
    .insert({
      partner_id: partnerCode,
      organization_name: payload.data.organizationName.trim(),
      category: payload.data.referralSourceCategory.trim(),
      location: payload.data.location?.trim() || null,
      primary_phone: payload.data.primaryPhone?.trim() || null,
      secondary_phone: payload.data.secondaryPhone?.trim() || null,
      primary_email: payload.data.primaryEmail?.trim() || null,
      active: payload.data.active,
      notes: payload.data.notes?.trim() || null,
      last_touched: null
    })
    .select("id, partner_id, organization_name")
    .single();
  if (error) return { error: error.message };

  revalidatePath("/sales/community-partners/organizations");
  revalidatePath("/sales/new-entries/new-community-partner");
  return {
    ok: true,
    id: partner.id,
    partner
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

  const supabase = await createClient();
  const { data: partner, error: partnerError } = await supabase
    .from("community_partner_organizations")
    .select("id, partner_id, organization_name")
    .or(`id.eq.${payload.data.partnerId},partner_id.eq.${payload.data.partnerId}`)
    .maybeSingle();
  if (partnerError) return { error: partnerError.message };
  if (!partner) return { error: "Select a valid organization first." };

  const sourceCode = makeShortId("RS").toUpperCase();
  const { data: source, error: insertError } = await supabase
    .from("referral_sources")
    .insert({
      referral_source_id: sourceCode,
      partner_id: partner.id,
      contact_name: payload.data.contactName.trim(),
      organization_name: partner.organization_name,
      job_title: payload.data.jobTitle?.trim() || null,
      primary_phone: payload.data.primaryPhone?.trim() || null,
      secondary_phone: payload.data.secondaryPhone?.trim() || null,
      primary_email: payload.data.primaryEmail?.trim() || null,
      preferred_contact_method: payload.data.preferredContactMethod?.trim() || null,
      active: payload.data.active,
      notes: payload.data.notes?.trim() || null,
      last_touched: toEasternDate()
    })
    .select("id, referral_source_id, partner_id, contact_name, organization_name")
    .single();
  if (insertError) return { error: insertError.message };

  await supabase
    .from("community_partner_organizations")
    .update({ last_touched: toEasternDate() })
    .eq("id", partner.id);

  revalidatePath("/sales/community-partners/referral-sources");
  revalidatePath("/sales/new-entries/new-referral-source");
  return {
    ok: true,
    id: source.id,
    source: {
      ...source,
      partner_id: partner.partner_id ?? source.partner_id
    }
  };
}

export async function getSalesFormLookups() {
  await requireSalesRoles();
  const supabase = await createClient();
  const [{ data: leads }, { data: partners }, { data: referralSources }] = await Promise.all([
    supabase
      .from("leads")
      .select("id, member_name, caregiver_name, stage, status, created_at, partner_id, referral_source_id")
      .order("created_at", { ascending: false }),
    supabase
      .from("community_partner_organizations")
      .select("id, partner_id, organization_name, category, active, last_touched")
      .order("organization_name", { ascending: true }),
    supabase
      .from("referral_sources")
      .select("id, referral_source_id, partner_id, contact_name, organization_name, active, last_touched")
      .order("organization_name", { ascending: true })
  ]);
  const partnerById = new Map((partners ?? []).map((partner: any) => [partner.id, partner]));
  const normalizedReferralSources = (referralSources ?? []).map((source: any) => ({
    ...source,
    partner_id: partnerById.get(source.partner_id)?.partner_id ?? source.partner_id
  }));
  return {
    leads: leads ?? [],
    partners: partners ?? [],
    referralSources: normalizedReferralSources
  };
}

const enrollmentPacketSendSchema = z.object({
  leadId: optionalString,
  memberId: optionalString,
  caregiverEmail: optionalString,
  requestedDays: z.array(z.string().min(1)).min(1),
  transportation: optionalString,
  communityFee: z.number().min(0),
  dailyRate: z.number().min(0),
  optionalMessage: optionalString
});

export async function sendEnrollmentPacketAction(raw: z.infer<typeof enrollmentPacketSendSchema>) {
  await requireSalesRoles();
  const payload = enrollmentPacketSendSchema.safeParse(raw);
  if (!payload.success) {
    return { ok: false, error: "Invalid enrollment packet request." } as const;
  }

  try {
    const canonical = await resolveCanonicalPersonRef(
      {
        sourceType: payload.data.leadId?.trim() ? "lead" : "member",
        leadId: payload.data.leadId?.trim() || null,
        memberId: payload.data.memberId?.trim() || null,
        selectedId: payload.data.memberId?.trim() || payload.data.leadId?.trim() || null
      },
      {
        expectedType: "member",
        actionLabel: "sendEnrollmentPacketAction"
      }
    );
    if (!canonical.memberId) {
      return { ok: false, error: "sendEnrollmentPacketAction expected member.id but canonical member resolution returned empty memberId." } as const;
    }

    const profile = await getCurrentProfile();
    const sent = await sendEnrollmentPacketRequest({
      leadId: canonical.leadId,
      memberId: canonical.memberId,
      senderUserId: profile.id,
      senderFullName: profile.full_name,
      caregiverEmail: payload.data.caregiverEmail || null,
      requestedDays: payload.data.requestedDays.map((day) => day.trim()).filter(Boolean),
      transportation: payload.data.transportation || null,
      communityFee: payload.data.communityFee,
      dailyRate: payload.data.dailyRate,
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










