import { getMemberHealthProfile, getPhysicianOrderById } from "@/lib/services/physician-orders-read";
import {
  claimQueuedPhysicianOrderPostSignSyncRows,
  emitAgedPostSignSyncQueueAlerts,
  invokeRunSignedPofPostSignSyncRpc,
  invokeSignPhysicianOrderRpc,
  invokeSyncSignedPofToMemberClinicalProfileRpc,
  markPostSignQueueCompleted,
  markPostSignQueueQueued
} from "@/lib/services/physician-order-post-sign-runtime";
import {
  buildPostSignSyncError,
  clean,
  computePostSignRetryAt,
  type PofPostSignSyncStep
} from "@/lib/services/physician-order-core";
import { recordWorkflowMilestone } from "@/lib/services/lifecycle-milestones";
import { dismissWorkflowNotifications } from "@/lib/services/notifications";
import { logSystemEvent } from "@/lib/services/system-event-service";
import { recordImmediateSystemAlert } from "@/lib/services/workflow-observability";
import { toEasternISO } from "@/lib/timezone";

export type SignPhysicianOrderResult = {
  postSignStatus: "synced" | "queued";
  queueId: string;
  attemptCount: number;
  nextRetryAt: string | null;
  lastError: string | null;
};

function buildPostSignActionUrl(pofId: string) {
  return `/health/physician-orders/${pofId}`;
}

function normalizeSignedPofPostSignFailure(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown post-sign sync error.";
  const stepMatch = message.match(/(?:^|\s)(mhp_mcc|mar_schedules):\s*(.+?)(?:\s+\(ref [^)]+\))?$/i);
  if (stepMatch) {
    return {
      step: stepMatch[1].toLowerCase() as Extract<PofPostSignSyncStep, "mhp_mcc" | "mar_schedules">,
      message: stepMatch[2].trim()
    };
  }
  return {
    step: "mar_schedules" as const,
    message
  };
}

async function runSignedPofPostSignBoundary(input: {
  pofId: string;
  syncTimestamp: string;
  serviceRole?: boolean;
}) {
  try {
    await invokeRunSignedPofPostSignSyncRpc({
      pofId: input.pofId,
      syncTimestamp: input.syncTimestamp,
      serviceRole: input.serviceRole
    });
    return {
      ok: true as const
    };
  } catch (error) {
    const normalized = normalizeSignedPofPostSignFailure(error);
    return {
      ok: false as const,
      step: normalized.step,
      errorMessage: buildPostSignSyncError(normalized.step, normalized.message)
    };
  }
}

export async function runSignedPhysicianOrderPostSignWorkflow(input: {
  pofId: string;
  syncTimestamp?: string | null;
  serviceRole?: boolean;
}) {
  return invokeRunSignedPofPostSignSyncRpc({
    pofId: input.pofId,
    syncTimestamp: clean(input.syncTimestamp) ?? toEasternISO(),
    serviceRole: input.serviceRole
  });
}

export async function processSignedPhysicianOrderPostSignSync(input: {
  pofId: string;
  memberId: string;
  queueId: string;
  queueAttemptCount: number;
  actor: { id: string; fullName: string };
  signedAtIso: string;
  pofRequestId?: string | null;
  serviceRole?: boolean;
}): Promise<SignPhysicianOrderResult> {
  const attemptCount = Math.max(0, Number(input.queueAttemptCount ?? 0)) + 1;
  const postSign = await runSignedPofPostSignBoundary({
    pofId: input.pofId,
    syncTimestamp: input.signedAtIso,
    serviceRole: input.serviceRole
  });

  if (postSign.ok) {
    await markPostSignQueueCompleted({
      queueId: input.queueId,
      attemptCount,
      actor: input.actor,
      completedAt: input.signedAtIso,
      pofRequestId: input.pofRequestId,
      serviceRole: input.serviceRole
    });
    await logSystemEvent(
      {
        event_type: "pof_post_sign_sync_completed",
        entity_type: "physician_order",
        entity_id: input.pofId,
        actor_type: "user",
        actor_id: input.actor.id,
        actor_user_id: input.actor.id,
        status: "completed",
        severity: "low",
        metadata: {
          member_id: input.memberId,
          queue_id: input.queueId,
          attempt_count: attemptCount,
          pof_request_id: clean(input.pofRequestId)
        }
      },
      { required: false }
    );
    try {
      await dismissWorkflowNotifications({
        entityType: "physician_order",
        entityId: input.pofId,
        eventType: "action_required",
        dismissedAt: input.signedAtIso,
        metadataContains: {
          follow_up_task_type: "pof_post_sign_sync"
        },
        serviceRole: true
      });
    } catch (notificationError) {
      console.error("[physician-order-post-sign-service] unable to dismiss resolved post-sign follow-up notifications", {
        physicianOrderId: input.pofId,
        message: notificationError instanceof Error ? notificationError.message : "Unknown notification dismiss error."
      });
    }
    return {
      postSignStatus: "synced",
      queueId: input.queueId,
      attemptCount,
      nextRetryAt: null,
      lastError: null
    };
  }

  const nextRetryAt = computePostSignRetryAt(attemptCount, input.signedAtIso);
  await markPostSignQueueQueued({
    queueId: input.queueId,
    attemptCount,
    step: postSign.step,
    errorMessage: postSign.errorMessage,
    nextRetryAt,
    pofRequestId: input.pofRequestId,
    actor: input.actor,
    queuedAt: input.signedAtIso,
    serviceRole: input.serviceRole
  });
  await logSystemEvent(
    {
      event_type: "pof_post_sign_sync_queued_for_retry",
      entity_type: "physician_order",
      entity_id: input.pofId,
      actor_type: "user",
      actor_id: input.actor.id,
      actor_user_id: input.actor.id,
      status: "retry_pending",
      severity: attemptCount >= 3 ? "high" : "medium",
      metadata: {
        member_id: input.memberId,
        queue_id: input.queueId,
        attempt_count: attemptCount,
        failed_step: postSign.step,
        next_retry_at: nextRetryAt,
        last_error: postSign.errorMessage,
        pof_request_id: clean(input.pofRequestId)
      }
    },
    { required: false }
  );
  try {
    await recordWorkflowMilestone({
      event: {
        eventType: "action_required",
        entityType: "physician_order",
        entityId: input.pofId,
        actorType: "user",
        actorUserId: input.actor.id,
        status: "open",
        severity: attemptCount >= 3 ? "high" : "medium",
        eventKeySuffix: "pof-post-sign-sync",
        reopenOnConflict: true,
        requireRecipients: true,
        metadata: {
          member_id: input.memberId,
          follow_up_task_type: "pof_post_sign_sync",
          attempt_count: attemptCount,
          failed_step: postSign.step,
          next_retry_at: nextRetryAt,
          last_error: postSign.errorMessage,
          pof_request_id: clean(input.pofRequestId),
          title: "Signed POF Follow-up Needed",
          message:
            "Provider signature was recorded, but downstream MHP/MCC and MAR sync is still not complete. Do not treat this order as operationally ready yet.",
          priority: attemptCount >= 3 ? "high" : "medium",
          action_url: buildPostSignActionUrl(input.pofId)
        }
      }
    });
  } catch (milestoneError) {
    console.error("[physician-order-post-sign-service] unable to emit post-sign follow-up milestone", {
      physicianOrderId: input.pofId,
      message: milestoneError instanceof Error ? milestoneError.message : "Unknown post-sign milestone error."
    });
  }
  if (attemptCount >= 3) {
    await recordImmediateSystemAlert({
      entityType: "physician_order",
      entityId: input.pofId,
      actorUserId: input.actor.id,
      severity: "high",
      alertKey: "pof_post_sign_sync_failed",
      metadata: {
        member_id: input.memberId,
        queue_id: input.queueId,
        attempt_count: attemptCount,
        failed_step: postSign.step,
        next_retry_at: nextRetryAt,
        last_error: postSign.errorMessage,
        pof_request_id: clean(input.pofRequestId)
      }
    });
  }
  return {
    postSignStatus: "queued",
    queueId: input.queueId,
    attemptCount,
    nextRetryAt,
    lastError: postSign.errorMessage
  };
}

export async function signPhysicianOrder(
  pofId: string,
  actor: { id: string; fullName: string },
  options?: {
    serviceRole?: boolean;
    signedAtIso?: string;
    pofRequestId?: string | null;
  }
): Promise<SignPhysicianOrderResult> {
  const signedAtIso = options?.signedAtIso ?? toEasternISO();
  const transition = await invokeSignPhysicianOrderRpc({
    pofId,
    actor,
    signedAtIso,
    pofRequestId: options?.pofRequestId,
    serviceRole: options?.serviceRole
  });

  return processSignedPhysicianOrderPostSignSync({
    pofId: transition.physician_order_id,
    memberId: transition.member_id,
    queueId: transition.queue_id,
    queueAttemptCount: transition.queue_attempt_count,
    actor,
    signedAtIso,
    pofRequestId: options?.pofRequestId,
    serviceRole: options?.serviceRole
  });
}

export async function retryQueuedPhysicianOrderPostSignSync(input?: {
  limit?: number;
  serviceRole?: boolean;
  actor?: { id: string | null; fullName: string | null };
}) {
  const serviceRole = input?.serviceRole ?? true;
  const now = toEasternISO();
  const limit = Math.min(100, Math.max(1, input?.limit ?? 25));
  const actor = input?.actor ?? {
    id: null,
    fullName: "System Post-Sign Sync Retry"
  };
  const rows = await claimQueuedPhysicianOrderPostSignSyncRows({
    limit,
    claimAt: now,
    actor,
    serviceRole
  });

  let processed = 0;
  let succeeded = 0;
  let queued = 0;

  for (const row of rows) {
    processed += 1;
    const attemptCount = Math.max(0, Number(row.attempt_count ?? 0)) + 1;
    const postSign = await runSignedPofPostSignBoundary({
      pofId: row.physician_order_id,
      syncTimestamp: now,
      serviceRole
    });

    if (postSign.ok) {
      await markPostSignQueueCompleted({
        queueId: row.id,
        attemptCount,
        actor,
        completedAt: now,
        pofRequestId: row.pof_request_id,
        serviceRole
      });
      succeeded += 1;
      continue;
    }

    const nextRetryAt = computePostSignRetryAt(attemptCount, now);
    await markPostSignQueueQueued({
      queueId: row.id,
      attemptCount,
      step: postSign.step,
      errorMessage: postSign.errorMessage,
      nextRetryAt,
      pofRequestId: row.pof_request_id,
      actor,
      queuedAt: now,
      serviceRole
    });
    queued += 1;
  }

  const agedQueueAlertSummary = await emitAgedPostSignSyncQueueAlerts({
    nowIso: now,
    serviceRole,
    actorUserId: actor.id
  });

  return {
    processed,
    succeeded,
    queued,
    agedQueueRows: agedQueueAlertSummary.agedQueueRows,
    agedQueueAlertsRaised: agedQueueAlertSummary.alertsRaised,
    agedQueueAlertAgeMinutes: agedQueueAlertSummary.alertAgeMinutes
  };
}

export async function syncMemberHealthProfileFromSignedPhysicianOrder(
  pofId: string,
  options?: {
    serviceRole?: boolean;
  }
) {
  const form = await getPhysicianOrderById(pofId, { serviceRole: options?.serviceRole });
  if (!form) throw new Error("Physician order not found for sync.");
  if (form.status !== "Signed") return null;
  await invokeSyncSignedPofToMemberClinicalProfileRpc({
    pofId,
    syncTimestamp: toEasternISO(),
    serviceRole: options?.serviceRole
  });

  return getMemberHealthProfile(form.memberId, {
    canonicalInput: true,
    serviceRole: options?.serviceRole
  });
}
