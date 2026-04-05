import "server-only";

import { emitAgedEnrollmentPacketFollowUpQueueAlerts } from "@/lib/services/enrollment-packet-follow-up";
import { emitEnrollmentPacketMappingRetryHealthAlerts } from "@/lib/services/enrollment-packet-mapping-runtime";
import { recordWorkflowMilestone } from "@/lib/services/lifecycle-milestones";
import type { JsonValue } from "@/lib/services/notification-types";
import { emitAgedPostSignSyncQueueAlerts } from "@/lib/services/physician-order-post-sign-runtime";
import { recordImmediateSystemAlert } from "@/lib/services/workflow-observability";
import { toEasternISO } from "@/lib/timezone";

export type InternalRunnerHealthStatus = "healthy" | "degraded" | "missing_config";
export type InternalRunnerHealthReason =
  | "runner_not_configured"
  | "aged_queue"
  | "stale_claim"
  | "retry_queued"
  | null;
export type InternalRunnerReleaseSafetyStatus = "release_safe" | "action_required";

export type InternalRunnerReleaseSafetySignal = {
  releaseSafetyMessage: string;
  releaseSafetyStatus: InternalRunnerReleaseSafetyStatus;
};

type RunnerActionRequiredInput = {
  actorUserId?: string | null;
  entityType: "physician_order" | "enrollment_packet_request";
  eventKeySuffix: string;
  message: string;
  metadata: Record<string, JsonValue>;
  title: string;
};

type PofRunnerHealthSummary = {
  agedQueueAlertAgeMinutes: number;
  agedQueueAlertsRaised: number;
  agedQueueRows: number;
};

type EnrollmentPacketMappingRunnerHealthSummary = {
  agedQueueAlertAgeMinutes: number;
  agedQueueAlertsRaised: number;
  agedQueueRows: number;
  followUpAgedQueueAlertAgeMinutes: number;
  followUpAgedQueueAlertsRaised: number;
  followUpAgedQueueRows: number;
  staleClaimAgeMinutes: number;
  staleClaimAlertsRaised: number;
  staleClaimRows: number;
};

export type PofPostSignSyncRunnerHealth = PofRunnerHealthSummary & {
  healthReason: InternalRunnerHealthReason;
  healthStatus: InternalRunnerHealthStatus;
  releaseSafetyMessage: string;
  releaseSafetyStatus: InternalRunnerReleaseSafetyStatus;
  runnerConfigured: boolean;
  timestamp: string;
};

export type EnrollmentPacketMappingRunnerHealth = EnrollmentPacketMappingRunnerHealthSummary & {
  healthReason: InternalRunnerHealthReason;
  healthStatus: InternalRunnerHealthStatus;
  releaseSafetyMessage: string;
  releaseSafetyStatus: InternalRunnerReleaseSafetyStatus;
  runnerConfigured: boolean;
  timestamp: string;
};

const POF_POST_SIGN_SYNC_ROUTE = "/api/internal/pof-post-sign-sync";
const ENROLLMENT_PACKET_MAPPING_SYNC_ROUTE = "/api/internal/enrollment-packet-mapping-sync";

function clean(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeSecrets(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => clean(value)).filter((value): value is string => Boolean(value)))];
}

async function recordRunnerActionRequired(input: RunnerActionRequiredInput) {
  try {
    await recordWorkflowMilestone({
      event: {
        eventType: "action_required",
        entityType: input.entityType,
        entityId: null,
        actorType: "system",
        actorUserId: input.actorUserId ?? null,
        status: "open",
        severity: "high",
        eventKeySuffix: input.eventKeySuffix,
        reopenOnConflict: true,
        requireRecipients: true,
        metadata: {
          title: input.title,
          message: input.message,
          priority: "high",
          action_url: "/notifications",
          ...input.metadata
        }
      }
    });
  } catch (error) {
    console.error("[internal-runner-health] unable to emit action-required runner health milestone", error);
  }
}

export function getAcceptedPofPostSignSyncRunnerSecrets() {
  return normalizeSecrets([process.env.POF_POST_SIGN_SYNC_SECRET, process.env.CRON_SECRET]);
}

export function getPofPostSignSyncRunnerConfigError() {
  return "POF post-sign sync runner is not configured. Set POF_POST_SIGN_SYNC_SECRET for manual callers or CRON_SECRET for Vercel cron before scheduling this endpoint.";
}

export function getAcceptedEnrollmentPacketMappingRunnerSecrets() {
  return normalizeSecrets([process.env.ENROLLMENT_PACKET_MAPPING_SYNC_SECRET, process.env.CRON_SECRET]);
}

export function getEnrollmentPacketMappingRunnerConfigError() {
  return "Enrollment packet mapping retry runner is not configured. Set ENROLLMENT_PACKET_MAPPING_SYNC_SECRET for manual callers or CRON_SECRET for Vercel cron before scheduling this endpoint.";
}

export function resolveInternalRunnerReleaseSafety(input: {
  healthReason: InternalRunnerHealthReason;
  healthStatus: InternalRunnerHealthStatus;
  runnerConfigured: boolean;
  workflowLabel: string;
}): InternalRunnerReleaseSafetySignal {
  const workflowLabel = clean(input.workflowLabel) ?? "Queued workflow";
  if (!input.runnerConfigured || input.healthStatus === "missing_config") {
    return {
      releaseSafetyStatus: "action_required",
      releaseSafetyMessage: `${workflowLabel} runner is not configured. Queued work is not release-safe until the runner secret is fixed.`
    };
  }

  if (input.healthReason === "stale_claim") {
    return {
      releaseSafetyStatus: "action_required",
      releaseSafetyMessage: `${workflowLabel} has stale claimed work. Do not treat queued downstream work as release-safe until the runner recovers.`
    };
  }

  if (input.healthReason === "aged_queue" || input.healthReason === "retry_queued") {
    return {
      releaseSafetyStatus: "action_required",
      releaseSafetyMessage: `${workflowLabel} has delayed queued work. Do not treat downstream completion as release-safe until the queue clears.`
    };
  }

  return {
    releaseSafetyStatus: "release_safe",
    releaseSafetyMessage: `${workflowLabel} runner is configured and no delayed queued work was detected.`
  };
}

async function recordPofRunnerConfigMissingSignal(input: {
  actorUserId?: string | null;
}) {
  const message = getPofPostSignSyncRunnerConfigError();

  try {
    await recordImmediateSystemAlert({
      entityType: "physician_order",
      entityId: null,
      actorUserId: input.actorUserId ?? null,
      severity: "high",
      alertKey: "pof_post_sign_sync_runner_not_configured",
      metadata: {
        route: POF_POST_SIGN_SYNC_ROUTE,
        expected_secret_names: ["POF_POST_SIGN_SYNC_SECRET", "CRON_SECRET"],
        message
      }
    });
  } catch (error) {
    console.error("[internal-runner-health] unable to persist POF runner missing-config alert", error);
  }

  await recordRunnerActionRequired({
    entityType: "physician_order",
    actorUserId: input.actorUserId ?? null,
    eventKeySuffix: "pof-post-sign-sync-runner-not-configured",
    title: "POF Post-Sign Sync Runner Misconfigured",
    message:
      "Signed POF downstream sync is queued, but the internal runner is not configured. Set the runner secret before treating queued post-sign sync as release-safe.",
    metadata: {
      route: POF_POST_SIGN_SYNC_ROUTE,
      expected_secret_names: ["POF_POST_SIGN_SYNC_SECRET", "CRON_SECRET"],
      health_reason: "runner_not_configured"
    }
  });
}

async function recordPofAgedQueueSignal(input: {
  actorUserId?: string | null;
  summary: PofRunnerHealthSummary;
}) {
  await recordRunnerActionRequired({
    entityType: "physician_order",
    actorUserId: input.actorUserId ?? null,
    eventKeySuffix: "pof-post-sign-sync-aged-queue",
    title: "POF Post-Sign Sync Queue Delayed",
    message: `${input.summary.agedQueueRows} signed POF sync queue item(s) are older than ${input.summary.agedQueueAlertAgeMinutes} minute(s). Review runner health before relying on downstream sync completion.`,
    metadata: {
      route: POF_POST_SIGN_SYNC_ROUTE,
      queue_name: "pof_post_sign_sync_queue",
      health_reason: "aged_queue",
      aged_queue_rows: input.summary.agedQueueRows,
      alert_age_minutes: input.summary.agedQueueAlertAgeMinutes
    }
  });
}

async function recordEnrollmentPacketMappingRunnerConfigMissingSignal(input: {
  actorUserId?: string | null;
}) {
  const message = getEnrollmentPacketMappingRunnerConfigError();

  try {
    await recordImmediateSystemAlert({
      entityType: "enrollment_packet_request",
      entityId: null,
      actorUserId: input.actorUserId ?? null,
      severity: "high",
      alertKey: "enrollment_packet_mapping_sync_runner_not_configured",
      metadata: {
        route: ENROLLMENT_PACKET_MAPPING_SYNC_ROUTE,
        expected_secret_names: ["ENROLLMENT_PACKET_MAPPING_SYNC_SECRET", "CRON_SECRET"],
        message
      }
    });
  } catch (error) {
    console.error(
      "[internal-runner-health] unable to persist enrollment mapping runner missing-config alert",
      error
    );
  }

  await recordRunnerActionRequired({
    entityType: "enrollment_packet_request",
    actorUserId: input.actorUserId ?? null,
    eventKeySuffix: "enrollment-packet-mapping-runner-not-configured",
    title: "Enrollment Mapping Runner Misconfigured",
    message:
      "Enrollment packet downstream mapping is queued, but the internal retry runner is not configured. Set the runner secret before treating enrollment handoff as release-safe.",
    metadata: {
      route: ENROLLMENT_PACKET_MAPPING_SYNC_ROUTE,
      expected_secret_names: ["ENROLLMENT_PACKET_MAPPING_SYNC_SECRET", "CRON_SECRET"],
      health_reason: "runner_not_configured"
    }
  });
}

async function recordEnrollmentPacketMappingDelayedSignal(input: {
  actorUserId?: string | null;
  summary: EnrollmentPacketMappingRunnerHealthSummary;
}) {
  const messageParts: string[] = [];
  if (input.summary.agedQueueRows > 0) {
    messageParts.push(
      `${input.summary.agedQueueRows} aged retry item(s) older than ${input.summary.agedQueueAlertAgeMinutes} minute(s)`
    );
  }
  if (input.summary.followUpAgedQueueRows > 0) {
    messageParts.push(
      `${input.summary.followUpAgedQueueRows} aged follow-up item(s) older than ${input.summary.followUpAgedQueueAlertAgeMinutes} minute(s)`
    );
  }
  if (input.summary.staleClaimRows > 0) {
    messageParts.push(
      `${input.summary.staleClaimRows} stale claimed item(s) older than ${input.summary.staleClaimAgeMinutes} minute(s)`
    );
  }

  await recordRunnerActionRequired({
    entityType: "enrollment_packet_request",
    actorUserId: input.actorUserId ?? null,
    eventKeySuffix: "enrollment-packet-mapping-runner-delayed",
    title: "Enrollment Mapping Queue Delayed",
    message: `${messageParts.join(" and ")}. Review runner health before treating enrollment follow-up and downstream mapping as complete.`,
    metadata: {
      route: ENROLLMENT_PACKET_MAPPING_SYNC_ROUTE,
      mapping_queue_name: "enrollment_packet_requests.mapping_sync_status",
      follow_up_queue_name: "enrollment_packet_follow_up_queue",
      health_reason: input.summary.staleClaimRows > 0 ? "stale_claim" : "aged_queue",
      aged_queue_rows: input.summary.agedQueueRows,
      alert_age_minutes: input.summary.agedQueueAlertAgeMinutes,
      follow_up_aged_queue_rows: input.summary.followUpAgedQueueRows,
      follow_up_alert_age_minutes: input.summary.followUpAgedQueueAlertAgeMinutes,
      stale_claim_rows: input.summary.staleClaimRows,
      stale_claim_age_minutes: input.summary.staleClaimAgeMinutes
    }
  });
}

export async function getPofPostSignSyncRunnerHealth(input?: {
  actorUserId?: string | null;
  nowIso?: string;
  summary?: PofRunnerHealthSummary;
}) {
  const timestamp = clean(input?.nowIso) ?? toEasternISO();
  if (getAcceptedPofPostSignSyncRunnerSecrets().length === 0) {
    await recordPofRunnerConfigMissingSignal({ actorUserId: input?.actorUserId ?? null });
    return {
      timestamp,
      runnerConfigured: false,
      healthStatus: "missing_config" as const,
      healthReason: "runner_not_configured" as const,
      agedQueueRows: 0,
      agedQueueAlertsRaised: 0,
      agedQueueAlertAgeMinutes: 0
    } satisfies PofPostSignSyncRunnerHealth;
  }

  let summary: PofRunnerHealthSummary;
  if (input?.summary) {
    summary = input.summary;
  } else {
    const result = await emitAgedPostSignSyncQueueAlerts({
      nowIso: timestamp,
      serviceRole: true,
      actorUserId: input?.actorUserId ?? null
    });
    summary = {
      agedQueueRows: result.agedQueueRows,
      agedQueueAlertsRaised: result.alertsRaised,
      agedQueueAlertAgeMinutes: result.alertAgeMinutes
    };
  }

  if (summary.agedQueueRows > 0) {
    await recordPofAgedQueueSignal({
      actorUserId: input?.actorUserId ?? null,
      summary
    });
  }

  return {
    timestamp,
    runnerConfigured: true,
    healthStatus: summary.agedQueueRows > 0 ? "degraded" : "healthy",
    healthReason: summary.agedQueueRows > 0 ? "aged_queue" : null,
    ...summary
  } satisfies PofPostSignSyncRunnerHealth;
}

export async function getEnrollmentPacketMappingRunnerHealth(input?: {
  actorUserId?: string | null;
  nowIso?: string;
  summary?: EnrollmentPacketMappingRunnerHealthSummary;
}) {
  const timestamp = clean(input?.nowIso) ?? toEasternISO();
  if (getAcceptedEnrollmentPacketMappingRunnerSecrets().length === 0) {
    await recordEnrollmentPacketMappingRunnerConfigMissingSignal({
      actorUserId: input?.actorUserId ?? null
    });
    return {
      timestamp,
      runnerConfigured: false,
      healthStatus: "missing_config" as const,
      healthReason: "runner_not_configured" as const,
      agedQueueRows: 0,
      agedQueueAlertsRaised: 0,
      agedQueueAlertAgeMinutes: 0,
      followUpAgedQueueRows: 0,
      followUpAgedQueueAlertsRaised: 0,
      followUpAgedQueueAlertAgeMinutes: 0,
      staleClaimRows: 0,
      staleClaimAlertsRaised: 0,
      staleClaimAgeMinutes: 0
    } satisfies EnrollmentPacketMappingRunnerHealth;
  }

  let summary: EnrollmentPacketMappingRunnerHealthSummary;
  if (input?.summary) {
    summary = input.summary;
  } else {
    const [result, followUpResult] = await Promise.all([
      emitEnrollmentPacketMappingRetryHealthAlerts({
        nowIso: timestamp,
        actorUserId: input?.actorUserId ?? null
      }),
      emitAgedEnrollmentPacketFollowUpQueueAlerts({
        nowIso: timestamp,
        actorUserId: input?.actorUserId ?? null
      })
    ]);
    summary = {
      agedQueueRows: result.agedQueueRows,
      agedQueueAlertsRaised: result.agedQueueAlertsRaised,
      agedQueueAlertAgeMinutes: result.alertAgeMinutes,
      followUpAgedQueueRows: followUpResult.agedQueueRows,
      followUpAgedQueueAlertsRaised: followUpResult.alertsRaised,
      followUpAgedQueueAlertAgeMinutes: followUpResult.alertAgeMinutes,
      staleClaimRows: result.staleClaimRows,
      staleClaimAlertsRaised: result.staleClaimAlertsRaised,
      staleClaimAgeMinutes: result.staleClaimAgeMinutes
    };
  }

  if (summary.agedQueueRows > 0 || summary.followUpAgedQueueRows > 0 || summary.staleClaimRows > 0) {
    await recordEnrollmentPacketMappingDelayedSignal({
      actorUserId: input?.actorUserId ?? null,
      summary
    });
  }

  return {
    timestamp,
    runnerConfigured: true,
    healthStatus:
      summary.agedQueueRows > 0 || summary.followUpAgedQueueRows > 0 || summary.staleClaimRows > 0
        ? "degraded"
        : "healthy",
    healthReason:
      summary.staleClaimRows > 0
        ? "stale_claim"
        : summary.agedQueueRows > 0 || summary.followUpAgedQueueRows > 0
          ? "aged_queue"
          : null,
    ...summary
  } satisfies EnrollmentPacketMappingRunnerHealth;
}
