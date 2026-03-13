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

  const { error: upsertError } = await supabase
    .from("intake_assessment_signatures")
    .upsert(persistence.signatureRow, { onConflict: "assessment_id" });
  if (upsertError) throw new Error(upsertError.message);

  const { error: assessmentUpdateError } = await supabase
    .from("intake_assessments")
    .update(persistence.assessmentUpdate)
    .eq("id", assessment.id);
  if (assessmentUpdateError) throw new Error(assessmentUpdateError.message);

  return persistence.state;
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
