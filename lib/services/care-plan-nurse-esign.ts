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

  const { error: upsertError } = await supabase
    .from("care_plan_nurse_signatures")
    .upsert(persistence.signatureRow, { onConflict: "care_plan_id" });
  if (upsertError) throw new Error(upsertError.message);

  const nextCaregiverStatus =
    cleanCarePlanSignatureValue(carePlan.caregiver_signature_status) === "signed"
      ? "signed"
      : "ready_to_send";
  const { error: carePlanUpdateError } = await supabase
    .from("care_plans")
    .update({
      ...persistence.carePlanUpdate,
      caregiver_signature_status: nextCaregiverStatus
    })
    .eq("id", carePlan.id);
  if (carePlanUpdateError) throw new Error(carePlanUpdateError.message);

  return persistence.state;
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
