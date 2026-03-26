import "server-only";

import {
  clean,
  cleanEmail,
  hashToken
} from "@/lib/services/enrollment-packet-core";
import {
  resolveEnrollmentPacketOperationalReadiness,
  toEnrollmentPacketMappingSyncStatus
} from "@/lib/services/enrollment-packet-readiness";
import type {
  EnrollmentPacketRequestRow,
  EnrollmentPacketTokenMatch,
  PacketFileUpload
} from "@/lib/services/enrollment-packet-types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { toEasternISO } from "@/lib/timezone";
import {
  maybeRecordRepeatedFailureAlert,
  recordImmediateSystemAlert,
  recordWorkflowEvent
} from "@/lib/services/workflow-observability";

export type PublicEnrollmentPacketGuardFailureInput = {
  request?: EnrollmentPacketRequestRow | null;
  token?: string | null;
  caregiverIp?: string | null;
  caregiverUserAgent?: string | null;
  failureType: string;
  message: string;
  uploadCount?: number;
  uploadBytes?: number;
  severity?: "low" | "medium" | "high" | "critical";
};

export type PublicEnrollmentPacketSubmissionGuardLimits = {
  uploadCountLimit: number;
  uploadBytesLimit: number;
  totalUploadMb: number;
  submitLookbackMinutes: number;
  tokenAttemptLimit: number;
  ipAttemptLimit: number;
};

function buildEnrollmentPacketPublicIpFingerprint(ipAddress: string | null | undefined) {
  const normalized = clean(ipAddress);
  return normalized ? hashToken(`enrollment-packet-ip:${normalized}`) : null;
}

function sumEnrollmentPacketUploadBytes(uploads: PacketFileUpload[] | null | undefined) {
  return (uploads ?? []).reduce((total, upload) => total + (upload.bytes?.length ?? 0), 0);
}

async function countRecentSystemEvents(input: {
  eventType: string;
  entityType: string;
  entityId: string;
  status?: string | null;
  sinceIso: string;
}) {
  const admin = createSupabaseAdminClient();
  let query = admin
    .from("system_events")
    .select("id", { count: "exact", head: true })
    .eq("event_type", input.eventType)
    .eq("entity_type", input.entityType)
    .eq("entity_id", input.entityId)
    .gte("created_at", input.sinceIso);

  if (input.status) {
    query = query.eq("status", input.status);
  }

  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return Number(count ?? 0);
}

async function logPublicEnrollmentPacketGuardFailure(input: PublicEnrollmentPacketGuardFailureInput & {
  resolveRequestByToken: (token: string) => Promise<EnrollmentPacketTokenMatch | null>;
}) {
  const normalizedToken = clean(input.token);
  const request =
    input.request ??
    (normalizedToken ? (await input.resolveRequestByToken(normalizedToken))?.request ?? null : null);
  const ipFingerprint = buildEnrollmentPacketPublicIpFingerprint(input.caregiverIp);
  const baseMetadata = {
    failure_type: input.failureType,
    message: input.message,
    ip_fingerprint: ipFingerprint,
    user_agent: clean(input.caregiverUserAgent),
    upload_count: input.uploadCount ?? 0,
    upload_bytes: input.uploadBytes ?? 0
  };
  const severity = input.severity ?? "high";

  await recordWorkflowEvent({
    eventType: "enrollment_packet_public_guard_rejected",
    entityType: request ? "enrollment_packet_request" : "enrollment_packet_public_token",
    entityId: request?.id ?? (normalizedToken ? hashToken(`enrollment-packet-token:${normalizedToken}`) : null),
    actorType: "system",
    actorUserId: request?.sender_user_id ?? null,
    status: "failed",
    severity,
    metadata: request
      ? {
          member_id: request.member_id,
          lead_id: request.lead_id,
          ...baseMetadata
        }
      : baseMetadata
  });

  if (request?.id) {
    await maybeRecordRepeatedFailureAlert({
      workflowEventType: "enrollment_packet_public_guard_rejected",
      entityType: "enrollment_packet_request",
      entityId: request.id,
      actorUserId: request.sender_user_id,
      threshold: 3,
      metadata: {
        member_id: request.member_id,
        lead_id: request.lead_id,
        failure_type: input.failureType
      }
    });
  }

  if (ipFingerprint) {
    await recordWorkflowEvent({
      eventType: "enrollment_packet_public_guard_rejected",
      entityType: "enrollment_packet_public_ip",
      entityId: ipFingerprint,
      actorType: "system",
      actorUserId: request?.sender_user_id ?? null,
      status: "failed",
      severity,
      metadata: {
        packet_id: request?.id ?? null,
        member_id: request?.member_id ?? null,
        lead_id: request?.lead_id ?? null,
        ...baseMetadata
      }
    });
    await maybeRecordRepeatedFailureAlert({
      workflowEventType: "enrollment_packet_public_guard_rejected",
      entityType: "enrollment_packet_public_ip",
      entityId: ipFingerprint,
      actorUserId: request?.sender_user_id ?? null,
      threshold: 3,
      metadata: {
        packet_id: request?.id ?? null,
        member_id: request?.member_id ?? null,
        failure_type: input.failureType
      }
    });
  }
}

export async function recordPublicEnrollmentPacketGuardFailure(input: Omit<PublicEnrollmentPacketGuardFailureInput, "request"> & {
  resolveRequestByToken: (token: string) => Promise<EnrollmentPacketTokenMatch | null>;
}) {
  return logPublicEnrollmentPacketGuardFailure({
    ...input,
    request: null
  });
}

export async function enforcePublicEnrollmentPacketSubmissionGuards(input: {
  request: EnrollmentPacketRequestRow;
  caregiverIp: string | null;
  caregiverUserAgent: string | null;
  uploads: PacketFileUpload[];
  limits: PublicEnrollmentPacketSubmissionGuardLimits;
}) {
  const uploadCount = input.uploads.length;
  const uploadBytes = sumEnrollmentPacketUploadBytes(input.uploads);
  const ipFingerprint = buildEnrollmentPacketPublicIpFingerprint(input.caregiverIp);
  const rateWindowStart = new Date(
    Date.now() - input.limits.submitLookbackMinutes * 60 * 1000
  ).toISOString();

  if (uploadCount > input.limits.uploadCountLimit) {
    await logPublicEnrollmentPacketGuardFailure({
      request: input.request,
      caregiverIp: input.caregiverIp,
      caregiverUserAgent: input.caregiverUserAgent,
      failureType: "upload_count_cap_exceeded",
      message: `Too many files were attached to this enrollment packet submission (${uploadCount}).`,
      uploadCount,
      uploadBytes,
      severity: "high",
      resolveRequestByToken: async () => null
    });
    throw new Error(
      `Too many files attached. Upload up to ${input.limits.uploadCountLimit} files per submission.`
    );
  }

  if (uploadBytes > input.limits.uploadBytesLimit) {
    await logPublicEnrollmentPacketGuardFailure({
      request: input.request,
      caregiverIp: input.caregiverIp,
      caregiverUserAgent: input.caregiverUserAgent,
      failureType: "upload_cumulative_size_cap_exceeded",
      message: `Combined enrollment packet uploads exceeded the ${input.limits.totalUploadMb}MB cap.`,
      uploadCount,
      uploadBytes,
      severity: "high",
      resolveRequestByToken: async () => null
    });
    throw new Error(
      `Attached files are too large in total. Maximum combined upload size is ${input.limits.totalUploadMb}MB.`
    );
  }

  const tokenAttemptCount = await countRecentSystemEvents({
    eventType: "enrollment_packet_public_submit_attempt",
    entityType: "enrollment_packet_request",
    entityId: input.request.id,
    status: "started",
    sinceIso: rateWindowStart
  });
  if (tokenAttemptCount >= input.limits.tokenAttemptLimit) {
    await logPublicEnrollmentPacketGuardFailure({
      request: input.request,
      caregiverIp: input.caregiverIp,
      caregiverUserAgent: input.caregiverUserAgent,
      failureType: "token_rate_limit_exceeded",
      message: `Enrollment packet submission throttled after ${tokenAttemptCount} recent token attempts.`,
      uploadCount,
      uploadBytes,
      severity: "high",
      resolveRequestByToken: async () => null
    });
    throw new Error(
      `Too many recent submission attempts for this enrollment packet. Wait ${input.limits.submitLookbackMinutes} minutes and try again.`
    );
  }

  if (ipFingerprint) {
    const ipAttemptCount = await countRecentSystemEvents({
      eventType: "enrollment_packet_public_submit_attempt",
      entityType: "enrollment_packet_public_ip",
      entityId: ipFingerprint,
      status: "started",
      sinceIso: rateWindowStart
    });
    if (ipAttemptCount >= input.limits.ipAttemptLimit) {
      await logPublicEnrollmentPacketGuardFailure({
        request: input.request,
        caregiverIp: input.caregiverIp,
        caregiverUserAgent: input.caregiverUserAgent,
        failureType: "ip_rate_limit_exceeded",
        message: `Enrollment packet submission throttled after ${ipAttemptCount} recent IP attempts.`,
        uploadCount,
        uploadBytes,
        severity: "high",
        resolveRequestByToken: async () => null
      });
      throw new Error(
        `Too many recent submission attempts from this connection. Wait ${input.limits.submitLookbackMinutes} minutes and try again.`
      );
    }
  }

  await recordWorkflowEvent({
    eventType: "enrollment_packet_public_submit_attempt",
    entityType: "enrollment_packet_request",
    entityId: input.request.id,
    actorType: "system",
    actorUserId: input.request.sender_user_id,
    status: "started",
    severity: "low",
    metadata: {
      member_id: input.request.member_id,
      lead_id: input.request.lead_id,
      ip_fingerprint: ipFingerprint,
      user_agent: clean(input.caregiverUserAgent),
      upload_count: uploadCount,
      upload_bytes: uploadBytes
    }
  });

  if (ipFingerprint) {
    await recordWorkflowEvent({
      eventType: "enrollment_packet_public_submit_attempt",
      entityType: "enrollment_packet_public_ip",
      entityId: ipFingerprint,
      actorType: "system",
      actorUserId: input.request.sender_user_id,
      status: "started",
      severity: "low",
      metadata: {
        packet_id: input.request.id,
        member_id: input.request.member_id,
        lead_id: input.request.lead_id,
        upload_count: uploadCount,
        upload_bytes: uploadBytes
      }
    });
  }
}

export async function insertPacketEvent(input: {
  packetId: string;
  eventType: string;
  actorUserId?: string | null;
  actorEmail?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("enrollment_packet_events").insert({
    packet_id: input.packetId,
    event_type: input.eventType,
    actor_user_id: input.actorUserId ?? null,
    actor_email: cleanEmail(input.actorEmail),
    timestamp: toEasternISO(),
    metadata: input.metadata ?? {}
  });
  if (!error) return true;

  console.error("[enrollment-packets] packet event insert failed after committed workflow write", {
    packetId: input.packetId,
    eventType: input.eventType,
    message: error.message
  });
  try {
    await recordImmediateSystemAlert({
      entityType: "enrollment_packet_request",
      entityId: input.packetId,
      actorUserId: input.actorUserId ?? null,
      severity: "medium",
      alertKey: "enrollment_packet_event_insert_failed",
      metadata: {
        actor_email: cleanEmail(input.actorEmail),
        event_type: input.eventType,
        error: error.message
      }
    });
  } catch (alertError) {
    const alertMessage = alertError instanceof Error ? alertError.message : "Unknown system alert error.";
    console.error("[enrollment-packets] system alert insert failed after packet event insert failure", {
      packetId: input.packetId,
      eventType: input.eventType,
      message: alertMessage
    });
  }
  return false;
}

function buildEnrollmentPacketActionNeededMessage(input: {
  status: "completed";
  mappingSyncStatus: string | null | undefined;
}) {
  const operationalReadinessStatus = resolveEnrollmentPacketOperationalReadiness({
    status: input.status,
    mappingSyncStatus: input.mappingSyncStatus
  });

  if (operationalReadinessStatus === "filed_pending_mapping") {
    return {
      operationalReadinessStatus,
      actionNeededMessage:
        "Enrollment packet was completed, but downstream setup is still pending. Staff should wait for mapping completion before treating the member as operationally ready."
    } as const;
  }

  if (operationalReadinessStatus === "mapping_failed") {
    return {
      operationalReadinessStatus,
      actionNeededMessage:
        "Enrollment packet was completed, but downstream sync still needs staff follow-up before the member is operationally ready."
    } as const;
  }

  return {
    operationalReadinessStatus,
    actionNeededMessage: null
  } as const;
}

export function buildPublicEnrollmentPacketSubmitResult(input: {
  packetId: string;
  memberId: string;
  mappingSyncStatus: string | null | undefined;
  wasAlreadyFiled: boolean;
}) {
  const mappingSyncStatus = toEnrollmentPacketMappingSyncStatus(input.mappingSyncStatus);
  const readiness = buildEnrollmentPacketActionNeededMessage({
    status: "completed",
    mappingSyncStatus
  });

  return {
    packetId: input.packetId,
    memberId: input.memberId,
    status: "completed" as const,
    mappingSyncStatus,
    operationalReadinessStatus: readiness.operationalReadinessStatus,
    actionNeededMessage: readiness.actionNeededMessage,
    wasAlreadyFiled: input.wasAlreadyFiled
  };
}
