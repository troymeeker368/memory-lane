import "server-only";

import { randomUUID } from "node:crypto";

import {
  buildMissingSchemaMessage,
  isMissingSchemaObjectError
} from "@/lib/services/billing-schema-errors";
import {
  type EnrollmentPacketCompletionCascadeResult,
  repairEnrollmentPacketCompletionCascade,
  runEnrollmentPacketCompletionCascade
} from "@/lib/services/enrollment-packet-completion-cascade";
import {
  buildPublicEnrollmentPacketSubmitResult,
  enforcePublicEnrollmentPacketSubmissionGuards,
  insertPacketEvent,
  recordPublicEnrollmentPacketGuardFailure as recordPublicEnrollmentPacketGuardFailureRuntime
} from "@/lib/services/enrollment-packet-public-helpers";
import {
  clean,
  cleanEmail,
  generateSigningToken,
  hashToken,
  isExpired,
  isMissingRpcFunctionError,
  mergePublicProgressPayload,
  normalizeStoredIntakePayload,
  payloadMemberDisplayName,
  safeNumber,
  throwEnrollmentPacketSchemaError,
  toDeliveryStatus,
  toStatus,
  toSummary
} from "@/lib/services/enrollment-packet-core";
import {
  loadEnrollmentPacketArtifactOps,
  getMemberById,
  loadPacketFields,
  loadRequestById,
  recordEnrollmentPacketActionRequired,
} from "@/lib/services/enrollment-packet-mapping-runtime";
import { markEnrollmentPacketDeliveryState } from "@/lib/services/enrollment-packet-delivery-runtime";
import { recordWorkflowMilestone } from "@/lib/services/lifecycle-milestones";
import { parseDataUrlPayload } from "@/lib/services/member-files";
import { parseMemberDocumentStorageUri } from "@/lib/services/member-files";
import {
  recordImmediateSystemAlert,
  recordWorkflowEvent
} from "@/lib/services/workflow-observability";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";
import { toEasternDate, toEasternISO } from "@/lib/timezone";
import type {
  EnrollmentPacketFieldsRow,
  EnrollmentPacketRequestRow,
  EnrollmentPacketTokenMatch,
  EnrollmentPacketUploadCategory,
  FinalizedEnrollmentPacketSubmissionRpcRow,
  PacketFileUpload,
  PublicEnrollmentPacketContext
} from "@/lib/services/enrollment-packet-types";

const ENROLLMENT_PACKET_COMPLETION_RPC = "rpc_finalize_enrollment_packet_submission";
const SAVE_ENROLLMENT_PACKET_PROGRESS_RPC = "rpc_save_enrollment_packet_progress";
const ENROLLMENT_PACKET_DELIVERY_RPC_MIGRATION = "0073_delivery_and_member_file_rpc_hardening.sql";
const ENROLLMENT_PACKET_COMPLETION_MIGRATION = "0053_artifact_drift_replay_hardening.sql";
const PUBLIC_ENROLLMENT_PACKET_UPLOAD_COUNT_LIMIT = 12;
const PUBLIC_ENROLLMENT_PACKET_TOTAL_UPLOAD_BYTES_LIMIT = 30 * 1024 * 1024;
const PUBLIC_ENROLLMENT_PACKET_TOTAL_UPLOAD_MB =
  PUBLIC_ENROLLMENT_PACKET_TOTAL_UPLOAD_BYTES_LIMIT / (1024 * 1024);
const PUBLIC_ENROLLMENT_PACKET_SUBMIT_LOOKBACK_MINUTES = 15;
const PUBLIC_ENROLLMENT_PACKET_TOKEN_SUBMIT_ATTEMPT_LIMIT = 5;
const PUBLIC_ENROLLMENT_PACKET_IP_SUBMIT_ATTEMPT_LIMIT = 10;

type EnrollmentPacketCompletionAgreementSummary = Pick<
  EnrollmentPacketCompletionCascadeResult,
  | "senderNotificationDelivered"
  | "leadActivitySynced"
  | "completedPacketArtifactLinked"
  | "operationalShellsReady"
>;

async function loadEnrollmentPacketCompletionValidator() {
  const { validateEnrollmentPacketCompletion, validateEnrollmentPacketSubmission } = await import(
    "@/lib/services/enrollment-packet-public-validation"
  );
  return {
    validateEnrollmentPacketCompletion,
    validateEnrollmentPacketSubmission
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

export async function recordPublicEnrollmentPacketGuardFailure(input: {
  token?: string | null;
  caregiverIp?: string | null;
  caregiverUserAgent?: string | null;
  failureType: string;
  message: string;
  uploadCount?: number;
  uploadBytes?: number;
  severity?: "low" | "medium" | "high" | "critical";
}) {
  return recordPublicEnrollmentPacketGuardFailureRuntime({
    ...input,
    resolveRequestByToken: loadRequestByToken
  });
}

async function buildCommittedEnrollmentPacketReplayResult(input: {
  request: EnrollmentPacketRequestRow;
}) {
  let repairedRequest = input.request;
  let repairedSummary: EnrollmentPacketCompletionAgreementSummary | null = null;

  try {
    repairedSummary = await repairEnrollmentPacketCompletionCascade({
      packetId: input.request.id,
      actorType: "system"
    });
    repairedRequest = (await loadRequestById(input.request.id)) ?? input.request;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown enrollment packet replay repair failure.";
    console.error("[enrollment-packets] unable to self-heal already-completed enrollment packet replay", {
      packetId: input.request.id,
      message
    });
    await recordImmediateSystemAlert({
      entityType: "enrollment_packet_request",
      entityId: input.request.id,
      actorUserId: input.request.sender_user_id,
      severity: "medium",
      alertKey: "enrollment_packet_replay_repair_failed",
      metadata: {
        member_id: input.request.member_id,
        lead_id: input.request.lead_id,
        error: message
      }
    });
  }

  const submitResult = buildPublicEnrollmentPacketSubmitResult({
    packetId: input.request.id,
    memberId: input.request.member_id,
    mappingSyncStatus: repairedRequest.mapping_sync_status ?? "pending",
    wasAlreadyFiled: true
  });
  await assertEnrollmentPacketCompletionAgreement({
    request: repairedRequest,
    operationalReadinessStatus: submitResult.operationalReadinessStatus,
    senderNotificationDelivered: repairedSummary?.senderNotificationDelivered ?? true,
    leadActivitySynced: repairedSummary?.leadActivitySynced ?? true,
    completedPacketArtifactLinked: repairedSummary?.completedPacketArtifactLinked ?? true,
    operationalShellsReady: repairedSummary?.operationalShellsReady ?? true,
    source: "buildCommittedEnrollmentPacketReplayResult"
  });
  return submitResult;
}

async function verifyCommittedEnrollmentPacketFinalizeAfterError(input: {
  packetId: string;
  expectedMemberId: string;
  actorUserId: string;
  uploadBatchId: string | null;
  consumedSubmissionTokenHash: string;
  stagedUploads: Array<{
    uploadCategory: EnrollmentPacketUploadCategory;
    memberFileId: string | null;
  }>;
  reason: string;
}) {
  const refreshedRequest = await loadRequestById(input.packetId);
  if (!refreshedRequest) {
    await recordImmediateSystemAlert({
      entityType: "enrollment_packet_request",
      entityId: input.packetId,
      actorUserId: input.actorUserId,
      severity: "high",
      alertKey: "enrollment_packet_finalize_verification_pending",
      metadata: {
        member_id: input.expectedMemberId,
        upload_batch_id: input.uploadBatchId,
        reason: input.reason,
        verification_result: "request_missing"
      }
    });
    return { kind: "unverified" as const, request: null };
  }

  if (refreshedRequest.member_id !== input.expectedMemberId) {
    await recordImmediateSystemAlert({
      entityType: "enrollment_packet_request",
      entityId: input.packetId,
      actorUserId: input.actorUserId,
      severity: "high",
      alertKey: "enrollment_packet_finalize_verification_pending",
      metadata: {
        member_id: input.expectedMemberId,
        refreshed_member_id: refreshedRequest.member_id,
        upload_batch_id: input.uploadBatchId,
        reason: input.reason,
        verification_result: "member_mismatch"
      }
    });
    return { kind: "unverified" as const, request: refreshedRequest };
  }

  const admin = createSupabaseAdminClient();
  const batchId = String(input.uploadBatchId ?? "").trim();
  let uploadRows: Array<{
    upload_category: EnrollmentPacketUploadCategory;
    member_file_id: string | null;
    finalization_status: string | null;
  }> = [];
  if (batchId) {
    const { data, error } = await admin
      .from("enrollment_packet_uploads")
      .select("upload_category, member_file_id, finalization_status")
      .eq("packet_id", input.packetId)
      .eq("finalization_batch_id", batchId);
    if (error) throwEnrollmentPacketSchemaError(error, "enrollment_packet_uploads");
    uploadRows = (data ??
      []) as Array<{
      upload_category: EnrollmentPacketUploadCategory;
      member_file_id: string | null;
      finalization_status: string | null;
    }>;
  }

  const expectedArtifacts = input.stagedUploads
    .map((upload) => `${upload.uploadCategory}:${String(upload.memberFileId ?? "").trim()}`)
    .filter((value) => !value.endsWith(":"));
  const finalizedArtifacts = new Set(
    uploadRows
      .filter((row) => String(row.finalization_status ?? "").trim() === "finalized")
      .map((row) => `${row.upload_category}:${String(row.member_file_id ?? "").trim()}`)
      .filter((value) => !value.endsWith(":"))
  );
  const stagedOnly =
    uploadRows.length > 0 &&
    uploadRows.every((row) => String(row.finalization_status ?? "").trim() === "staged");
  const hasExpectedFinalizedArtifacts =
    expectedArtifacts.length > 0 && expectedArtifacts.every((key) => finalizedArtifacts.has(key));
  const tokenConsumed =
    clean(refreshedRequest.last_consumed_submission_token_hash) === input.consumedSubmissionTokenHash;
  const requestStatus = toStatus(refreshedRequest.status);

  if (requestStatus === "completed" && hasExpectedFinalizedArtifacts) {
    return { kind: "committed" as const, request: refreshedRequest };
  }

  if (requestStatus !== "completed" && !tokenConsumed && stagedOnly) {
    return { kind: "not_committed" as const, request: refreshedRequest };
  }

  await recordImmediateSystemAlert({
    entityType: "enrollment_packet_request",
    entityId: input.packetId,
    actorUserId: input.actorUserId,
    severity: "high",
    alertKey: "enrollment_packet_finalize_verification_pending",
    metadata: {
      member_id: input.expectedMemberId,
      refreshed_status: requestStatus,
      upload_batch_id: input.uploadBatchId,
      finalized_artifact_count: finalizedArtifacts.size,
      expected_artifact_count: expectedArtifacts.length,
      token_consumed: tokenConsumed,
      reason: input.reason,
      verification_result: "ambiguous"
    }
  });
  return { kind: "unverified" as const, request: refreshedRequest };
}

function buildEnrollmentPacketCompletionAgreementMessage(input: {
  operationalReadinessStatus: string;
  senderNotificationDelivered: boolean;
  leadActivitySynced: boolean;
  completedPacketArtifactLinked: boolean;
  operationalShellsReady: boolean;
  hasLead: boolean;
}) {
  const issues: string[] = [];
  if (input.operationalReadinessStatus !== "operationally_ready") {
    issues.push("downstream mapping is not fully complete");
  }
  if (!input.completedPacketArtifactLinked) {
    issues.push("completed packet artifact linkage did not finalize");
  }
  if (!input.operationalShellsReady) {
    issues.push("member operational shell sync did not finalize");
  }
  if (!input.senderNotificationDelivered) {
    issues.push("sender notification did not finalize");
  }
  if (input.hasLead && !input.leadActivitySynced) {
    issues.push("lead activity sync did not finalize");
  }

  if (issues.length === 0) return null;
  return `Enrollment packet was filed, but ${issues.join(", ")}. Staff should repair the packet workflow before treating this member as operationally ready.`;
}

async function assertEnrollmentPacketCompletionAgreement(input: {
  request: EnrollmentPacketRequestRow;
  operationalReadinessStatus: string;
  senderNotificationDelivered: boolean;
  leadActivitySynced: boolean;
  completedPacketArtifactLinked: boolean;
  operationalShellsReady: boolean;
  source: string;
}) {
  const message = buildEnrollmentPacketCompletionAgreementMessage({
    operationalReadinessStatus: input.operationalReadinessStatus,
    senderNotificationDelivered: input.senderNotificationDelivered,
    leadActivitySynced: input.leadActivitySynced,
    completedPacketArtifactLinked: input.completedPacketArtifactLinked,
    operationalShellsReady: input.operationalShellsReady,
    hasLead: Boolean(input.request.lead_id)
  });
  if (!message) return;

  await recordImmediateSystemAlert({
    entityType: "enrollment_packet_request",
    entityId: input.request.id,
    actorUserId: input.request.sender_user_id,
    severity: "high",
    alertKey: "enrollment_packet_completion_consensus_failed",
    metadata: {
      member_id: input.request.member_id,
      lead_id: input.request.lead_id,
      operational_readiness_status: input.operationalReadinessStatus,
      sender_notification_delivered: input.senderNotificationDelivered,
      lead_activity_synced: input.leadActivitySynced,
      completed_packet_artifact_linked: input.completedPacketArtifactLinked,
      operational_shells_ready: input.operationalShellsReady,
      source: input.source
    }
  });
  throw new Error(message);
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

async function markEnrollmentPacketOpened(input: {
  request: EnrollmentPacketRequestRow;
  metadata?: { ip?: string | null; userAgent?: string | null };
}) {
  if (input.request.opened_at) return false;
  const now = toEasternISO();
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("enrollment_packet_requests")
    .update({
      opened_at: now,
      last_family_activity_at: now,
      updated_at: now
    })
    .eq("id", input.request.id)
    .eq("status", input.request.status)
    .is("opened_at", null)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[enrollment-packets] unable to persist opened timestamp", error);
    return false;
  }
  if (!data?.id) return false;

  await insertPacketEvent({
    packetId: input.request.id,
    eventType: "opened",
    actorEmail: input.request.caregiver_email,
    metadata: {
      ip: clean(input.metadata?.ip),
      userAgent: clean(input.metadata?.userAgent)
    }
  });
  return true;
}

async function recordEnrollmentPacketExpiredIfNeeded(request: EnrollmentPacketRequestRow) {
  const requestStatus = toStatus(request.status);
  const shouldExpireStatus =
    requestStatus === "draft" ||
    requestStatus === "sent" ||
    requestStatus === "in_progress";

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

export async function getPublicEnrollmentPacketContext(
  token: string,
  metadata?: { ip?: string | null; userAgent?: string | null }
): Promise<PublicEnrollmentPacketContext> {
  const normalizedToken = clean(token);
  if (!normalizedToken) return { state: "invalid" };
  const matched = await loadRequestByToken(normalizedToken);
  if (!matched) return { state: "invalid" };
  const request = matched.request;

  if (toStatus(request.status) === "voided") {
    return { state: "voided" };
  }
  if (toStatus(request.status) === "completed") {
    const completedRequest = (await loadRequestById(request.id)) ?? request;
    const completedResult = buildPublicEnrollmentPacketSubmitResult({
      packetId: completedRequest.id,
      memberId: completedRequest.member_id,
      mappingSyncStatus: completedRequest.mapping_sync_status ?? "pending",
      wasAlreadyFiled: true
    });
    return {
      state: "completed",
      request: toSummary(completedRequest),
      mappingSyncStatus: completedResult.mappingSyncStatus,
      operationalReadinessStatus: completedResult.operationalReadinessStatus,
      actionNeeded: completedResult.operationalReadinessStatus !== "operationally_ready",
      actionNeededMessage: completedResult.actionNeededMessage
    };
  }
  if (isExpired(request.token_expires_at)) {
    await recordEnrollmentPacketExpiredIfNeeded(request);
    return { state: "expired" };
  }

  if (toStatus(request.status) === "sent") {
    await markEnrollmentPacketOpened({ request, metadata });
  }

  const [reloaded, fields, member] = await Promise.all([
    loadRequestById(request.id),
    loadPacketFields(request.id),
    getMemberById(request.member_id)
  ]);
  if (!reloaded || !fields || !member) return { state: "invalid" };
  return toPublicContext(reloaded, fields, member.display_name);
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
  const validateIntakePayload = (payload: unknown): payload is Partial<Record<string, unknown>> => {
    return Boolean(payload) && typeof payload === "object" && !Array.isArray(payload);
  };

  const context = await getPublicEnrollmentPacketContext(input.token);
  if (context.state !== "ready") throw new Error("Enrollment packet link is not active.");

  if (!validateIntakePayload(input.intakePayload)) {
    await recordPublicEnrollmentPacketGuardFailure({
      token: input.token,
      caregiverIp: null,
      caregiverUserAgent: null,
      failureType: "invalid_intake_payload_json",
      message: "Public enrollment packet progress included malformed intakePayload JSON.",
      severity: "medium"
    }).catch(() => {
      // Intentionally ignore logging failures here; preserve deterministic submission failure behavior.
    });
    throw new Error("Enrollment packet answers are invalid. Refresh the form and try again.");
  }

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
  const requestWasAlreadyInProgress = toStatus(context.request.status) === "in_progress";
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

  if (!requestWasAlreadyInProgress) {
    await insertPacketEvent({
      packetId: context.request.id,
      eventType: "in_progress",
      actorEmail: cleanEmail(mergedPayload.primaryContactEmail) ?? context.request.caregiverEmail
    });
  }
  return { ok: true as const };
}

export async function getPublicCompletedEnrollmentPacketArtifact(input: {
  token: string;
}) {
  const context = await getPublicEnrollmentPacketContext(input.token);
  if (context.state !== "completed") {
    throw new Error("Completed enrollment packet is not available.");
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("enrollment_packet_uploads")
    .select("file_path, file_name, file_type, uploaded_at")
    .eq("packet_id", context.request.id)
    .eq("upload_category", "completed_packet")
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throwEnrollmentPacketSchemaError(error, "enrollment_packet_uploads");
  if (!data) {
    throw new Error("Completed enrollment packet PDF could not be found.");
  }

  const objectPath = parseMemberDocumentStorageUri(data.file_path);
  if (!objectPath) {
    throw new Error("Completed enrollment packet PDF storage path is invalid.");
  }

  return {
    packetId: context.request.id,
    fileName: clean(data.file_name) ?? `Enrollment Packet Completed - ${context.request.id}.pdf`,
    fileType: clean(data.file_type) ?? "application/pdf",
    objectPath
  };
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
  if (matchedRequest.tokenMatch === "consumed" && status === "completed") {
    return buildCommittedEnrollmentPacketReplayResult({ request });
  }
  if (status === "completed") {
    return buildCommittedEnrollmentPacketReplayResult({ request });
  }
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
    uploads: input.uploads ?? [],
    limits: {
      uploadCountLimit: PUBLIC_ENROLLMENT_PACKET_UPLOAD_COUNT_LIMIT,
      uploadBytesLimit: PUBLIC_ENROLLMENT_PACKET_TOTAL_UPLOAD_BYTES_LIMIT,
      totalUploadMb: PUBLIC_ENROLLMENT_PACKET_TOTAL_UPLOAD_MB,
      submitLookbackMinutes: PUBLIC_ENROLLMENT_PACKET_SUBMIT_LOOKBACK_MINUTES,
      tokenAttemptLimit: PUBLIC_ENROLLMENT_PACKET_TOKEN_SUBMIT_ATTEMPT_LIMIT,
      ipAttemptLimit: PUBLIC_ENROLLMENT_PACKET_IP_SUBMIT_ATTEMPT_LIMIT
    }
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
        status: "completed" | "failed";
        error?: string | null;
      }
    | null = null;
  let completionCascadeSummary: EnrollmentPacketCompletionAgreementSummary | null = null;
  const consumedSubmissionTokenHash = hashToken(normalizedToken);
  let finalizeAttempted = false;
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
    const { validateEnrollmentPacketSubmission } = await loadEnrollmentPacketCompletionValidator();
    const completionValidation = validateEnrollmentPacketSubmission({
      payload: validationPayload,
      caregiverTypedName,
      hasSignature: true,
      attested: input.attested
    });
    if (!completionValidation.isComplete) {
      const issues = [...completionValidation.missingItems, ...completionValidation.signatureErrors];
      throw new Error(
        `Complete all required packet fields before signing. Missing: ${issues.join(", ")}.`
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
    if (senderSignature.error) {
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
      senderSignatureName,
      uploadedDocuments: (input.uploads ?? []).map((upload) => ({
        category: upload.category,
        fileName: upload.fileName
      }))
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
    finalizeAttempted = true;
    finalizedSubmission = await invokeFinalizeEnrollmentPacketCompletionRpc({
      packetId: request.id,
      rotatedToken,
      consumedSubmissionTokenHash,
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
        reason: "Replay-safe enrollment packet finalization reused committed completed state.",
        batchId: uploadBatchId,
        uploads: stagedUploads
      });
      return buildCommittedEnrollmentPacketReplayResult({
        request: (await loadRequestById(request.id)) ?? request
      });
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unable to complete enrollment packet.";
    let finalizeVerification:
      | Awaited<ReturnType<typeof verifyCommittedEnrollmentPacketFinalizeAfterError>>
      | null = null;
    if (!finalizedSubmission && finalizeAttempted) {
      finalizeVerification = await verifyCommittedEnrollmentPacketFinalizeAfterError({
        packetId: request.id,
        expectedMemberId: member.id,
        actorUserId: request.sender_user_id,
        uploadBatchId,
        consumedSubmissionTokenHash,
        stagedUploads: stagedUploads.map((upload) => ({
          uploadCategory: upload.uploadCategory,
          memberFileId: upload.memberFileId
        })),
        reason
      });
      if (finalizeVerification.kind === "committed" && finalizeVerification.request) {
        return buildCommittedEnrollmentPacketReplayResult({
          request: finalizeVerification.request
        });
      }
    }
    if (stagedUploads.length > 0 && finalizeVerification?.kind !== "unverified") {
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

  const refreshedRequest = await loadRequestById(request.id);
  const refreshedFields = await loadPacketFields(request.id);

  if (refreshedRequest && refreshedFields) {
    try {
      const cascadeSummary = await runEnrollmentPacketCompletionCascade({
        request: refreshedRequest,
        member,
        fields: refreshedFields,
        senderSignatureName,
        caregiverEmail: cleanEmail(input.caregiverEmail) ?? request.caregiver_email,
        memberFileArtifacts: uploadedArtifacts.map((artifact) => ({
          uploadCategory: artifact.uploadCategory,
          memberFileId: artifact.memberFileId
        })),
        actorType: "user",
        ensureCompletedPacketArtifact: false
      });
      mappingSummary = {
        mappingRunId: cascadeSummary.mappingRunId,
        status: cascadeSummary.mappingStatus
      };
      completionCascadeSummary = {
        senderNotificationDelivered: cascadeSummary.senderNotificationDelivered,
        leadActivitySynced: cascadeSummary.leadActivitySynced,
        completedPacketArtifactLinked: cascadeSummary.completedPacketArtifactLinked,
        operationalShellsReady: cascadeSummary.operationalShellsReady
      };
      failedMappingRunId = cascadeSummary.mappingRunId;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unable to run enrollment packet completion cascade.";
      mappingSummary = {
        mappingRunId: null,
        status: "failed",
        error: reason
      };
      failedMappingRunId = null;
      try {
        await artifactOps.updateEnrollmentPacketMappingSyncState({
          packetId: request.id,
          status: "failed",
          attemptedAt: toEasternISO(),
          error: reason,
          mappingRunId: null
        });
      } catch (syncStateError) {
        console.error("[enrollment-packets] unable to persist cascade failure mapping state", syncStateError);
      }
      await recordImmediateSystemAlert({
        entityType: "enrollment_packet_request",
        entityId: request.id,
        actorUserId: request.sender_user_id,
        severity: "medium",
        alertKey: "enrollment_packet_completion_cascade_failed",
        metadata: {
          member_id: member.id,
          lead_id: request.lead_id,
          error: reason,
          upload_batch_id: uploadBatchId
        }
      });
      await recordEnrollmentPacketActionRequired({
        packetId: request.id,
        memberId: member.id,
        leadId: request.lead_id,
        actorUserId: request.sender_user_id,
        title: "Enrollment Packet Sync Blocked",
        message:
          "The enrollment packet was completed, but downstream sync could not start. Review the packet and complete the downstream handoff before relying on MCC/MHP/POF data.",
        actionUrl: `/sales/pipeline/enrollment-packets`,
        eventKeySuffix: "mapping-cascade-failed"
      });
    }
  } else {
    mappingSummary = {
      mappingRunId: null,
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
        "The enrollment packet was completed, but downstream sync could not start because the packet fields could not be reloaded. Review the packet and complete the downstream handoff before relying on MCC/MHP/POF data.",
      actionUrl: `/sales/pipeline/enrollment-packets`,
      eventKeySuffix: "mapping-missing-fields"
    });
  }

  const reviewableUploads = uploadedArtifacts.filter(
    (artifact) => artifact.uploadCategory !== "completed_packet" && artifact.uploadCategory !== "signature_artifact"
  );

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

  const submitResult = buildPublicEnrollmentPacketSubmitResult({
    packetId: request.id,
    memberId: member.id,
    mappingSyncStatus: mappingSummary?.status ?? finalizedSubmission?.mappingSyncStatus ?? "pending",
    wasAlreadyFiled: false
  });
  await assertEnrollmentPacketCompletionAgreement({
    request,
    operationalReadinessStatus: submitResult.operationalReadinessStatus,
    senderNotificationDelivered: completionCascadeSummary?.senderNotificationDelivered ?? false,
    leadActivitySynced: completionCascadeSummary?.leadActivitySynced ?? !request.lead_id,
    completedPacketArtifactLinked: completionCascadeSummary?.completedPacketArtifactLinked ?? false,
    operationalShellsReady: completionCascadeSummary?.operationalShellsReady ?? false,
    source: "submitPublicEnrollmentPacket.preReturn"
  });
  return submitResult;
}
