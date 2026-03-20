import "server-only";

import { randomUUID } from "node:crypto";

import {
  ensureCanonicalMemberForLead,
  resolveCanonicalLeadRef,
  resolveCanonicalMemberId
} from "@/lib/services/canonical-person-ref";
import {
  normalizeEnrollmentPacketIntakePayload,
  type EnrollmentPacketIntakePayload
} from "@/lib/services/enrollment-packet-intake-payload";
import {
  buildAppBaseUrl,
  clean,
  cleanEmail,
  generateSigningToken,
  hashToken,
  isActiveEnrollmentPacketUniqueViolation,
  isEmail,
  isExpired,
  isMissingRpcFunctionError,
  isRowFoundError,
  mergePublicProgressPayload,
  normalizeStaffTransportation,
  normalizeStoredIntakePayload,
  payloadMemberDisplayName,
  safeNumber,
  splitMemberName,
  toDeliveryStatus,
  toStatus,
  toSummary
} from "@/lib/services/enrollment-packet-core";
import {
  isEnrollmentPacketOperationallyReady,
  resolveEnrollmentPacketOperationalReadiness,
  toEnrollmentPacketMappingSyncStatus,
} from "@/lib/services/enrollment-packet-readiness";
import {
  addLeadActivity,
  getEnrollmentPacketSenderSignatureProfile,
  getLeadById,
  getMemberById,
  loadEnrollmentPacketArtifactOps,
  loadPacketFields,
  loadRequestById,
  recordEnrollmentPacketActionRequired,
  runEnrollmentPacketDownstreamMapping
} from "@/lib/services/enrollment-packet-mapping-runtime";
import {
  calculateInitialEnrollmentAmount,
  normalizeEnrollmentDateOnly
} from "@/lib/services/enrollment-packet-proration";
import {
  ENROLLMENT_PACKET_STATUS_VALUES,
  type CompletedEnrollmentPacketFilters,
  type CompletedEnrollmentPacketListItem,
  type EnrollmentPacketFieldsRow,
  type EnrollmentPacketRequestRow,
  type EnrollmentPacketStatus,
  type EnrollmentPacketTokenMatch,
  type EnrollmentPacketUploadCategory,
  type FinalizedEnrollmentPacketSubmissionRpcRow,
  type PacketFileUpload,
  type PublicEnrollmentPacketContext,
  type SenderProfileRow,
  type StaffTransportationOption
} from "@/lib/services/enrollment-packet-types";
import { recordWorkflowMilestone } from "@/lib/services/lifecycle-milestones";
import { resolveEnrollmentPricingForRequestedDays } from "@/lib/services/enrollment-pricing";
import {
  parseDataUrlPayload,
} from "@/lib/services/member-files";
import {
  maybeRecordRepeatedFailureAlert,
  recordImmediateSystemAlert,
  recordWorkflowEvent
} from "@/lib/services/workflow-observability";
import {
  buildRetryableWorkflowDeliveryError,
  throwDeliveryStateFinalizeFailure,
  type SendWorkflowDeliveryStatus
} from "@/lib/services/send-workflow-state";
import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";
import { buildMissingSchemaMessage, isMissingSchemaObjectError } from "@/lib/supabase/schema-errors";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { toEasternDate, toEasternISO } from "@/lib/timezone";

const ENROLLMENT_PACKET_COMPLETION_RPC = "rpc_finalize_enrollment_packet_submission";
const PREPARE_ENROLLMENT_PACKET_REQUEST_RPC = "rpc_prepare_enrollment_packet_request";
const TRANSITION_ENROLLMENT_PACKET_DELIVERY_STATE_RPC = "rpc_transition_enrollment_packet_delivery_state";
const SAVE_ENROLLMENT_PACKET_PROGRESS_RPC = "rpc_save_enrollment_packet_progress";
const ENROLLMENT_PACKET_DELIVERY_RPC_MIGRATION = "0073_delivery_and_member_file_rpc_hardening.sql";
const ENROLLMENT_PACKET_COMPLETION_MIGRATION = "0053_artifact_drift_replay_hardening.sql";
const PUBLIC_ENROLLMENT_PACKET_UPLOAD_COUNT_LIMIT = 12;
const PUBLIC_ENROLLMENT_PACKET_TOTAL_UPLOAD_BYTES_LIMIT = 30 * 1024 * 1024;
const PUBLIC_ENROLLMENT_PACKET_TOTAL_UPLOAD_MB = PUBLIC_ENROLLMENT_PACKET_TOTAL_UPLOAD_BYTES_LIMIT / (1024 * 1024);
const PUBLIC_ENROLLMENT_PACKET_SUBMIT_LOOKBACK_MINUTES = 15;
const PUBLIC_ENROLLMENT_PACKET_TOKEN_SUBMIT_ATTEMPT_LIMIT = 5;
const PUBLIC_ENROLLMENT_PACKET_IP_SUBMIT_ATTEMPT_LIMIT = 10;

export { ENROLLMENT_PACKET_STATUS_VALUES };
export type {
  CompletedEnrollmentPacketFilters,
  CompletedEnrollmentPacketListItem,
  EnrollmentPacketRequestSummary,
  EnrollmentPacketStatus,
  PublicEnrollmentPacketContext
} from "@/lib/services/enrollment-packet-types";
export {
  getEnrollmentPacketSenderSignatureProfile,
  retryFailedEnrollmentPacketMappings
} from "@/lib/services/enrollment-packet-mapping-runtime";

async function loadEnrollmentPacketTemplateBuilder() {
  const { buildEnrollmentPacketTemplate } = await import("@/lib/email/templates/enrollment-packet");
  return buildEnrollmentPacketTemplate;
}

async function loadEnrollmentPacketCompletionValidator() {
  const { validateEnrollmentPacketCompletion } = await import("@/lib/services/enrollment-packet-public-validation");
  return validateEnrollmentPacketCompletion;
}

async function loadRequestByToken(rawToken: string): Promise<EnrollmentPacketTokenMatch | null> {
  const hashed = hashToken(rawToken);
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("enrollment_packet_requests")
    .select("*")
    .eq("token", hashed)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data) {
    return {
      request: data as EnrollmentPacketRequestRow,
      tokenMatch: "active"
    };
  }

  const { data: consumedData, error: consumedError } = await admin
    .from("enrollment_packet_requests")
    .select("*")
    .eq("last_consumed_submission_token_hash", hashed)
    .maybeSingle();
  if (consumedError) throw new Error(consumedError.message);
  if (!consumedData) return null;
  return {
    request: consumedData as EnrollmentPacketRequestRow,
    tokenMatch: "consumed"
  };
}

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

type PublicEnrollmentPacketGuardFailureInput = {
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

async function logPublicEnrollmentPacketGuardFailure(input: PublicEnrollmentPacketGuardFailureInput) {
  const normalizedToken = clean(input.token);
  const request =
    input.request ??
    (normalizedToken ? (await loadRequestByToken(normalizedToken))?.request ?? null : null);
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

export async function recordPublicEnrollmentPacketGuardFailure(
  input: Omit<PublicEnrollmentPacketGuardFailureInput, "request">
) {
  return logPublicEnrollmentPacketGuardFailure({
    ...input,
    request: null
  });
}

async function enforcePublicEnrollmentPacketSubmissionGuards(input: {
  request: EnrollmentPacketRequestRow;
  caregiverIp: string | null;
  caregiverUserAgent: string | null;
  uploads: PacketFileUpload[];
}) {
  const uploadCount = input.uploads.length;
  const uploadBytes = sumEnrollmentPacketUploadBytes(input.uploads);
  const ipFingerprint = buildEnrollmentPacketPublicIpFingerprint(input.caregiverIp);
  const rateWindowStart = new Date(
    Date.now() - PUBLIC_ENROLLMENT_PACKET_SUBMIT_LOOKBACK_MINUTES * 60 * 1000
  ).toISOString();

  if (uploadCount > PUBLIC_ENROLLMENT_PACKET_UPLOAD_COUNT_LIMIT) {
    await logPublicEnrollmentPacketGuardFailure({
      request: input.request,
      caregiverIp: input.caregiverIp,
      caregiverUserAgent: input.caregiverUserAgent,
      failureType: "upload_count_cap_exceeded",
      message: `Too many files were attached to this enrollment packet submission (${uploadCount}).`,
      uploadCount,
      uploadBytes,
      severity: "high"
    });
    throw new Error(
      `Too many files attached. Upload up to ${PUBLIC_ENROLLMENT_PACKET_UPLOAD_COUNT_LIMIT} files per submission.`
    );
  }

  if (uploadBytes > PUBLIC_ENROLLMENT_PACKET_TOTAL_UPLOAD_BYTES_LIMIT) {
    await logPublicEnrollmentPacketGuardFailure({
      request: input.request,
      caregiverIp: input.caregiverIp,
      caregiverUserAgent: input.caregiverUserAgent,
      failureType: "upload_cumulative_size_cap_exceeded",
      message: `Combined enrollment packet uploads exceeded the ${PUBLIC_ENROLLMENT_PACKET_TOTAL_UPLOAD_MB}MB cap.`,
      uploadCount,
      uploadBytes,
      severity: "high"
    });
    throw new Error(
      `Attached files are too large in total. Maximum combined upload size is ${PUBLIC_ENROLLMENT_PACKET_TOTAL_UPLOAD_MB}MB.`
    );
  }

  const tokenAttemptCount = await countRecentSystemEvents({
    eventType: "enrollment_packet_public_submit_attempt",
    entityType: "enrollment_packet_request",
    entityId: input.request.id,
    status: "started",
    sinceIso: rateWindowStart
  });
  if (tokenAttemptCount >= PUBLIC_ENROLLMENT_PACKET_TOKEN_SUBMIT_ATTEMPT_LIMIT) {
    await logPublicEnrollmentPacketGuardFailure({
      request: input.request,
      caregiverIp: input.caregiverIp,
      caregiverUserAgent: input.caregiverUserAgent,
      failureType: "token_rate_limit_exceeded",
      message: `Enrollment packet submission throttled after ${tokenAttemptCount} recent token attempts.`,
      uploadCount,
      uploadBytes,
      severity: "high"
    });
    throw new Error(
      `Too many recent submission attempts for this enrollment packet. Wait ${PUBLIC_ENROLLMENT_PACKET_SUBMIT_LOOKBACK_MINUTES} minutes and try again.`
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
    if (ipAttemptCount >= PUBLIC_ENROLLMENT_PACKET_IP_SUBMIT_ATTEMPT_LIMIT) {
      await logPublicEnrollmentPacketGuardFailure({
        request: input.request,
        caregiverIp: input.caregiverIp,
        caregiverUserAgent: input.caregiverUserAgent,
        failureType: "ip_rate_limit_exceeded",
        message: `Enrollment packet submission throttled after ${ipAttemptCount} recent IP attempts.`,
        uploadCount,
        uploadBytes,
        severity: "high"
      });
      throw new Error(
        `Too many recent submission attempts from this connection. Wait ${PUBLIC_ENROLLMENT_PACKET_SUBMIT_LOOKBACK_MINUTES} minutes and try again.`
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

async function insertPacketEvent(input: {
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

async function invokeFinalizeEnrollmentPacketCompletionRpc(input: {
  packetId: string;
  rotatedToken: string;
  consumedSubmissionTokenHash: string;
  completedAt: string;
  filedAt: string;
  signerName: string;
  signerEmail: string | null;
  signatureBlob: string;
  ipAddress: string | null;
  actorUserId: string;
  actorEmail: string | null;
  uploadBatchId: string;
  completedMetadata: Record<string, unknown>;
  filedMetadata: Record<string, unknown>;
}) {
  const admin = createSupabaseAdminClient();
  try {
    const data = await invokeSupabaseRpcOrThrow<unknown>(admin, ENROLLMENT_PACKET_COMPLETION_RPC, {
      p_packet_id: input.packetId,
      p_rotated_token: input.rotatedToken,
      p_consumed_submission_token_hash: input.consumedSubmissionTokenHash,
      p_completed_at: input.completedAt,
      p_filed_at: input.filedAt,
      p_signer_name: input.signerName,
      p_signer_email: input.signerEmail,
      p_signature_blob: input.signatureBlob,
      p_ip_address: input.ipAddress,
      p_actor_user_id: input.actorUserId,
      p_actor_email: input.actorEmail,
      p_upload_batch_id: input.uploadBatchId,
      p_completed_metadata: input.completedMetadata,
      p_filed_metadata: input.filedMetadata
    });
    const row = (Array.isArray(data) ? data[0] : null) as FinalizedEnrollmentPacketSubmissionRpcRow | null;
    if (!row?.packet_id || !row?.status) {
      throw new Error("Enrollment packet finalization RPC did not return expected identifiers.");
    }
    return {
      packetId: row.packet_id,
      status: row.status,
      mappingSyncStatus: row.mapping_sync_status ?? "pending",
      wasAlreadyFiled: Boolean(row.was_already_filed)
    };
  } catch (error) {
    if (isMissingRpcFunctionError(error, ENROLLMENT_PACKET_COMPLETION_RPC)) {
      throw new Error(
        `Enrollment packet completion finalization RPC is not available yet. Apply Supabase migration ${ENROLLMENT_PACKET_COMPLETION_MIGRATION} first.`
      );
    }
    throw error;
  }
}

async function listActivePacketRows(memberId: string) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("enrollment_packet_requests")
    .select("*")
    .eq("member_id", memberId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as EnrollmentPacketRequestRow[];
  return rows.filter((row) => {
    if (isExpired(row.token_expires_at)) return false;
    const status = toStatus(row.status);
    return status === "draft" || status === "prepared" || status === "sent" || status === "opened" || status === "partially_completed";
  });
}

function isReusablePreparedEnrollmentPacket(row: EnrollmentPacketRequestRow) {
  const status = toStatus(row.status);
  const deliveryStatus = toDeliveryStatus(row);
  return status === "prepared" && (deliveryStatus === "ready_to_send" || deliveryStatus === "send_failed");
}

export async function listEnrollmentPacketRequestsForMember(memberId: string) {
  const normalizedMemberId = clean(memberId);
  if (!normalizedMemberId) throw new Error("Member ID is required.");
  const canonicalMemberId = await resolveCanonicalMemberId(normalizedMemberId, {
    actionLabel: "listEnrollmentPacketRequestsForMember",
    serviceRole: true
  });
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("enrollment_packet_requests")
    .select("*")
    .eq("member_id", canonicalMemberId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as EnrollmentPacketRequestRow[]).map((row) => toSummary(row));
}

export async function listEnrollmentPacketRequestsForLead(leadId: string) {
  const normalizedLeadId = clean(leadId);
  if (!normalizedLeadId) throw new Error("Lead ID is required.");
  const canonical = await resolveCanonicalLeadRef(
    {
      sourceType: "lead",
      leadId: normalizedLeadId,
      selectedId: normalizedLeadId
    },
    {
      actionLabel: "listEnrollmentPacketRequestsForLead",
      serviceRole: true
    }
  );
  if (!canonical.leadId) {
    throw new Error("listEnrollmentPacketRequestsForLead expected lead.id but canonical lead resolution returned empty leadId.");
  }
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("enrollment_packet_requests")
    .select("*")
    .eq("lead_id", canonical.leadId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as EnrollmentPacketRequestRow[]).map((row) => toSummary(row));
}

export async function listCompletedEnrollmentPacketRequests(
  filters: CompletedEnrollmentPacketFilters = {}
): Promise<CompletedEnrollmentPacketListItem[]> {
  const safeLimit = Math.max(1, Math.min(500, Math.trunc(filters.limit ?? 200)));
  const normalizedStatus = filters.status === "completed" || filters.status === "filed" ? filters.status : "all";
  const fromDate = clean(filters.fromDate);
  const toDate = clean(filters.toDate);
  const searchNeedle = clean(filters.search)?.toLowerCase() ?? null;

  const admin = createSupabaseAdminClient();
  let query = admin
    .from("enrollment_packet_requests")
    .select("*")
    .order("completed_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(safeLimit);
  if (normalizedStatus === "all") {
    query = query.in("status", ["completed", "filed"]);
  } else {
    query = query.eq("status", normalizedStatus);
  }
  if (fromDate) {
    query = query.gte("completed_at", `${fromDate}T00:00:00`);
  }
  if (toDate) {
    query = query.lte("completed_at", `${toDate}T23:59:59`);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as EnrollmentPacketRequestRow[];
  if (rows.length === 0) return [];

  const memberIds = Array.from(new Set(rows.map((row) => row.member_id).filter(Boolean)));
  const leadIds = Array.from(new Set(rows.map((row) => row.lead_id).filter((value): value is string => Boolean(value))));
  const senderIds = Array.from(new Set(rows.map((row) => row.sender_user_id).filter(Boolean)));

  const memberNames = new Map<string, string>();
  if (memberIds.length > 0) {
    const { data: members, error: membersError } = await admin.from("members").select("id, display_name").in("id", memberIds);
    if (membersError) throw new Error(membersError.message);
    for (const row of (members ?? []) as Array<{ id: string; display_name: string | null }>) {
      memberNames.set(String(row.id), clean(row.display_name) ?? "Unknown member");
    }
  }

  const leadNames = new Map<string, string>();
  if (leadIds.length > 0) {
    const { data: leads, error: leadsError } = await admin.from("leads").select("id, member_name").in("id", leadIds);
    if (leadsError) throw new Error(leadsError.message);
    for (const row of (leads ?? []) as Array<{ id: string; member_name: string | null }>) {
      leadNames.set(String(row.id), clean(row.member_name) ?? "Unknown lead");
    }
  }

  const senderNames = new Map<string, string>();
  if (senderIds.length > 0) {
    const { data: senders, error: sendersError } = await admin.from("profiles").select("id, full_name").in("id", senderIds);
    if (sendersError) throw new Error(sendersError.message);
    for (const row of (senders ?? []) as Array<{ id: string; full_name: string | null }>) {
      senderNames.set(String(row.id), clean(row.full_name) ?? "Unknown staff");
    }
  }

  const items = rows.map((row) => {
    const summary = toSummary(row);
    return {
      ...summary,
      memberName: memberNames.get(row.member_id) ?? "Unknown member",
      leadMemberName: row.lead_id ? leadNames.get(row.lead_id) ?? null : null,
      senderName: senderNames.get(row.sender_user_id) ?? null,
      mappingSyncStatus: toEnrollmentPacketMappingSyncStatus(row.mapping_sync_status),
      operationalReadinessStatus: resolveEnrollmentPacketOperationalReadiness({
        status: row.status,
        mappingSyncStatus: row.mapping_sync_status
      }),
      operationallyReady: isEnrollmentPacketOperationallyReady({
        status: row.status,
        mappingSyncStatus: row.mapping_sync_status
      }),
      mappingSyncError: clean(row.mapping_sync_error)
    };
  });

  if (!searchNeedle) return items;

  return items.filter((item) => {
    const haystack = [
      item.memberName,
      item.leadMemberName,
      item.caregiverEmail,
      item.senderName,
      item.senderUserId,
      item.memberId,
      item.leadId
    ]
      .map((value) => clean(value)?.toLowerCase())
      .filter((value): value is string => Boolean(value));
    return haystack.some((value) => value.includes(searchNeedle));
  });
}

export async function upsertEnrollmentPacketSenderSignatureProfile(input: {
  userId: string;
  signatureName: string;
  signatureImageDataUrl: string;
}) {
  const userId = clean(input.userId);
  const signatureName = clean(input.signatureName);
  if (!userId) throw new Error("User ID is required.");
  if (!signatureName) throw new Error("Signature name is required.");
  const signature = parseDataUrlPayload(input.signatureImageDataUrl);
  if (!signature.contentType.startsWith("image/")) {
    throw new Error("Sender signature image must be a valid image.");
  }
  const now = toEasternISO();
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("enrollment_packet_sender_signatures")
    .upsert(
      {
        user_id: userId,
        signature_name: signatureName,
        signature_blob: input.signatureImageDataUrl.trim(),
        updated_at: now
      },
      { onConflict: "user_id" }
    )
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as SenderProfileRow;
}

async function sendEnrollmentPacketEmail(input: {
  caregiverEmail: string;
  caregiverName: string | null;
  memberName: string;
  optionalMessage?: string | null;
  requestUrl: string;
}) {
  const apiKey = clean(process.env.RESEND_API_KEY);
  if (!apiKey) throw new Error("Enrollment packet email delivery is not configured. Set RESEND_API_KEY.");
  const clinicalSenderEmail = resolveClinicalSenderEmail();
  const buildEnrollmentPacketTemplate = await loadEnrollmentPacketTemplateBuilder();
  const template = buildEnrollmentPacketTemplate({
    recipientName: clean(input.caregiverName) ?? "Family Member",
    memberName: input.memberName,
    requestUrl: input.requestUrl,
    optionalMessage: input.optionalMessage ?? null
  });

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: `${template.fromDisplayName} <${clinicalSenderEmail}>`,
      to: [input.caregiverEmail],
      subject: template.subject,
      html: template.html,
      text: template.text
    })
  });

  if (!response.ok) {
    let detail = "";
    try {
      detail = await response.text();
    } catch {
      detail = "";
    }
    throw new Error(`Unable to deliver enrollment packet email (${response.status}). ${detail}`.trim());
  }
}

async function markEnrollmentPacketDeliveryState(input: {
  packetId: string;
  status?: EnrollmentPacketStatus;
  deliveryStatus: SendWorkflowDeliveryStatus;
  deliveryError?: string | null;
  sentAt?: string | null;
  attemptAt: string;
  expectedCurrentStatus?: EnrollmentPacketStatus | null;
}) {
  const admin = createSupabaseAdminClient();
  try {
    type TransitionResultRow = {
      packet_id: string;
      status: string;
      delivery_status: string;
      did_transition: boolean;
    };
    const data = await invokeSupabaseRpcOrThrow<unknown>(admin, TRANSITION_ENROLLMENT_PACKET_DELIVERY_STATE_RPC, {
      p_packet_id: input.packetId,
      p_delivery_status: input.deliveryStatus,
      p_attempt_at: input.attemptAt,
      p_status: input.status ?? null,
      p_sent_at: input.sentAt ?? null,
      p_delivery_error: clean(input.deliveryError),
      p_expected_current_status: input.expectedCurrentStatus ?? null
    });
    const row = (Array.isArray(data) ? data[0] : null) as TransitionResultRow | null;
    return {
      packetId: row?.packet_id ?? input.packetId,
      status: row?.status ?? input.status ?? null,
      deliveryStatus: row?.delivery_status ?? input.deliveryStatus,
      didTransition: Boolean(row?.did_transition)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update enrollment packet delivery state.";
    if (message.includes(TRANSITION_ENROLLMENT_PACKET_DELIVERY_STATE_RPC)) {
      throw new Error(
        `Enrollment packet delivery state RPC is not available yet. Apply Supabase migration ${ENROLLMENT_PACKET_DELIVERY_RPC_MIGRATION} first.`
      );
    }
    throw error;
  }
}

async function prepareEnrollmentPacketRequestForDelivery(input: {
  existingRequest: EnrollmentPacketRequestRow | null;
  memberId: string;
  leadId: string | null;
  senderUserId: string;
  caregiverEmail: string;
  expiresAt: string;
  hashedToken: string;
  requestedDays: string[];
  transportation: StaffTransportationOption;
  communityFee: number;
  dailyRate: number;
  pricingCommunityFeeId: string | null;
  pricingDailyRateId: string | null;
  pricingSnapshot: Record<string, unknown>;
  caregiverName: string | null;
  caregiverPhone: string | null;
  intakePayload: EnrollmentPacketIntakePayload;
  signatureProfile: SenderProfileRow;
  senderEmail: string;
  eventMetadata: Record<string, unknown>;
  preparedAt: string;
}) {
  const admin = createSupabaseAdminClient();
  const packetId = input.existingRequest?.id ?? null;
  let preparedPacketId = packetId;

  try {
    type PrepareEnrollmentPacketResultRow = {
      packet_id: string;
      was_created: boolean;
    };
    const data = await invokeSupabaseRpcOrThrow<unknown>(admin, PREPARE_ENROLLMENT_PACKET_REQUEST_RPC, {
      p_packet_id: packetId,
      p_member_id: input.memberId,
      p_lead_id: input.leadId,
      p_sender_user_id: input.senderUserId,
      p_caregiver_email: input.caregiverEmail,
      p_token: input.hashedToken,
      p_token_expires_at: input.expiresAt,
      p_requested_days: input.requestedDays,
      p_transportation: input.transportation,
      p_community_fee: input.communityFee,
      p_daily_rate: input.dailyRate,
      p_pricing_community_fee_id: input.pricingCommunityFeeId,
      p_pricing_daily_rate_id: input.pricingDailyRateId,
      p_pricing_snapshot: input.pricingSnapshot,
      p_caregiver_name: input.caregiverName,
      p_caregiver_phone: input.caregiverPhone,
      p_intake_payload: input.intakePayload,
      p_signature_name: input.signatureProfile.signature_name,
      p_signature_blob: input.signatureProfile.signature_blob,
      p_sender_email: input.senderEmail,
      p_prepared_at: input.preparedAt
    });
    const row = (Array.isArray(data) ? data[0] : null) as PrepareEnrollmentPacketResultRow | null;
    preparedPacketId = clean(row?.packet_id) ?? packetId;
    if (!preparedPacketId) {
      throw new Error("Enrollment packet request preparation RPC did not return a packet id.");
    }
  } catch (error) {
    if (
      isActiveEnrollmentPacketUniqueViolation(
        error as { code?: string | null; message?: string | null; details?: string | null } | null | undefined
      )
    ) {
      throw new Error("An active enrollment packet already exists for this member.");
    }
    const message = error instanceof Error ? error.message : "Unable to prepare enrollment packet request.";
    if (message.includes(PREPARE_ENROLLMENT_PACKET_REQUEST_RPC)) {
      throw new Error(
        `Enrollment packet request preparation RPC is not available yet. Apply Supabase migration ${ENROLLMENT_PACKET_DELIVERY_RPC_MIGRATION} first.`
      );
    }
    throw error;
  }

  await insertPacketEvent({
    packetId: preparedPacketId,
    eventType: "prepared",
    actorUserId: input.senderUserId,
    actorEmail: input.senderEmail,
    metadata: input.eventMetadata
  });

  return preparedPacketId;
}

function resolveClinicalSenderEmail() {
  const sender = clean(process.env.CLINICAL_SENDER_EMAIL);
  if (!sender || !isEmail(sender)) {
    throw new Error("CLINICAL_SENDER_EMAIL is missing or invalid.");
  }
  return sender;
}

async function resolveSendContext(input: {
  memberId?: string | null;
  leadId?: string | null;
}) {
  const leadId = clean(input.leadId);
  if (!leadId) {
    throw new Error("sendEnrollmentPacketRequest requires lead.id. Enrollment packet sending is lead-driven.");
  }

  const canonicalLead = await resolveCanonicalLeadRef(
    {
      sourceType: "lead",
      leadId,
      selectedId: leadId
    },
    {
      actionLabel: "sendEnrollmentPacketRequest",
      serviceRole: true
    }
  );
  if (!canonicalLead.leadId) {
    throw new Error("sendEnrollmentPacketRequest expected lead.id but canonical lead resolution returned empty leadId.");
  }

  const member = await ensureCanonicalMemberForLead({
    leadId: canonicalLead.leadId,
    actionLabel: "sendEnrollmentPacketRequest.ensureCanonicalMemberForLead",
    serviceRole: true
  });
  if (!member) {
    throw new Error("Enrollment packet requires canonical member linkage for the selected lead.");
  }

  const memberIdFromInput = clean(input.memberId);
  if (memberIdFromInput) {
    const memberCanonicalId = await resolveCanonicalMemberId(memberIdFromInput, {
      actionLabel: "sendEnrollmentPacketRequest.strictLinkCheck",
      serviceRole: true
    });
    if (memberCanonicalId !== member.id) {
      throw new Error(
        `sendEnrollmentPacketRequest expected canonical member linked to lead.id ${canonicalLead.leadId}, but member.id ${memberIdFromInput} is not linked to that lead.`
      );
    }
  }

  const lead = await getLeadById(canonicalLead.leadId);
  if (!lead) throw new Error("Lead was not found.");
  const refreshedMember = await getMemberById(member.id);
  if (!refreshedMember) throw new Error("Member was not found.");

  return { member: refreshedMember, lead };
}

export async function sendEnrollmentPacketRequest(input: {
  memberId?: string | null;
  leadId: string;
  senderUserId: string;
  senderFullName: string;
  senderEmail?: string | null;
  caregiverEmail?: string | null;
  requestedStartDate?: string | null;
  requestedDays: string[];
  transportation: string;
  communityFeeOverride?: number | null;
  dailyRateOverride?: number | null;
  totalInitialEnrollmentAmountOverride?: number | null;
  optionalMessage?: string | null;
  appBaseUrl?: string | null;
}) {
  const senderUserId = clean(input.senderUserId);
  const senderFullName = clean(input.senderFullName);
  const senderEmail = resolveClinicalSenderEmail();
  if (!senderUserId) throw new Error("Sender user is required.");
  if (!senderFullName) throw new Error("Sender name is required.");
  if (!isEmail(senderEmail)) throw new Error("Sender email is invalid.");

  const signatureProfile = await getEnrollmentPacketSenderSignatureProfile(senderUserId);
  if (!signatureProfile) {
    const err = new Error("Sender signature is not configured.");
    (err as Error & { code?: string }).code = "signature_setup_required";
    throw err;
  }

  const { member, lead } = await resolveSendContext({
    memberId: input.memberId,
    leadId: input.leadId
  });
  const staffTransportation = normalizeStaffTransportation(input.transportation);
  const requestedStartDate = normalizeEnrollmentDateOnly(
    clean(input.requestedStartDate) ?? clean(lead?.member_start_date) ?? toEasternDate()
  );
  const resolvedPricing = await resolveEnrollmentPricingForRequestedDays({
    requestedDays: input.requestedDays,
    effectiveDate: requestedStartDate
  });
  const communityFeeOverride =
    typeof input.communityFeeOverride === "number" && Number.isFinite(input.communityFeeOverride)
      ? safeNumber(input.communityFeeOverride, resolvedPricing.communityFeeAmount)
      : null;
  const dailyRateOverride =
    typeof input.dailyRateOverride === "number" && Number.isFinite(input.dailyRateOverride)
      ? safeNumber(input.dailyRateOverride, resolvedPricing.dailyRateAmount)
      : null;
  const effectiveCommunityFee = communityFeeOverride ?? safeNumber(resolvedPricing.communityFeeAmount);
  const effectiveDailyRate = dailyRateOverride ?? safeNumber(resolvedPricing.dailyRateAmount);
  const calculatedInitialEnrollmentAmount = calculateInitialEnrollmentAmount({
    requestedStartDate,
    requestedDays: resolvedPricing.requestedDays,
    dailyRate: effectiveDailyRate,
    communityFee: effectiveCommunityFee
  });
  const totalInitialEnrollmentAmountOverride =
    typeof input.totalInitialEnrollmentAmountOverride === "number" &&
    Number.isFinite(input.totalInitialEnrollmentAmountOverride)
      ? safeNumber(input.totalInitialEnrollmentAmountOverride, calculatedInitialEnrollmentAmount)
      : null;
  const effectiveInitialEnrollmentAmount = totalInitialEnrollmentAmountOverride ?? calculatedInitialEnrollmentAmount;
  const pricingSnapshot = {
    ...(resolvedPricing.snapshot ?? {}),
    selectedValues: {
      communityFee: effectiveCommunityFee,
      dailyRate: effectiveDailyRate,
      totalInitialEnrollmentAmount: effectiveInitialEnrollmentAmount,
      requestedStartDate
    },
    overrides: {
      communityFee: communityFeeOverride,
      dailyRate: dailyRateOverride,
      totalInitialEnrollmentAmount: totalInitialEnrollmentAmountOverride
    }
  };
  const caregiverEmail = cleanEmail(input.caregiverEmail) ?? cleanEmail(lead?.caregiver_email);
  if (!caregiverEmail || !isEmail(caregiverEmail)) throw new Error("Caregiver email is required.");
  const requiredCaregiverEmail = caregiverEmail;
  const memberNameParts = splitMemberName(lead?.member_name ?? member.display_name);

  const active = await listActivePacketRows(member.id);
  const reusablePreparedActive = active.find((row) => isReusablePreparedEnrollmentPacket(row)) ?? null;
  const blockingActive = active.find((row) => {
    if (reusablePreparedActive && row.id === reusablePreparedActive.id) return false;
    const status = toStatus(row.status);
    return (
      status === "draft" ||
      status === "prepared" ||
      status === "sent" ||
      status === "opened" ||
      status === "partially_completed"
    );
  });
  if (blockingActive) {
    throw new Error("An active enrollment packet already exists for this member.");
  }

  const now = toEasternISO();
  const token = generateSigningToken();
  const hashedToken = hashToken(token);
  const expiresAtDate = new Date();
  expiresAtDate.setDate(expiresAtDate.getDate() + 14);
  const expiresAt = expiresAtDate.toISOString();
  const requestUrl = `${buildAppBaseUrl(input.appBaseUrl)}/sign/enrollment-packet/${token}`;
  const intakePayload = normalizeEnrollmentPacketIntakePayload({
    memberLegalFirstName: memberNameParts.firstName,
    memberLegalLastName: memberNameParts.lastName,
    memberDob: clean(lead?.member_dob),
    requestedAttendanceDays: resolvedPricing.requestedDays,
    requestedStartDate,
    transportationPreference: staffTransportation,
    transportationQuestionEnabled: "No",
    referredBy: clean(lead?.referral_name),
    primaryContactName: clean(lead?.caregiver_name),
    primaryContactRelationship: clean(lead?.caregiver_relationship),
    primaryContactPhone: clean(lead?.caregiver_phone),
    primaryContactEmail: requiredCaregiverEmail,
    responsiblePartyGuarantorFirstName: clean(lead?.caregiver_name)?.split(" ")[0] ?? null,
    responsiblePartyGuarantorLastName: clean(lead?.caregiver_name)?.split(" ").slice(1).join(" ") || null,
    membershipNumberOfDays: String(resolvedPricing.requestedDays.length),
    membershipDailyAmount: effectiveDailyRate.toFixed(2),
    communityFee: effectiveCommunityFee.toFixed(2),
    totalInitialEnrollmentAmount: effectiveInitialEnrollmentAmount.toFixed(2),
    photoConsentMemberName: clean(lead?.member_name) ?? clean(member.display_name)
  });

  const requestId = await prepareEnrollmentPacketRequestForDelivery({
    existingRequest: reusablePreparedActive,
    memberId: member.id,
    leadId: lead?.id ?? null,
    senderUserId,
    caregiverEmail: requiredCaregiverEmail,
    expiresAt,
    hashedToken,
    requestedDays: resolvedPricing.requestedDays,
    transportation: staffTransportation,
    communityFee: effectiveCommunityFee,
    dailyRate: effectiveDailyRate,
    pricingCommunityFeeId: resolvedPricing.communityFeeId,
    pricingDailyRateId: resolvedPricing.dailyRateId,
    pricingSnapshot,
    caregiverName: clean(lead?.caregiver_name),
    caregiverPhone: clean(lead?.caregiver_phone),
    intakePayload,
    signatureProfile,
    senderEmail,
    preparedAt: now,
    eventMetadata: {
      memberId: member.id,
      leadId: lead?.id ?? null,
      pricingCommunityFeeId: resolvedPricing.communityFeeId,
      pricingDailyRateId: resolvedPricing.dailyRateId,
      pricingDaysPerWeek: resolvedPricing.daysPerWeek,
      communityFee: effectiveCommunityFee,
      dailyRate: effectiveDailyRate,
      requestedStartDate,
      totalInitialEnrollmentAmount: effectiveInitialEnrollmentAmount,
      communityFeeOverride,
      dailyRateOverride,
      totalInitialEnrollmentAmountOverride,
      retryAttempt: Boolean(reusablePreparedActive),
      reusedPreparedRequest: Boolean(reusablePreparedActive)
    }
  });

  try {
    await sendEnrollmentPacketEmail({
      caregiverEmail: requiredCaregiverEmail,
      caregiverName: lead?.caregiver_name ?? null,
      memberName: member.display_name,
      optionalMessage: input.optionalMessage ?? null,
      requestUrl
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unable to deliver enrollment packet email.";
    const failedAt = toEasternISO();
    await markEnrollmentPacketDeliveryState({
      packetId: requestId,
      status: "prepared",
      deliveryStatus: "send_failed",
      deliveryError: reason,
      sentAt: null,
      attemptAt: failedAt
    });
    await insertPacketEvent({
      packetId: requestId,
      eventType: "send_failed",
      actorUserId: senderUserId,
      actorEmail: senderEmail,
      metadata: {
        memberId: member.id,
        leadId: lead?.id ?? null,
        retryAvailable: true,
        error: reason
      }
    });
    await recordWorkflowEvent({
      eventType: "enrollment_packet_failed",
      entityType: "enrollment_packet_request",
      entityId: requestId,
      actorType: "user",
      actorUserId: senderUserId,
      status: "failed",
      severity: "medium",
      metadata: {
        member_id: member.id,
        lead_id: lead?.id ?? null,
        phase: "delivery",
        delivery_status: "send_failed",
        retry_available: true,
        error: reason
      }
    });
    await recordWorkflowMilestone({
      event: {
        eventType: "enrollment_packet_failed",
        entityType: "enrollment_packet_request",
        entityId: requestId,
        actorType: "user",
        actorUserId: senderUserId,
        status: "failed",
        severity: "high",
        metadata: {
          member_id: member.id,
          lead_id: lead?.id ?? null,
          phase: "delivery",
          error: reason
        }
      }
    });
    await maybeRecordRepeatedFailureAlert({
      workflowEventType: "enrollment_packet_failed",
      entityType: "enrollment_packet_request",
      entityId: requestId,
      actorUserId: senderUserId,
      threshold: 2,
      metadata: {
        member_id: member.id,
        lead_id: lead?.id ?? null,
        phase: "delivery"
      }
    });
    throw buildRetryableWorkflowDeliveryError({
      requestId,
      requestUrl,
      reason,
      workflowLabel: "Enrollment packet",
      retryLabel: "Retry sending the same packet once delivery settings are corrected."
    });
  }

  const sentAt = toEasternISO();
  try {
    await markEnrollmentPacketDeliveryState({
      packetId: requestId,
      status: "sent",
      deliveryStatus: "sent",
      deliveryError: null,
      sentAt,
      attemptAt: sentAt
    });
  } catch (error) {
    await throwDeliveryStateFinalizeFailure({
      entityType: "enrollment_packet_request",
      entityId: requestId,
      actorUserId: senderUserId,
      alertKey: "enrollment_packet_delivery_state_finalize_failed",
      metadata: {
        member_id: member.id,
        lead_id: lead?.id ?? null,
        caregiver_email: requiredCaregiverEmail,
        email_delivery_state: "email_sent_but_sent_state_not_persisted",
        prepared_delivery_status: "ready_to_send",
        error: error instanceof Error ? error.message : "Unable to finalize enrollment packet sent state."
      },
      message:
        "Enrollment packet email was delivered, but the sent state could not be finalized. The link remains active in Ready to Send state. Review operational alerts before retrying."
    });
  }

  await insertPacketEvent({
    packetId: requestId,
    eventType: "Enrollment Packet Sent",
    actorUserId: senderUserId,
    actorEmail: senderEmail
  });
  await recordWorkflowEvent({
    eventType: "enrollment_packet_sent",
    entityType: "enrollment_packet_request",
    entityId: requestId,
    actorType: "user",
    actorUserId: senderUserId,
    status: "sent",
    severity: "low",
    metadata: {
      member_id: member.id,
      lead_id: lead?.id ?? null,
      caregiver_email: requiredCaregiverEmail,
      sent_at: sentAt
    }
  });
  try {
    await recordWorkflowMilestone({
      event: {
        event_type: "enrollment_packet_sent",
        entity_type: "enrollment_packet_request",
        entity_id: requestId,
        actor_type: "user",
        actor_id: senderUserId,
        actor_user_id: senderUserId,
        status: "sent",
        severity: "low",
        metadata: {
          member_id: member.id,
          lead_id: lead?.id ?? null,
          caregiver_email: requiredCaregiverEmail,
          sent_at: sentAt
        }
      }
    });
  } catch (error) {
    console.error("[enrollment-packets] unable to emit post-send workflow milestone", error);
  }

  if (lead?.id) {
    await addLeadActivity({
      leadId: lead.id,
      memberName: lead.member_name,
      activityType: "Email",
      outcome: "Enrollment Packet Sent",
      notes: `Enrollment packet request ${requestId} sent to ${caregiverEmail}.`,
      completedByUserId: senderUserId,
      completedByName: senderFullName
    });
  }

  return {
    request: toSummary({
      id: requestId,
      member_id: member.id,
      lead_id: lead?.id ?? null,
      sender_user_id: senderUserId,
      caregiver_email: requiredCaregiverEmail,
      status: "sent",
      delivery_status: "sent",
      last_delivery_attempt_at: sentAt,
      delivery_failed_at: null,
      delivery_error: null,
      token: hashedToken,
      last_consumed_submission_token_hash: reusablePreparedActive?.last_consumed_submission_token_hash ?? null,
      token_expires_at: expiresAt,
      created_at: reusablePreparedActive?.created_at ?? now,
      sent_at: sentAt,
      completed_at: reusablePreparedActive?.completed_at ?? null,
      mapping_sync_status: reusablePreparedActive?.mapping_sync_status ?? null,
      mapping_sync_error: reusablePreparedActive?.mapping_sync_error ?? null,
      mapping_sync_attempted_at: reusablePreparedActive?.mapping_sync_attempted_at ?? null,
      latest_mapping_run_id: reusablePreparedActive?.latest_mapping_run_id ?? null
    }),
    requestUrl
  };
}

function toPublicContext(
  request: EnrollmentPacketRequestRow,
  fields: EnrollmentPacketFieldsRow,
  memberName: string
): PublicEnrollmentPacketContext {
  const intakePayload = normalizeStoredIntakePayload(fields);
  const prefilledMemberName = payloadMemberDisplayName(intakePayload);
  return {
    state: "ready",
    request: toSummary(request),
    memberName: prefilledMemberName ?? memberName,
    fields: {
      requestedDays: fields.requested_days ?? [],
      transportation: fields.transportation,
      communityFee: safeNumber(fields.community_fee),
      dailyRate: safeNumber(fields.daily_rate),
      caregiverName: fields.caregiver_name,
      caregiverPhone: fields.caregiver_phone,
      caregiverEmail: fields.caregiver_email,
      caregiverAddressLine1: fields.caregiver_address_line1,
      caregiverAddressLine2: fields.caregiver_address_line2,
      caregiverCity: fields.caregiver_city,
      caregiverState: fields.caregiver_state,
      caregiverZip: fields.caregiver_zip,
      secondaryContactName: fields.secondary_contact_name,
      secondaryContactPhone: fields.secondary_contact_phone,
      secondaryContactEmail: fields.secondary_contact_email,
      secondaryContactRelationship: fields.secondary_contact_relationship,
      notes: fields.notes,
      intakePayload
    }
  };
}

export async function getPublicEnrollmentPacketContext(
  token: string,
  metadata?: { ip?: string | null; userAgent?: string | null }
): Promise<PublicEnrollmentPacketContext> {
  const normalizedToken = clean(token);
  if (!normalizedToken) return { state: "invalid" };
  const matched = await loadRequestByToken(normalizedToken);
  if (!matched) return { state: "invalid" };
  const request = matched.request;

  if (toStatus(request.status) === "completed" || toStatus(request.status) === "filed") {
    return {
      state: "completed",
      request: toSummary(request)
    };
  }
  if (isExpired(request.token_expires_at)) {
    await recordEnrollmentPacketExpiredIfNeeded(request);
    return { state: "expired" };
  }

  if (toStatus(request.status) === "sent") {
    const now = toEasternISO();
    const transition = await markEnrollmentPacketDeliveryState({
      packetId: request.id,
      status: "opened",
      deliveryStatus: "sent",
      attemptAt: now,
      expectedCurrentStatus: "sent"
    });
    if (transition.didTransition) {
      await insertPacketEvent({
        packetId: request.id,
        eventType: "opened",
        actorEmail: request.caregiver_email,
        metadata: {
          ip: clean(metadata?.ip),
          userAgent: clean(metadata?.userAgent)
        }
      });
    }
  }

  const [reloaded, fields, member] = await Promise.all([
    loadRequestById(request.id),
    loadPacketFields(request.id),
    getMemberById(request.member_id)
  ]);
  if (!reloaded || !fields || !member) return { state: "invalid" };
  return toPublicContext(reloaded, fields, member.display_name);
}

async function recordEnrollmentPacketExpiredIfNeeded(request: EnrollmentPacketRequestRow) {
  const requestStatus = toStatus(request.status);
  const shouldExpireStatus =
    requestStatus === "draft" ||
    requestStatus === "prepared" ||
    requestStatus === "sent" ||
    requestStatus === "opened" ||
    requestStatus === "partially_completed";

  if (shouldExpireStatus) {
    try {
      await markEnrollmentPacketDeliveryState({
        packetId: request.id,
        status: "expired",
        deliveryStatus: toDeliveryStatus(request),
        attemptAt: toEasternISO(),
        expectedCurrentStatus: requestStatus
      });
    } catch (error) {
      console.error("[enrollment-packets] unable to persist expired packet status", error);
    }
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("system_events")
    .select("id")
    .eq("event_type", "enrollment_packet_expired")
    .eq("entity_type", "enrollment_packet_request")
    .eq("entity_id", request.id)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[enrollment-packets] unable to check existing expiration event", error);
    return;
  }
  if (data?.id) return;

  await recordWorkflowEvent({
    eventType: "enrollment_packet_expired",
    entityType: "enrollment_packet_request",
    entityId: request.id,
    actorType: "system",
    actorUserId: request.sender_user_id,
    status: "expired",
    severity: "medium",
    metadata: {
      member_id: request.member_id,
      lead_id: request.lead_id,
      expired_at: request.token_expires_at
    }
  });
  await recordWorkflowMilestone({
    event: {
      eventType: "enrollment_packet_expired",
      entityType: "enrollment_packet_request",
      entityId: request.id,
      actorType: "system",
      actorUserId: request.sender_user_id,
      status: "expired",
      severity: "medium",
      metadata: {
        member_id: request.member_id,
        lead_id: request.lead_id,
        expired_at: request.token_expires_at
      }
    }
  });
}

export async function savePublicEnrollmentPacketProgress(input: {
  token: string;
  caregiverName?: string | null;
  caregiverPhone?: string | null;
  caregiverEmail?: string | null;
  primaryContactAddress?: string | null;
  primaryContactAddressLine1?: string | null;
  primaryContactCity?: string | null;
  primaryContactState?: string | null;
  primaryContactZip?: string | null;
  caregiverAddressLine1?: string | null;
  caregiverAddressLine2?: string | null;
  caregiverCity?: string | null;
  caregiverState?: string | null;
  caregiverZip?: string | null;
  secondaryContactName?: string | null;
  secondaryContactPhone?: string | null;
  secondaryContactEmail?: string | null;
  secondaryContactRelationship?: string | null;
  secondaryContactAddress?: string | null;
  secondaryContactAddressLine1?: string | null;
  secondaryContactCity?: string | null;
  secondaryContactState?: string | null;
  secondaryContactZip?: string | null;
  notes?: string | null;
  intakePayload?: Partial<Record<string, unknown>> | null;
}) {
  const context = await getPublicEnrollmentPacketContext(input.token);
  if (context.state !== "ready") throw new Error("Enrollment packet link is not active.");
  const mergedPayload = mergePublicProgressPayload({
    storedPayload: context.fields.intakePayload,
    intakePayload: input.intakePayload,
    caregiverName: input.caregiverName,
    caregiverPhone: input.caregiverPhone,
    caregiverEmail: input.caregiverEmail,
    primaryContactAddress: input.primaryContactAddress,
    primaryContactAddressLine1: input.primaryContactAddressLine1,
    primaryContactCity: input.primaryContactCity,
    primaryContactState: input.primaryContactState,
    primaryContactZip: input.primaryContactZip,
    caregiverAddressLine1: input.caregiverAddressLine1,
    caregiverAddressLine2: input.caregiverAddressLine2,
    caregiverCity: input.caregiverCity,
    caregiverState: input.caregiverState,
    caregiverZip: input.caregiverZip,
    secondaryContactName: input.secondaryContactName,
    secondaryContactPhone: input.secondaryContactPhone,
    secondaryContactEmail: input.secondaryContactEmail,
    secondaryContactRelationship: input.secondaryContactRelationship,
    secondaryContactAddress: input.secondaryContactAddress,
    secondaryContactAddressLine1: input.secondaryContactAddressLine1,
    secondaryContactCity: input.secondaryContactCity,
    secondaryContactState: input.secondaryContactState,
    secondaryContactZip: input.secondaryContactZip,
    notes: input.notes
  });
  const now = toEasternISO();
  const admin = createSupabaseAdminClient();
  try {
    await invokeSupabaseRpcOrThrow<unknown>(admin, SAVE_ENROLLMENT_PACKET_PROGRESS_RPC, {
      p_packet_id: context.request.id,
      p_caregiver_name: mergedPayload.primaryContactName,
      p_caregiver_phone: mergedPayload.primaryContactPhone,
      p_caregiver_email: cleanEmail(mergedPayload.primaryContactEmail),
      p_caregiver_address_line1:
        mergedPayload.primaryContactAddressLine1 ?? mergedPayload.primaryContactAddress ?? mergedPayload.memberAddressLine1,
      p_caregiver_address_line2: mergedPayload.memberAddressLine2,
      p_caregiver_city: mergedPayload.primaryContactCity ?? mergedPayload.memberCity,
      p_caregiver_state: mergedPayload.primaryContactState ?? mergedPayload.memberState,
      p_caregiver_zip: mergedPayload.primaryContactZip ?? mergedPayload.memberZip,
      p_secondary_contact_name: mergedPayload.secondaryContactName,
      p_secondary_contact_phone: mergedPayload.secondaryContactPhone,
      p_secondary_contact_email: cleanEmail(mergedPayload.secondaryContactEmail),
      p_secondary_contact_relationship: mergedPayload.secondaryContactRelationship,
      p_notes: mergedPayload.additionalNotes,
      p_intake_payload: mergedPayload,
      p_updated_at: now
    });
  } catch (error) {
    if (isMissingRpcFunctionError(error, SAVE_ENROLLMENT_PACKET_PROGRESS_RPC)) {
      throw new Error(
        `Enrollment packet progress RPC is not available yet. Apply Supabase migration ${ENROLLMENT_PACKET_DELIVERY_RPC_MIGRATION} first.`
      );
    }
    if (isMissingSchemaObjectError(error)) {
      throw new Error(
        buildMissingSchemaMessage({
          objectName: "enrollment_packet_fields",
          migration: "0027_enrollment_packet_intake_mapping.sql"
        })
      );
    }
    throw error;
  }

  await insertPacketEvent({
    packetId: context.request.id,
    eventType: "partially_completed",
    actorEmail: cleanEmail(mergedPayload.primaryContactEmail) ?? context.request.caregiverEmail
  });
  return { ok: true as const };
}

export async function submitPublicEnrollmentPacket(input: {
  token: string;
  caregiverTypedName: string;
  caregiverSignatureImageDataUrl: string;
  attested: boolean;
  caregiverIp: string | null;
  caregiverUserAgent: string | null;
  caregiverName?: string | null;
  caregiverPhone?: string | null;
  caregiverEmail?: string | null;
  primaryContactAddress?: string | null;
  primaryContactAddressLine1?: string | null;
  primaryContactCity?: string | null;
  primaryContactState?: string | null;
  primaryContactZip?: string | null;
  caregiverAddressLine1?: string | null;
  caregiverAddressLine2?: string | null;
  caregiverCity?: string | null;
  caregiverState?: string | null;
  caregiverZip?: string | null;
  secondaryContactName?: string | null;
  secondaryContactPhone?: string | null;
  secondaryContactEmail?: string | null;
  secondaryContactRelationship?: string | null;
  secondaryContactAddress?: string | null;
  secondaryContactAddressLine1?: string | null;
  secondaryContactCity?: string | null;
  secondaryContactState?: string | null;
  secondaryContactZip?: string | null;
  notes?: string | null;
  intakePayload?: Partial<Record<string, unknown>> | null;
  uploads?: PacketFileUpload[];
}) {
  const normalizedToken = clean(input.token);
  const caregiverTypedName = clean(input.caregiverTypedName);
  if (!normalizedToken) throw new Error("Signature token is required.");
  if (!caregiverTypedName) throw new Error("Typed caregiver name is required.");
  if (!input.attested) throw new Error("Electronic signature attestation is required.");
  const signature = parseDataUrlPayload(input.caregiverSignatureImageDataUrl);
  if (!signature.contentType.startsWith("image/")) throw new Error("Caregiver signature format is invalid.");

  const matchedRequest = await loadRequestByToken(normalizedToken);
  if (!matchedRequest) throw new Error("This enrollment packet link is invalid.");
  const request = matchedRequest.request;
  const status = toStatus(request.status);
  if (matchedRequest.tokenMatch === "consumed" && (status === "completed" || status === "filed")) {
    return {
      packetId: request.id,
      memberId: request.member_id,
      status: "filed" as const,
      mappingSyncStatus: request.mapping_sync_status ?? "pending",
      wasAlreadyFiled: true as const
    };
  }
  if (status === "completed" || status === "filed") throw new Error("This enrollment packet has already been submitted.");
  if (isExpired(request.token_expires_at)) {
    await recordEnrollmentPacketExpiredIfNeeded(request);
    throw new Error("This enrollment packet link has expired.");
  }

  const member = await getMemberById(request.member_id);
  if (!member) throw new Error("Member record was not found.");
  await enforcePublicEnrollmentPacketSubmissionGuards({
    request,
    caregiverIp: input.caregiverIp,
    caregiverUserAgent: input.caregiverUserAgent,
    uploads: input.uploads ?? []
  });
  const artifactOps = await loadEnrollmentPacketArtifactOps();
  let senderSignatureName = "Staff";
  let finalizedAt: string | null = null;
  let uploadBatchId: string | null = null;
  let finalizedSubmission:
    | {
        packetId: string;
        status: string;
        mappingSyncStatus: string;
        wasAlreadyFiled: boolean;
      }
    | null = null;
  let failedMappingRunId: string | null = null;
  let mappingSummary:
    | {
        mappingRunId: string | null;
        downstreamSystemsUpdated: string[];
        conflictsRequiringReview: number;
        status: "pending" | "completed" | "failed";
        error?: string | null;
      }
    | null = null;
  const stagedUploads: Array<{
    uploadCategory: EnrollmentPacketUploadCategory;
    objectPath: string;
    memberFileId: string | null;
    memberFileCreated: boolean;
  }> = [];
  const uploadedArtifacts: Array<{
    uploadCategory: EnrollmentPacketUploadCategory;
    memberFileId: string | null;
  }> = [];

  try {
    await savePublicEnrollmentPacketProgress({
      token: normalizedToken,
      caregiverName: input.caregiverName,
      caregiverPhone: input.caregiverPhone,
      caregiverEmail: input.caregiverEmail,
      primaryContactAddress: input.primaryContactAddress,
      primaryContactAddressLine1: input.primaryContactAddressLine1,
      primaryContactCity: input.primaryContactCity,
      primaryContactState: input.primaryContactState,
      primaryContactZip: input.primaryContactZip,
      caregiverAddressLine1: input.caregiverAddressLine1,
      caregiverAddressLine2: input.caregiverAddressLine2,
      caregiverCity: input.caregiverCity,
      caregiverState: input.caregiverState,
      caregiverZip: input.caregiverZip,
      secondaryContactName: input.secondaryContactName,
      secondaryContactPhone: input.secondaryContactPhone,
      secondaryContactEmail: input.secondaryContactEmail,
      secondaryContactRelationship: input.secondaryContactRelationship,
      secondaryContactAddress: input.secondaryContactAddress,
      secondaryContactAddressLine1: input.secondaryContactAddressLine1,
      secondaryContactCity: input.secondaryContactCity,
      secondaryContactState: input.secondaryContactState,
      secondaryContactZip: input.secondaryContactZip,
      notes: input.notes,
      intakePayload: input.intakePayload
    });

    const fieldsForValidation = await loadPacketFields(request.id);
    if (!fieldsForValidation) throw new Error("Enrollment packet fields were not found.");
    const validationPayload = normalizeStoredIntakePayload(fieldsForValidation);
    const validateEnrollmentPacketCompletion = await loadEnrollmentPacketCompletionValidator();
    const completionValidation = validateEnrollmentPacketCompletion({
      payload: validationPayload
    });
    if (!completionValidation.isComplete) {
      throw new Error(
        `Complete all required packet fields before signing. Missing: ${completionValidation.missingItems.join(", ")}.`
      );
    }

    const now = toEasternISO();
    const admin = createSupabaseAdminClient();
    const rotatedToken = hashToken(generateSigningToken());
    uploadBatchId = randomUUID();

    const senderSignature = await admin
      .from("enrollment_packet_signatures")
      .select("signer_name, signature_blob")
      .eq("packet_id", request.id)
      .eq("signer_role", "sender_staff")
      .order("signed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (senderSignature.error && !isRowFoundError(senderSignature.error)) {
      throw new Error(senderSignature.error.message);
    }
    senderSignatureName = senderSignature.data
      ? String((senderSignature.data as { signer_name: string }).signer_name)
      : "Staff";

    const signatureArtifact = await artifactOps.insertUploadAndFile({
      packetId: request.id,
      memberId: member.id,
      batchId: uploadBatchId,
      fileName: `Enrollment Packet Signature - ${toEasternDate(now)}.png`,
      contentType: signature.contentType,
      bytes: signature.bytes,
      uploadCategory: "signature_artifact",
      uploadedByUserId: null,
      uploadedByName: caregiverTypedName,
      dataUrl: input.caregiverSignatureImageDataUrl.trim()
    });
    stagedUploads.push({
      uploadCategory: "signature_artifact",
      objectPath: signatureArtifact.objectPath,
      memberFileId: signatureArtifact.memberFileId,
      memberFileCreated: signatureArtifact.memberFileCreated
    });
    uploadedArtifacts.push({
      uploadCategory: "signature_artifact",
      memberFileId: signatureArtifact.memberFileId
    });

    for (const upload of input.uploads ?? []) {
      const artifact = await artifactOps.insertUploadAndFile({
        packetId: request.id,
        memberId: member.id,
        batchId: uploadBatchId,
        fileName: upload.fileName,
        contentType: upload.contentType,
        bytes: upload.bytes,
        uploadCategory: upload.category,
        uploadedByUserId: null,
        uploadedByName: caregiverTypedName
      });
      stagedUploads.push({
        uploadCategory: upload.category,
        objectPath: artifact.objectPath,
        memberFileId: artifact.memberFileId,
        memberFileCreated: artifact.memberFileCreated
      });
      uploadedArtifacts.push({
        uploadCategory: upload.category,
        memberFileId: artifact.memberFileId
      });
    }

    const refreshedFields = await loadPacketFields(request.id);
    if (!refreshedFields) throw new Error("Enrollment packet fields are missing.");
    const packetDocx = await artifactOps.buildCompletedPacketArtifactData({
      memberName: member.display_name,
      request,
      fields: refreshedFields,
      intakePayload: normalizeStoredIntakePayload(refreshedFields),
      caregiverSignatureName: caregiverTypedName,
      senderSignatureName
    });
    const finalPacketArtifact = await artifactOps.insertUploadAndFile({
      packetId: request.id,
      memberId: member.id,
      batchId: uploadBatchId,
      fileName: packetDocx.fileName,
      contentType: packetDocx.contentType,
      bytes: packetDocx.bytes,
      uploadCategory: "completed_packet",
      uploadedByUserId: null,
      uploadedByName: caregiverTypedName,
      dataUrl: packetDocx.dataUrl
    });
    stagedUploads.push({
      uploadCategory: "completed_packet",
      objectPath: finalPacketArtifact.objectPath,
      memberFileId: finalPacketArtifact.memberFileId,
      memberFileCreated: finalPacketArtifact.memberFileCreated
    });
    uploadedArtifacts.push({
      uploadCategory: "completed_packet",
      memberFileId: finalPacketArtifact.memberFileId
    });

    finalizedAt = toEasternISO();
    finalizedSubmission = await invokeFinalizeEnrollmentPacketCompletionRpc({
      packetId: request.id,
      rotatedToken,
      consumedSubmissionTokenHash: hashToken(normalizedToken),
      completedAt: now,
      filedAt: finalizedAt,
      signerName: caregiverTypedName,
      signerEmail: cleanEmail(input.caregiverEmail) ?? request.caregiver_email,
      signatureBlob: input.caregiverSignatureImageDataUrl.trim(),
      ipAddress: clean(input.caregiverIp),
      actorUserId: request.sender_user_id,
      actorEmail: cleanEmail(input.caregiverEmail) ?? request.caregiver_email,
      uploadBatchId,
      completedMetadata: {
        caregiverSignatureName: caregiverTypedName,
        completedAt: now,
        signatureArtifactMemberFileId: signatureArtifact.memberFileId,
        finalPacketMemberFileId: finalPacketArtifact.memberFileId
      },
      filedMetadata: {
        caregiverSignatureName: caregiverTypedName,
        initiatedByUserId: request.sender_user_id,
        initiatedByName: senderSignatureName,
        completedAt: now,
        filedAt: finalizedAt,
        mappingSyncStatus: "pending"
      }
    });

    if (finalizedSubmission.wasAlreadyFiled) {
      await artifactOps.cleanupEnrollmentPacketUploadArtifacts({
        packetId: request.id,
        memberId: member.id,
        actorUserId: request.sender_user_id,
        reason: "Replay-safe enrollment packet finalization reused committed filed state.",
        batchId: uploadBatchId,
        uploads: stagedUploads
      });
      const replayedRequest = await loadRequestById(request.id);
      return {
        packetId: request.id,
        memberId: member.id,
        status: "filed" as const,
        mappingSyncStatus:
          replayedRequest?.mapping_sync_status ?? finalizedSubmission.mappingSyncStatus ?? "pending",
        wasAlreadyFiled: true as const
      };
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unable to complete enrollment packet.";
    if (stagedUploads.length > 0) {
      await artifactOps.cleanupEnrollmentPacketUploadArtifacts({
        packetId: request.id,
        memberId: member.id,
        actorUserId: request.sender_user_id,
        reason,
        batchId: uploadBatchId,
        uploads: stagedUploads
      });
    }
    await recordWorkflowEvent({
      eventType: "enrollment_packet_failed",
      entityType: "enrollment_packet_request",
      entityId: request.id,
      actorType: "user",
      actorUserId: request.sender_user_id,
      status: "failed",
      severity: "high",
      metadata: {
        member_id: member.id,
        lead_id: request.lead_id,
        phase: finalizedSubmission ? "post_finalize" : "finalization",
        error: reason,
        mapping_run_id: failedMappingRunId,
        upload_batch_id: uploadBatchId
      }
    });
    await recordWorkflowMilestone({
      event: {
        eventType: "enrollment_packet_failed",
        entityType: "enrollment_packet_request",
        entityId: request.id,
        actorType: "user",
        actorUserId: request.sender_user_id,
        status: "failed",
        severity: "high",
        metadata: {
          member_id: member.id,
          lead_id: request.lead_id,
          phase: finalizedSubmission ? "post_finalize" : "finalization",
          error: reason
        }
      }
    });
    await recordImmediateSystemAlert({
      entityType: "enrollment_packet_request",
      entityId: request.id,
      actorUserId: request.sender_user_id,
      severity: "high",
      alertKey: "enrollment_packet_completion_failed",
      metadata: {
        member_id: member.id,
        lead_id: request.lead_id,
        error: reason,
        mapping_run_id: failedMappingRunId,
        upload_batch_id: uploadBatchId
      }
    });
    throw error;
  }

  const refreshedFields = await loadPacketFields(request.id);

  if (refreshedFields) {
    mappingSummary = await runEnrollmentPacketDownstreamMapping({
      request,
      member,
      fields: refreshedFields,
      senderSignatureName,
      caregiverEmail: cleanEmail(input.caregiverEmail) ?? request.caregiver_email,
      memberFileArtifacts: uploadedArtifacts.map((artifact) => ({
        uploadCategory: artifact.uploadCategory,
        memberFileId: artifact.memberFileId
      })),
      actorType: "user"
    });
    failedMappingRunId = mappingSummary.mappingRunId;
  } else {
    mappingSummary = {
      mappingRunId: null,
      downstreamSystemsUpdated: [],
      conflictsRequiringReview: 0,
      status: "failed",
      error: "Enrollment packet fields are missing after filing."
    };
    failedMappingRunId = null;
    try {
      await artifactOps.updateEnrollmentPacketMappingSyncState({
        packetId: request.id,
        status: "failed",
        attemptedAt: toEasternISO(),
        error: mappingSummary.error,
        mappingRunId: null
      });
    } catch (syncStateError) {
      console.error("[enrollment-packets] unable to persist missing-fields mapping failure state", syncStateError);
    }
    await recordImmediateSystemAlert({
      entityType: "enrollment_packet_request",
      entityId: request.id,
      actorUserId: request.sender_user_id,
      severity: "high",
      alertKey: "enrollment_packet_mapping_missing_fields",
      metadata: {
        member_id: member.id,
        lead_id: request.lead_id
      }
    });
    await recordEnrollmentPacketActionRequired({
      packetId: request.id,
      memberId: member.id,
      leadId: request.lead_id,
      actorUserId: request.sender_user_id,
      title: "Enrollment Packet Sync Blocked",
      message:
        "The enrollment packet was filed, but downstream sync could not start because the packet fields could not be reloaded. Review the packet and complete the downstream handoff before relying on MCC/MHP/POF data.",
      actionUrl: `/sales/new-entries/completed-enrollment-packets`,
      eventKeySuffix: "mapping-missing-fields"
    });
  }

  if (request.lead_id) {
    try {
      const lead = await getLeadById(request.lead_id);
      await addLeadActivity({
        leadId: request.lead_id,
        memberName: lead?.member_name ?? member.display_name,
        activityType: "Email",
        outcome: "Enrollment Packet Completed",
        notes: `Enrollment packet request ${request.id} completed by caregiver and filed to member records.`,
        completedByUserId: request.sender_user_id,
        completedByName: senderSignatureName,
        activityAt: finalizedAt ?? toEasternISO()
      });
    } catch (error) {
      console.error("[enrollment-packets] unable to record lead activity after packet filing", error);
      await recordImmediateSystemAlert({
        entityType: "enrollment_packet_request",
        entityId: request.id,
        actorUserId: request.sender_user_id,
        severity: "medium",
        alertKey: "enrollment_packet_lead_activity_failed",
        metadata: {
          member_id: member.id,
          lead_id: request.lead_id,
          error: error instanceof Error ? error.message : "Unable to record lead activity after packet filing."
        }
      });
      await recordEnrollmentPacketActionRequired({
        packetId: request.id,
        memberId: member.id,
        leadId: request.lead_id,
        actorUserId: request.sender_user_id,
        title: "Enrollment Packet Lead Activity Missing",
        message:
          "The enrollment packet was filed, but the sales lead activity log did not save. Open the lead and add the missing completion activity so sales follow-up stays aligned.",
        actionUrl: request.lead_id ? `/sales/leads/${request.lead_id}` : "/sales/new-entries/completed-enrollment-packets",
        eventKeySuffix: "lead-activity-failed"
      });
    }
  }

  const reviewableUploads = uploadedArtifacts.filter(
    (artifact) => artifact.uploadCategory !== "completed_packet" && artifact.uploadCategory !== "signature_artifact"
  );

  await recordWorkflowEvent({
    eventType: "enrollment_packet_submitted",
    entityType: "enrollment_packet_request",
    entityId: request.id,
    actorType: "user",
    actorUserId: request.sender_user_id,
    status: "completed",
    severity: "low",
    metadata: {
      member_id: member.id,
      lead_id: request.lead_id,
      caregiver_signature_name: caregiverTypedName,
      completed_at: finalizedAt ?? toEasternISO(),
      filed_at: finalizedAt ?? toEasternISO(),
      mapping_sync_status: mappingSummary?.status ?? "pending",
      mapping_run_id: mappingSummary?.mappingRunId ?? null,
      downstream_systems_updated: mappingSummary?.downstreamSystemsUpdated ?? [],
      conflicts_requiring_review: mappingSummary?.conflictsRequiringReview ?? 0,
      mapping_error: mappingSummary?.status === "failed" ? mappingSummary.error ?? null : null
    }
  });

  if (reviewableUploads.length > 0) {
    await recordWorkflowMilestone({
      event: {
        eventType: "document_uploaded",
        entityType: "enrollment_packet_request",
        entityId: request.id,
        actorType: "user",
        actorUserId: request.sender_user_id,
        status: "completed",
        severity: "low",
        metadata: {
          member_id: member.id,
          lead_id: request.lead_id,
          document_label:
            reviewableUploads.length === 1
              ? `Enrollment ${reviewableUploads[0].uploadCategory.replaceAll("_", " ")} document`
              : `${reviewableUploads.length} enrollment documents`
        }
      }
    });
  } else {
    await recordWorkflowMilestone({
      event: {
        eventType: "missing_required_document",
        entityType: "enrollment_packet_request",
        entityId: request.id,
        actorType: "system",
        actorUserId: request.sender_user_id,
        status: "open",
        severity: "high",
        metadata: {
          member_id: member.id,
          lead_id: request.lead_id
        }
      }
    });
  }

  try {
    await recordWorkflowMilestone({
      event: {
        event_type: "enrollment_packet_submitted",
        entity_type: "enrollment_packet_request",
        entity_id: request.id,
        actor_type: "user",
        actor_id: request.sender_user_id,
        actor_user_id: request.sender_user_id,
        status: "completed",
        severity: "low",
        metadata: {
          member_id: member.id,
          lead_id: request.lead_id,
          caregiver_signature_name: caregiverTypedName,
          initiated_by_user_id: request.sender_user_id,
          initiated_by_name: senderSignatureName,
          completed_at: finalizedAt ?? toEasternISO(),
          filed_at: finalizedAt ?? toEasternISO(),
          status: "filed",
          mapping_sync_status: mappingSummary?.status ?? "pending",
          mapping_run_id: mappingSummary?.mappingRunId ?? null,
          downstream_systems_updated: mappingSummary?.downstreamSystemsUpdated ?? [],
          conflicts_requiring_review: mappingSummary?.conflictsRequiringReview ?? 0,
          mapping_error: mappingSummary?.status === "failed" ? mappingSummary.error ?? null : null
        }
      }
    });
  } catch (error) {
    console.error("[enrollment-packets] unable to emit post-completion workflow milestone", error);
  }

  return {
    packetId: request.id,
    memberId: member.id,
    status: "filed" as const,
    mappingSyncStatus: mappingSummary?.status ?? finalizedSubmission?.mappingSyncStatus ?? "pending",
    wasAlreadyFiled: false as const
  };
}
