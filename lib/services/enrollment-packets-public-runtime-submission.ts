import "server-only";

import {
  buildMissingSchemaMessage,
  isMissingSchemaObjectError
} from "@/lib/services/billing-schema-errors";
import {
  enforcePublicEnrollmentPacketSubmissionGuards,
  recordPublicEnrollmentPacketGuardFailure as recordPublicEnrollmentPacketGuardFailureRuntime
} from "@/lib/services/enrollment-packet-public-helpers";
import { loadRequestByToken, getPublicEnrollmentPacketContext } from "@/lib/services/enrollment-packets-public-runtime-context";
import {
  cleanEmail,
  isMissingRpcFunctionError,
  mergePublicProgressPayload,
  normalizeStoredIntakePayload,
  toStatus
} from "@/lib/services/enrollment-packet-core";
import { loadPacketFields } from "@/lib/services/enrollment-packet-mapping-runtime";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";
import { toEasternISO } from "@/lib/timezone";
import type {
  EnrollmentPacketFieldsRow,
  EnrollmentPacketRequestRow,
  PacketFileUpload
} from "@/lib/services/enrollment-packet-types";

const SAVE_ENROLLMENT_PACKET_PROGRESS_RPC = "rpc_save_enrollment_packet_progress";
const ENROLLMENT_PACKET_DELIVERY_RPC_MIGRATION = "0073_delivery_and_member_file_rpc_hardening.sql";
const PUBLIC_ENROLLMENT_PACKET_UPLOAD_COUNT_LIMIT = 12;
const PUBLIC_ENROLLMENT_PACKET_TOTAL_UPLOAD_BYTES_LIMIT = 30 * 1024 * 1024;
const PUBLIC_ENROLLMENT_PACKET_TOTAL_UPLOAD_MB =
  PUBLIC_ENROLLMENT_PACKET_TOTAL_UPLOAD_BYTES_LIMIT / (1024 * 1024);
const PUBLIC_ENROLLMENT_PACKET_SUBMIT_LOOKBACK_MINUTES = 15;
const PUBLIC_ENROLLMENT_PACKET_TOKEN_SUBMIT_ATTEMPT_LIMIT = 5;
const PUBLIC_ENROLLMENT_PACKET_IP_SUBMIT_ATTEMPT_LIMIT = 10;

export type PublicEnrollmentPacketProgressInput = {
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
};

type PreparePublicEnrollmentPacketSubmissionInput = PublicEnrollmentPacketProgressInput & {
  request: EnrollmentPacketRequestRow;
  caregiverTypedName: string;
  attested: boolean;
  caregiverIp: string | null;
  caregiverUserAgent: string | null;
  uploads: PacketFileUpload[];
};

async function loadEnrollmentPacketCompletionValidator() {
  const { validateEnrollmentPacketSubmission } = await import(
    "@/lib/services/enrollment-packet-public-validation"
  );
  return { validateEnrollmentPacketSubmission };
}

function validateIntakePayload(payload: unknown): payload is Partial<Record<string, unknown>> {
  return Boolean(payload) && typeof payload === "object" && !Array.isArray(payload);
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

export async function savePublicEnrollmentPacketProgress(input: PublicEnrollmentPacketProgressInput) {
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
    const { insertPacketEvent } = await import("@/lib/services/enrollment-packet-public-helpers");
    await insertPacketEvent({
      packetId: context.request.id,
      eventType: "in_progress",
      actorEmail: cleanEmail(mergedPayload.primaryContactEmail) ?? context.request.caregiverEmail
    });
  }
  return { ok: true as const };
}

export async function preparePublicEnrollmentPacketSubmission(
  input: PreparePublicEnrollmentPacketSubmissionInput
): Promise<{
  validatedFieldsSnapshot: EnrollmentPacketFieldsRow;
  senderSignatureName: string;
}> {
  await enforcePublicEnrollmentPacketSubmissionGuards({
    request: input.request,
    caregiverIp: input.caregiverIp,
    caregiverUserAgent: input.caregiverUserAgent,
    uploads: input.uploads,
    limits: {
      uploadCountLimit: PUBLIC_ENROLLMENT_PACKET_UPLOAD_COUNT_LIMIT,
      uploadBytesLimit: PUBLIC_ENROLLMENT_PACKET_TOTAL_UPLOAD_BYTES_LIMIT,
      totalUploadMb: PUBLIC_ENROLLMENT_PACKET_TOTAL_UPLOAD_MB,
      submitLookbackMinutes: PUBLIC_ENROLLMENT_PACKET_SUBMIT_LOOKBACK_MINUTES,
      tokenAttemptLimit: PUBLIC_ENROLLMENT_PACKET_TOKEN_SUBMIT_ATTEMPT_LIMIT,
      ipAttemptLimit: PUBLIC_ENROLLMENT_PACKET_IP_SUBMIT_ATTEMPT_LIMIT
    }
  });

  await savePublicEnrollmentPacketProgress(input);

  const validatedFieldsSnapshot = await loadPacketFields(input.request.id);
  if (!validatedFieldsSnapshot) throw new Error("Enrollment packet fields were not found.");
  const validationPayload = normalizeStoredIntakePayload(validatedFieldsSnapshot);
  const { validateEnrollmentPacketSubmission } = await loadEnrollmentPacketCompletionValidator();
  const completionValidation = validateEnrollmentPacketSubmission({
    payload: validationPayload,
    caregiverTypedName: input.caregiverTypedName,
    hasSignature: true,
    attested: input.attested
  });
  if (!completionValidation.isComplete) {
    const issues = [...completionValidation.missingItems, ...completionValidation.signatureErrors];
    throw new Error(
      `Complete all required packet fields before signing. Missing: ${issues.join(", ")}.`
    );
  }

  const admin = createSupabaseAdminClient();
  const senderSignature = await admin
    .from("enrollment_packet_signatures")
    .select("signer_name, signature_blob")
    .eq("packet_id", input.request.id)
    .eq("signer_role", "sender_staff")
    .order("signed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (senderSignature.error) {
    throw new Error(senderSignature.error.message);
  }

  return {
    validatedFieldsSnapshot,
    senderSignatureName: senderSignature.data
      ? String((senderSignature.data as { signer_name: string }).signer_name)
      : "Staff"
  };
}
