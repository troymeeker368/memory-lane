import { normalizeRoleKey } from "@/lib/permissions";

export const INTAKE_ASSESSMENT_SIGNATURE_STATUS_VALUES = ["unsigned", "signed", "voided"] as const;
export type IntakeAssessmentSignatureStatus = (typeof INTAKE_ASSESSMENT_SIGNATURE_STATUS_VALUES)[number];

export type IntakeAssessmentSignatureState = {
  assessmentId: string;
  memberId: string | null;
  status: IntakeAssessmentSignatureStatus;
  signedByUserId: string | null;
  signedByName: string | null;
  signedAt: string | null;
  signatureArtifactStoragePath: string | null;
  signatureArtifactMemberFileId: string | null;
  signatureMetadata: Record<string, unknown>;
};

export function cleanIntakeAssessmentSignatureValue(value: string | null | undefined) {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

export function parseIntakeAssessmentSignatureStatus(value: string | null | undefined): IntakeAssessmentSignatureStatus {
  if (value === "signed") return "signed";
  if (value === "voided") return "voided";
  return "unsigned";
}

export function getUnsignedIntakeAssessmentSignatureState(
  assessmentId: string,
  memberId: string | null = null
): IntakeAssessmentSignatureState {
  return {
    assessmentId,
    memberId,
    status: "unsigned",
    signedByUserId: null,
    signedByName: null,
    signedAt: null,
    signatureArtifactStoragePath: null,
    signatureArtifactMemberFileId: null,
    signatureMetadata: {}
  };
}

export function isAuthorizedIntakeAssessmentSignerRole(role: string | null | undefined) {
  const normalized = normalizeRoleKey(role);
  return normalized === "nurse" || normalized === "admin";
}

function assertAuthorizedIntakeAssessmentSignerRole(role: string | null | undefined) {
  if (!isAuthorizedIntakeAssessmentSignerRole(role)) {
    throw new Error("Only nurse or admin users may electronically sign Intake Assessments.");
  }
}

export function buildIntakeAssessmentSignaturePersistence(input: {
  assessmentId: string;
  memberId: string;
  actor: {
    id: string;
    fullName: string;
    role: string;
    signoffName?: string | null;
  };
  attested: boolean;
  signedAt: string;
  signatureArtifactStoragePath?: string | null;
  signatureArtifactMemberFileId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const assessmentId = cleanIntakeAssessmentSignatureValue(input.assessmentId);
  const memberId = cleanIntakeAssessmentSignatureValue(input.memberId);
  if (!assessmentId) throw new Error("Assessment ID is required to sign.");
  if (!memberId) throw new Error("Member ID is required to sign.");
  if (!input.attested) throw new Error("Electronic signature attestation is required.");

  assertAuthorizedIntakeAssessmentSignerRole(input.actor.role);

  const signedByName =
    cleanIntakeAssessmentSignatureValue(input.actor.signoffName) ??
    cleanIntakeAssessmentSignatureValue(input.actor.fullName);
  if (!signedByName) throw new Error("Signer identity is missing.");

  const signerRole = normalizeRoleKey(input.actor.role);
  const signedAt = cleanIntakeAssessmentSignatureValue(input.signedAt);
  if (!signedAt) throw new Error("Signed-at timestamp is required.");
  const signatureMetadata: Record<string, unknown> = {
    signedVia: "intake-esign",
    attested: true,
    signerRole,
    ...(input.metadata ?? {})
  };

  const signatureArtifactStoragePath = cleanIntakeAssessmentSignatureValue(input.signatureArtifactStoragePath);
  const signatureArtifactMemberFileId = cleanIntakeAssessmentSignatureValue(input.signatureArtifactMemberFileId);

  return {
    signatureRow: {
      assessment_id: assessmentId,
      member_id: memberId,
      signed_by_user_id: input.actor.id,
      signed_by_name: signedByName,
      signed_at: signedAt,
      status: "signed",
      signature_artifact_storage_path: signatureArtifactStoragePath,
      signature_artifact_member_file_id: signatureArtifactMemberFileId,
      signature_metadata: signatureMetadata,
      updated_at: signedAt
    },
    assessmentUpdate: {
      signed_by: signedByName,
      signed_by_user_id: input.actor.id,
      signed_at: signedAt,
      signature_status: "signed",
      signature_metadata: signatureMetadata,
      updated_at: signedAt
    },
    state: {
      assessmentId,
      memberId,
      status: "signed" as const,
      signedByUserId: input.actor.id,
      signedByName,
      signedAt,
      signatureArtifactStoragePath,
      signatureArtifactMemberFileId,
      signatureMetadata
    }
  };
}
