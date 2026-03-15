import { z } from "zod";

import {
  LEAD_ACTIVITY_OUTCOMES,
  LEAD_ACTIVITY_TYPES,
  LEAD_FOLLOW_UP_TYPES,
  LEAD_LOST_REASON_OPTIONS
} from "@/lib/canonical";
import { normalizeRoleKey } from "@/lib/permissions";
import { insertAuditLogEntry } from "@/lib/services/audit-log-service";
import { resolveCanonicalLeadRef } from "@/lib/services/canonical-person-ref";
import { applyLeadStageTransitionWithMemberUpsertSupabase } from "@/lib/services/sales-lead-conversion-supabase";
import { applyLeadStageTransitionSupabase } from "@/lib/services/sales-lead-stage-supabase";
import { createClient } from "@/lib/supabase/server";
import { recordWorkflowEvent } from "@/lib/services/workflow-observability";
import { toEasternISO } from "@/lib/timezone";

const optionalString = z.string().optional().or(z.literal(""));

function clean(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

export const salesLeadActivityInputSchema = z
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

export const legacyLeadActivityInputSchema = z
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

export type SalesLeadActivityInput = z.infer<typeof salesLeadActivityInputSchema>;
export type LegacyLeadActivityInput = z.infer<typeof legacyLeadActivityInputSchema>;

export function normalizeLegacyLeadActivityInput(input: LegacyLeadActivityInput): SalesLeadActivityInput {
  return {
    leadId: input.leadId,
    activityAt: "",
    activityType: input.activityType,
    outcome: input.outcome,
    lostReason: input.lostReason || "",
    notes: input.notes ?? "",
    nextFollowUpDate: input.nextFollowUpDate || "",
    nextFollowUpType: input.nextFollowUpType || "",
    partnerId: "",
    referralSourceId: ""
  };
}

export async function createSalesLeadActivity(input: {
  activity: SalesLeadActivityInput;
  actor: {
    id: string;
    fullName: string;
    role: string;
  };
  source: string;
}) {
  const canonicalLead = await resolveCanonicalLeadRef(
    {
      sourceType: "lead",
      leadId: input.activity.leadId,
      selectedId: input.activity.leadId
    },
    {
      actionLabel: input.source
    }
  );
  if (!canonicalLead.leadId) {
    throw new Error(`${input.source} expected lead.id but canonical lead resolution returned empty leadId.`);
  }

  const supabase = await createClient();
  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("id, member_name, member_dob, member_start_date, stage, status, partner_id, referral_source_id, next_follow_up_date, next_follow_up_type")
    .eq("id", canonicalLead.leadId)
    .maybeSingle();
  if (leadError) throw new Error(leadError.message);
  if (!lead) throw new Error("Lead not found.");

  const partnerId = input.activity.partnerId?.trim() || lead.partner_id || null;
  const referralSourceId = input.activity.referralSourceId?.trim() || lead.referral_source_id || null;
  const nextFollowUpDate = clean(input.activity.nextFollowUpDate) ?? clean(lead.next_follow_up_date);
  const nextFollowUpType = clean(input.activity.nextFollowUpType) ?? clean(lead.next_follow_up_type);
  const { data: insertedActivity, error: insertError } = await supabase
    .from("lead_activities")
    .insert({
    lead_id: canonicalLead.leadId,
    member_name: lead.member_name,
    activity_at: input.activity.activityAt || toEasternISO(),
    activity_type: input.activity.activityType,
    outcome: input.activity.outcome,
    lost_reason: input.activity.lostReason || null,
    notes: input.activity.notes || null,
    next_follow_up_date: nextFollowUpDate,
    next_follow_up_type: nextFollowUpType,
    completed_by_user_id: input.actor.id,
    completed_by_name: input.actor.fullName,
    partner_id: partnerId,
    referral_source_id: referralSourceId
    })
    .select("id")
    .single();
  if (insertError) throw new Error(insertError.message);

  if (input.activity.outcome === "Not a fit") {
    await applyLeadStageTransitionSupabase({
      leadId: lead.id,
      requestedStage: "Closed - Lost",
      requestedStatus: "Lost",
      actorUserId: input.actor.id,
      actorName: input.actor.fullName,
      source: input.source,
      reason: "Lead activity outcome marked as Not a fit.",
      additionalLeadPatch: {
        lost_reason: input.activity.lostReason || null,
        next_follow_up_date: null,
        next_follow_up_type: null
      }
    });
  }

  if (input.activity.outcome === "Enrollment completed" || input.activity.outcome === "Member start confirmed") {
    const memberDisplayName = clean(lead.member_name);
    if (!memberDisplayName) {
      throw new Error(`${input.source} cannot convert lead ${lead.id} because member_name is blank.`);
    }

    const { data: linkedMembers, error: linkedMembersError } = await supabase
      .from("members")
      .select("id")
      .eq("source_lead_id", canonicalLead.leadId)
      .order("created_at", { ascending: true })
      .limit(2);
    if (linkedMembersError) throw new Error(linkedMembersError.message);
    if ((linkedMembers ?? []).length > 1) {
      throw new Error(`${input.source} found multiple members linked to lead ${canonicalLead.leadId}.`);
    }

    const linkedMemberId = linkedMembers?.[0]?.id ? String(linkedMembers[0].id) : null;
    if (canonicalLead.memberId && linkedMemberId && canonicalLead.memberId !== linkedMemberId) {
      throw new Error(
        `${input.source} resolved lead ${canonicalLead.leadId} to member ${canonicalLead.memberId}, but the canonical linked member is ${linkedMemberId}.`
      );
    }

    await applyLeadStageTransitionWithMemberUpsertSupabase({
      leadId: lead.id,
      requestedStage: "Closed - Won",
      requestedStatus: "Won",
      actorUserId: input.actor.id,
      actorName: input.actor.fullName,
      source: input.source,
      reason: `Lead activity outcome: ${input.activity.outcome}.`,
      memberDisplayName,
      memberDob: clean(lead.member_dob),
      memberEnrollmentDate: clean(lead.member_start_date),
      existingMemberId: canonicalLead.memberId ?? linkedMemberId
    });
  }

  await insertAuditLogEntry({
    actorUserId: input.actor.id,
    actorRole: normalizeRoleKey(input.actor.role),
    action: "create_log",
    entityType: "lead_activity",
    entityId: canonicalLead.leadId,
    details: {
      activityType: input.activity.activityType,
      outcome: input.activity.outcome
    }
  });

  await recordWorkflowEvent({
    eventType: "lead_activity_created",
    entityType: "lead",
    entityId: canonicalLead.leadId,
    actorType: "user",
    actorUserId: input.actor.id,
    status: "created",
    severity: "low",
    metadata: {
      activity_type: input.activity.activityType,
      outcome: input.activity.outcome,
      lost_reason: input.activity.lostReason || null,
      next_follow_up_date: nextFollowUpDate,
      next_follow_up_type: nextFollowUpType,
      partner_id: partnerId,
      referral_source_id: referralSourceId
    }
  });

  return {
    leadId: lead.id,
    activityId: String(insertedActivity.id)
  };
}
