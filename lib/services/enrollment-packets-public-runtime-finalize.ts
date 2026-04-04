import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";
import {
  buildPublicEnrollmentPacketSubmitResult
} from "@/lib/services/enrollment-packet-public-helpers";
import {
  clean,
  isMissingRpcFunctionError,
  throwEnrollmentPacketSchemaError,
  toStatus
} from "@/lib/services/enrollment-packet-core";
import { loadRequestById } from "@/lib/services/enrollment-packet-mapping-runtime";
import { recordImmediateSystemAlert } from "@/lib/services/workflow-observability";
import type {
  EnrollmentPacketRequestRow,
  EnrollmentPacketUploadCategory,
  FinalizedEnrollmentPacketSubmissionRpcRow
} from "@/lib/services/enrollment-packet-types";

const ENROLLMENT_PACKET_COMPLETION_RPC = "rpc_finalize_enrollment_packet_submission";
const ENROLLMENT_PACKET_COMPLETION_MIGRATION = "0053_artifact_drift_replay_hardening.sql";

export async function buildCommittedEnrollmentPacketReplayResult(input: {
  request: EnrollmentPacketRequestRow;
}) {
  const committedRequest = (await loadRequestById(input.request.id)) ?? input.request;

  return buildPublicEnrollmentPacketSubmitResult({
    packetId: input.request.id,
    memberId: input.request.member_id,
    mappingSyncStatus: committedRequest.mapping_sync_status ?? "pending",
    completionFollowUpStatus: committedRequest.completion_follow_up_status ?? "pending",
    completionFollowUpError: committedRequest.completion_follow_up_error,
    wasAlreadyFiled: true
  });
}

export async function verifyCommittedEnrollmentPacketFinalizeAfterError(input: {
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
  const hasRequiredCommitEvidence =
    requestStatus === "completed" && tokenConsumed && (expectedArtifacts.length === 0 || hasExpectedFinalizedArtifacts);

  if (hasRequiredCommitEvidence) {
    return { kind: "committed" as const, request: refreshedRequest };
  }

  if (requestStatus !== "completed" && !tokenConsumed && (expectedArtifacts.length === 0 || stagedOnly)) {
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

export async function invokeFinalizeEnrollmentPacketCompletionRpc(input: {
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
  uploadBatchId: string | null;
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
