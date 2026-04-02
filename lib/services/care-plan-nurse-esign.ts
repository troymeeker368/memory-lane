import "server-only";

import {
  CARE_PLAN_NURSE_SIGNATURE_STATUS_VALUES,
  buildCarePlanNurseSignaturePersistence,
  cleanCarePlanSignatureValue,
  getUnsignedCarePlanNurseSignatureState,
  isAuthorizedCarePlanSignerRole,
  parseCarePlanNurseSignatureStatus,
  type CarePlanNurseSignatureState,
  type CarePlanNurseSignatureStatus
} from "@/lib/services/care-plan-nurse-esign-core";
import { captureClinicalEsignArtifact } from "@/lib/services/clinical-esign-artifacts";
import {
  deleteMemberFileRecordAndStorage
} from "@/lib/services/member-files";
import {
  recordImmediateSystemAlert,
  recordWorkflowEvent
} from "@/lib/services/workflow-observability";
import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";
import { createClient } from "@/lib/supabase/server";
import { toEasternDate, toEasternISO } from "@/lib/timezone";

export {
  CARE_PLAN_NURSE_SIGNATURE_STATUS_VALUES,
  buildCarePlanNurseSignaturePersistence,
  getUnsignedCarePlanNurseSignatureState,
  isAuthorizedCarePlanSignerRole,
  type CarePlanNurseSignatureState,
  type CarePlanNurseSignatureStatus
};

type CarePlanNurseSignatureRow = {
  care_plan_id: string;
  member_id: string;
  signed_by_user_id: string;
  signed_by_name: string;
  signed_at: string;
  status: "signed" | "voided";
  signature_artifact_storage_path: string | null;
  signature_artifact_member_file_id: string | null;
  signature_metadata: Record<string, unknown> | null;
};

type FinalizedCarePlanNurseSignatureRpcRow = CarePlanNurseSignatureRow & {
  caregiver_signature_status: string | null;
  was_already_signed: boolean;
};

const FINALIZE_CARE_PLAN_NURSE_SIGNATURE_RPC = "rpc_finalize_care_plan_nurse_signature";
const FINALIZE_CARE_PLAN_NURSE_SIGNATURE_MIGRATION = "0053_artifact_drift_replay_hardening.sql";

function toStateFromRow(row: CarePlanNurseSignatureRow): CarePlanNurseSignatureState {
  return {
    carePlanId: row.care_plan_id,
    memberId: row.member_id,
    status: parseCarePlanNurseSignatureStatus(row.status),
    signedByUserId: row.signed_by_user_id,
    signedByName: row.signed_by_name,
    signedAt: row.signed_at,
    signatureArtifactStoragePath: row.signature_artifact_storage_path,
    signatureArtifactMemberFileId: row.signature_artifact_member_file_id,
    signatureMetadata:
      row.signature_metadata && typeof row.signature_metadata === "object"
        ? (row.signature_metadata as Record<string, unknown>)
        : {}
  };
}

async function reportCarePlanPostCommitTelemetryFailure(input: {
  carePlanId: string;
  memberId: string;
  actorUserId: string;
  step: string;
  error: unknown;
}) {
  const reason =
    input.error instanceof Error ? input.error.message : "Unknown post-commit care plan telemetry failure.";
  console.error("Care plan nurse signature post-commit telemetry failed.", {
    carePlanId: input.carePlanId,
    memberId: input.memberId,
    step: input.step,
    error: input.error
  });
  try {
    await recordImmediateSystemAlert({
      entityType: "care_plan",
      entityId: input.carePlanId,
      actorUserId: input.actorUserId,
      severity: "medium",
      alertKey: "care_plan_nurse_signature_post_commit_telemetry_failed",
      metadata: {
        member_id: input.memberId,
        step: input.step,
        error: reason
      }
    });
  } catch (alertError) {
    console.error("Failed to record care plan nurse post-commit telemetry alert.", {
      carePlanId: input.carePlanId,
      memberId: input.memberId,
      step: input.step,
      error: alertError
    });
  }
}

async function cleanupCarePlanNurseSignatureArtifactAfterFinalizeFailure(input: {
  carePlanId: string;
  memberId: string;
  actorUserId: string;
  reason: string;
  artifact: {
    signatureArtifactStoragePath: string | null;
    signatureArtifactMemberFileId: string | null;
    signatureArtifactMemberFileCreated?: boolean;
  };
}) {
  if (!input.artifact.signatureArtifactMemberFileCreated) {
    await recordImmediateSystemAlert({
      entityType: "care_plan",
      entityId: input.carePlanId,
      actorUserId: input.actorUserId,
      severity: "high",
      alertKey: "care_plan_nurse_signature_finalize_split_brain",
      metadata: {
        member_id: input.memberId,
        reason: input.reason,
        signature_artifact_storage_path: input.artifact.signatureArtifactStoragePath,
        signature_artifact_member_file_id: input.artifact.signatureArtifactMemberFileId
      }
    });
    return;
  }

  try {
    if (input.artifact.signatureArtifactMemberFileId) {
      await deleteMemberFileRecordAndStorage({
        memberFileId: input.artifact.signatureArtifactMemberFileId,
        storageObjectPath: input.artifact.signatureArtifactStoragePath,
        actorUserId: input.actorUserId,
        entityType: "care_plan",
        entityId: input.carePlanId,
        alertKey: "care_plan_nurse_signature_finalize_storage_cleanup_failed",
        metadata: {
          member_id: input.memberId,
          reason: input.reason
        }
      });
    }
  } catch (cleanupError) {
    await recordImmediateSystemAlert({
      entityType: "care_plan",
      entityId: input.carePlanId,
      actorUserId: input.actorUserId,
      severity: "high",
      alertKey: "care_plan_nurse_signature_finalize_cleanup_failed",
      metadata: {
        member_id: input.memberId,
        reason: input.reason,
        cleanup_error: cleanupError instanceof Error ? cleanupError.message : "Unknown cleanup error.",
        signature_artifact_storage_path: input.artifact.signatureArtifactStoragePath,
        signature_artifact_member_file_id: input.artifact.signatureArtifactMemberFileId
      }
    });
  }
}

async function verifyCommittedCarePlanNurseSignatureAfterFinalizeError(input: {
  carePlanId: string;
  expectedMemberId: string;
  expectedSignatureArtifactStoragePath: string | null;
  expectedSignatureArtifactMemberFileId: string | null;
  actorUserId: string;
  reason: string;
}) {
  let state: CarePlanNurseSignatureState;
  try {
    state = await getCarePlanNurseSignatureState(input.carePlanId, { serviceRole: true });
  } catch (error) {
    await recordImmediateSystemAlert({
      entityType: "care_plan",
      entityId: input.carePlanId,
      actorUserId: input.actorUserId,
      severity: "high",
      alertKey: "care_plan_nurse_signature_finalize_verification_pending",
      metadata: {
        member_id: input.expectedMemberId,
        reason: input.reason,
        verification_result: "state_reload_failed",
        reload_error: error instanceof Error ? error.message : "Unknown reload error."
      }
    });
    return { kind: "unverified" as const, state: null };
  }

  if (state.memberId !== input.expectedMemberId) {
    await recordImmediateSystemAlert({
      entityType: "care_plan",
      entityId: input.carePlanId,
      actorUserId: input.actorUserId,
      severity: "high",
      alertKey: "care_plan_nurse_signature_finalize_verification_pending",
      metadata: {
        member_id: input.expectedMemberId,
        refreshed_member_id: state.memberId,
        reason: input.reason,
        verification_result: "member_mismatch"
      }
    });
    return { kind: "unverified" as const, state };
  }

  if (
    state.status === "signed" &&
    state.signedByUserId &&
    state.signedByName &&
    state.signedAt &&
    state.signatureArtifactStoragePath === input.expectedSignatureArtifactStoragePath &&
    state.signatureArtifactMemberFileId === input.expectedSignatureArtifactMemberFileId
  ) {
    return { kind: "committed" as const, state };
  }

  if (
    state.status !== "signed" &&
    state.signatureArtifactStoragePath !== input.expectedSignatureArtifactStoragePath &&
    state.signatureArtifactMemberFileId !== input.expectedSignatureArtifactMemberFileId
  ) {
    return { kind: "not_committed" as const, state };
  }

  await recordImmediateSystemAlert({
    entityType: "care_plan",
    entityId: input.carePlanId,
    actorUserId: input.actorUserId,
    severity: "high",
    alertKey: "care_plan_nurse_signature_finalize_verification_pending",
    metadata: {
      member_id: input.expectedMemberId,
      refreshed_status: state.status,
      refreshed_signature_artifact_storage_path: state.signatureArtifactStoragePath,
      refreshed_signature_artifact_member_file_id: state.signatureArtifactMemberFileId,
      expected_signature_artifact_storage_path: input.expectedSignatureArtifactStoragePath,
      expected_signature_artifact_member_file_id: input.expectedSignatureArtifactMemberFileId,
      reason: input.reason,
      verification_result: "ambiguous"
    }
  });
  return { kind: "unverified" as const, state };
}

function toFinalizedCarePlanNurseSignatureRowFromState(
  state: CarePlanNurseSignatureState
): FinalizedCarePlanNurseSignatureRpcRow {
  const memberId = state.memberId;
  if (
    !memberId ||
    state.status !== "signed" ||
    !state.signedByUserId ||
    !state.signedByName ||
    !state.signedAt ||
    !state.signatureArtifactStoragePath ||
    !state.signatureArtifactMemberFileId
  ) {
    throw new Error("Committed care plan nurse signature state is incomplete.");
  }

  return {
    care_plan_id: state.carePlanId,
    member_id: memberId,
    signed_by_user_id: state.signedByUserId,
    signed_by_name: state.signedByName,
    signed_at: state.signedAt,
    status: "signed",
    signature_artifact_storage_path: state.signatureArtifactStoragePath,
    signature_artifact_member_file_id: state.signatureArtifactMemberFileId,
    signature_metadata: state.signatureMetadata,
    caregiver_signature_status: null,
    was_already_signed: false
  };
}

export async function getCarePlanNurseSignatureState(
  carePlanId: string,
  options?: { serviceRole?: boolean }
): Promise<CarePlanNurseSignatureState> {
  const normalizedCarePlanId = cleanCarePlanSignatureValue(carePlanId);
  if (!normalizedCarePlanId) throw new Error("Care Plan ID is required.");

  const supabase = await createClient({ serviceRole: options?.serviceRole });
  const { data, error } = await supabase
    .from("care_plan_nurse_signatures")
    .select(
      "care_plan_id, member_id, signed_by_user_id, signed_by_name, signed_at, status, signature_artifact_storage_path, signature_artifact_member_file_id, signature_metadata"
    )
    .eq("care_plan_id", normalizedCarePlanId)
    .maybeSingle();
  if (error) throw new Error(error.message);

  if (data) return toStateFromRow(data as CarePlanNurseSignatureRow);

  const { data: carePlan, error: carePlanError } = await supabase
    .from("care_plans")
    .select(
      "id, member_id, nurse_signature_status, nurse_signed_by_user_id, nurse_signed_by_name, nurse_signed_at, nurse_signature_artifact_storage_path, nurse_signature_artifact_member_file_id, nurse_signature_metadata, nurse_designee_user_id, nurse_designee_name, administrator_signature, completed_by"
    )
    .eq("id", normalizedCarePlanId)
    .maybeSingle();
  if (carePlanError) throw new Error(carePlanError.message);
  if (!carePlan) throw new Error("Care plan not found.");

  const fallbackName =
    cleanCarePlanSignatureValue(carePlan.nurse_signed_by_name) ??
    cleanCarePlanSignatureValue(carePlan.nurse_designee_name) ??
    cleanCarePlanSignatureValue(carePlan.administrator_signature) ??
    cleanCarePlanSignatureValue(carePlan.completed_by);
  const fallbackUserId =
    cleanCarePlanSignatureValue(carePlan.nurse_signed_by_user_id) ??
    cleanCarePlanSignatureValue(carePlan.nurse_designee_user_id);
  const parsedStatus = parseCarePlanNurseSignatureStatus(carePlan.nurse_signature_status);
  const fallbackStatus =
    parsedStatus === "unsigned" && fallbackUserId && cleanCarePlanSignatureValue(carePlan.nurse_signed_at)
      ? "signed"
      : parsedStatus === "signed" && !fallbackUserId
        ? "unsigned"
        : parsedStatus;
  const fallbackSignedAt = cleanCarePlanSignatureValue(carePlan.nurse_signed_at);
  const currentMetadata =
    carePlan.nurse_signature_metadata && typeof carePlan.nurse_signature_metadata === "object"
      ? ({ ...carePlan.nurse_signature_metadata } as Record<string, unknown>)
      : {};
  const signatureMetadata =
    fallbackStatus === "unsigned" && fallbackName && !fallbackUserId
      ? {
          ...currentMetadata,
          legacySignatureNeedsResign: true
        }
      : currentMetadata;

  return {
    carePlanId: carePlan.id,
    memberId: carePlan.member_id ?? null,
    status: fallbackStatus,
    signedByUserId: fallbackStatus === "signed" ? fallbackUserId : null,
    signedByName: fallbackStatus === "signed" ? fallbackName : null,
    signedAt: fallbackStatus === "signed" ? fallbackSignedAt : null,
    signatureArtifactStoragePath: cleanCarePlanSignatureValue(carePlan.nurse_signature_artifact_storage_path),
    signatureArtifactMemberFileId: cleanCarePlanSignatureValue(carePlan.nurse_signature_artifact_member_file_id),
    signatureMetadata
  };
}

export async function signCarePlanNurseEsign(input: {
  carePlanId: string;
  actor: {
    id: string;
    fullName: string;
    role: string;
    signoffName?: string | null;
  };
  attested: boolean;
  signatureImageDataUrl: string;
  signatureArtifactStoragePath?: string | null;
  signatureArtifactMemberFileId?: string | null;
  metadata?: Record<string, unknown>;
  serviceRole?: boolean;
}) {
  const now = toEasternISO();
  const carePlanId = cleanCarePlanSignatureValue(input.carePlanId);
  if (!carePlanId) throw new Error("Care Plan ID is required to sign.");

  const supabase = await createClient({ serviceRole: input.serviceRole ?? true });
  const { data: carePlan, error: carePlanError } = await supabase
    .from("care_plans")
    .select("id, member_id, review_date, caregiver_signature_status")
    .eq("id", carePlanId)
    .maybeSingle();
  if (carePlanError) throw new Error(carePlanError.message);
  if (!carePlan) throw new Error("Care plan not found.");
  if (!cleanCarePlanSignatureValue(input.signatureImageDataUrl)) {
    throw new Error("Nurse/Admin e-signature image is required.");
  }

  const existingState = await getCarePlanNurseSignatureState(carePlan.id, {
    serviceRole: input.serviceRole ?? true
  });
  if (existingState.status === "signed" && existingState.signedByUserId && existingState.signedAt) {
    return existingState;
  }

  const completionDate = cleanCarePlanSignatureValue(carePlan.review_date) ?? toEasternDate(now);
  const artifact = await captureClinicalEsignArtifact({
    domain: "care-plan",
    recordId: carePlan.id,
    memberId: carePlan.member_id,
    signedByUserId: input.actor.id,
    signedByName: input.actor.signoffName ?? input.actor.fullName,
    signedAtIso: now,
    signatureImageDataUrl: input.signatureImageDataUrl
  });
  const persistence = buildCarePlanNurseSignaturePersistence({
    carePlanId: carePlan.id,
    memberId: carePlan.member_id,
    actor: input.actor,
    attested: input.attested,
    signedAt: now,
    completionDate,
    signatureArtifactStoragePath:
      artifact.signatureArtifactStoragePath ?? input.signatureArtifactStoragePath,
    signatureArtifactMemberFileId:
      artifact.signatureArtifactMemberFileId ?? input.signatureArtifactMemberFileId,
    metadata: {
      signatureCapture: "drawn-image",
      ...(input.metadata ?? {})
    }
  });

  let rpcData: unknown;
  let finalizedRow: FinalizedCarePlanNurseSignatureRpcRow | null = null;
  try {
    rpcData = await invokeSupabaseRpcOrThrow<unknown>(supabase, FINALIZE_CARE_PLAN_NURSE_SIGNATURE_RPC, {
      p_care_plan_id: carePlan.id,
      p_member_id: carePlan.member_id,
      p_signed_by_user_id: persistence.signatureRow.signed_by_user_id,
      p_signed_by_name: persistence.signatureRow.signed_by_name,
      p_signed_at: persistence.signatureRow.signed_at,
      p_signature_artifact_storage_path: persistence.signatureRow.signature_artifact_storage_path,
      p_signature_artifact_member_file_id: persistence.signatureRow.signature_artifact_member_file_id,
      p_signature_metadata: persistence.signatureRow.signature_metadata
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to finalize care plan nurse signature.";
    const verification = await verifyCommittedCarePlanNurseSignatureAfterFinalizeError({
      carePlanId: carePlan.id,
      expectedMemberId: carePlan.member_id,
      expectedSignatureArtifactStoragePath: persistence.signatureRow.signature_artifact_storage_path,
      expectedSignatureArtifactMemberFileId: persistence.signatureRow.signature_artifact_member_file_id,
      actorUserId: input.actor.id,
      reason: message
    });
    if (verification.kind === "committed" && verification.state) {
      finalizedRow = toFinalizedCarePlanNurseSignatureRowFromState(verification.state);
    } else if (verification.kind === "not_committed") {
      await cleanupCarePlanNurseSignatureArtifactAfterFinalizeFailure({
        carePlanId: carePlan.id,
        memberId: carePlan.member_id,
        actorUserId: input.actor.id,
        reason: message,
        artifact
      });
    }
    if (finalizedRow) {
      // Preserve committed artifacts and continue through the canonical success path.
    } else if (message.includes(FINALIZE_CARE_PLAN_NURSE_SIGNATURE_RPC)) {
      throw new Error(
        `Care plan nurse signature finalization RPC is not available. Apply Supabase migration ${FINALIZE_CARE_PLAN_NURSE_SIGNATURE_MIGRATION} and refresh PostgREST schema cache.`
      );
    } else {
      throw error;
    }
  }

  if (!finalizedRow) {
    finalizedRow = (Array.isArray(rpcData) ? rpcData[0] : null) as FinalizedCarePlanNurseSignatureRpcRow | null;
  }
  if (!finalizedRow?.care_plan_id) {
    const verification = await verifyCommittedCarePlanNurseSignatureAfterFinalizeError({
      carePlanId: carePlan.id,
      expectedMemberId: carePlan.member_id,
      expectedSignatureArtifactStoragePath: persistence.signatureRow.signature_artifact_storage_path,
      expectedSignatureArtifactMemberFileId: persistence.signatureRow.signature_artifact_member_file_id,
      actorUserId: input.actor.id,
      reason: "Care plan nurse signature finalization RPC did not return a signature row."
    });
    if (verification.kind === "committed" && verification.state) {
      finalizedRow = toFinalizedCarePlanNurseSignatureRowFromState(verification.state);
    } else {
      if (verification.kind === "not_committed") {
        await cleanupCarePlanNurseSignatureArtifactAfterFinalizeFailure({
          carePlanId: carePlan.id,
          memberId: carePlan.member_id,
          actorUserId: input.actor.id,
          reason: "Care plan nurse signature finalization RPC did not return a signature row.",
          artifact
        });
      }
      throw new Error("Care plan nurse signature finalization RPC did not return a signature row.");
    }
  }

  const state = toStateFromRow(finalizedRow);
  if (!finalizedRow.was_already_signed) {
    try {
      await recordWorkflowEvent({
        eventType: "care_plan_nurse_signed",
        entityType: "care_plan",
        entityId: carePlan.id,
        actorType: "user",
        actorUserId: input.actor.id,
        status: "signed",
        severity: "low",
        metadata: {
          member_id: carePlan.member_id,
          nurse_signature_status: state.status,
          caregiver_signature_status: finalizedRow.caregiver_signature_status,
          signature_artifact_member_file_id: state.signatureArtifactMemberFileId
        }
      });
    } catch (telemetryError) {
      await reportCarePlanPostCommitTelemetryFailure({
        carePlanId: carePlan.id,
        memberId: carePlan.member_id,
        actorUserId: input.actor.id,
        step: "recordWorkflowEvent:care_plan_nurse_signed",
        error: telemetryError
      });
    }
  }

  return state;
}

export async function requireSignedCarePlanNurseEsign(
  carePlanId: string,
  options?: { serviceRole?: boolean }
) {
  const state = await getCarePlanNurseSignatureState(carePlanId, options);
  if (state.status !== "signed" || !state.signedByUserId || !state.signedAt) {
    throw new Error("Care Plan must be electronically signed by an authorized nurse/admin first.");
  }
  return state;
}
