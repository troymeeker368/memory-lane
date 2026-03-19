import {
  DEFAULT_PHYSICIAN_ORDER_RULE_SETTINGS,
  POF_LEVEL_OF_CARE_OPTIONS
} from "@/lib/services/physician-order-config";
import {
  resolvePhysicianOrderClinicalSyncStatus,
  type PhysicianOrderClinicalSyncStatus
} from "@/lib/services/physician-order-clinical-sync";
import {
  defaultCareInformation,
  defaultOperationalFlags,
  type PhysicianOrderAllergy,
  type PhysicianOrderCareInformation,
  type PhysicianOrderDiagnosis,
  type PhysicianOrderForm,
  type PhysicianOrderMedication,
  type PhysicianOrderOperationalFlags,
  type PhysicianOrderRenewalStatus,
  type PhysicianOrderStatus,
  type ProviderSignatureStatus
} from "@/lib/services/physician-order-model";
import { deriveEnrollmentPacketPofRiskSignals } from "@/lib/services/enrollment-packet-intake-staging";
import { toEasternDate } from "@/lib/timezone";

export type PostgrestErrorLike = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

export type PofPostSignSyncStep = "mhp_mcc" | "mar_medications" | "mar_schedules";
export type PofPostSignSyncQueueStatus = "queued" | "completed";

export type PofPostSignSyncQueueRow = {
  id: string;
  physician_order_id: string;
  member_id: string;
  pof_request_id: string | null;
  status: PofPostSignSyncQueueStatus;
  attempt_count: number;
  next_retry_at: string | null;
  signature_completed_at: string;
  queued_at: string | null;
  last_error: string | null;
  last_failed_step: PofPostSignSyncStep | null;
};

export type RpcSignPhysicianOrderRow = {
  physician_order_id: string;
  member_id: string;
  queue_id: string;
  queue_attempt_count: number;
  queue_next_retry_at: string | null;
};

export type RpcSyncSignedPofToMemberClinicalProfileRow = {
  member_id: string;
  member_health_profile_id: string;
  member_command_center_id: string | null;
};

export type PofPostSignQueueStatusRow = {
  physician_order_id: string;
  status: "queued" | "completed";
  last_error: string | null;
  last_failed_step: string | null;
};

export function clean(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function sanitizeList(values: Array<string | null | undefined> | null | undefined) {
  return (values ?? []).map((value) => clean(value)).filter((value): value is string => Boolean(value));
}

export function sanitizeDiagnosisRows(rows: PhysicianOrderDiagnosis[]) {
  return rows
    .map((row, index) => {
      const diagnosisName = clean(row.diagnosisName);
      if (!diagnosisName) return null;
      const normalizedRow: PhysicianOrderDiagnosis = {
        id: clean(row.id) ?? `diagnosis-${index + 1}`,
        diagnosisType: row.diagnosisType === "secondary" ? "secondary" : index === 0 ? "primary" : "secondary",
        diagnosisName,
        diagnosisCode: null
      };
      return normalizedRow;
    })
    .filter((row): row is PhysicianOrderDiagnosis => Boolean(row));
}

export function sanitizeAllergyRows(rows: PhysicianOrderAllergy[]) {
  return rows
    .map((row, index) => {
      const allergyName = clean(row.allergyName);
      if (!allergyName) return null;
      return {
        id: clean(row.id) ?? `allergy-${index + 1}`,
        allergyGroup:
          row.allergyGroup === "food" ||
          row.allergyGroup === "medication" ||
          row.allergyGroup === "environmental" ||
          row.allergyGroup === "other"
            ? row.allergyGroup
            : "medication",
        allergyName,
        severity: clean(row.severity),
        comments: clean(row.comments)
      } satisfies PhysicianOrderAllergy;
    })
    .filter((row): row is PhysicianOrderAllergy => Boolean(row));
}

export function sanitizeMedicationRows(rows: PhysicianOrderMedication[]) {
  return rows
    .map((row, index) => {
      const name = clean(row.name);
      if (!name) return null;
      const scheduledTimes = Array.from(
        new Set(
          (Array.isArray(row.scheduledTimes) ? row.scheduledTimes : [])
            .map((value) => clean(value))
            .filter((value): value is string => Boolean(value))
        )
      );
      return {
        id: clean(row.id) ?? `medication-${index + 1}`,
        name,
        strength: clean(row.strength),
        dose: clean(row.dose),
        quantity: clean(row.quantity),
        form: clean(row.form),
        route: clean(row.route),
        routeLaterality: clean(row.routeLaterality),
        frequency: clean(row.frequency),
        scheduledTimes,
        givenAtCenter: Boolean(row.givenAtCenter),
        givenAtCenterTime24h: clean(row.givenAtCenterTime24h),
        prn: Boolean(row.prn),
        prnInstructions: clean(row.prnInstructions),
        startDate: clean(row.startDate),
        endDate: clean(row.endDate),
        active: row.active !== false,
        provider: clean(row.provider),
        instructions: clean(row.instructions),
        comments: clean(row.comments)
      } satisfies PhysicianOrderMedication;
    })
    .filter((row): row is PhysicianOrderMedication => Boolean(row));
}

export function calculateRenewalDueDate(sentDate: string | null | undefined) {
  if (!sentDate) return null;
  const d = new Date(`${sentDate}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCFullYear(d.getUTCFullYear() + DEFAULT_PHYSICIAN_ORDER_RULE_SETTINGS.renewalIntervalYears);
  return d.toISOString().slice(0, 10);
}

export function addDaysDateOnly(dateValue: string, days: number) {
  const [yearRaw, monthRaw, dayRaw] = dateValue.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const seed = new Date(Date.UTC(year, month - 1, day));
  seed.setUTCDate(seed.getUTCDate() + days);
  return `${seed.getUTCFullYear()}-${String(seed.getUTCMonth() + 1).padStart(2, "0")}-${String(seed.getUTCDate()).padStart(2, "0")}`;
}

export function resolveRenewalStatus(nextRenewalDueDate: string | null | undefined): PhysicianOrderRenewalStatus {
  const dueDate = clean(nextRenewalDueDate);
  if (!dueDate) return "Missing Completion";
  const today = toEasternDate();
  if (dueDate < today) return "Overdue";
  const due = new Date(`${dueDate}T00:00:00.000Z`);
  const start = new Date(`${today}T00:00:00.000Z`);
  const days = Math.ceil((due.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
  return days <= DEFAULT_PHYSICIAN_ORDER_RULE_SETTINGS.renewalDueSoonDays ? "Due Soon" : "Current";
}

export function toStatus(value: string | null | undefined): PhysicianOrderStatus {
  const normalized = (value ?? "").toLowerCase();
  if (normalized === "draft") return "Draft";
  if (normalized === "sent") return "Sent";
  if (normalized === "signed") return "Signed";
  if (normalized === "expired") return "Expired";
  if (normalized === "superseded") return "Superseded";
  return "Draft";
}

export function fromStatus(value: PhysicianOrderStatus) {
  return value.toLowerCase();
}

export function parseJsonArray<T>(value: unknown, fallback: T[]): T[] {
  if (!Array.isArray(value)) return fallback;
  return value as T[];
}

export function parseJsonObject<T>(value: unknown, fallback: T): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  return { ...(fallback as object), ...(value as object) } as T;
}

export function extractErrorText(error: PostgrestErrorLike | null | undefined) {
  return [error?.message, error?.details, error?.hint].filter(Boolean).join(" ").toLowerCase();
}

export function isPostgresUniqueViolation(error: PostgrestErrorLike | null | undefined) {
  const text = extractErrorText(error);
  if (!text) return false;
  return error?.code === "23505" || text.includes("duplicate key value") || text.includes("unique constraint");
}

function isIntakeDraftSentUniqueViolation(error: PostgrestErrorLike | null | undefined) {
  const text = extractErrorText(error);
  if (!isPostgresUniqueViolation(error) || !text) return false;
  return text.includes("idx_physician_orders_intake_draft_sent_unique");
}

export function mapPhysicianOrderWriteError(error: PostgrestErrorLike | null | undefined, fallbackMessage: string) {
  if (isIntakeDraftSentUniqueViolation(error)) {
    return "A Draft/Sent physician order already exists for this intake assessment. Open the existing order instead of creating a new one.";
  }
  return clean(error?.message) ?? fallbackMessage;
}

export function isMissingPhysicianOrdersTableError(error: PostgrestErrorLike | null | undefined) {
  const text = extractErrorText(error);
  if (!text) return false;
  if (error?.code === "PGRST205") return text.includes("physician_orders");
  return (
    text.includes("physician_orders") &&
    (text.includes("schema cache") || text.includes("does not exist") || text.includes("relation"))
  );
}

export function physicianOrdersTableRequiredError() {
  return new Error("Physician Orders storage is not available. Run Supabase migration 0006_intake_pof_mhp_supabase.sql.");
}

export function isMissingRpcFunctionError(error: unknown, rpcName: string) {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: string }).code ?? "").toUpperCase();
  const text = String((error as { message?: string }).message ?? "").toLowerCase();
  return (code === "PGRST202" || code === "42883") && text.includes(rpcName.toLowerCase());
}

export function missingRpcFunctionRequiredError(rpcName: string) {
  return new Error(
    `Shared RPC ${rpcName} is not available. Apply Supabase migration 0037_shared_rpc_standardization_lead_pof.sql and refresh PostgREST schema cache.`
  );
}

export function computePostSignRetryAt(attemptCount: number, nowIso: string) {
  const clampedAttempt = Math.max(1, Math.floor(attemptCount));
  const delayMinutes = Math.min(60, 5 * 2 ** (clampedAttempt - 1));
  const next = new Date(Date.parse(nowIso) + delayMinutes * 60 * 1000);
  return next.toISOString();
}

export function getPofPostSignSyncAlertAgeMinutes(defaultMinutes: number, configuredValue = process.env.POF_POST_SIGN_SYNC_ALERT_AGE_MINUTES) {
  const parsed = Number(configuredValue ?? defaultMinutes);
  if (!Number.isFinite(parsed)) return defaultMinutes;
  return Math.max(5, Math.trunc(parsed));
}

export function buildPostSignSyncError(step: PofPostSignSyncStep, error: unknown) {
  const base = error instanceof Error ? error.message : "Unknown post-sign sync error.";
  if (step === "mhp_mcc") return `MHP/MCC sync failed: ${base}`;
  if (step === "mar_medications") return `MAR medication sync failed: ${base}`;
  return `MAR schedule sync failed: ${base}`;
}

export function toRpcSignPhysicianOrderRow(data: unknown): RpcSignPhysicianOrderRow {
  const row = (Array.isArray(data) ? data[0] : null) as RpcSignPhysicianOrderRow | null;
  if (!row?.physician_order_id || !row.member_id || !row.queue_id) {
    throw new Error("Physician order signing RPC did not return queue details.");
  }
  return {
    physician_order_id: row.physician_order_id,
    member_id: row.member_id,
    queue_id: row.queue_id,
    queue_attempt_count: Math.max(0, Number(row.queue_attempt_count ?? 0)),
    queue_next_retry_at: row.queue_next_retry_at ?? null
  };
}

export function toRpcSyncSignedPofToMemberClinicalProfileRow(data: unknown): RpcSyncSignedPofToMemberClinicalProfileRow {
  const row = (Array.isArray(data) ? data[0] : null) as RpcSyncSignedPofToMemberClinicalProfileRow | null;
  if (!row?.member_id || !row.member_health_profile_id) {
    throw new Error("Signed POF clinical sync RPC did not return expected member identifiers.");
  }
  return {
    member_id: row.member_id,
    member_health_profile_id: row.member_health_profile_id,
    member_command_center_id: clean(row.member_command_center_id) ?? null
  };
}

export function rowToForm(row: any, clinicalSyncStatus?: PhysicianOrderClinicalSyncStatus): PhysicianOrderForm {
  const diagnosisRows = sanitizeDiagnosisRows(parseJsonArray<PhysicianOrderDiagnosis>(row.diagnoses, []));
  const allergyRows = sanitizeAllergyRows(parseJsonArray<PhysicianOrderAllergy>(row.allergies, []));
  const medications = sanitizeMedicationRows(parseJsonArray<PhysicianOrderMedication>(row.medications, []));
  const standingOrders = parseJsonArray<string>(row.standing_orders, []);
  const careInformation = parseJsonObject<PhysicianOrderCareInformation>(row.clinical_support, defaultCareInformation());
  const operationalFlags = parseJsonObject<PhysicianOrderOperationalFlags>(row.operational_flags, defaultOperationalFlags());
  const status = toStatus(row.status);
  const providerSignatureStatus: ProviderSignatureStatus = row.signed_at ? "Signed" : "Pending";
  const resolvedClinicalSyncStatus =
    clinicalSyncStatus ??
    resolvePhysicianOrderClinicalSyncStatus({
      status,
      queueStatus: null
    });

  return {
    id: row.id,
    memberId: row.member_id,
    intakeAssessmentId: row.intake_assessment_id,
    memberNameSnapshot: row.member_name_snapshot ?? row.members?.display_name ?? "Unknown Member",
    memberDobSnapshot: row.member_dob_snapshot,
    sex: row.sex === "M" || row.sex === "F" ? row.sex : null,
    levelOfCare: POF_LEVEL_OF_CARE_OPTIONS.includes(row.level_of_care) ? row.level_of_care : null,
    dnrSelected: Boolean(row.dnr_selected),
    vitalsBloodPressure: row.vitals_blood_pressure,
    vitalsPulse: row.vitals_pulse,
    vitalsOxygenSaturation: row.vitals_oxygen_saturation,
    vitalsRespiration: row.vitals_respiration,
    diagnosisRows,
    diagnoses: diagnosisRows.map((entry) => entry.diagnosisName),
    allergyRows,
    allergies: allergyRows.map((entry) => entry.allergyName),
    medications,
    standingOrders,
    careInformation,
    operationalFlags,
    providerName: row.provider_name,
    providerSignature: row.provider_signature,
    providerSignatureDate: row.provider_signature_date,
    status,
    providerSignatureStatus,
    createdByUserId: row.created_by_user_id,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    completedByUserId: row.sent_at ? row.updated_by_user_id : null,
    completedByName: row.sent_at ? row.updated_by_name : null,
    completedDate: row.sent_at ? String(row.sent_at).slice(0, 10) : null,
    nextRenewalDueDate: row.next_renewal_due_date,
    signedBy: row.signed_by_name ?? row.provider_name,
    signedDate: row.signed_at ? String(row.signed_at).slice(0, 10) : null,
    clinicalSyncStatus: resolvedClinicalSyncStatus,
    clinicalSyncReady: resolvedClinicalSyncStatus === "synced",
    supersededAt: row.superseded_at,
    supersededByPofId: row.superseded_by,
    updatedByUserId: row.updated_by_user_id,
    updatedByName: row.updated_by_name,
    updatedAt: row.updated_at,
    enrollmentPacketPrefill: null
  };
}

export function normalizePhysicianOrderSex(value: unknown): "M" | "F" | null {
  const normalized = clean(typeof value === "string" ? value : null)?.toLowerCase();
  if (!normalized) return null;
  if (normalized === "m" || normalized === "male") return "M";
  if (normalized === "f" || normalized === "female") return "F";
  return null;
}

function setIfBlank(current: string | null | undefined, fallback: unknown) {
  const currentValue = clean(current);
  if (currentValue) return currentValue;
  return clean(fallback);
}

function payloadBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  const normalized = clean(value)?.toLowerCase();
  if (!normalized) return null;
  if (["yes", "y", "true", "1"].includes(normalized)) return true;
  if (["no", "n", "false", "0"].includes(normalized)) return false;
  return null;
}

function payloadStringArray(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return value.map((item) => clean(item)).filter((item): item is string => Boolean(item));
}

function buildEnrollmentPacketRiskNote(prefillPayload: Record<string, unknown>) {
  const derived = deriveEnrollmentPacketPofRiskSignals(prefillPayload);
  if (derived.riskSignals.length === 0) return null;
  return `Caregiver intake flags: ${derived.riskSignals.join(" | ")}`;
}

export function applyEnrollmentPacketPrefillToDraft(input: {
  careInformation: PhysicianOrderCareInformation;
  operationalFlags: PhysicianOrderOperationalFlags;
  prefillPayload: Record<string, unknown>;
}) {
  const careInformation = { ...input.careInformation, adlProfile: { ...input.careInformation.adlProfile } };
  const operationalFlags = { ...input.operationalFlags };
  const prefill = input.prefillPayload;

  const medicationDuringDayRequired =
    payloadBoolean(prefill.medicationDuringDayRequired) === true || clean(prefill.medicationsDuringDay) != null;
  const oxygenUseRequired =
    payloadBoolean(prefill.oxygenUseRequired) === true ||
    clean(prefill.oxygenUse) != null ||
    clean(prefill.oxygenFlowRate) != null;
  const mobilityAssistanceRequired =
    payloadBoolean(prefill.mobilityAssistanceRequired) === true || clean(prefill.mobilitySupport) != null;

  if (medicationDuringDayRequired) {
    careInformation.medAdministrationNurse = true;
    careInformation.personalCareMedication = true;
  }
  if (oxygenUseRequired) {
    careInformation.breathingOxygenTank = true;
    careInformation.breathingRoomAir = false;
    careInformation.breathingOxygenLiters = setIfBlank(careInformation.breathingOxygenLiters, prefill.oxygenFlowRate);
    operationalFlags.oxygenRequirement = true;
  }
  if (mobilityAssistanceRequired) {
    operationalFlags.bathroomAssistance = true;
  }

  const adlSnapshot =
    prefill.adlSnapshot && typeof prefill.adlSnapshot === "object"
      ? (prefill.adlSnapshot as Record<string, unknown>)
      : {};
  careInformation.adlProfile.ambulation = setIfBlank(careInformation.adlProfile.ambulation, adlSnapshot.ambulation);
  careInformation.adlProfile.transferring = setIfBlank(careInformation.adlProfile.transferring, adlSnapshot.transfers);
  careInformation.adlProfile.toileting = setIfBlank(careInformation.adlProfile.toileting, adlSnapshot.toileting);
  careInformation.adlProfile.bathing = setIfBlank(careInformation.adlProfile.bathing, adlSnapshot.bathing);
  careInformation.adlProfile.dressing = setIfBlank(careInformation.adlProfile.dressing, adlSnapshot.dressing);
  careInformation.adlProfile.eating = setIfBlank(careInformation.adlProfile.eating, adlSnapshot.eating);
  careInformation.adlProfile.bladderContinence = setIfBlank(
    careInformation.adlProfile.bladderContinence,
    adlSnapshot.continence
  );
  careInformation.adlProfile.bowelContinence = setIfBlank(careInformation.adlProfile.bowelContinence, adlSnapshot.continence);

  const adlSupport =
    prefill.adlSupport && typeof prefill.adlSupport === "object" ? (prefill.adlSupport as Record<string, unknown>) : {};
  careInformation.adlProfile.toiletingNeeds = setIfBlank(
    careInformation.adlProfile.toiletingNeeds,
    adlSupport.toiletingBathingAssistance
  );
  careInformation.adlProfile.toiletingComments = setIfBlank(
    careInformation.adlProfile.toiletingComments,
    adlSupport.toiletingBathingAssistance
  );

  const behavioralSelections = payloadStringArray(prefill.behavioralRiskSelections).map((value) => value.toLowerCase());
  if (behavioralSelections.includes("wandering")) {
    careInformation.inappropriateBehaviorWanderer = true;
  }
  if (behavioralSelections.includes("aggression") || behavioralSelections.includes("agitation")) {
    careInformation.inappropriateBehaviorAggression = true;
  }
  if (behavioralSelections.includes("confusion")) {
    careInformation.disorientedIntermittently = true;
  }

  const riskNote = buildEnrollmentPacketRiskNote(prefill);
  if (riskNote) {
    const existing = clean(careInformation.orientationProfile.cognitiveBehaviorComments);
    careInformation.orientationProfile.cognitiveBehaviorComments = existing ? `${existing} | ${riskNote}` : riskNote;
  }

  return {
    careInformation,
    operationalFlags
  };
}
