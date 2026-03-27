import { createClient } from "@/lib/supabase/server";
import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";
import { logSystemEvent } from "@/lib/services/system-event-service";
import { toEasternDate, toEasternISO } from "@/lib/timezone";

import {
  resolveCanonicalLeadTransition,
  type CanonicalLeadBusinessStatus,
  type CanonicalLeadStage,
  type LeadDbStatus
} from "@/lib/services/sales-lead-stage-supabase";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const RPC_CONVERT_LEAD_TO_MEMBER = "rpc_convert_lead_to_member";
const RPC_CREATE_LEAD_WITH_MEMBER_CONVERSION = "rpc_create_lead_with_member_conversion";
const LEAD_CONVERSION_RPC_MIGRATION = "0037_shared_rpc_standardization_lead_pof.sql";

type LeadConversionRpcRow = {
  lead_id: string;
  member_id: string;
  from_stage: string | null;
  to_stage: string;
  from_status: LeadDbStatus | null;
  to_status: LeadDbStatus;
  business_status: CanonicalLeadBusinessStatus;
};

function isMissingRpcFunctionError(error: unknown, rpcName: string) {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: string }).code ?? "").toUpperCase();
  const text = String((error as { message?: string }).message ?? "").toLowerCase();
  return (code === "PGRST202" || code === "42883") && text.includes(rpcName.toLowerCase());
}

function buildLeadConversionRpcUnavailableMessage(functionName: string) {
  return `Lead conversion RPC ${functionName} is not available. Apply Supabase migration ${LEAD_CONVERSION_RPC_MIGRATION} (and any earlier unapplied migrations), then refresh Supabase schema cache.`;
}

function sanitizeAdditionalLeadPatch(additionalLeadPatch?: Record<string, JsonValue>) {
  if (!additionalLeadPatch) return {};
  const patch = { ...additionalLeadPatch };
  delete patch.stage;
  delete patch.status;
  delete patch.stage_updated_at;
  delete patch.updated_at;
  return patch;
}

async function invokeLeadConversionRpcWithFallback(
  supabase: Awaited<ReturnType<typeof createClient>>,
  input: {
    rpcName: string;
    args: Record<string, unknown>;
  }
) {
  try {
    return await invokeSupabaseRpcOrThrow<unknown>(supabase, input.rpcName, input.args);
  } catch (error) {
    if (!isMissingRpcFunctionError(error, input.rpcName)) {
      throw error;
    }
    throw new Error(buildLeadConversionRpcUnavailableMessage(input.rpcName));
  }
}

export interface LeadStageTransitionMemberUpsertResult {
  leadId: string;
  memberId: string;
  fromStage: string | null;
  toStage: CanonicalLeadStage;
  fromStatus: LeadDbStatus | null;
  toStatus: LeadDbStatus;
  businessStatus: CanonicalLeadBusinessStatus;
}

function toLeadConversionResult(data: unknown) {
  const row = (Array.isArray(data) ? data[0] : null) as LeadConversionRpcRow | null;
  if (!row?.lead_id || !row?.member_id) {
    throw new Error("Lead conversion workflow did not return lead/member identifiers.");
  }

  return {
    leadId: row.lead_id,
    memberId: row.member_id,
    fromStage: row.from_stage,
    toStage: row.to_stage as CanonicalLeadStage,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    businessStatus: row.business_status
  } satisfies LeadStageTransitionMemberUpsertResult;
}

export async function applyLeadStageTransitionWithMemberUpsertSupabase(input: {
  leadId: string;
  requestedStage: string;
  requestedStatus: string;
  actorUserId: string;
  actorName: string;
  source: string;
  reason?: string | null;
  memberDisplayName: string;
  memberDob?: string | null;
  memberEnrollmentDate?: string | null;
  existingMemberId?: string | null;
  additionalLeadPatch?: Record<string, JsonValue>;
}) {
  const resolved = resolveCanonicalLeadTransition({
    requestedStage: input.requestedStage,
    requestedStatus: input.requestedStatus
  });

  const supabase = await createClient();
  const args = {
    p_lead_id: input.leadId,
    p_to_stage: resolved.stage,
    p_to_status: resolved.dbStatus,
    p_business_status: resolved.businessStatus,
    p_actor_user_id: input.actorUserId,
    p_actor_name: input.actorName,
    p_source: input.source,
    p_reason: input.reason ?? null,
    p_member_display_name: input.memberDisplayName,
    p_member_dob: input.memberDob ?? null,
    p_member_enrollment_date: input.memberEnrollmentDate ?? null,
    p_existing_member_id: input.existingMemberId ?? null,
    p_additional_lead_patch: sanitizeAdditionalLeadPatch(input.additionalLeadPatch) as JsonValue,
    p_now: toEasternISO(),
    p_today: toEasternDate()
  };
  const data = await invokeLeadConversionRpcWithFallback(supabase, {
    rpcName: RPC_CONVERT_LEAD_TO_MEMBER,
    args
  });

  const result = toLeadConversionResult(data);
  await logSystemEvent({
    event_type: "lead_member_conversion_completed",
    entity_type: "lead",
    entity_id: result.leadId,
    actor_type: "user",
    actor_id: input.actorUserId,
    metadata: {
      member_id: result.memberId,
      source: input.source,
      to_stage: result.toStage,
      to_status: result.toStatus
    }
  }, { required: false });

  return result;
}

export async function createLeadWithMemberConversionSupabase(input: {
  requestedStage: string;
  requestedStatus: string;
  createdByUserId: string;
  actorUserId: string;
  actorName: string;
  source: string;
  reason?: string | null;
  memberDisplayName: string;
  memberDob?: string | null;
  memberEnrollmentDate?: string | null;
  leadPatch: Record<string, JsonValue>;
}) {
  const resolved = resolveCanonicalLeadTransition({
    requestedStage: input.requestedStage,
    requestedStatus: input.requestedStatus
  });

  const supabase = await createClient();
  const args = {
    p_to_stage: resolved.stage,
    p_to_status: resolved.dbStatus,
    p_business_status: resolved.businessStatus,
    p_created_by_user_id: input.createdByUserId,
    p_actor_user_id: input.actorUserId,
    p_actor_name: input.actorName,
    p_source: input.source,
    p_reason: input.reason ?? null,
    p_member_display_name: input.memberDisplayName,
    p_member_dob: input.memberDob ?? null,
    p_member_enrollment_date: input.memberEnrollmentDate ?? null,
    p_lead_patch: input.leadPatch as JsonValue,
    p_now: toEasternISO(),
    p_today: toEasternDate()
  };
  const data = await invokeLeadConversionRpcWithFallback(supabase, {
    rpcName: RPC_CREATE_LEAD_WITH_MEMBER_CONVERSION,
    args
  });

  const result = toLeadConversionResult(data);
  await logSystemEvent({
    event_type: "lead_member_conversion_completed",
    entity_type: "lead",
    entity_id: result.leadId,
    actor_type: "user",
    actor_id: input.actorUserId,
    metadata: {
      member_id: result.memberId,
      source: input.source,
      to_stage: result.toStage,
      to_status: result.toStatus
    }
  }, { required: false });

  return result;
}
