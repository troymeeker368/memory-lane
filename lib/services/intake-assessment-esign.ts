import "server-only";

import {
  INTAKE_ASSESSMENT_SIGNATURE_STATUS_VALUES,
  buildIntakeAssessmentSignaturePersistence,
  cleanIntakeAssessmentSignatureValue,
  getUnsignedIntakeAssessmentSignatureState,
  isAuthorizedIntakeAssessmentSignerRole,
  parseIntakeAssessmentSignatureStatus,
  type IntakeAssessmentSignatureState,
  type IntakeAssessmentSignatureStatus
} from "@/lib/services/intake-assessment-esign-core";
import { captureClinicalEsignArtifact } from "@/lib/services/clinical-esign-artifacts";
import { recordWorkflowMilestone } from "@/lib/services/lifecycle-milestones";
import {
  recordImmediateSystemAlert,
  recordWorkflowEvent
} from "@/lib/services/workflow-observability";
import {
  deleteMemberDocumentObject,
  deleteMemberFileRecord
} from "@/lib/services/member-files";
import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";
import { createClient } from "@/lib/supabase/server";
import { toEasternISO } from "@/lib/timezone";

export {
  INTAKE_ASSESSMENT_SIGNATURE_STATUS_VALUES,
  buildIntakeAssessmentSignaturePersistence,
  getUnsignedIntakeAssessmentSignatureState,
  isAuthorizedIntakeAssessmentSignerRole,
  type IntakeAssessmentSignatureState,
  type IntakeAssessmentSignatureStatus
};

type IntakeAssessmentSignatureRow = {
  assessment_id: string;
  member_id: string;
  signed_by_user_id: string;
  signed_by_name: string;
  signed_at: string;
  status: "signed" | "voided";
  signature_artifact_storage_path: string | null;
  signature_artifact_member_file_id: string | null;
  signature_metadata: Record<string, unknown> | null;
};

type FinalizedIntakeAssessmentSignatureRpcRow = IntakeAssessmentSignatureRow & {
  was_already_signed: boolean;
};

const FINALIZE_INTAKE_SIGNATURE_RPC = "rpc_finalize_intake_assessment_signature";
const FINALIZE_INTAKE_SIGNATURE_MIGRATION = "0052_intake_assessment_signature_finalize_rpc.sql";

function toStateFromRow(row: IntakeAssessmentSignatureRow): IntakeAssessmentSignatureState {
  return {
    assessmentId: row.assessment_id,
    memberId: row.member_id,
    status: parseIntakeAssessmentSignatureStatus(row.status),
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

async function cleanupIntakeSignatureArtifactAfterFinalizeFailure(input: {
  assessmentId: string;
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
      entityType: "intake_assessment",
      entityId: input.assessmentId,
      actorUserId: input.actorUserId,
      severity: "high",
      alertKey: "intake_assessment_signature_finalize_split_brain",
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
      await deleteMemberFileRecord(input.artifact.signatureArtifactMemberFileId);
    }
    if (input.artifact.signatureArtifactStoragePath) {
      await deleteMemberDocumentObject(input.artifact.signatureArtifactStoragePath);
    }
  } catch (cleanupError) {
    await recordImmediateSystemAlert({
      entityType: "intake_assessment",
      entityId: input.assessmentId,
      actorUserId: input.actorUserId,
      severity: "high",
      alertKey: "intake_assessment_signature_finalize_cleanup_failed",
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

export async function getIntakeAssessmentSignatureState(
  assessmentId: string,
  options?: { serviceRole?: boolean }
): Promise<IntakeAssessmentSignatureState> {
  const normalizedAssessmentId = cleanIntakeAssessmentSignatureValue(assessmentId);
  if (!normalizedAssessmentId) throw new Error("Assessment ID is required.");

  const supabase = await createClient({ serviceRole: options?.serviceRole });
  const { data, error } = await supabase
    .from("intake_assessment_signatures")
    .select(
      "assessment_id, member_id, signed_by_user_id, signed_by_name, signed_at, status, signature_artifact_storage_path, signature_artifact_member_file_id, signature_metadata"
    )
    .eq("assessment_id", normalizedAssessmentId)
    .maybeSingle();
  if (error) throw new Error(error.message);

  if (data) return toStateFromRow(data as IntakeAssessmentSignatureRow);

  const { data: assessment, error: assessmentError } = await supabase
    .from("intake_assessments")
    .select("id, member_id, signature_status, signed_by_user_id, signed_by, signed_at, signature_metadata")
    .eq("id", normalizedAssessmentId)
    .maybeSingle();
  if (assessmentError) throw new Error(assessmentError.message);
  if (!assessment) throw new Error("Intake assessment not found.");

  return {
    assessmentId: assessment.id,
    memberId: assessment.member_id,
    status: parseIntakeAssessmentSignatureStatus(assessment.signature_status),
    signedByUserId: assessment.signed_by_user_id ?? null,
    signedByName: assessment.signed_by ?? null,
    signedAt: assessment.signed_at ?? null,
    signatureArtifactStoragePath: null,
    signatureArtifactMemberFileId: null,
    signatureMetadata:
      assessment.signature_metadata && typeof assessment.signature_metadata === "object"
        ? (assessment.signature_metadata as Record<string, unknown>)
        : {}
  };
}

export async function listIntakeAssessmentSignatureStatesByAssessmentIds(
  assessmentIds: string[],
  options?: { serviceRole?: boolean }
) {
  const normalizedAssessmentIds = Array.from(
    new Set(assessmentIds.map((value) => cleanIntakeAssessmentSignatureValue(value)).filter(Boolean))
  ) as string[];
  if (normalizedAssessmentIds.length === 0) return {} as Record<string, IntakeAssessmentSignatureState>;

  const supabase = await createClient({ serviceRole: options?.serviceRole });
  const { data, error } = await supabase
    .from("intake_assessment_signatures")
    .select(
      "assessment_id, member_id, signed_by_user_id, signed_by_name, signed_at, status, signature_artifact_storage_path, signature_artifact_member_file_id, signature_metadata"
    )
    .in("assessment_id", normalizedAssessmentIds);
  if (error) throw new Error(error.message);

  const stateByAssessmentId: Record<string, IntakeAssessmentSignatureState> = {};
  (data ?? []).forEach((row) => {
    const state = toStateFromRow(row as IntakeAssessmentSignatureRow);
    stateByAssessmentId[state.assessmentId] = state;
  });

  const missing = normalizedAssessmentIds.filter((id) => !stateByAssessmentId[id]);
  if (missing.length > 0) {
    const { data: assessments, error: assessmentsError } = await supabase
      .from("intake_assessments")
      .select("id, member_id, signature_status, signed_by_user_id, signed_by, signed_at, signature_metadata")
      .in("id", missing);
    if (assessmentsError) throw new Error(assessmentsError.message);

    (assessments ?? []).forEach((assessment: any) => {
      stateByAssessmentId[assessment.id] = {
        assessmentId: assessment.id,
        memberId: assessment.member_id,
        status: parseIntakeAssessmentSignatureStatus(assessment.signature_status),
        signedByUserId: assessment.signed_by_user_id ?? null,
        signedByName: assessment.signed_by ?? null,
        signedAt: assessment.signed_at ?? null,
        signatureArtifactStoragePath: null,
        signatureArtifactMemberFileId: null,
        signatureMetadata:
          assessment.signature_metadata && typeof assessment.signature_metadata === "object"
            ? (assessment.signature_metadata as Record<string, unknown>)
            : {}
      };
    });
  }

  return stateByAssessmentId;
}

export async function signIntakeAssessment(input: {
  assessmentId: string;
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
  const assessmentId = cleanIntakeAssessmentSignatureValue(input.assessmentId);
  if (!assessmentId) throw new Error("Assessment ID is required to sign.");

  const supabase = await createClient({ serviceRole: input.serviceRole });
  const { data: assessment, error: assessmentError } = await supabase
    .from("intake_assessments")
    .select("id, member_id")
    .eq("id", assessmentId)
    .maybeSingle();
  if (assessmentError) throw new Error(assessmentError.message);
  if (!assessment) throw new Error("Intake assessment not found.");

  const existingState = await getIntakeAssessmentSignatureState(assessment.id, {
    serviceRole: input.serviceRole
  });
  if (existingState.status === "signed" && existingState.signedByUserId && existingState.signedAt) {
    return existingState;
  }

  try {
    if (!cleanIntakeAssessmentSignatureValue(input.signatureImageDataUrl)) {
      throw new Error("Nurse/Admin e-signature image is required.");
    }
    const artifact = await captureClinicalEsignArtifact({
      domain: "intake-assessment",
      recordId: assessment.id,
      memberId: assessment.member_id,
      signedByUserId: input.actor.id,
      signedByName: input.actor.signoffName ?? input.actor.fullName,
      signedAtIso: now,
      signatureImageDataUrl: input.signatureImageDataUrl
    });

    const persistence = buildIntakeAssessmentSignaturePersistence({
      assessmentId: assessment.id,
      memberId: assessment.member_id,
      actor: input.actor,
      attested: input.attested,
      signedAt: now,
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
    try {
      rpcData = await invokeSupabaseRpcOrThrow<unknown>(supabase, FINALIZE_INTAKE_SIGNATURE_RPC, {
        p_assessment_id: assessment.id,
        p_member_id: assessment.member_id,
        p_signed_by_user_id: persistence.signatureRow.signed_by_user_id,
        p_signed_by_name: persistence.signatureRow.signed_by_name,
        p_signed_at: persistence.signatureRow.signed_at,
        p_signature_artifact_storage_path: persistence.signatureRow.signature_artifact_storage_path,
        p_signature_artifact_member_file_id: persistence.signatureRow.signature_artifact_member_file_id,
        p_signature_metadata: persistence.signatureRow.signature_metadata
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to finalize intake assessment signature.";
      await cleanupIntakeSignatureArtifactAfterFinalizeFailure({
        assessmentId: assessment.id,
        memberId: assessment.member_id,
        actorUserId: input.actor.id,
        reason: message,
        artifact
      });
      if (message.includes(FINALIZE_INTAKE_SIGNATURE_RPC)) {
        throw new Error(
          `Intake assessment signature finalization RPC is not available. Apply Supabase migration ${FINALIZE_INTAKE_SIGNATURE_MIGRATION} and refresh PostgREST schema cache.`
        );
      }
      throw error;
    }

    const finalizedRow = (Array.isArray(rpcData) ? rpcData[0] : null) as FinalizedIntakeAssessmentSignatureRpcRow | null;
    if (!finalizedRow?.assessment_id) {
      await cleanupIntakeSignatureArtifactAfterFinalizeFailure({
        assessmentId: assessment.id,
        memberId: assessment.member_id,
        actorUserId: input.actor.id,
        reason: "Intake assessment signature finalization RPC did not return a signature row.",
        artifact
      });
      throw new Error("Intake assessment signature finalization RPC did not return a signature row.");
    }

    const state = toStateFromRow(finalizedRow);
    if (!finalizedRow.was_already_signed) {
      await recordWorkflowEvent({
        eventType: "intake_assessment_signed",
        entityType: "intake_assessment",
        entityId: assessment.id,
        actorType: "user",
        actorUserId: input.actor.id,
        status: "signed",
        severity: "low",
        metadata: {
          member_id: assessment.member_id,
          signature_status: state.status,
          signature_artifact_member_file_id: state.signatureArtifactMemberFileId
        }
      });
      await recordWorkflowMilestone({
        event: {
          eventType: "intake_completed",
          entityType: "intake_assessment",
          entityId: assessment.id,
          actorType: "user",
          actorUserId: input.actor.id,
          status: "completed",
          severity: "low",
          metadata: {
            member_id: assessment.member_id,
            signature_status: state.status,
            signature_artifact_member_file_id: state.signatureArtifactMemberFileId
          }
        }
      });
    }

    return state;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unable to sign intake assessment.";
    await recordWorkflowEvent({
      eventType: "intake_assessment_failed",
      entityType: "intake_assessment",
      entityId: assessment.id,
      actorType: "user",
      actorUserId: input.actor.id,
      status: "failed",
      severity: "high",
      metadata: {
        member_id: assessment.member_id,
        phase: "signature",
        error: reason
      }
    });
    await recordImmediateSystemAlert({
      entityType: "intake_assessment",
      entityId: assessment.id,
      actorUserId: input.actor.id,
      severity: "high",
      alertKey: "intake_assessment_signature_failed",
      metadata: {
        member_id: assessment.member_id,
        error: reason
      }
    });
    await recordWorkflowMilestone({
      event: {
        eventType: "workflow_error",
        entityType: "intake_assessment",
        entityId: assessment.id,
        actorType: "user",
        actorUserId: input.actor.id,
        status: "failed",
        severity: "high",
        metadata: {
          member_id: assessment.member_id,
          workflow_label: "Intake assessment signature",
          message: `Intake assessment signature failed. Review the assessment and retry the completion workflow.`,
          action_url: `/operations/member-command-center/${assessment.member_id}`
        }
      }
    });
    throw error;
  }
}

export async function requireSignedIntakeAssessment(
  assessmentId: string,
  options?: { serviceRole?: boolean }
) {
  const state = await getIntakeAssessmentSignatureState(assessmentId, options);
  if (state.status !== "signed" || !state.signedByUserId || !state.signedAt) {
    throw new Error("Intake Assessment must be electronically signed before downstream cascade.");
  }
  return state;
}
