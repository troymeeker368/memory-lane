import { resolveCanonicalLeadState } from "@/lib/canonical";
import { createClient } from "@/lib/supabase/server";
import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";
import { recordWorkflowEvent } from "@/lib/services/workflow-observability";
import { toEasternDate, toEasternISO } from "@/lib/timezone";

export type CanonicalLeadStage =
  | "Inquiry"
  | "Tour"
  | "Enrollment in Progress"
  | "Nurture"
  | "Closed - Won"
  | "Closed - Lost";

export type CanonicalLeadBusinessStatus = "Open" | "Won" | "Lost" | "Nurture";
export type LeadDbStatus = "open" | "won" | "lost";

export interface LeadStageTransitionResult {
  leadId: string;
  fromStage: string | null;
  toStage: CanonicalLeadStage;
  fromStatus: LeadDbStatus | null;
  toStatus: LeadDbStatus;
  businessStatus: CanonicalLeadBusinessStatus;
}

const TRANSITION_LEAD_STAGE_RPC = "rpc_transition_lead_stage";
const TRANSITION_LEAD_STAGE_RPC_MIGRATION = "0073_delivery_and_member_file_rpc_hardening.sql";

export function resolveCanonicalLeadTransition(input: {
  requestedStage: string;
  requestedStatus: string;
}) {
  const resolved = resolveCanonicalLeadState(input);
  return {
    stage: resolved.stage as CanonicalLeadStage,
    businessStatus: resolved.status as CanonicalLeadBusinessStatus,
    dbStatus: resolved.dbStatus
  };
}

export async function applyLeadStageTransitionSupabase(input: {
  leadId: string;
  requestedStage: string;
  requestedStatus: string;
  actorUserId: string;
  actorName: string;
  source: string;
  reason?: string | null;
  additionalLeadPatch?: Record<string, unknown>;
}) {
  const supabase = await createClient();
  const resolved = resolveCanonicalLeadTransition({
    requestedStage: input.requestedStage,
    requestedStatus: input.requestedStatus
  });
  const now = toEasternISO();

  const patch: Record<string, unknown> = {
    stage: resolved.stage,
    status: resolved.dbStatus,
    stage_updated_at: now,
    updated_at: now,
    ...(input.additionalLeadPatch ?? {})
  };

  const hasClosedDate = Object.prototype.hasOwnProperty.call(patch, "closed_date");
  const hasLostReason = Object.prototype.hasOwnProperty.call(patch, "lost_reason");
  if (resolved.businessStatus === "Lost") {
    if (!hasClosedDate) patch.closed_date = toEasternDate();
  } else if (resolved.businessStatus === "Won") {
    if (!hasClosedDate) patch.closed_date = toEasternDate();
    if (!hasLostReason) patch.lost_reason = null;
  } else {
    if (!hasClosedDate) patch.closed_date = null;
    if (!hasLostReason) patch.lost_reason = null;
  }

  type TransitionRow = {
    lead_id: string;
    from_stage: string | null;
    to_stage: string;
    from_status: LeadDbStatus | null;
    to_status: LeadDbStatus;
    business_status: CanonicalLeadBusinessStatus;
  };

  let row: TransitionRow | null = null;
  try {
    const data = await invokeSupabaseRpcOrThrow<unknown>(supabase, TRANSITION_LEAD_STAGE_RPC, {
      p_lead_id: input.leadId,
      p_to_stage: resolved.stage,
      p_to_status: resolved.dbStatus,
      p_business_status: resolved.businessStatus,
      p_actor_user_id: input.actorUserId,
      p_actor_name: input.actorName,
      p_source: input.source,
      p_reason: input.reason ?? null,
      p_additional_lead_patch: patch,
      p_now: now,
      p_today: toEasternDate()
    });
    row = (Array.isArray(data) ? data[0] : null) as TransitionRow | null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update lead.";
    if (message.includes(TRANSITION_LEAD_STAGE_RPC)) {
      throw new Error(
        `Lead stage transition RPC is not available. Apply Supabase migration ${TRANSITION_LEAD_STAGE_RPC_MIGRATION} and refresh PostgREST schema cache.`
      );
    }
    throw error;
  }

  if (!row?.lead_id) {
    throw new Error("Lead stage transition RPC did not return the lead transition result.");
  }

  const changed = row.from_stage !== row.to_stage || (row.from_status ?? null) !== row.to_status;
  if (changed) {
    await recordWorkflowEvent({
      eventType: "lead_stage_transitioned",
      entityType: "lead",
      entityId: input.leadId,
      actorType: "user",
      actorUserId: input.actorUserId,
      status: resolved.businessStatus.toLowerCase(),
      severity: "low",
      metadata: {
        from_stage: row.from_stage,
        to_stage: row.to_stage,
        from_status: row.from_status,
        to_status: row.to_status,
        source: input.source,
        reason: input.reason ?? null
      }
    });
  }

  return {
    leadId: input.leadId,
    fromStage: row.from_stage,
    toStage: row.to_stage as CanonicalLeadStage,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    businessStatus: row.business_status
  } satisfies LeadStageTransitionResult;
}
