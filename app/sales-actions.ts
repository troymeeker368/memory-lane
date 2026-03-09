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
    "/sales/pipeline-by-stage"
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
    closedDate: optionalString
  })
  .superRefine((val, ctx) => {
    const stage = canonicalLeadStage(val.stage);
    const status = stage === "Closed - Lost" ? "Lost" : canonicalLeadStatus(val.status, stage);

    if (val.leadSource === "Referral" && !val.referralName?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["referralName"],
        message: "Referral Name is required when Lead Source is Referral."
      });
    }

    if (val.leadSource === "Referral" && !val.partnerId?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["partnerId"],
        message: "Community Partner Organization is required when Lead Source is Referral."
      });
    }

    if (val.leadSource === "Referral" && !val.referralSourceId?.trim()) {
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

  const commonPatch = {
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








