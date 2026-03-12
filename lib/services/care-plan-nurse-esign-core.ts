import { normalizeRoleKey } from "@/lib/permissions";

export const CARE_PLAN_NURSE_SIGNATURE_STATUS_VALUES = ["unsigned", "signed", "voided"] as const;
export type CarePlanNurseSignatureStatus = (typeof CARE_PLAN_NURSE_SIGNATURE_STATUS_VALUES)[number];

export type CarePlanNurseSignatureState = {
  carePlanId: string;
  memberId: string | null;
  status: CarePlanNurseSignatureStatus;
  signedByUserId: string | null;
  signedByName: string | null;
  signedAt: string | null;
  signatureArtifactStoragePath: string | null;
  signatureArtifactMemberFileId: string | null;
  signatureMetadata: Record<string, unknown>;
};

export function cleanCarePlanSignatureValue(value: string | null | undefined) {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

export function parseCarePlanNurseSignatureStatus(
  value: string | null | undefined
): CarePlanNurseSignatureStatus {
  if (value === "signed") return "signed";
  if (value === "voided") return "voided";
  return "unsigned";
}

export function getUnsignedCarePlanNurseSignatureState(
  carePlanId: string,
  memberId: string | null = null
): CarePlanNurseSignatureState {
  return {
    carePlanId,
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

export function isAuthorizedCarePlanSignerRole(role: string | null | undefined) {
  const normalized = normalizeRoleKey(role);
  return normalized === "nurse" || normalized === "admin";
}

function assertAuthorizedCarePlanSignerRole(role: string | null | undefined) {
  if (!isAuthorizedCarePlanSignerRole(role)) {
    throw new Error("Only nurse or admin users may electronically sign Care Plans.");
  }
}

export function buildCarePlanNurseSignaturePersistence(input: {
  carePlanId: string;
  memberId: string;
  actor: {
    id: string;
    fullName: string;
    role: string;
    signoffName?: string | null;
  };
  attested: boolean;
  signedAt: string;
  completionDate: string;
  signatureArtifactStoragePath?: string | null;
  signatureArtifactMemberFileId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const carePlanId = cleanCarePlanSignatureValue(input.carePlanId);
  const memberId = cleanCarePlanSignatureValue(input.memberId);
  if (!carePlanId) throw new Error("Care Plan ID is required to sign.");
  if (!memberId) throw new Error("Member ID is required to sign.");
  if (!input.attested) throw new Error("Electronic signature attestation is required.");

  assertAuthorizedCarePlanSignerRole(input.actor.role);

  const signedByName =
    cleanCarePlanSignatureValue(input.actor.signoffName) ??
    cleanCarePlanSignatureValue(input.actor.fullName);
  if (!signedByName) throw new Error("Signer identity is missing.");

  const signerRole = normalizeRoleKey(input.actor.role);
  const signedAt = cleanCarePlanSignatureValue(input.signedAt);
  if (!signedAt) throw new Error("Signed-at timestamp is required.");
  const completionDate = cleanCarePlanSignatureValue(input.completionDate);
  if (!completionDate) throw new Error("Completion date is required.");

  const signatureMetadata: Record<string, unknown> = {
    signedVia: "care-plan-nurse-esign",
    attested: true,
    signerRole,
    ...(input.metadata ?? {})
  };

  const signatureArtifactStoragePath = cleanCarePlanSignatureValue(input.signatureArtifactStoragePath);
  const signatureArtifactMemberFileId = cleanCarePlanSignatureValue(input.signatureArtifactMemberFileId);

  return {
    signatureRow: {
      care_plan_id: carePlanId,
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
    carePlanUpdate: {
      nurse_signature_status: "signed",
      nurse_signed_by_user_id: input.actor.id,
      nurse_signed_by_name: signedByName,
      nurse_signed_at: signedAt,
      nurse_signature_artifact_storage_path: signatureArtifactStoragePath,
      nurse_signature_artifact_member_file_id: signatureArtifactMemberFileId,
      nurse_signature_metadata: signatureMetadata,
      completed_by: signedByName,
      date_of_completion: completionDate,
      administrator_signature: signedByName,
      administrator_signature_date: completionDate,
      nurse_designee_user_id: input.actor.id,
      nurse_designee_name: signedByName,
      legacy_cleanup_flag: false,
      updated_at: signedAt
    },
    state: {
      carePlanId,
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
