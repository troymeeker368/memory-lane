"use server";

import { revalidatePath } from "next/cache";
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
import { addAuditLogEvent, addLeadStageHistoryEntry, addMockRecord, getMockDb, updateMockRecord, upsertMemberFromLead } from "@/lib/mock-repo";
import { normalizeRoleKey } from "@/lib/permissions";
import { findLikelyLeadDuplicates } from "@/lib/services/lead-duplicates";
import { ensureMemberCommandCenterProfile, prefillMemberCommandCenterFromAssessment } from "@/lib/services/member-command-center";
import { ensureMemberHealthProfile, prefillMemberHealthProfileFromAssessment } from "@/lib/services/member-health-profiles";
import { syncCommandCenterToMhp, syncMhpToCommandCenter } from "@/lib/services/member-profile-sync";
import { isMockMode } from "@/lib/runtime";
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

function resolveLostReason(lostReason?: string, lostReasonOther?: string) {
  const reason = (lostReason ?? "").trim();
  if (!reason) return null;
  if (reason === "Other") {
    const other = (lostReasonOther ?? "").trim();
    return other || null;
  }
  return reason;
}

function findPartner(db: ReturnType<typeof getMockDb>, partnerId?: string | null) {
  if (!partnerId) return null;
  return db.partners.find((partner) => partner.id === partnerId || partner.partner_id === partnerId) ?? null;
}

function findReferralSource(db: ReturnType<typeof getMockDb>, referralSourceId?: string | null) {
  if (!referralSourceId) return null;
  return db.referralSources.find((source) => source.id === referralSourceId || source.referral_source_id === referralSourceId) ?? null;
}

function touchPartnerAndSource(
  db: ReturnType<typeof getMockDb>,
  partner: ReturnType<typeof findPartner>,
  source: ReturnType<typeof findReferralSource>
) {
  const today = toEasternDate();
  if (partner) {
    updateMockRecord("partners", partner.id, { last_touched: today });
  }
  if (source) {
    updateMockRecord("referralSources", source.id, { last_touched: today });
  }
}

function syncLeadEnrollmentToMembers(lead: ReturnType<typeof getMockDb>["leads"][number]) {
  const shouldConvert = canonicalLeadStatus(lead.status, lead.stage) === "Won";
  if (!shouldConvert) return;

  const member = upsertMemberFromLead(lead.member_name, {
    stage: lead.stage,
    status: lead.status,
    enrollmentDate: lead.member_start_date ?? lead.closed_date ?? toEasternDate(),
    leadId: lead.id
  });

  if (member) {
    revalidatePath("/members");
    revalidatePath(`/members/${member.id}`);
  }
}

interface SalesLeadPatch {
  stage: string;
  status: (typeof LEAD_STATUS_OPTIONS)[number];
  stage_updated_at: string;
  inquiry_date: string;
  tour_date: string | null;
  tour_completed: boolean;
  discovery_date: string | null;
  member_start_date: string | null;
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
  notes_summary: string | null;
  lost_reason: string | null;
  closed_date: string | null;
}

function chooseIfEmpty(current: string | null | undefined, next: string | null | undefined) {
  const normalizedCurrent = (current ?? "").trim();
  if (normalizedCurrent.length > 0) return current ?? null;
  const normalizedNext = (next ?? "").trim();
  return normalizedNext.length > 0 ? next ?? null : null;
}

function earliestDate(current: string | null | undefined, incoming: string | null | undefined) {
  if (!current) return incoming ?? null;
  if (!incoming) return current ?? null;
  return current <= incoming ? current : incoming;
}

function mergeLeadPatch(
  target: ReturnType<typeof getMockDb>["leads"][number],
  incoming: SalesLeadPatch,
  sourceLeadDisplayId: string | null
) {
  const mergeNote = sourceLeadDisplayId
    ? `Merged duplicate lead ${sourceLeadDisplayId} on ${toEasternDate()}.`
    : `Merged duplicate inquiry on ${toEasternDate()}.`;

  return {
    stage: target.stage,
    status: target.status,
    stage_updated_at: toEasternISO(),
    inquiry_date: earliestDate(target.inquiry_date, incoming.inquiry_date) ?? target.inquiry_date,
    tour_date: earliestDate(target.tour_date, incoming.tour_date),
    tour_completed: target.tour_completed || incoming.tour_completed,
    discovery_date: earliestDate(target.discovery_date, incoming.discovery_date),
    member_start_date: earliestDate(target.member_start_date, incoming.member_start_date),
    caregiver_name: chooseIfEmpty(target.caregiver_name, incoming.caregiver_name) ?? target.caregiver_name,
    caregiver_relationship: chooseIfEmpty(target.caregiver_relationship, incoming.caregiver_relationship),
    caregiver_email: chooseIfEmpty(target.caregiver_email, incoming.caregiver_email),
    caregiver_phone: chooseIfEmpty(target.caregiver_phone, incoming.caregiver_phone) ?? target.caregiver_phone,
    member_name: chooseIfEmpty(target.member_name, incoming.member_name) ?? target.member_name,
    member_dob: chooseIfEmpty(target.member_dob, incoming.member_dob),
    lead_source: chooseIfEmpty(target.lead_source, incoming.lead_source) ?? target.lead_source,
    lead_source_other: chooseIfEmpty(target.lead_source_other, incoming.lead_source_other),
    partner_id: chooseIfEmpty(target.partner_id, incoming.partner_id),
    referral_source_id: chooseIfEmpty(target.referral_source_id, incoming.referral_source_id),
    referral_name: chooseIfEmpty(target.referral_name, incoming.referral_name),
    likelihood: chooseIfEmpty(target.likelihood, incoming.likelihood),
    next_follow_up_date: chooseIfEmpty(target.next_follow_up_date, incoming.next_follow_up_date),
    next_follow_up_type: chooseIfEmpty(target.next_follow_up_type, incoming.next_follow_up_type),
    notes_summary: appendUniqueNote(target.notes_summary, mergeNote),
    lost_reason: target.lost_reason,
    closed_date: target.closed_date
  } satisfies SalesLeadPatch;
}

function copyLeadHistoryToTarget(input: {
  db: ReturnType<typeof getMockDb>;
  sourceLead: ReturnType<typeof getMockDb>["leads"][number];
  targetLead: ReturnType<typeof getMockDb>["leads"][number];
}) {
  const sourceActivities = input.db.leadActivities.filter((row) => row.lead_id === input.sourceLead.id);
  sourceActivities.forEach((activity) => {
    addMockRecord("leadActivities", {
      activity_id: `${activity.activity_id}-MERGED`,
      lead_id: input.targetLead.id,
      member_name: input.targetLead.member_name,
      activity_at: activity.activity_at,
      activity_type: activity.activity_type,
      outcome: activity.outcome,
      lost_reason: activity.lost_reason,
      notes: appendUniqueNote(
        activity.notes,
        `Merged from ${input.sourceLead.lead_id} on ${toEasternDate()}.`
      ),
      next_follow_up_date: activity.next_follow_up_date,
      next_follow_up_type: activity.next_follow_up_type,
      completed_by_user_id: activity.completed_by_user_id,
      completed_by_name: activity.completed_by_name,
      partner_id: activity.partner_id ?? null,
      referral_source_id: activity.referral_source_id ?? null
    });
  });

  const sourceStageHistory = input.db.leadStageHistory.filter((row) => row.lead_id === input.sourceLead.id);
  sourceStageHistory.forEach((history) => {
    addLeadStageHistoryEntry({
      leadId: input.targetLead.id,
      fromStage: history.from_stage,
      toStage: history.to_stage,
      fromStatus: history.from_status,
      toStatus: history.to_status,
      changedByUserId: history.changed_by_user_id,
      changedByName: history.changed_by_name,
      reason: appendUniqueNote(history.reason, `Merged history copied from ${input.sourceLead.lead_id}.`),
      source: "merge-copy",
      changedAt: history.changed_at
    });
  });
}

function closeMergedSourceLead(input: {
  sourceLead: ReturnType<typeof getMockDb>["leads"][number];
  targetLead: ReturnType<typeof getMockDb>["leads"][number];
  actor: { id: string; fullName: string; role: Parameters<typeof addAuditLogEvent>[0]["actorRole"] };
}) {
  const beforeStage = input.sourceLead.stage;
  const beforeStatus = input.sourceLead.status;
  const now = toEasternISO();
  const mergedNote = appendUniqueNote(
    input.sourceLead.notes_summary,
    `Merged into ${input.targetLead.lead_id} on ${toEasternDate()}.`
  );

  updateMockRecord("leads", input.sourceLead.id, {
    stage: "Closed - Lost",
    status: "Lost",
    stage_updated_at: now,
    lost_reason: `Merged into ${input.targetLead.lead_id}`,
    closed_date: toEasternDate(),
    next_follow_up_date: null,
    next_follow_up_type: null,
    notes_summary: mergedNote
  });

  addLeadStageHistoryEntry({
    leadId: input.sourceLead.id,
    fromStage: beforeStage,
    toStage: "Closed - Lost",
    fromStatus: beforeStatus,
    toStatus: "Lost",
    changedByUserId: input.actor.id,
    changedByName: input.actor.fullName,
    reason: `Merged into ${input.targetLead.lead_id}`,
    source: "merge-lead"
  });

  addAuditLogEvent({
    actorUserId: input.actor.id,
    actorName: input.actor.fullName,
    actorRole: input.actor.role,
    action: "update_lead",
    entityType: "lead",
    entityId: input.sourceLead.id,
    details: {
      operation: "merge-source-closed",
      mergedIntoLeadId: input.targetLead.id
    }
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

  if (!isMockMode()) {
    // TODO(backend): Wire Sales lead save action to Supabase leads table.
    return { error: "Sales lead backend integration pending." };
  }

  const db = getMockDb();
  const profile = await getCurrentProfile();
  let stage = canonicalLeadStage(payload.data.stage);
  let status = canonicalLeadStatus(payload.data.status, stage);
  if (stage === "Closed - Lost") status = "Lost";
  if (status === "Lost") stage = "Closed - Lost";
  if (status === "Won") stage = "Closed - Won";
  if (status === "Nurture" && stage !== "Nurture") stage = "Nurture";
  status = canonicalLeadStatus(status, stage);
  const isLostStatus = status === "Lost";
  const isEipStage = stage === "Enrollment in Progress";
  const resolvedLostReason = isLostStatus ? resolveLostReason(payload.data.lostReason, payload.data.lostReasonOther) : null;

  const selectedReferralSource = findReferralSource(db, payload.data.referralSourceId?.trim() || null);
  const selectedPartner = findPartner(db, payload.data.partnerId?.trim() || null);

  if (payload.data.leadSource === "Referral" && selectedPartner && selectedReferralSource && selectedReferralSource.partner_id !== selectedPartner.partner_id) {
    return { error: "Referral Source must belong to the selected Community Partner Organization." };
  }

  const resolvedPartnerId = selectedPartner?.partner_id ?? selectedReferralSource?.partner_id ?? null;
  const resolvedReferralSourceId = selectedReferralSource?.referral_source_id ?? null;
  const resolvedReferralName = payload.data.referralName?.trim() || selectedReferralSource?.contact_name || null;

  const commonPatch: SalesLeadPatch = {
    stage,
    status,
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
    closed_date: isLostStatus ? payload.data.closedDate?.trim() || toEasternDate() : status === "Won" ? toEasternDate() : null
  };

  if (!payload.data.skipDuplicateReview) {
    const duplicateMatches = findLikelyLeadDuplicates(db, {
      leadId: payload.data.leadId?.trim() || null,
      memberName: commonPatch.member_name,
      caregiverName: commonPatch.caregiver_name,
      caregiverPhone: commonPatch.caregiver_phone,
      caregiverEmail: commonPatch.caregiver_email,
      memberDob: commonPatch.member_dob
    });
    const duplicateDecision = payload.data.duplicateDecision?.trim() || "";
    const canKeepSeparate = canKeepDuplicateAsSeparate(profile.role);

    if (duplicateMatches.length > 0) {
      if (duplicateDecision !== "keep-separate" && duplicateDecision !== "merge") {
        return {
          error: "Potential duplicate leads found. Review matches before saving.",
          duplicateRequiresDecision: true,
          duplicateMatches,
          canKeepSeparate
        };
      }

      if (duplicateDecision === "keep-separate" && !canKeepSeparate) {
        return {
          error: "Only Admin, Manager, or Director can keep possible duplicates as separate leads.",
          duplicateRequiresDecision: true,
          duplicateMatches,
          canKeepSeparate
        };
      }

      if (duplicateDecision === "merge") {
        const mergeTargetLeadId = payload.data.mergeTargetLeadId?.trim() || duplicateMatches[0]?.leadId || "";
        const targetLead = db.leads.find((row) => row.id === mergeTargetLeadId) ?? null;
        if (!targetLead) {
          return {
            error: "Select a valid lead to merge into.",
            duplicateRequiresDecision: true,
            duplicateMatches,
            canKeepSeparate
          };
        }

        if (payload.data.leadId?.trim() && payload.data.leadId.trim() === targetLead.id) {
          return {
            error: "Cannot merge a lead into itself.",
            duplicateRequiresDecision: true,
            duplicateMatches,
            canKeepSeparate
          };
        }

        const sourceLead = payload.data.leadId?.trim()
          ? db.leads.find((row) => row.id === payload.data.leadId?.trim()) ?? null
          : null;

        const mergedPatch = mergeLeadPatch(targetLead, commonPatch, sourceLead?.lead_id ?? null);
        const mergedTarget = updateMockRecord("leads", targetLead.id, mergedPatch);
        if (!mergedTarget) {
          return { error: "Unable to merge into selected lead." };
        }

        if (payload.data.leadSource === "Referral") {
          touchPartnerAndSource(db, selectedPartner, selectedReferralSource);
        }

        if (sourceLead && sourceLead.id !== mergedTarget.id) {
          copyLeadHistoryToTarget({
            db,
            sourceLead,
            targetLead: mergedTarget
          });
          closeMergedSourceLead({
            sourceLead,
            targetLead: mergedTarget,
            actor: {
              id: profile.id,
              fullName: profile.full_name,
              role: profile.role
            }
          });
        }

        addAuditLogEvent({
          actorUserId: profile.id,
          actorName: profile.full_name,
          actorRole: profile.role,
          action: "update_lead",
          entityType: "lead",
          entityId: mergedTarget.id,
          details: {
            operation: "merge-duplicate",
            mergedSourceLeadId: sourceLead?.id ?? null,
            mergedSourceLeadDisplayId: sourceLead?.lead_id ?? null
          }
        });

        revalidateSalesLeadViews(mergedTarget.id);
        if (sourceLead) {
          revalidateSalesLeadViews(sourceLead.id);
        }
        revalidatePath("/sales/new-entries/new-inquiry");
        return {
          ok: true,
          id: mergedTarget.id,
          merged: true,
          mergedIntoLeadId: mergedTarget.id,
          mergedSourceLeadId: sourceLead?.id ?? null
        };
      }
    }
  }

  if (payload.data.leadId) {
    const existingLead = db.leads.find((row) => row.id === payload.data.leadId) ?? null;
    const updated = updateMockRecord("leads", payload.data.leadId, commonPatch);
    if (!updated) {
      console.error("[Sales] saveSalesLeadAction update failed", { leadId: payload.data.leadId });
      return { error: "Lead not found." };
    }

    if (payload.data.leadSource === "Referral") {
      touchPartnerAndSource(db, selectedPartner, selectedReferralSource);
    }

    syncLeadEnrollmentToMembers(updated);

    if (existingLead && (existingLead.stage !== updated.stage || existingLead.status !== updated.status)) {
      addLeadStageHistoryEntry({
        leadId: updated.id,
        fromStage: existingLead.stage,
        toStage: updated.stage,
        fromStatus: existingLead.status,
        toStatus: updated.status,
        changedByUserId: profile.id,
        changedByName: profile.full_name,
        reason: "Lead updated",
        source: "saveSalesLeadAction"
      });
    }
    addAuditLogEvent({
      actorUserId: profile.id,
      actorName: profile.full_name,
      actorRole: profile.role,
      action: "update_lead",
      entityType: "lead",
      entityId: updated.id,
      details: {
        stage: updated.stage,
        status: updated.status
      }
    });

    revalidateSalesLeadViews(payload.data.leadId);
    return { ok: true, id: payload.data.leadId };
  }

  const created = addMockRecord("leads", {
    lead_id: `L-${Date.now().toString().slice(-8)}`,
    created_at: toEasternISO(),
    created_by_user_id: profile.id,
    created_by_name: profile.full_name,
    ...commonPatch
  });

  if (payload.data.leadSource === "Referral") {
    touchPartnerAndSource(db, selectedPartner, selectedReferralSource);
  }

  syncLeadEnrollmentToMembers(created);
  addLeadStageHistoryEntry({
    leadId: created.id,
    fromStage: null,
    toStage: created.stage,
    fromStatus: null,
    toStatus: created.status,
    changedByUserId: profile.id,
    changedByName: profile.full_name,
    reason: "Lead created",
    source: "saveSalesLeadAction",
    changedAt: created.created_at
  });
  addAuditLogEvent({
    actorUserId: profile.id,
    actorName: profile.full_name,
    actorRole: profile.role,
    action: "create_lead",
    entityType: "lead",
    entityId: created.id,
    details: {
      stage: created.stage,
      status: created.status
    }
  });

  revalidateSalesLeadViews(created.id);
  revalidatePath("/sales/new-entries/new-inquiry");
  return { ok: true, id: created.id };
}

function appendUniqueNote(existing: string | null | undefined, entry: string) {
  const normalizedExisting = (existing ?? "").trim();
  if (!normalizedExisting) return entry;
  if (normalizedExisting.toLowerCase().includes(entry.toLowerCase())) return normalizedExisting;
  return `${normalizedExisting}\n\n${entry}`;
}

function canKeepDuplicateAsSeparate(role: string) {
  const normalized = normalizeRoleKey(role);
  return normalized === "admin" || normalized === "manager" || normalized === "director";
}

const enrollLeadSchema = z.object({
  leadId: z.string().min(1)
});

function ensureLeadCaregiverContact(input: {
  db: ReturnType<typeof getMockDb>;
  memberId: string;
  lead: ReturnType<typeof getMockDb>["leads"][number];
  actor: { id: string; fullName: string };
  now: string;
}) {
  const targetPhone = normalizePhoneDigits(input.lead.caregiver_phone);
  const existing = input.db.memberContacts.find((contact) => {
    if (contact.member_id !== input.memberId) return false;
    const sameName = normalizeText(contact.contact_name) === normalizeText(input.lead.caregiver_name);
    const contactPhone = normalizePhoneDigits(
      contact.cellular_number ?? contact.work_number ?? contact.home_number
    );
    return sameName && targetPhone.length > 0 && contactPhone === targetPhone;
  });

  if (existing) return existing;

  return addMockRecord("memberContacts", {
    member_id: input.memberId,
    contact_name: input.lead.caregiver_name,
    relationship_to_member: input.lead.caregiver_relationship ?? "Responsible Party",
    category: "Responsible Party",
    category_other: null,
    email: input.lead.caregiver_email ?? null,
    cellular_number: input.lead.caregiver_phone ?? null,
    work_number: null,
    home_number: null,
    street_address: null,
    city: null,
    state: null,
    zip: null,
    created_by_user_id: input.actor.id,
    created_by_name: input.actor.fullName,
    created_at: input.now,
    updated_at: input.now
  });
}

export async function enrollMemberFromLeadAction(raw: z.infer<typeof enrollLeadSchema>) {
  await requireSalesRoles();
  const payload = enrollLeadSchema.safeParse(raw);
  if (!payload.success) {
    return { error: "Invalid lead conversion request." };
  }

  if (!isMockMode()) {
    // TODO(backend): Convert lead to member in one transaction once backend is connected.
    return { error: "Lead enrollment backend integration pending." };
  }

  const db = getMockDb();
  const profile = await getCurrentProfile();
  const lead = db.leads.find((row) => row.id === payload.data.leadId) ?? null;
  if (!lead) {
    return { error: "Lead not found." };
  }

  const canonicalStage = canonicalLeadStage(lead.stage);
  if (canonicalStage !== "Enrollment in Progress") {
    return { error: "Enroll Member is only available for leads in Enrollment in Progress." };
  }

  const now = toEasternISO();
  const enrollmentDate = lead.member_start_date?.trim() || toEasternDate();
  const member =
    upsertMemberFromLead(lead.member_name, {
      leadId: lead.id,
      stage: "Enrollment in Progress",
      status: "Won",
      enrollmentDate
    }) ?? null;

  if (!member) {
    return { error: "Unable to create or locate member record for this lead." };
  }

  updateMockRecord("members", member.id, {
    status: "active",
    enrollment_date: member.enrollment_date ?? enrollmentDate,
    dob: member.dob ?? lead.member_dob ?? null
  });

  const commandCenter = ensureMemberCommandCenterProfile(member.id);
  updateMockRecord("memberCommandCenters", commandCenter.id, {
    original_referral_source: commandCenter.original_referral_source ?? lead.lead_source,
    updated_by_user_id: profile.id,
    updated_by_name: profile.full_name,
    updated_at: now
  });

  const healthProfile = ensureMemberHealthProfile(member.id);
  updateMockRecord("memberHealthProfiles", healthProfile.id, {
    original_referral_source: healthProfile.original_referral_source ?? lead.lead_source,
    updated_by_user_id: profile.id,
    updated_by_name: profile.full_name,
    updated_at: now
  });

  const latestAssessment = [...db.assessments]
    .filter((assessment) => assessment.lead_id === lead.id)
    .sort((left, right) => (left.created_at < right.created_at ? 1 : -1))[0];
  if (latestAssessment) {
    prefillMemberHealthProfileFromAssessment({
      memberId: member.id,
      assessment: latestAssessment,
      actor: { id: profile.id, fullName: profile.full_name }
    });
    prefillMemberCommandCenterFromAssessment({
      memberId: member.id,
      assessment: latestAssessment,
      actor: { id: profile.id, fullName: profile.full_name }
    });
  }

  ensureLeadCaregiverContact({
    db,
    memberId: member.id,
    lead,
    actor: { id: profile.id, fullName: profile.full_name },
    now
  });

  syncMhpToCommandCenter(member.id, { id: profile.id, fullName: profile.full_name }, now);
  syncCommandCenterToMhp(
    member.id,
    { id: profile.id, fullName: profile.full_name },
    now,
    { syncAllergies: true }
  );

  const beforeStage = lead.stage;
  const beforeStatus = lead.status;
  const convertedLead = updateMockRecord("leads", lead.id, {
    stage: "Closed - Won",
    status: "Won",
    stage_updated_at: now,
    member_start_date: enrollmentDate,
    closed_date: toEasternDate(),
    lost_reason: null,
    notes_summary: appendUniqueNote(
      lead.notes_summary,
      `Converted to active member ${member.display_name} on ${toEasternDate()}.`
    )
  });

  if (!convertedLead) {
    return { error: "Lead conversion failed while updating lead status." };
  }

  if (beforeStage !== convertedLead.stage || beforeStatus !== convertedLead.status) {
    addLeadStageHistoryEntry({
      leadId: convertedLead.id,
      fromStage: beforeStage,
      toStage: convertedLead.stage,
      fromStatus: beforeStatus,
      toStatus: convertedLead.status,
      changedByUserId: profile.id,
      changedByName: profile.full_name,
      reason: "Converted to active member",
      source: "enrollMemberFromLeadAction"
    });
  }

  addAuditLogEvent({
    actorUserId: profile.id,
    actorName: profile.full_name,
    actorRole: profile.role,
    action: "manager_review",
    entityType: "lead",
    entityId: convertedLead.id,
    details: {
      operation: "enroll-member",
      convertedMemberId: member.id,
      convertedMemberName: member.display_name
    }
  });

  revalidateSalesLeadViews(lead.id);
  revalidatePath("/members");
  revalidatePath(`/members/${member.id}`);
  revalidatePath("/operations/member-command-center");
  revalidatePath(`/operations/member-command-center/${member.id}`);
  revalidatePath("/health/member-health-profiles");
  revalidatePath(`/health/member-health-profiles/${member.id}`);

  return {
    ok: true,
    leadId: convertedLead.id,
    memberId: member.id
  };
}

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

  if (!isMockMode()) {
    // TODO(backend): Wire to lead_activities table.
    return { error: "Lead activity backend integration pending." };
  }

  const profile = await getCurrentProfile();
  const db = getMockDb();
  const lead = db.leads.find((row) => row.id === payload.data.leadId);

  if (!lead) {
    return { error: "Lead not found." };
  }

  const selectedReferralSource = findReferralSource(db, payload.data.referralSourceId?.trim() || null);
  const selectedPartner = findPartner(db, payload.data.partnerId?.trim() || null);

  const partnerId = selectedPartner?.partner_id ?? selectedReferralSource?.partner_id ?? lead.partner_id ?? null;
  const referralSourceId = selectedReferralSource?.referral_source_id ?? lead.referral_source_id ?? null;

  addMockRecord("leadActivities", {
    activity_id: makeShortId("LA"),
    lead_id: payload.data.leadId,
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

  if (payload.data.outcome === "Not a fit") {
    updateMockRecord("leads", lead.id, {
      status: "Lost",
      stage: "Closed - Lost",
      stage_updated_at: toEasternISO(),
      closed_date: toEasternDate(),
      lost_reason: payload.data.lostReason || null,
      next_follow_up_date: null,
      next_follow_up_type: null
    });
    addLeadStageHistoryEntry({
      leadId: lead.id,
      fromStage: lead.stage,
      toStage: "Closed - Lost",
      fromStatus: lead.status,
      toStatus: "Lost",
      changedByUserId: profile.id,
      changedByName: profile.full_name,
      reason: payload.data.lostReason || "Not a fit",
      source: "createSalesLeadActivityAction"
    });
  }

  if (payload.data.outcome === "Enrollment completed" || payload.data.outcome === "Member start confirmed") {
    const wonLead = updateMockRecord("leads", lead.id, {
      status: "Won",
      stage: "Closed - Won",
      stage_updated_at: toEasternISO(),
      closed_date: toEasternDate(),
      lost_reason: null
    });

    if (wonLead) {
      syncLeadEnrollmentToMembers(wonLead);
      addLeadStageHistoryEntry({
        leadId: wonLead.id,
        fromStage: lead.stage,
        toStage: "Closed - Won",
        fromStatus: lead.status,
        toStatus: "Won",
        changedByUserId: profile.id,
        changedByName: profile.full_name,
        reason: payload.data.outcome,
        source: "createSalesLeadActivityAction"
      });
    }
  }

  addAuditLogEvent({
    actorUserId: profile.id,
    actorName: profile.full_name,
    actorRole: profile.role,
    action: "create_log",
    entityType: "lead_activity",
    entityId: payload.data.leadId,
    details: {
      activityType: payload.data.activityType,
      outcome: payload.data.outcome
    }
  });

  touchPartnerAndSource(db, selectedPartner, selectedReferralSource);

  revalidatePath("/sales/activities");
  revalidatePath("/sales/new-entries/log-lead-activity");
  revalidatePath(`/sales/leads/${lead.id}`);
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

  if (!isMockMode()) {
    // TODO(backend): Wire quick call/email action logs to lead_activities table.
    return { error: "Quick contact backend integration pending." };
  }

  const profile = await getCurrentProfile();
  const db = getMockDb();
  const lead = db.leads.find((row) => row.id === payload.data.leadId);

  if (!lead) {
    return { error: "Lead not found." };
  }

  const isCall = payload.data.channel === "call";
  const created = addMockRecord("leadActivities", {
    activity_id: makeShortId("LA"),
    lead_id: payload.data.leadId,
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
  });

  revalidatePath("/sales/activities");
  revalidatePath("/sales/new-entries/log-lead-activity");
  revalidatePath("/sales/pipeline/follow-up-dashboard");
  revalidatePath(`/sales/leads/${lead.id}`);

  return { ok: true, id: created.id };
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

  if (!isMockMode()) {
    // TODO(backend): Wire to partner_activities table.
    return { error: "Partner activity backend integration pending." };
  }

  const db = getMockDb();
  const profile = await getCurrentProfile();

  const partner = findPartner(db, payload.data.partnerId);
  const source = findReferralSource(db, payload.data.referralSourceId);

  if (!partner) {
    return { error: "Community partner organization not found." };
  }

  if (!source) {
    return { error: "Referral source not found." };
  }

  if (source.partner_id !== partner.partner_id) {
    return { error: "Referral source must belong to the selected organization." };
  }

  const lead = payload.data.leadId ? db.leads.find((row) => row.id === payload.data.leadId) || null : null;

  addMockRecord("partnerActivities", {
    partner_activity_id: makeShortId("PA"),
    referral_source_id: source.referral_source_id,
    partner_id: partner.partner_id,
    organization_name: partner.organization_name,
    contact_name: source.contact_name,
    activity_at: payload.data.activityAt || toEasternISO(),
    activity_type: payload.data.activityType,
    notes: payload.data.notes || null,
    completed_by: profile.full_name,
    completed_by_user_id: profile.id,
    next_follow_up_date: payload.data.nextFollowUpDate || null,
    next_follow_up_type: payload.data.nextFollowUpType || null,
    last_touched: toEasternDate(),
    lead_id: lead?.id ?? null
  });

  touchPartnerAndSource(db, partner, source);

  revalidatePath("/sales/community-partners");
  revalidatePath("/sales/new-entries/log-partner-activities");
  revalidatePath("/sales/activities");
  revalidatePath(`/sales/community-partners/organizations/${partner.id}`);
  revalidatePath(`/sales/community-partners/referral-sources/${source.id}`);
  if (lead) {
    revalidatePath(`/sales/leads/${lead.id}`);
  }

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

  if (!isMockMode()) {
    // TODO(backend): Wire to community_partner_organizations table.
    return { error: "Community partner backend integration pending." };
  }

  const partner = addMockRecord("partners", {
    partner_id: makeShortId("P").toUpperCase(),
    organization_name: payload.data.organizationName.trim(),
    referral_source_category: payload.data.referralSourceCategory.trim(),
    location: payload.data.location?.trim() || "",
    primary_phone: payload.data.primaryPhone?.trim() || "",
    secondary_phone: payload.data.secondaryPhone?.trim() || null,
    primary_email: payload.data.primaryEmail?.trim() || "",
    active: payload.data.active,
    notes: payload.data.notes?.trim() || null,
    last_touched: null,
    contact_name: payload.data.contactName?.trim() || payload.data.organizationName.trim()
  });

  revalidatePath("/sales/community-partners/organizations");
  revalidatePath("/sales/new-entries/new-community-partner");
  return {
    ok: true,
    id: partner.id,
    partner: {
      id: partner.id,
      partner_id: partner.partner_id,
      organization_name: partner.organization_name
    }
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

  if (!isMockMode()) {
    // TODO(backend): Wire to referral_sources table.
    return { error: "Referral source backend integration pending." };
  }

  const db = getMockDb();
  const partner = findPartner(db, payload.data.partnerId);

  if (!partner) {
    return { error: "Select a valid organization first." };
  }

  const source = addMockRecord("referralSources", {
    referral_source_id: makeShortId("RS").toUpperCase(),
    partner_id: partner.partner_id,
    contact_name: payload.data.contactName.trim(),
    organization_name: partner.organization_name,
    job_title: payload.data.jobTitle?.trim() || null,
    primary_phone: payload.data.primaryPhone?.trim() || "",
    secondary_phone: payload.data.secondaryPhone?.trim() || null,
    primary_email: payload.data.primaryEmail?.trim() || "",
    preferred_contact_method: payload.data.preferredContactMethod?.trim() || "",
    active: payload.data.active,
    notes: payload.data.notes?.trim() || null,
    last_touched: toEasternDate()
  });

  updateMockRecord("partners", partner.id, { last_touched: toEasternDate() });

  revalidatePath("/sales/community-partners/referral-sources");
  revalidatePath("/sales/new-entries/new-referral-source");
  return {
    ok: true,
    id: source.id,
    source: {
      id: source.id,
      referral_source_id: source.referral_source_id,
      partner_id: source.partner_id,
      contact_name: source.contact_name,
      organization_name: source.organization_name
    }
  };
}

export async function getSalesFormLookups() {
  await requireSalesRoles();
  if (!isMockMode()) {
    // TODO(backend): Replace with lookups from partner/referral/lead tables.
    return { leads: [], partners: [], referralSources: [] };
  }

  const db = getMockDb();
  return {
    leads: [...db.leads].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
    partners: [...db.partners].sort((a, b) => (a.organization_name > b.organization_name ? 1 : -1)),
    referralSources: [...db.referralSources].sort((a, b) => (a.organization_name > b.organization_name ? 1 : -1))
  };
}

export async function getSalesNowLocalAction() {
  return { now: toEasternDateTimeLocal() };
}








