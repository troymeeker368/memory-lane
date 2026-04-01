import { createClient } from "@/lib/supabase/server";
import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";
import { recordImmediateSystemAlert } from "@/lib/services/workflow-observability";
import { POF_POST_SIGN_QUEUE_SELECT } from "@/lib/services/physician-orders-selects";
import type { PhysicianOrderPostSignQueueStatus } from "@/lib/services/physician-order-clinical-sync";
import {
  clean,
  extractErrorText,
  getPofPostSignSyncAlertAgeMinutes,
  isMissingPhysicianOrdersTableError,
  isMissingRpcFunctionError,
  missingRpcFunctionRequiredError,
  physicianOrdersTableRequiredError,
  toRpcRunSignedPofPostSignSyncRow,
  toRpcSignPhysicianOrderRow,
  toRpcSyncSignedPofToMemberClinicalProfileRow,
  type PofPostSignQueueStatusRow,
  type PofPostSignSyncQueueRow,
  type PofPostSignSyncStep,
  type PostgrestErrorLike
} from "@/lib/services/physician-order-core";

const CLAIM_POF_POST_SIGN_SYNC_QUEUE_RPC = "rpc_claim_pof_post_sign_sync_queue";
const CLAIM_POF_POST_SIGN_SYNC_QUEUE_MIGRATION = "0097_pof_post_sign_retry_claim_rpc.sql";
const FINALIZE_POF_POST_SIGN_SYNC_QUEUE_RPC = "rpc_finalize_pof_post_sign_sync_queue";
const FINALIZE_POF_POST_SIGN_SYNC_QUEUE_MIGRATION = "0174_pof_post_sign_queue_outcome_rpc.sql";
const RPC_SIGN_PHYSICIAN_ORDER = "rpc_sign_physician_order";
const RPC_RUN_SIGNED_POF_POST_SIGN_SYNC = "rpc_run_signed_pof_post_sign_sync";
const RUN_SIGNED_POF_POST_SIGN_SYNC_MIGRATION = "0155_signed_pof_post_sign_sync_rpc_consolidation.sql";
const RPC_SYNC_SIGNED_POF_TO_MEMBER_CLINICAL_PROFILE = "rpc_sync_signed_pof_to_member_clinical_profile";
const DEFAULT_POF_POST_SIGN_SYNC_ALERT_AGE_MINUTES = 30;
const MAX_POF_POST_SIGN_SYNC_ALERT_ROWS = 50;

function isMissingPofPostSignQueueTableError(error: PostgrestErrorLike | null | undefined) {
  const text = extractErrorText(error);
  if (!text) return false;
  if (error?.code === "PGRST205") return text.includes("pof_post_sign_sync_queue");
  return (
    text.includes("pof_post_sign_sync_queue") &&
    (text.includes("schema cache") || text.includes("does not exist") || text.includes("relation"))
  );
}

function pofPostSignQueueTableRequiredError() {
  return new Error(
    "POF post-sign sync queue storage is not available. Run Supabase migration 0039_pof_post_sign_sync_queue.sql."
  );
}

export async function emitAgedPostSignSyncQueueAlerts(input: {
  nowIso: string;
  serviceRole?: boolean;
  actorUserId?: string | null;
}) {
  const alertAgeMinutes = getPofPostSignSyncAlertAgeMinutes(DEFAULT_POF_POST_SIGN_SYNC_ALERT_AGE_MINUTES);
  const thresholdIso = new Date(Date.parse(input.nowIso) - alertAgeMinutes * 60 * 1000).toISOString();
  const supabase = await createClient({ serviceRole: input.serviceRole ?? true });
  const { data, error } = await supabase
    .from("pof_post_sign_sync_queue")
    .select(POF_POST_SIGN_QUEUE_SELECT)
    .eq("status", "queued")
    .lte("signature_completed_at", thresholdIso)
    .order("signature_completed_at", { ascending: true })
    .limit(MAX_POF_POST_SIGN_SYNC_ALERT_ROWS);
  if (error) {
    if (isMissingPofPostSignQueueTableError(error)) throw pofPostSignQueueTableRequiredError();
    throw new Error(error.message);
  }

  const rows = (data ?? []) as PofPostSignSyncQueueRow[];
  let alertsRaised = 0;
  for (const row of rows) {
    const didCreateAlert = await recordImmediateSystemAlert({
      entityType: "physician_order",
      entityId: row.physician_order_id,
      actorUserId: input.actorUserId ?? null,
      severity: "high",
      alertKey: "pof_post_sign_sync_aged_queue",
      metadata: {
        member_id: row.member_id,
        queue_id: row.id,
        pof_request_id: clean(row.pof_request_id),
        queue_status: row.status,
        attempt_count: Math.max(0, Number(row.attempt_count ?? 0)),
        next_retry_at: clean(row.next_retry_at),
        signature_completed_at: row.signature_completed_at,
        queued_at: clean(row.queued_at),
        last_failed_step: clean(row.last_failed_step),
        last_error: clean(row.last_error),
        alert_age_minutes: alertAgeMinutes
      }
    });
    if (didCreateAlert) {
      alertsRaised += 1;
    }
  }

  return {
    alertAgeMinutes,
    agedQueueRows: rows.length,
    alertsRaised
  };
}

export async function claimQueuedPhysicianOrderPostSignSyncRows(input: {
  limit: number;
  claimAt: string;
  actor: { id: string | null; fullName: string | null };
  serviceRole?: boolean;
}) {
  const supabase = await createClient({ serviceRole: input.serviceRole ?? true });
  try {
    const data = await invokeSupabaseRpcOrThrow<unknown>(supabase, CLAIM_POF_POST_SIGN_SYNC_QUEUE_RPC, {
      p_limit: input.limit,
      p_now: input.claimAt,
      p_actor_user_id: clean(input.actor.id),
      p_actor_name: clean(input.actor.fullName)
    });
    return ((Array.isArray(data) ? data : []) as PofPostSignSyncQueueRow[]).map((row) => ({
      ...row,
      status: row.status === "completed" ? "completed" : row.status === "processing" ? "processing" : "queued"
    }));
  } catch (error) {
    if (isMissingRpcFunctionError(error, CLAIM_POF_POST_SIGN_SYNC_QUEUE_RPC)) {
      throw new Error(
        `POF post-sign queue claim RPC is not available. Apply Supabase migration ${CLAIM_POF_POST_SIGN_SYNC_QUEUE_MIGRATION} and refresh PostgREST schema cache.`
      );
    }
    const postgrestError = error as PostgrestErrorLike | null | undefined;
    if (isMissingPofPostSignQueueTableError(postgrestError)) throw pofPostSignQueueTableRequiredError();
    throw error;
  }
}

export async function loadPostSignQueueStatusByPofIds(
  pofIds: string[],
  options?: {
    serviceRole?: boolean;
  }
) {
  const normalizedIds = [...new Set(pofIds.map((value) => clean(value)).filter((value): value is string => Boolean(value)))];
  const statuses = new Map<
    string,
    {
      status: PhysicianOrderPostSignQueueStatus;
      attemptCount: number | null;
      nextRetryAt: string | null;
      lastError: string | null;
      lastFailedStep: string | null;
    }
  >();
  if (normalizedIds.length === 0) return statuses;

  const supabase = await createClient({ serviceRole: options?.serviceRole ?? true });
  const { data, error } = await supabase
    .from("pof_post_sign_sync_queue")
    .select("physician_order_id, status, attempt_count, next_retry_at, last_error, last_failed_step")
    .in("physician_order_id", normalizedIds);
  if (error) {
    if (isMissingPofPostSignQueueTableError(error)) throw pofPostSignQueueTableRequiredError();
    throw new Error(error.message);
  }

  for (const row of (data ?? []) as PofPostSignQueueStatusRow[]) {
    const pofId = clean(row.physician_order_id);
    if (!pofId) continue;
    statuses.set(pofId, {
      status: row.status === "completed" ? "completed" : "queued",
      attemptCount: typeof row.attempt_count === "number" ? row.attempt_count : null,
      nextRetryAt: clean(row.next_retry_at),
      lastError: clean(row.last_error),
      lastFailedStep: clean(row.last_failed_step)
    });
  }
  return statuses;
}

export async function invokeSignPhysicianOrderRpc(input: {
  pofId: string;
  actor: { id: string; fullName: string };
  signedAtIso: string;
  pofRequestId?: string | null;
  serviceRole?: boolean;
}) {
  const supabase = await createClient({ serviceRole: input.serviceRole ?? true });
  try {
    const data = await invokeSupabaseRpcOrThrow<unknown>(supabase, RPC_SIGN_PHYSICIAN_ORDER, {
      p_pof_id: input.pofId,
      p_actor_user_id: input.actor.id,
      p_actor_name: input.actor.fullName,
      p_signed_at: input.signedAtIso,
      p_pof_request_id: clean(input.pofRequestId) ?? null
    });
    return toRpcSignPhysicianOrderRow(data);
  } catch (error) {
    if (isMissingRpcFunctionError(error, RPC_SIGN_PHYSICIAN_ORDER)) {
      throw missingRpcFunctionRequiredError(RPC_SIGN_PHYSICIAN_ORDER);
    }
    const postgrestError = error as PostgrestErrorLike | null | undefined;
    if (isMissingPofPostSignQueueTableError(postgrestError)) throw pofPostSignQueueTableRequiredError();
    if (isMissingPhysicianOrdersTableError(postgrestError)) throw physicianOrdersTableRequiredError();
    throw error;
  }
}

export async function invokeSyncSignedPofToMemberClinicalProfileRpc(input: {
  pofId: string;
  syncTimestamp: string;
  serviceRole?: boolean;
}) {
  const supabase = await createClient({ serviceRole: input.serviceRole ?? true });
  try {
    const data = await invokeSupabaseRpcOrThrow<unknown>(supabase, RPC_SYNC_SIGNED_POF_TO_MEMBER_CLINICAL_PROFILE, {
      p_pof_id: input.pofId,
      p_synced_at: input.syncTimestamp
    });
    return toRpcSyncSignedPofToMemberClinicalProfileRow(data);
  } catch (error) {
    if (isMissingRpcFunctionError(error, RPC_SYNC_SIGNED_POF_TO_MEMBER_CLINICAL_PROFILE)) {
      throw new Error(
        "Shared RPC rpc_sync_signed_pof_to_member_clinical_profile is not available. Apply Supabase migration 0043_delivery_state_and_pof_post_sign_sync_rpc.sql and refresh PostgREST schema cache."
      );
    }
    throw error;
  }
}

export async function invokeRunSignedPofPostSignSyncRpc(input: {
  pofId: string;
  syncTimestamp: string;
  serviceRole?: boolean;
}) {
  const supabase = await createClient({ serviceRole: input.serviceRole ?? true });
  try {
    const data = await invokeSupabaseRpcOrThrow<unknown>(supabase, RPC_RUN_SIGNED_POF_POST_SIGN_SYNC, {
      p_pof_id: input.pofId,
      p_sync_timestamp: input.syncTimestamp
    });
    return toRpcRunSignedPofPostSignSyncRow(data);
  } catch (error) {
    if (isMissingRpcFunctionError(error, RPC_RUN_SIGNED_POF_POST_SIGN_SYNC)) {
      throw new Error(
        `Signed POF post-sign sync RPC is not available. Apply Supabase migration ${RUN_SIGNED_POF_POST_SIGN_SYNC_MIGRATION} and refresh PostgREST schema cache.`
      );
    }
    const postgrestError = error as PostgrestErrorLike | null | undefined;
    if (isMissingPhysicianOrdersTableError(postgrestError)) throw physicianOrdersTableRequiredError();
    throw error;
  }
}

async function finalizePostSignQueueOutcome(input: {
  queueId: string;
  status: "queued" | "completed";
  attemptCount: number;
  lastAttemptAt: string;
  nextRetryAt?: string | null;
  lastError?: string | null;
  lastFailedStep?: PofPostSignSyncStep | null;
  pofRequestId?: string | null;
  actor: { id: string | null; fullName: string | null };
  serviceRole?: boolean;
}) {
  const supabase = await createClient({ serviceRole: input.serviceRole });
  try {
    await invokeSupabaseRpcOrThrow<unknown>(supabase, FINALIZE_POF_POST_SIGN_SYNC_QUEUE_RPC, {
      p_queue_id: input.queueId,
      p_status: input.status,
      p_attempt_count: input.attemptCount,
      p_last_attempt_at: input.lastAttemptAt,
      p_next_retry_at: input.status === "queued" ? clean(input.nextRetryAt) : null,
      p_last_error: input.status === "queued" ? clean(input.lastError) : null,
      p_last_error_at: input.status === "queued" ? input.lastAttemptAt : null,
      p_last_failed_step: input.status === "queued" ? clean(input.lastFailedStep) : null,
      p_pof_request_id: clean(input.pofRequestId),
      p_actor_user_id: clean(input.actor.id),
      p_actor_name: clean(input.actor.fullName)
    });
  } catch (error) {
    if (isMissingRpcFunctionError(error, FINALIZE_POF_POST_SIGN_SYNC_QUEUE_RPC)) {
      throw new Error(
        `POF post-sign queue outcome RPC is not available. Apply Supabase migration ${FINALIZE_POF_POST_SIGN_SYNC_QUEUE_MIGRATION} and refresh PostgREST schema cache.`
      );
    }
    const postgrestError = error as PostgrestErrorLike | null | undefined;
    if (isMissingPofPostSignQueueTableError(postgrestError)) throw pofPostSignQueueTableRequiredError();
    throw error;
  }
}

export async function markPostSignQueueCompleted(input: {
  queueId: string;
  attemptCount: number;
  actor: { id: string | null; fullName: string | null };
  completedAt: string;
  pofRequestId?: string | null;
  serviceRole?: boolean;
}) {
  await finalizePostSignQueueOutcome({
    queueId: input.queueId,
    status: "completed",
    attemptCount: input.attemptCount,
    lastAttemptAt: input.completedAt,
    pofRequestId: input.pofRequestId,
    actor: input.actor,
    serviceRole: input.serviceRole
  });
}

export async function markPostSignQueueQueued(input: {
  queueId: string;
  attemptCount: number;
  step: PofPostSignSyncStep;
  errorMessage: string;
  nextRetryAt: string;
  pofRequestId?: string | null;
  actor: { id: string | null; fullName: string | null };
  queuedAt: string;
  serviceRole?: boolean;
}) {
  await finalizePostSignQueueOutcome({
    queueId: input.queueId,
    status: "queued",
    attemptCount: input.attemptCount,
    lastAttemptAt: input.queuedAt,
    nextRetryAt: input.nextRetryAt,
    lastError: input.errorMessage,
    lastFailedStep: input.step,
    pofRequestId: input.pofRequestId,
    actor: input.actor,
    serviceRole: input.serviceRole
  });
}
