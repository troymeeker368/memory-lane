import "server-only";

import {
  processSignedPhysicianOrderPostSignSync
} from "@/lib/services/physician-orders-supabase";
import { getPhysicianOrderClinicalSyncState } from "@/lib/services/physician-orders-read";
import {
  clean,
  createSignedStorageUrl,
  type PofRequestRow
} from "@/lib/services/pof-esign-core";
import { recordWorkflowMilestone } from "@/lib/services/lifecycle-milestones";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordImmediateSystemAlert, recordWorkflowEvent } from "@/lib/services/workflow-observability";

type FinalizedPofSignatureFollowUpRow = {
  request_id: string;
  physician_order_id: string;
  member_id: string;
  member_file_id: string | null;
  queue_id: string;
  queue_attempt_count: number;
};

export type PublicPofPostSignOutcome = {
  postSignStatus: "synced" | "queued";
  retry: {
    queueId: string | null;
    attemptCount: number;
    nextRetryAt: string | null;
    lastError: string | null;
  };
  actionNeeded: boolean;
  actionNeededMessage: string | null;
};

async function recordPofAlertSafely(input: Parameters<typeof recordImmediateSystemAlert>[0], context: string) {
  try {
    await recordImmediateSystemAlert(input);
  } catch (error) {
    console.error("[pof-esign] unable to persist follow-up system alert", {
      context,
      entityId: input.entityId ?? null,
      alertKey: input.alertKey,
      message: error instanceof Error ? error.message : "Unknown system alert error."
    });
  }
}

function buildPublicPofPostSignOutcome(input: {
  postSignStatus: "synced" | "queued";
  queueId: string | null;
  attemptCount: number;
  nextRetryAt: string | null;
  lastError: string | null;
}): PublicPofPostSignOutcome {
  if (input.postSignStatus === "queued") {
    return {
      postSignStatus: "queued",
      retry: {
        queueId: input.queueId,
        attemptCount: input.attemptCount,
        nextRetryAt: clean(input.nextRetryAt),
        lastError: clean(input.lastError)
      },
      actionNeeded: true,
      actionNeededMessage:
        "Signature was durably recorded, but downstream MHP/MCC and MAR sync is still queued. Staff should not treat this order as operationally ready yet."
    };
  }

  return {
    postSignStatus: "synced",
    retry: {
      queueId: input.queueId,
      attemptCount: input.attemptCount,
      nextRetryAt: clean(input.nextRetryAt),
      lastError: clean(input.lastError)
    },
    actionNeeded: false,
    actionNeededMessage: null
  };
}

export async function maybeCreateSignedPofAccessUrl(input: {
  requestId: string;
  memberId: string;
  actorUserId: string;
  signedPdfStorageUrl: string | null;
}) {
  const storageUrl = clean(input.signedPdfStorageUrl);
  if (!storageUrl) return null;
  try {
    return await createSignedStorageUrl(storageUrl, 60 * 15);
  } catch (error) {
    await recordPofAlertSafely({
      entityType: "pof_request",
      entityId: input.requestId,
      actorUserId: input.actorUserId,
      severity: "medium",
      alertKey: "pof_signed_pdf_url_enrichment_failed",
      metadata: {
        member_id: input.memberId,
        signed_pdf_url: storageUrl,
        error: error instanceof Error ? error.message : "Unable to create signed PDF access URL."
      }
    }, "maybeCreateSignedPofAccessUrl");
    return null;
  }
}

export async function loadPublicPofPostSignOutcome(request: PofRequestRow): Promise<PublicPofPostSignOutcome> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("pof_post_sign_sync_queue")
    .select("id, status, attempt_count, next_retry_at, last_error")
    .eq("physician_order_id", request.physician_order_id)
    .maybeSingle();
  if (error) throw new Error(error.message);

  if (data) {
    return buildPublicPofPostSignOutcome({
      postSignStatus: data.status === "completed" ? "synced" : "queued",
      queueId: String(data.id),
      attemptCount: Math.max(0, Number(data.attempt_count ?? 0)),
      nextRetryAt: clean(data.next_retry_at),
      lastError: clean(data.last_error)
    });
  }

  const clinicalSyncStatus = await getPhysicianOrderClinicalSyncState(request.physician_order_id, {
    serviceRole: true
  });

  return buildPublicPofPostSignOutcome({
    postSignStatus: clinicalSyncStatus === "synced" ? "synced" : "queued",
    queueId: null,
    attemptCount: 0,
    nextRetryAt: null,
    lastError: null
  });
}

export async function runBestEffortCommittedPofSignatureFollowUp(input: {
  finalized: FinalizedPofSignatureFollowUpRow;
  request: PofRequestRow;
  signedAt: string;
}) {
  try {
    const postSignResult = await processSignedPhysicianOrderPostSignSync({
      pofId: input.finalized.physician_order_id,
      memberId: input.finalized.member_id,
      queueId: input.finalized.queue_id,
      queueAttemptCount: input.finalized.queue_attempt_count,
      actor: {
        id: input.request.sent_by_user_id,
        fullName: input.request.nurse_name
      },
      signedAtIso: input.signedAt,
      pofRequestId: input.finalized.request_id,
      serviceRole: true
    });

    try {
      await recordWorkflowMilestone({
        event: {
          event_type: "physician_order_signed",
          entity_type: "physician_order",
          entity_id: input.finalized.physician_order_id,
          actor_type: "provider",
          status: "signed",
          severity: "low",
          metadata: {
            member_id: input.finalized.member_id,
            pof_request_id: input.finalized.request_id,
            member_file_id: input.finalized.member_file_id,
            queue_id: input.finalized.queue_id,
            post_sign_status: postSignResult.postSignStatus,
            post_sign_attempt_count: postSignResult.attemptCount,
            post_sign_next_retry_at: postSignResult.nextRetryAt
          }
        }
      });
      await recordWorkflowEvent({
        eventType: "pof_request_signed",
        entityType: "pof_request",
        entityId: input.finalized.request_id,
        actorType: "provider",
        status: "signed",
        severity: "low",
        metadata: {
          member_id: input.finalized.member_id,
          physician_order_id: input.finalized.physician_order_id,
          member_file_id: input.finalized.member_file_id,
          post_sign_status: postSignResult.postSignStatus,
          post_sign_attempt_count: postSignResult.attemptCount,
          post_sign_next_retry_at: postSignResult.nextRetryAt
        }
      });
    } catch (loggingError) {
      const reason = loggingError instanceof Error ? loggingError.message : "Unable to record signed POF follow-up telemetry.";
      await recordWorkflowEvent({
        eventType: "pof_post_commit_followup_failed",
        entityType: "pof_request",
        entityId: input.finalized.request_id,
        actorType: "system",
        actorUserId: input.request.sent_by_user_id,
        status: "failed",
        severity: "high",
        metadata: {
          member_id: input.finalized.member_id,
          physician_order_id: input.finalized.physician_order_id,
          member_file_id: input.finalized.member_file_id,
          queue_id: input.finalized.queue_id,
          error: reason
        }
      });
      await recordPofAlertSafely({
        entityType: "pof_request",
        entityId: input.finalized.request_id,
        actorUserId: input.request.sent_by_user_id,
        severity: "high",
        alertKey: "pof_post_commit_followup_failed",
        metadata: {
          member_id: input.finalized.member_id,
          physician_order_id: input.finalized.physician_order_id,
          member_file_id: input.finalized.member_file_id,
          queue_id: input.finalized.queue_id,
          error: reason
        }
      }, "runBestEffortCommittedPofSignatureFollowUp");
    }

    return buildPublicPofPostSignOutcome({
      postSignStatus: postSignResult.postSignStatus,
      queueId: postSignResult.queueId,
      attemptCount: postSignResult.attemptCount,
      nextRetryAt: postSignResult.nextRetryAt,
      lastError: postSignResult.lastError
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unable to complete signed POF follow-up.";
    await recordWorkflowEvent({
      eventType: "pof_post_commit_followup_failed",
      entityType: "pof_request",
      entityId: input.finalized.request_id,
      actorType: "system",
      actorUserId: input.request.sent_by_user_id,
      status: "failed",
      severity: "high",
      metadata: {
        member_id: input.finalized.member_id,
        physician_order_id: input.finalized.physician_order_id,
        member_file_id: input.finalized.member_file_id,
        queue_id: input.finalized.queue_id,
        error: reason
      }
    });
    await recordPofAlertSafely({
      entityType: "pof_request",
      entityId: input.finalized.request_id,
      actorUserId: input.request.sent_by_user_id,
      severity: "high",
      alertKey: "pof_post_commit_followup_failed",
      metadata: {
        member_id: input.finalized.member_id,
        physician_order_id: input.finalized.physician_order_id,
        member_file_id: input.finalized.member_file_id,
        queue_id: input.finalized.queue_id,
        error: reason
      }
    }, "runBestEffortCommittedPofSignatureFollowUp");
    return buildPublicPofPostSignOutcome({
      postSignStatus: "queued",
      queueId: input.finalized.queue_id,
      attemptCount: Math.max(1, Number(input.finalized.queue_attempt_count ?? 0)),
      nextRetryAt: null,
      lastError: reason
    });
  }
}
