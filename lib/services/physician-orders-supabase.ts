import { Buffer } from "node:buffer";
import { resolveCanonicalMemberRef } from "@/lib/services/canonical-person-ref";
import { createClient } from "@/lib/supabase/server";
import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";
import {
  DEFAULT_PHYSICIAN_ORDER_RULE_SETTINGS,
  OPHTHALMIC_LATERALITY_OPTIONS,
  OTIC_LATERALITY_OPTIONS,
  POF_ALLERGY_GROUP_OPTIONS,
  POF_DEFAULT_MEDICATION_FORM,
  POF_DEFAULT_MEDICATION_QUANTITY,
  POF_DEFAULT_MEDICATION_ROUTE,
  POF_LEVEL_OF_CARE_OPTIONS,
  POF_MEDICATION_FORM_OPTIONS,
  POF_MEDICATION_ROUTE_OPTIONS,
  POF_NUTRITION_OPTIONS,
  POF_STANDING_ORDER_OPTIONS
} from "@/lib/services/physician-order-config";
import { generateMarSchedulesForMember } from "@/lib/services/mar-workflow";
import { type IntakeAssessmentForPofPrefill, mapIntakeAssessmentToPofPrefill } from "@/lib/services/intake-to-pof-mapping";
import type { IntakeAssessmentSignatureState } from "@/lib/services/intake-assessment-esign";
import { logSystemEvent } from "@/lib/services/system-event-service";
import { recordImmediateSystemAlert } from "@/lib/services/workflow-observability";
import {
  deriveEnrollmentPacketPofRiskSignals,
  getLatestEnrollmentPacketPofStagingSummary,
  markEnrollmentPacketPofStagingReviewed
} from "@/lib/services/enrollment-packet-intake-staging";
import { toEasternDate, toEasternISO } from "@/lib/timezone";

export {
  OPHTHALMIC_LATERALITY_OPTIONS,
  OTIC_LATERALITY_OPTIONS,
  POF_DEFAULT_MEDICATION_FORM,
  POF_DEFAULT_MEDICATION_QUANTITY,
  POF_DEFAULT_MEDICATION_ROUTE,
  POF_LEVEL_OF_CARE_OPTIONS,
  POF_MEDICATION_FORM_OPTIONS,
  POF_MEDICATION_ROUTE_OPTIONS,
  POF_NUTRITION_OPTIONS,
  POF_STANDING_ORDER_OPTIONS
};

export type PhysicianOrderStatus = "Draft" | "Sent" | "Signed" | "Expired" | "Superseded";
export type ProviderSignatureStatus = "Pending" | "Signed";
export type PhysicianOrderRenewalStatus = "Current" | "Due Soon" | "Overdue" | "Missing Completion";
export type PhysicianOrderClinicalSyncStatus = "not_signed" | "pending" | "synced";

const CREATE_DRAFT_POF_FROM_INTAKE_RPC = "rpc_create_draft_physician_order_from_intake";
const CREATE_DRAFT_POF_FROM_INTAKE_MIGRATION = "0055_intake_draft_pof_atomic_creation.sql";

async function loadPofDocumentPdfBuilder() {
  const { buildPofDocumentPdfBytes } = await import("@/lib/services/pof-document-pdf");
  return buildPofDocumentPdfBytes;
}

type CreateDraftPofFromIntakeRpcRow = {
  physician_order_id: string;
  draft_pof_status: string;
  was_existing: boolean;
};

export interface PhysicianOrderMedication {
  id: string;
  name: string;
  strength: string | null;
  dose: string | null;
  quantity: string | null;
  form: string | null;
  route: string | null;
  routeLaterality: string | null;
  frequency: string | null;
  scheduledTimes: string[];
  givenAtCenter: boolean;
  givenAtCenterTime24h: string | null;
  prn: boolean;
  prnInstructions: string | null;
  startDate: string | null;
  endDate: string | null;
  active: boolean;
  provider: string | null;
  instructions: string | null;
  comments: string | null;
}

export interface PhysicianOrderDiagnosis {
  id: string;
  diagnosisType: "primary" | "secondary";
  diagnosisName: string;
  diagnosisCode: string | null;
}

export interface PhysicianOrderAllergy {
  id: string;
  allergyGroup: (typeof POF_ALLERGY_GROUP_OPTIONS)[number];
  allergyName: string;
  severity: string | null;
  comments: string | null;
}

export interface PhysicianOrderAdlProfile {
  ambulation: string | null;
  transferring: string | null;
  bathing: string | null;
  dressing: string | null;
  eating: string | null;
  bladderContinence: string | null;
  bowelContinence: string | null;
  toileting: string | null;
  toiletingNeeds: string | null;
  toiletingComments: string | null;
  hearing: string | null;
  vision: string | null;
  dental: string | null;
  speechVerbalStatus: string | null;
  speechComments: string | null;
  hygieneGrooming: string | null;
  maySelfMedicate: boolean | null;
  medicationManagerName: string | null;
}

export interface PhysicianOrderOrientationProfile {
  orientationDob: "Yes" | "No" | null;
  orientationCity: "Yes" | "No" | null;
  orientationCurrentYear: "Yes" | "No" | null;
  orientationFormerOccupation: "Yes" | "No" | null;
  disorientation: boolean | null;
  memoryImpairment: string | null;
  memorySeverity: string | null;
  cognitiveBehaviorComments: string | null;
}

export interface PhysicianOrderCareInformation {
  disorientedConstantly: boolean;
  disorientedIntermittently: boolean;
  inappropriateBehaviorWanderer: boolean;
  inappropriateBehaviorVerbalAggression: boolean;
  inappropriateBehaviorAggression: boolean;
  personalCareBathing: boolean;
  personalCareFeeding: boolean;
  personalCareDressing: boolean;
  personalCareMedication: boolean;
  personalCareToileting: boolean;
  ambulatoryStatus: "Full" | "Semi" | "Non" | null;
  mobilityIndependent: boolean;
  mobilityWalker: boolean;
  mobilityWheelchair: boolean;
  mobilityScooter: boolean;
  mobilityOther: boolean;
  mobilityOtherText: string | null;
  functionalLimitationSight: boolean;
  functionalLimitationHearing: boolean;
  functionalLimitationSpeech: boolean;
  activitiesPassive: boolean;
  activitiesActive: boolean;
  activitiesGroupParticipation: boolean;
  activitiesPrefersAlone: boolean;
  neurologicalConvulsionsSeizures: boolean;
  stimulationAfraidLoudNoises: boolean;
  stimulationEasilyOverwhelmed: boolean;
  stimulationAdaptsEasily: boolean;
  medAdministrationSelf: boolean;
  medAdministrationNurse: boolean;
  bladderContinent: boolean;
  bladderIncontinent: boolean;
  bowelContinent: boolean;
  bowelIncontinent: boolean;
  skinNormal: boolean;
  skinOther: string | null;
  breathingRoomAir: boolean;
  breathingOxygenTank: boolean;
  breathingOxygenLiters: string | null;
  nutritionDiets: string[];
  nutritionDietOther: string | null;
  joySparksNotes: string | null;
  adlProfile: PhysicianOrderAdlProfile;
  orientationProfile: PhysicianOrderOrientationProfile;
}

export interface PhysicianOrderOperationalFlags {
  nutAllergy: boolean;
  shellfishAllergy: boolean;
  fishAllergy: boolean;
  diabeticRestrictedSweets: boolean;
  oxygenRequirement: boolean;
  dnr: boolean;
  noPhotos: boolean;
  bathroomAssistance: boolean;
}

export interface EnrollmentPacketPrefillMeta {
  stagingId: string;
  packetId: string;
  sourceLabel: string;
  importedAt: string | null;
  caregiverName: string | null;
  initiatedByName: string | null;
  riskSignals: string[];
}

export interface PhysicianOrderForm {
  id: string;
  memberId: string;
  intakeAssessmentId: string | null;
  memberNameSnapshot: string;
  memberDobSnapshot: string | null;
  sex: "M" | "F" | null;
  levelOfCare: (typeof POF_LEVEL_OF_CARE_OPTIONS)[number] | null;
  dnrSelected: boolean;
  vitalsBloodPressure: string | null;
  vitalsPulse: string | null;
  vitalsOxygenSaturation: string | null;
  vitalsRespiration: string | null;
  diagnosisRows: PhysicianOrderDiagnosis[];
  diagnoses: string[];
  allergyRows: PhysicianOrderAllergy[];
  allergies: string[];
  medications: PhysicianOrderMedication[];
  standingOrders: string[];
  careInformation: PhysicianOrderCareInformation;
  operationalFlags: PhysicianOrderOperationalFlags;
  providerName: string | null;
  providerSignature: string | null;
  providerSignatureDate: string | null;
  status: PhysicianOrderStatus;
  providerSignatureStatus: ProviderSignatureStatus;
  createdByUserId: string;
  createdByName: string;
  createdAt: string;
  completedByUserId: string | null;
  completedByName: string | null;
  completedDate: string | null;
  nextRenewalDueDate: string | null;
  signedBy: string | null;
  signedDate: string | null;
  clinicalSyncStatus: PhysicianOrderClinicalSyncStatus;
  clinicalSyncReady: boolean;
  supersededAt: string | null;
  supersededByPofId: string | null;
  updatedByUserId: string | null;
  updatedByName: string | null;
  updatedAt: string;
  enrollmentPacketPrefill: EnrollmentPacketPrefillMeta | null;
}

export interface PhysicianOrderIndexRow {
  id: string;
  memberId: string;
  memberName: string;
  status: PhysicianOrderStatus;
  levelOfCare: string | null;
  providerName: string | null;
  completedDate: string | null;
  nextRenewalDueDate: string | null;
  renewalStatus: PhysicianOrderRenewalStatus;
  signedDate: string | null;
  clinicalSyncStatus: PhysicianOrderClinicalSyncStatus;
  updatedAt: string;
}

export interface PhysicianOrderSaveInput {
  id?: string | null;
  memberId: string;
  intakeAssessmentId?: string | null;
  memberDobSnapshot: string | null;
  sex: "M" | "F" | null;
  levelOfCare: (typeof POF_LEVEL_OF_CARE_OPTIONS)[number] | null;
  dnrSelected: boolean;
  vitalsBloodPressure: string | null;
  vitalsPulse: string | null;
  vitalsOxygenSaturation: string | null;
  vitalsRespiration: string | null;
  diagnosisRows: PhysicianOrderDiagnosis[];
  diagnoses: string[];
  allergyRows: PhysicianOrderAllergy[];
  allergies: string[];
  medications: PhysicianOrderMedication[];
  standingOrders: string[];
  careInformation: PhysicianOrderCareInformation;
  operationalFlags: PhysicianOrderOperationalFlags;
  providerName: string | null;
  providerSignature: string | null;
  providerSignatureDate: string | null;
  status: PhysicianOrderStatus;
  actor: { id: string; fullName: string };
}

function clean(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function sanitizeList(values: Array<string | null | undefined> | null | undefined) {
  return (values ?? []).map((value) => clean(value)).filter((value): value is string => Boolean(value));
}

function sanitizeDiagnosisRows(rows: PhysicianOrderDiagnosis[]) {
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

function sanitizeAllergyRows(rows: PhysicianOrderAllergy[]) {
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

function sanitizeMedicationRows(rows: PhysicianOrderMedication[]) {
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

function calculateRenewalDueDate(sentDate: string | null | undefined) {
  if (!sentDate) return null;
  const d = new Date(`${sentDate}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCFullYear(d.getUTCFullYear() + DEFAULT_PHYSICIAN_ORDER_RULE_SETTINGS.renewalIntervalYears);
  return d.toISOString().slice(0, 10);
}

function addDaysDateOnly(dateValue: string, days: number) {
  const [yearRaw, monthRaw, dayRaw] = dateValue.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const seed = new Date(Date.UTC(year, month - 1, day));
  seed.setUTCDate(seed.getUTCDate() + days);
  return `${seed.getUTCFullYear()}-${String(seed.getUTCMonth() + 1).padStart(2, "0")}-${String(seed.getUTCDate()).padStart(2, "0")}`;
}

function resolveRenewalStatus(nextRenewalDueDate: string | null | undefined): PhysicianOrderRenewalStatus {
  const dueDate = clean(nextRenewalDueDate);
  if (!dueDate) return "Missing Completion";
  const today = toEasternDate();
  if (dueDate < today) return "Overdue";
  const due = new Date(`${dueDate}T00:00:00.000Z`);
  const start = new Date(`${today}T00:00:00.000Z`);
  const days = Math.ceil((due.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
  return days <= DEFAULT_PHYSICIAN_ORDER_RULE_SETTINGS.renewalDueSoonDays ? "Due Soon" : "Current";
}

function defaultAdlProfile(): PhysicianOrderAdlProfile {
  return {
    ambulation: null,
    transferring: null,
    bathing: null,
    dressing: null,
    eating: null,
    bladderContinence: null,
    bowelContinence: null,
    toileting: null,
    toiletingNeeds: null,
    toiletingComments: null,
    hearing: null,
    vision: null,
    dental: null,
    speechVerbalStatus: null,
    speechComments: null,
    hygieneGrooming: null,
    maySelfMedicate: null,
    medicationManagerName: null
  };
}

function defaultOrientationProfile(): PhysicianOrderOrientationProfile {
  return {
    orientationDob: null,
    orientationCity: null,
    orientationCurrentYear: null,
    orientationFormerOccupation: null,
    disorientation: null,
    memoryImpairment: null,
    memorySeverity: null,
    cognitiveBehaviorComments: null
  };
}

function defaultCareInformation(): PhysicianOrderCareInformation {
  return {
    disorientedConstantly: false,
    disorientedIntermittently: false,
    inappropriateBehaviorWanderer: false,
    inappropriateBehaviorVerbalAggression: false,
    inappropriateBehaviorAggression: false,
    personalCareBathing: false,
    personalCareFeeding: false,
    personalCareDressing: false,
    personalCareMedication: false,
    personalCareToileting: false,
    ambulatoryStatus: null,
    mobilityIndependent: true,
    mobilityWalker: false,
    mobilityWheelchair: false,
    mobilityScooter: false,
    mobilityOther: false,
    mobilityOtherText: null,
    functionalLimitationSight: false,
    functionalLimitationHearing: false,
    functionalLimitationSpeech: false,
    activitiesPassive: false,
    activitiesActive: true,
    activitiesGroupParticipation: true,
    activitiesPrefersAlone: false,
    neurologicalConvulsionsSeizures: false,
    stimulationAfraidLoudNoises: false,
    stimulationEasilyOverwhelmed: false,
    stimulationAdaptsEasily: true,
    medAdministrationSelf: false,
    medAdministrationNurse: true,
    bladderContinent: true,
    bladderIncontinent: false,
    bowelContinent: true,
    bowelIncontinent: false,
    skinNormal: true,
    skinOther: null,
    breathingRoomAir: true,
    breathingOxygenTank: false,
    breathingOxygenLiters: null,
    nutritionDiets: ["Regular"],
    nutritionDietOther: null,
    joySparksNotes: null,
    adlProfile: defaultAdlProfile(),
    orientationProfile: defaultOrientationProfile()
  };
}

function defaultOperationalFlags(): PhysicianOrderOperationalFlags {
  return {
    nutAllergy: false,
    shellfishAllergy: false,
    fishAllergy: false,
    diabeticRestrictedSweets: false,
    oxygenRequirement: false,
    dnr: false,
    noPhotos: false,
    bathroomAssistance: false
  };
}

function toStatus(value: string | null | undefined): PhysicianOrderStatus {
  const normalized = (value ?? "").toLowerCase();
  if (normalized === "draft") return "Draft";
  if (normalized === "sent") return "Sent";
  if (normalized === "signed") return "Signed";
  if (normalized === "expired") return "Expired";
  if (normalized === "superseded") return "Superseded";
  return "Draft";
}

function fromStatus(value: PhysicianOrderStatus) {
  return value.toLowerCase();
}

function parseJsonArray<T>(value: unknown, fallback: T[]): T[] {
  if (!Array.isArray(value)) return fallback;
  return value as T[];
}

function parseJsonObject<T>(value: unknown, fallback: T): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  return { ...(fallback as object), ...(value as object) } as T;
}

type PostgrestErrorLike = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

function extractErrorText(error: PostgrestErrorLike | null | undefined) {
  return [error?.message, error?.details, error?.hint].filter(Boolean).join(" ").toLowerCase();
}

function isPostgresUniqueViolation(error: PostgrestErrorLike | null | undefined) {
  const text = extractErrorText(error);
  if (!text) return false;
  return error?.code === "23505" || text.includes("duplicate key value") || text.includes("unique constraint");
}

function isIntakeDraftSentUniqueViolation(error: PostgrestErrorLike | null | undefined) {
  const text = extractErrorText(error);
  if (!isPostgresUniqueViolation(error) || !text) return false;
  return text.includes("idx_physician_orders_intake_draft_sent_unique");
}

function mapPhysicianOrderWriteError(error: PostgrestErrorLike | null | undefined, fallbackMessage: string) {
  if (isIntakeDraftSentUniqueViolation(error)) {
    return "A Draft/Sent physician order already exists for this intake assessment. Open the existing order instead of creating a new one.";
  }
  return clean(error?.message) ?? fallbackMessage;
}

function isMissingPhysicianOrdersTableError(error: PostgrestErrorLike | null | undefined) {
  const text = extractErrorText(error);
  if (!text) return false;
  if (error?.code === "PGRST205") return text.includes("physician_orders");
  return (
    text.includes("physician_orders") &&
    (text.includes("schema cache") || text.includes("does not exist") || text.includes("relation"))
  );
}

function physicianOrdersTableRequiredError() {
  return new Error("Physician Orders storage is not available. Run Supabase migration 0006_intake_pof_mhp_supabase.sql.");
}

function isMissingRpcFunctionError(error: unknown, rpcName: string) {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: string }).code ?? "").toUpperCase();
  const text = String((error as { message?: string }).message ?? "").toLowerCase();
  return (code === "PGRST202" || code === "42883") && text.includes(rpcName.toLowerCase());
}

function missingRpcFunctionRequiredError(rpcName: string) {
  return new Error(
    `Shared RPC ${rpcName} is not available. Apply Supabase migration 0037_shared_rpc_standardization_lead_pof.sql and refresh PostgREST schema cache.`
  );
}

type PofPostSignSyncStep = "mhp_mcc" | "mar_medications" | "mar_schedules";
type PofPostSignSyncQueueStatus = "queued" | "completed";
type PofPostSignSyncQueueRow = {
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

export type SignPhysicianOrderResult = {
  postSignStatus: "synced" | "queued";
  queueId: string;
  attemptCount: number;
  nextRetryAt: string | null;
  lastError: string | null;
};

type RpcSignPhysicianOrderRow = {
  physician_order_id: string;
  member_id: string;
  queue_id: string;
  queue_attempt_count: number;
  queue_next_retry_at: string | null;
};

type RpcSyncSignedPofToMemberClinicalProfileRow = {
  member_id: string;
  member_health_profile_id: string;
  member_command_center_id: string | null;
};

type PofPostSignQueueStatusRow = {
  physician_order_id: string;
  status: "queued" | "completed";
};

const RPC_SIGN_PHYSICIAN_ORDER = "rpc_sign_physician_order";
const RPC_SYNC_SIGNED_POF_TO_MEMBER_CLINICAL_PROFILE = "rpc_sync_signed_pof_to_member_clinical_profile";
const DEFAULT_POF_POST_SIGN_SYNC_ALERT_AGE_MINUTES = 30;
const MAX_POF_POST_SIGN_SYNC_ALERT_ROWS = 50;

function isMissingPofPostSignQueueTableError(error: PostgrestErrorLike | null | undefined) {
  const text = extractErrorText(error);
  if (!text) return false;
  if (error?.code === "PGRST205") return text.includes("pof_post_sign_sync_queue");
  return (
    text.includes("pof_post_sign_sync_queue") &&
    (text.includes("schema cache") || text.includes("does not exist") || text.includes("relation"))
  );
}

function pofPostSignQueueTableRequiredError() {
  return new Error(
    "POF post-sign sync queue storage is not available. Run Supabase migration 0039_pof_post_sign_sync_queue.sql."
  );
}

function computePostSignRetryAt(attemptCount: number, nowIso: string) {
  const clampedAttempt = Math.max(1, Math.floor(attemptCount));
  const delayMinutes = Math.min(60, 5 * 2 ** (clampedAttempt - 1));
  const next = new Date(Date.parse(nowIso) + delayMinutes * 60 * 1000);
  return next.toISOString();
}

function getPofPostSignSyncAlertAgeMinutes() {
  const parsed = Number(process.env.POF_POST_SIGN_SYNC_ALERT_AGE_MINUTES ?? DEFAULT_POF_POST_SIGN_SYNC_ALERT_AGE_MINUTES);
  if (!Number.isFinite(parsed)) return DEFAULT_POF_POST_SIGN_SYNC_ALERT_AGE_MINUTES;
  return Math.max(5, Math.trunc(parsed));
}

function buildPostSignSyncError(step: PofPostSignSyncStep, error: unknown) {
  const base = error instanceof Error ? error.message : "Unknown post-sign sync error.";
  if (step === "mhp_mcc") return `MHP/MCC sync failed: ${base}`;
  if (step === "mar_medications") return `MAR medication sync failed: ${base}`;
  return `MAR schedule sync failed: ${base}`;
}

async function emitAgedPostSignSyncQueueAlerts(input: {
  nowIso: string;
  serviceRole?: boolean;
  actorUserId?: string | null;
}) {
  const alertAgeMinutes = getPofPostSignSyncAlertAgeMinutes();
  const thresholdIso = new Date(Date.parse(input.nowIso) - alertAgeMinutes * 60 * 1000).toISOString();
  const supabase = await createClient({ serviceRole: input.serviceRole ?? true });
  const { data, error } = await supabase
    .from("pof_post_sign_sync_queue")
    .select(
      "id, physician_order_id, member_id, pof_request_id, status, attempt_count, next_retry_at, signature_completed_at, queued_at, last_error, last_failed_step"
    )
    .eq("status", "queued")
    .lte("signature_completed_at", thresholdIso)
    .order("signature_completed_at", { ascending: true })
    .limit(MAX_POF_POST_SIGN_SYNC_ALERT_ROWS);
  if (error) {
    if (isMissingPofPostSignQueueTableError(error)) throw pofPostSignQueueTableRequiredError();
    throw new Error(error.message);
  }

  const rows = (data ?? []) as PofPostSignSyncQueueRow[];
  let alertsRaised = 0;
  for (const row of rows) {
    const didCreateAlert = await recordImmediateSystemAlert({
      entityType: "physician_order",
      entityId: row.physician_order_id,
      actorUserId: input.actorUserId ?? null,
      severity: "high",
      alertKey: "pof_post_sign_sync_aged_queue",
      metadata: {
        member_id: row.member_id,
        queue_id: row.id,
        pof_request_id: clean(row.pof_request_id),
        queue_status: row.status,
        attempt_count: Math.max(0, Number(row.attempt_count ?? 0)),
        next_retry_at: clean(row.next_retry_at),
        signature_completed_at: row.signature_completed_at,
        queued_at: clean(row.queued_at),
        last_failed_step: clean(row.last_failed_step),
        last_error: clean(row.last_error),
        alert_age_minutes: alertAgeMinutes
      }
    });
    if (didCreateAlert) {
      alertsRaised += 1;
    }
  }

  return {
    alertAgeMinutes,
    agedQueueRows: rows.length,
    alertsRaised
  };
}

function toRpcSignPhysicianOrderRow(data: unknown): RpcSignPhysicianOrderRow {
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

function toRpcSyncSignedPofToMemberClinicalProfileRow(data: unknown): RpcSyncSignedPofToMemberClinicalProfileRow {
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

function resolveClinicalSyncStatus(input: {
  status: PhysicianOrderStatus;
  queueStatus?: "queued" | "completed" | null;
}): PhysicianOrderClinicalSyncStatus {
  if (input.status !== "Signed") return "not_signed";
  return input.queueStatus === "completed" ? "synced" : "pending";
}

async function loadPostSignQueueStatusByPofIds(
  pofIds: string[],
  options?: {
    serviceRole?: boolean;
  }
) {
  const normalizedIds = [...new Set(pofIds.map((value) => clean(value)).filter((value): value is string => Boolean(value)))];
  const statuses = new Map<string, "queued" | "completed">();
  if (normalizedIds.length === 0) return statuses;

  const supabase = await createClient({ serviceRole: options?.serviceRole ?? true });
  const { data, error } = await supabase
    .from("pof_post_sign_sync_queue")
    .select("physician_order_id, status")
    .in("physician_order_id", normalizedIds);
  if (error) {
    if (isMissingPofPostSignQueueTableError(error)) throw pofPostSignQueueTableRequiredError();
    throw new Error(error.message);
  }

  for (const row of (data ?? []) as PofPostSignQueueStatusRow[]) {
    const pofId = clean(row.physician_order_id);
    if (!pofId) continue;
    statuses.set(pofId, row.status === "completed" ? "completed" : "queued");
  }
  return statuses;
}

async function invokeSignPhysicianOrderRpc(input: {
  pofId: string;
  actor: { id: string; fullName: string };
  signedAtIso: string;
  pofRequestId?: string | null;
  serviceRole?: boolean;
}) {
  const supabase = await createClient({ serviceRole: input.serviceRole ?? true });
  try {
    const data = await invokeSupabaseRpcOrThrow<unknown>(supabase, RPC_SIGN_PHYSICIAN_ORDER, {
      p_pof_id: input.pofId,
      p_actor_user_id: input.actor.id,
      p_actor_name: input.actor.fullName,
      p_signed_at: input.signedAtIso,
      p_pof_request_id: clean(input.pofRequestId) ?? null
    });
    return toRpcSignPhysicianOrderRow(data);
  } catch (error) {
    if (isMissingRpcFunctionError(error, RPC_SIGN_PHYSICIAN_ORDER)) {
      throw missingRpcFunctionRequiredError(RPC_SIGN_PHYSICIAN_ORDER);
    }
    const postgrestError = error as PostgrestErrorLike | null | undefined;
    if (isMissingPofPostSignQueueTableError(postgrestError)) throw pofPostSignQueueTableRequiredError();
    if (isMissingPhysicianOrdersTableError(postgrestError)) throw physicianOrdersTableRequiredError();
    throw error;
  }
}

async function invokeSyncSignedPofToMemberClinicalProfileRpc(input: {
  pofId: string;
  syncTimestamp: string;
  serviceRole?: boolean;
}) {
  const supabase = await createClient({ serviceRole: input.serviceRole ?? true });
  try {
    const data = await invokeSupabaseRpcOrThrow<unknown>(supabase, RPC_SYNC_SIGNED_POF_TO_MEMBER_CLINICAL_PROFILE, {
      p_pof_id: input.pofId,
      p_synced_at: input.syncTimestamp
    });
    return toRpcSyncSignedPofToMemberClinicalProfileRow(data);
  } catch (error) {
    if (isMissingRpcFunctionError(error, RPC_SYNC_SIGNED_POF_TO_MEMBER_CLINICAL_PROFILE)) {
      throw new Error(
        "Shared RPC rpc_sync_signed_pof_to_member_clinical_profile is not available. Apply Supabase migration 0043_delivery_state_and_pof_post_sign_sync_rpc.sql and refresh PostgREST schema cache."
      );
    }
    throw error;
  }
}

async function markPostSignQueueCompleted(input: {
  queueId: string;
  attemptCount: number;
  actor: { id: string | null; fullName: string | null };
  completedAt: string;
  pofRequestId?: string | null;
  serviceRole?: boolean;
}) {
  const supabase = await createClient({ serviceRole: input.serviceRole });
  const requestId = clean(input.pofRequestId);
  const payload = {
    status: "completed",
    attempt_count: input.attemptCount,
    last_attempt_at: input.completedAt,
    next_retry_at: null,
    last_error: null,
    last_error_at: null,
    last_failed_step: null,
    ...(requestId ? { pof_request_id: requestId } : {}),
    resolved_at: input.completedAt,
    resolved_by_user_id: clean(input.actor.id),
    resolved_by_name: clean(input.actor.fullName)
  };
  const { error } = await supabase
    .from("pof_post_sign_sync_queue")
    .update(payload)
    .eq("id", input.queueId);
  if (error) {
    if (isMissingPofPostSignQueueTableError(error)) throw pofPostSignQueueTableRequiredError();
    throw new Error(error.message);
  }
}

async function markPostSignQueueQueued(input: {
  queueId: string;
  attemptCount: number;
  step: PofPostSignSyncStep;
  errorMessage: string;
  nextRetryAt: string;
  pofRequestId?: string | null;
  actor: { id: string | null; fullName: string | null };
  queuedAt: string;
  serviceRole?: boolean;
}) {
  const supabase = await createClient({ serviceRole: input.serviceRole });
  const requestId = clean(input.pofRequestId);
  const payload = {
    status: "queued",
    attempt_count: input.attemptCount,
    last_attempt_at: input.queuedAt,
    next_retry_at: input.nextRetryAt,
    last_error: input.errorMessage,
    last_error_at: input.queuedAt,
    last_failed_step: input.step,
    ...(requestId ? { pof_request_id: requestId } : {}),
    queued_by_user_id: clean(input.actor.id),
    queued_by_name: clean(input.actor.fullName),
    resolved_at: null,
    resolved_by_user_id: null,
    resolved_by_name: null
  };
  const { error } = await supabase
    .from("pof_post_sign_sync_queue")
    .update(payload)
    .eq("id", input.queueId);
  if (error) {
    if (isMissingPofPostSignQueueTableError(error)) throw pofPostSignQueueTableRequiredError();
    throw new Error(error.message);
  }
}

async function runPostSignSyncCascade(input: {
  pofId: string;
  memberId: string;
  syncTimestamp: string;
  serviceRole?: boolean;
}) {
  let step: PofPostSignSyncStep = "mhp_mcc";
  try {
    await syncMemberHealthProfileFromSignedPhysicianOrder(input.pofId, { serviceRole: input.serviceRole });
    step = "mar_schedules";
    const scheduleStartDate = toEasternDate(input.syncTimestamp);
    const scheduleEndDate = addDaysDateOnly(scheduleStartDate, 30);
    await generateMarSchedulesForMember({
      memberId: input.memberId,
      startDate: scheduleStartDate,
      endDate: scheduleEndDate,
      serviceRole: input.serviceRole ?? true
    });
    return {
      ok: true as const
    };
  } catch (error) {
    return {
      ok: false as const,
      step,
      errorMessage: buildPostSignSyncError(step, error)
    };
  }
}

async function resolvePhysicianOrderMemberId(rawMemberId: string, actionLabel: string) {
  const canonical = await resolveCanonicalMemberRef(
    {
      sourceType: "member",
      memberId: rawMemberId
    },
    { actionLabel }
  );
  if (!canonical.memberId) {
    throw new Error(`${actionLabel} expected member.id but canonical member resolution returned empty memberId.`);
  }
  return canonical.memberId;
}

function rowToForm(row: any, clinicalSyncStatus?: PhysicianOrderClinicalSyncStatus): PhysicianOrderForm {
  const diagnosisRows = sanitizeDiagnosisRows(parseJsonArray<PhysicianOrderDiagnosis>(row.diagnoses, []));
  const allergyRows = sanitizeAllergyRows(parseJsonArray<PhysicianOrderAllergy>(row.allergies, []));
  const medications = sanitizeMedicationRows(parseJsonArray<PhysicianOrderMedication>(row.medications, []));
  const standingOrders = parseJsonArray<string>(row.standing_orders, []);
  const careInformation = parseJsonObject<PhysicianOrderCareInformation>(row.clinical_support, defaultCareInformation());
  const operationalFlags = parseJsonObject<PhysicianOrderOperationalFlags>(row.operational_flags, defaultOperationalFlags());
  const status = toStatus(row.status);
  const providerSignatureStatus: ProviderSignatureStatus = row.signed_at ? "Signed" : "Pending";
  const resolvedClinicalSyncStatus = clinicalSyncStatus ?? resolveClinicalSyncStatus({ status, queueStatus: null });

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

async function getMember(memberId: string) {
  const canonicalMemberId = await resolvePhysicianOrderMemberId(memberId, "physician-orders:getMember");
  const supabase = await createClient();
  const { data } = await supabase.from("members").select("id, display_name, dob").eq("id", canonicalMemberId).single();
  return data;
}

export async function getPhysicianOrders(filters?: {
  memberId?: string | null;
  status?: PhysicianOrderStatus | "all";
  q?: string;
}): Promise<PhysicianOrderIndexRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("physician_orders")
    .select(
      "id, member_id, status, level_of_care, provider_name, sent_at, next_renewal_due_date, signed_at, updated_at, members!physician_orders_member_id_fkey(display_name)"
    )
    .order("updated_at", { ascending: false });

  if (filters?.memberId) {
    const canonicalMemberId = await resolvePhysicianOrderMemberId(filters.memberId, "getPhysicianOrders");
    query = query.eq("member_id", canonicalMemberId);
  }
  if (filters?.status && filters.status !== "all") query = query.eq("status", fromStatus(filters.status));

  const { data, error } = await query;
  if (error) {
    if (isMissingPhysicianOrdersTableError(error)) {
      throw physicianOrdersTableRequiredError();
    }
    throw new Error(error.message);
  }

  const queueStatuses = await loadPostSignQueueStatusByPofIds(
    ((data ?? []) as Array<{ id: string }>).map((row) => String(row.id)),
    { serviceRole: true }
  );

  return (data ?? [])
    .map((row: any) => {
      const status = toStatus(row.status);
      return {
      id: row.id,
      memberId: row.member_id,
      memberName: row.members?.display_name ?? "Unknown Member",
      status,
      levelOfCare: row.level_of_care,
      providerName: row.provider_name,
      completedDate: row.sent_at ? String(row.sent_at).slice(0, 10) : null,
      nextRenewalDueDate: row.next_renewal_due_date,
      renewalStatus: resolveRenewalStatus(row.next_renewal_due_date),
      signedDate: row.signed_at ? String(row.signed_at).slice(0, 10) : null,
      clinicalSyncStatus: resolveClinicalSyncStatus({
        status,
        queueStatus: queueStatuses.get(String(row.id)) ?? null
      }),
      updatedAt: row.updated_at
    };
    })
    .filter((row) => {
      const q = (filters?.q ?? "").trim().toLowerCase();
      if (!q) return true;
      return (
        row.memberName.toLowerCase().includes(q) ||
        String(row.providerName ?? "").toLowerCase().includes(q) ||
        row.status.toLowerCase().includes(q)
      );
    });
}

export async function getPhysicianOrdersForMember(memberId: string) {
  const canonicalMemberId = await resolvePhysicianOrderMemberId(memberId, "getPhysicianOrdersForMember");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("physician_orders")
    .select("*, members!physician_orders_member_id_fkey(display_name)")
    .eq("member_id", canonicalMemberId)
    .order("updated_at", { ascending: false });
  if (error) {
    if (isMissingPhysicianOrdersTableError(error)) {
      throw physicianOrdersTableRequiredError();
    }
    throw new Error(error.message);
  }
  const rows = data ?? [];
  const queueStatuses = await loadPostSignQueueStatusByPofIds(
    rows.map((row: any) => String(row.id)),
    { serviceRole: true }
  );
  return rows.map((row: any) =>
    rowToForm(
      row,
      resolveClinicalSyncStatus({
        status: toStatus(row.status),
        queueStatus: queueStatuses.get(String(row.id)) ?? null
      })
    )
  );
}

export async function getActivePhysicianOrderForMember(memberId: string) {
  const canonicalMemberId = await resolvePhysicianOrderMemberId(memberId, "getActivePhysicianOrderForMember");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("physician_orders")
    .select("*, members!physician_orders_member_id_fkey(display_name)")
    .eq("member_id", canonicalMemberId)
    .eq("is_active_signed", true)
    .maybeSingle();
  if (error) {
    if (isMissingPhysicianOrdersTableError(error)) throw physicianOrdersTableRequiredError();
    throw new Error(error.message);
  }
  if (!data) return null;
  const queueStatuses = await loadPostSignQueueStatusByPofIds([String((data as { id: string }).id)], {
    serviceRole: true
  });
  return rowToForm(
    data,
    resolveClinicalSyncStatus({
      status: toStatus((data as { status: string }).status),
      queueStatus: queueStatuses.get(String((data as { id: string }).id)) ?? null
    })
  );
}

export async function getPhysicianOrderById(
  pofId: string,
  options?: {
    serviceRole?: boolean;
  }
) {
  const supabase = await createClient({ serviceRole: options?.serviceRole });
  const { data, error } = await supabase
    .from("physician_orders")
    .select("*, members!physician_orders_member_id_fkey(display_name)")
    .eq("id", pofId)
    .maybeSingle();
  if (error) {
    if (isMissingPhysicianOrdersTableError(error)) throw physicianOrdersTableRequiredError();
    throw new Error(error.message);
  }
  if (!data) return null;
  const queueStatuses = await loadPostSignQueueStatusByPofIds([String((data as { id: string }).id)], {
    serviceRole: true
  });
  return rowToForm(
    data,
    resolveClinicalSyncStatus({
      status: toStatus((data as { status: string }).status),
      queueStatus: queueStatuses.get(String((data as { id: string }).id)) ?? null
    })
  );
}

export async function getPhysicianOrderClinicalSyncState(
  pofId: string,
  options?: {
    serviceRole?: boolean;
  }
): Promise<PhysicianOrderClinicalSyncStatus> {
  const form = await getPhysicianOrderById(pofId, { serviceRole: options?.serviceRole });
  return form?.clinicalSyncStatus ?? "not_signed";
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

function applyEnrollmentPacketPrefillToDraft(input: {
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

export async function buildNewPhysicianOrderDraft(input: {
  memberId: string;
  actor: { id: string; fullName: string; signoffName?: string | null };
}): Promise<PhysicianOrderForm | null> {
  const memberId = await resolvePhysicianOrderMemberId(input.memberId, "buildNewPhysicianOrderDraft");
  const member = await getMember(memberId);
  if (!member) return null;

  const supabase = await createClient();
  const { data: latestIntake, error: latestIntakeError } = await supabase
    .from("intake_assessments")
    .select("*")
    .eq("member_id", memberId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestIntakeError) {
    throw new Error(`Unable to load latest intake assessment for POF draft prefill: ${latestIntakeError.message}`);
  }

  const mapped = latestIntake ? mapIntakeAssessmentToPofPrefill(latestIntake as IntakeAssessmentForPofPrefill) : null;
  const enrollmentPacketPrefill = await getLatestEnrollmentPacketPofStagingSummary(memberId);
  const shouldApplyEnrollmentPacketPrefill = Boolean(enrollmentPacketPrefill?.reviewRequired);
  const baseCareInformation = mapped
    ? ({ ...defaultCareInformation(), ...mapped.careInformation } as PhysicianOrderCareInformation)
    : defaultCareInformation();
  const baseOperationalFlags = mapped
    ? ({ ...defaultOperationalFlags(), ...mapped.operationalFlags } as PhysicianOrderOperationalFlags)
    : defaultOperationalFlags();
  const staged = shouldApplyEnrollmentPacketPrefill
    ? applyEnrollmentPacketPrefillToDraft({
        careInformation: baseCareInformation,
        operationalFlags: baseOperationalFlags,
        prefillPayload: enrollmentPacketPrefill!.prefillPayload
      })
    : {
        careInformation: baseCareInformation,
        operationalFlags: baseOperationalFlags
      };
  const now = toEasternISO();

  return {
    id: "",
    memberId,
    intakeAssessmentId: latestIntake?.id ?? null,
    memberNameSnapshot: member.display_name,
    memberDobSnapshot: clean(member.dob),
    sex: null,
    levelOfCare: "Home",
    dnrSelected: mapped?.dnrSelected ?? false,
    vitalsBloodPressure: mapped?.vitalsBloodPressure ?? null,
    vitalsPulse: mapped?.vitalsPulse ?? null,
    vitalsOxygenSaturation: mapped?.vitalsOxygenSaturation ?? null,
    vitalsRespiration: mapped?.vitalsRespiration ?? null,
    diagnosisRows: [],
    diagnoses: [],
    allergyRows: mapped?.allergyRows.map((row, idx) => ({ ...row, id: `new-allergy-${idx + 1}` })) ?? [],
    allergies: mapped?.allergyRows.map((row) => row.allergyName) ?? [],
    medications: [],
    standingOrders: [...POF_STANDING_ORDER_OPTIONS],
    careInformation: staged.careInformation,
    operationalFlags: staged.operationalFlags,
    providerName: clean(input.actor.signoffName) ?? input.actor.fullName,
    providerSignature: clean(input.actor.signoffName) ?? input.actor.fullName,
    providerSignatureDate: null,
    status: "Draft",
    providerSignatureStatus: "Pending",
    createdByUserId: input.actor.id,
    createdByName: input.actor.fullName,
    createdAt: now,
    completedByUserId: null,
    completedByName: null,
    completedDate: null,
    nextRenewalDueDate: null,
    signedBy: null,
    signedDate: null,
    clinicalSyncStatus: "not_signed",
    clinicalSyncReady: false,
    supersededAt: null,
    supersededByPofId: null,
    updatedByUserId: input.actor.id,
    updatedByName: input.actor.fullName,
    updatedAt: now,
    enrollmentPacketPrefill: shouldApplyEnrollmentPacketPrefill
      ? {
          stagingId: enrollmentPacketPrefill!.stagingId,
          packetId: enrollmentPacketPrefill!.packetId,
          sourceLabel: enrollmentPacketPrefill!.sourceLabel,
          importedAt: enrollmentPacketPrefill!.importedAt,
          caregiverName: enrollmentPacketPrefill!.caregiverName,
          initiatedByName: enrollmentPacketPrefill!.initiatedByName,
          riskSignals: enrollmentPacketPrefill!.riskSignals
        }
      : null
  };
}

async function nextVersionNumber(memberId: string) {
  const canonicalMemberId = await resolvePhysicianOrderMemberId(memberId, "nextVersionNumber");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("physician_orders")
    .select("version_number")
    .eq("member_id", canonicalMemberId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isMissingPhysicianOrdersTableError(error)) throw physicianOrdersTableRequiredError();
    throw new Error(error.message);
  }
  return Number(data?.version_number ?? 0) + 1;
}

export async function createDraftPhysicianOrderFromAssessment(input: {
  assessment: IntakeAssessmentForPofPrefill;
  actor: { id: string; fullName: string; signoffName?: string | null };
  intakeSignature?: IntakeAssessmentSignatureState;
}) {
  const supabase = await createClient();
  const member = await getMember(input.assessment.member_id);
  if (!member) throw new Error("Member not found for intake assessment.");

  const mapped = mapIntakeAssessmentToPofPrefill(input.assessment);
  const now = toEasternISO();
  const payload = {
    member_id: input.assessment.member_id,
    intake_assessment_id: input.assessment.id,
    status: "draft",
    is_active_signed: false,
    member_name_snapshot: member.display_name,
    member_dob_snapshot: clean(member.dob),
    dnr_selected: mapped.dnrSelected,
    vitals_blood_pressure: mapped.vitalsBloodPressure,
    vitals_pulse: mapped.vitalsPulse,
    vitals_oxygen_saturation: mapped.vitalsOxygenSaturation,
    vitals_respiration: mapped.vitalsRespiration,
    diagnoses: [],
    allergies: mapped.allergyRows,
    medications: [],
    standing_orders: POF_STANDING_ORDER_OPTIONS,
    diet_order: {
      diets: mapped.careInformation.nutritionDiets,
      other: mapped.careInformation.nutritionDietOther
    },
    mobility_order: {
      ambulatoryStatus: mapped.careInformation.ambulatoryStatus,
      mobilityWalker: mapped.careInformation.mobilityWalker,
      mobilityWheelchair: mapped.careInformation.mobilityWheelchair,
      mobilityOther: mapped.careInformation.mobilityOther,
      mobilityOtherText: mapped.careInformation.mobilityOtherText
    },
    adl_support: mapped.careInformation.adlProfile,
    continence_support: {
      bladderContinent: mapped.careInformation.bladderContinent,
      bladderIncontinent: mapped.careInformation.bladderIncontinent,
      bowelContinent: mapped.careInformation.bowelContinent,
      bowelIncontinent: mapped.careInformation.bowelIncontinent
    },
    behavior_orientation: mapped.careInformation.orientationProfile,
    clinical_support: {
      ...defaultCareInformation(),
      ...mapped.careInformation
    },
    nutrition_orders: {
      diets: mapped.careInformation.nutritionDiets,
      nutritionDietOther: mapped.careInformation.nutritionDietOther
    },
    operational_flags: mapped.operationalFlags,
    provider_name: clean(input.actor.signoffName) ?? input.actor.fullName,
    provider_signature: clean(input.actor.signoffName) ?? input.actor.fullName,
    signature_metadata: input.intakeSignature
      ? {
          sourceIntakeAssessmentSignature: {
            status: input.intakeSignature.status,
            signedByUserId: input.intakeSignature.signedByUserId,
            signedByName: input.intakeSignature.signedByName,
            signedAt: input.intakeSignature.signedAt
          }
        }
      : {},
    created_by_user_id: input.actor.id,
    created_by_name: input.actor.fullName,
    updated_by_user_id: input.actor.id,
    updated_by_name: input.actor.fullName,
    created_at: now,
    updated_at: now
  };

  let rpcData: unknown;
  try {
    rpcData = await invokeSupabaseRpcOrThrow<unknown>(supabase, CREATE_DRAFT_POF_FROM_INTAKE_RPC, {
      p_assessment_id: input.assessment.id,
      p_member_id: input.assessment.member_id,
      p_payload: payload,
      p_attempted_at: now
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create draft physician order from intake.";
    if (message.includes(CREATE_DRAFT_POF_FROM_INTAKE_RPC)) {
      throw new Error(
        `Intake draft physician order RPC is not available. Apply Supabase migration ${CREATE_DRAFT_POF_FROM_INTAKE_MIGRATION} and refresh PostgREST schema cache.`
      );
    }
    throw new Error(mapPhysicianOrderWriteError(error as PostgrestErrorLike, "Unable to create draft physician order from intake."));
  }

  const row = (Array.isArray(rpcData) ? rpcData[0] : null) as CreateDraftPofFromIntakeRpcRow | null;
  if (!row?.physician_order_id) {
    throw new Error("Intake draft physician order RPC did not return the physician order id.");
  }

  const saved = await getPhysicianOrderById(row.physician_order_id);
  if (!saved) throw new Error("Unable to load created physician order.");
  return saved;
}

export async function updatePhysicianOrder(input: PhysicianOrderSaveInput) {
  const canonicalMemberId = await resolvePhysicianOrderMemberId(input.memberId, "updatePhysicianOrder");
  const supabase = await createClient();
  const existing = input.id ? await getPhysicianOrderById(input.id) : null;
  if (existing && existing.status === "Signed") {
    throw new Error("Signed physician orders are locked. Create a new order to make updates.");
  }

  const member = await getMember(canonicalMemberId);
  if (!member) throw new Error("Member not found.");
  const diagnosisRows = sanitizeDiagnosisRows(input.diagnosisRows);
  const allergyRows = sanitizeAllergyRows(input.allergyRows);
  const medications = sanitizeMedicationRows(input.medications);

  const wantsSigned = input.status === "Signed";
  // Avoid tripping uniq_physician_orders_active_signed before we supersede old active orders.
  // We persist as Sent first, then finalize signed state in signPhysicianOrder.
  const persistedStatus: PhysicianOrderStatus = wantsSigned ? "Sent" : input.status;
  const now = toEasternISO();
  const sentAt = persistedStatus === "Sent" ? now : null;
  const signedAt = null;
  const nextRenewalDueDate = sentAt ? calculateRenewalDueDate(sentAt.slice(0, 10)) : null;

  const payload = {
    member_id: canonicalMemberId,
    intake_assessment_id: clean(input.intakeAssessmentId),
    status: fromStatus(persistedStatus),
    is_active_signed: false,
    member_name_snapshot: member.display_name,
    member_dob_snapshot: clean(input.memberDobSnapshot),
    sex: input.sex,
    level_of_care: input.levelOfCare,
    dnr_selected: input.dnrSelected,
    vitals_blood_pressure: clean(input.vitalsBloodPressure),
    vitals_pulse: clean(input.vitalsPulse),
    vitals_oxygen_saturation: clean(input.vitalsOxygenSaturation),
    vitals_respiration: clean(input.vitalsRespiration),
    diagnoses: diagnosisRows,
    allergies: allergyRows,
    medications,
    standing_orders: sanitizeList(input.standingOrders),
    diet_order: {
      diets: input.careInformation.nutritionDiets,
      other: input.careInformation.nutritionDietOther
    },
    mobility_order: {
      ambulatoryStatus: input.careInformation.ambulatoryStatus,
      mobilityIndependent: input.careInformation.mobilityIndependent,
      mobilityWalker: input.careInformation.mobilityWalker,
      mobilityWheelchair: input.careInformation.mobilityWheelchair,
      mobilityScooter: input.careInformation.mobilityScooter,
      mobilityOther: input.careInformation.mobilityOther,
      mobilityOtherText: input.careInformation.mobilityOtherText
    },
    adl_support: input.careInformation.adlProfile,
    continence_support: {
      bladderContinent: input.careInformation.bladderContinent,
      bladderIncontinent: input.careInformation.bladderIncontinent,
      bowelContinent: input.careInformation.bowelContinent,
      bowelIncontinent: input.careInformation.bowelIncontinent
    },
    behavior_orientation: input.careInformation.orientationProfile,
    clinical_support: input.careInformation,
    nutrition_orders: {
      nutritionDiets: input.careInformation.nutritionDiets,
      nutritionDietOther: input.careInformation.nutritionDietOther
    },
    operational_flags: { ...input.operationalFlags, dnr: input.dnrSelected },
    provider_name: clean(input.providerName),
    provider_signature: clean(input.providerSignature),
    provider_signature_date: clean(input.providerSignatureDate),
    sent_at: sentAt,
    signed_at: signedAt,
    signed_by_name: null,
    next_renewal_due_date: nextRenewalDueDate,
    updated_by_user_id: input.actor.id,
    updated_by_name: input.actor.fullName,
    updated_at: now
  };

  if (existing) {
    const { error } = await supabase.from("physician_orders").update(payload).eq("id", existing.id);
    if (error) {
      if (isMissingPhysicianOrdersTableError(error)) throw physicianOrdersTableRequiredError();
      throw new Error(mapPhysicianOrderWriteError(error, "Unable to update physician order."));
    }
    if (wantsSigned) {
      await signPhysicianOrder(existing.id, input.actor);
    }
    const saved = await getPhysicianOrderById(existing.id);
    if (!saved) throw new Error("Unable to load saved physician order.");
    await markEnrollmentPacketPofStagingReviewed({
      memberId: canonicalMemberId,
      actorUserId: input.actor.id,
      actorName: input.actor.fullName
    });
    return saved;
  }

  const version = await nextVersionNumber(canonicalMemberId);
  const { data, error } = await supabase
    .from("physician_orders")
    .insert({
      ...payload,
      version_number: version,
      created_by_user_id: input.actor.id,
      created_by_name: input.actor.fullName,
      created_at: now
    })
    .select("id")
    .single();

  if (error) {
    if (isMissingPhysicianOrdersTableError(error)) throw physicianOrdersTableRequiredError();
    throw new Error(mapPhysicianOrderWriteError(error, "Unable to create physician order."));
  }
  if (wantsSigned) {
    await signPhysicianOrder(data.id, input.actor);
  }
  const saved = await getPhysicianOrderById(data.id);
  if (!saved) throw new Error("Unable to load saved physician order.");
  await markEnrollmentPacketPofStagingReviewed({
    memberId: canonicalMemberId,
    actorUserId: input.actor.id,
    actorName: input.actor.fullName
  });
  return saved;
}

export async function processSignedPhysicianOrderPostSignSync(input: {
  pofId: string;
  memberId: string;
  queueId: string;
  queueAttemptCount: number;
  actor: { id: string; fullName: string };
  signedAtIso: string;
  pofRequestId?: string | null;
  serviceRole?: boolean;
}): Promise<SignPhysicianOrderResult> {
  const attemptCount = Math.max(0, Number(input.queueAttemptCount ?? 0)) + 1;
  const postSign = await runPostSignSyncCascade({
    pofId: input.pofId,
    memberId: input.memberId,
    syncTimestamp: input.signedAtIso,
    serviceRole: input.serviceRole
  });

  if (postSign.ok) {
    await markPostSignQueueCompleted({
      queueId: input.queueId,
      attemptCount,
      actor: input.actor,
      completedAt: input.signedAtIso,
      pofRequestId: input.pofRequestId,
      serviceRole: input.serviceRole
    });
    await logSystemEvent({
      event_type: "pof_post_sign_sync_completed",
      entity_type: "physician_order",
      entity_id: input.pofId,
      actor_type: "user",
      actor_id: input.actor.id,
      actor_user_id: input.actor.id,
      status: "completed",
      severity: "low",
      metadata: {
        member_id: input.memberId,
        queue_id: input.queueId,
        attempt_count: attemptCount,
        pof_request_id: clean(input.pofRequestId)
      }
    });
    return {
      postSignStatus: "synced",
      queueId: input.queueId,
      attemptCount,
      nextRetryAt: null,
      lastError: null
    };
  }

  const nextRetryAt = computePostSignRetryAt(attemptCount, input.signedAtIso);
  await markPostSignQueueQueued({
    queueId: input.queueId,
    attemptCount,
    step: postSign.step,
    errorMessage: postSign.errorMessage,
    nextRetryAt,
    pofRequestId: input.pofRequestId,
    actor: input.actor,
    queuedAt: input.signedAtIso,
    serviceRole: input.serviceRole
    });
  await logSystemEvent({
    event_type: "pof_post_sign_sync_queued_for_retry",
    entity_type: "physician_order",
    entity_id: input.pofId,
    actor_type: "user",
    actor_id: input.actor.id,
    actor_user_id: input.actor.id,
    status: "retry_pending",
    severity: attemptCount >= 3 ? "high" : "medium",
    metadata: {
      member_id: input.memberId,
      queue_id: input.queueId,
      attempt_count: attemptCount,
      failed_step: postSign.step,
      next_retry_at: nextRetryAt,
      last_error: postSign.errorMessage,
      pof_request_id: clean(input.pofRequestId)
    }
  });
  if (attemptCount >= 3) {
    await recordImmediateSystemAlert({
      entityType: "physician_order",
      entityId: input.pofId,
      actorUserId: input.actor.id,
      severity: "high",
      alertKey: "pof_post_sign_sync_failed",
      metadata: {
        member_id: input.memberId,
        queue_id: input.queueId,
        attempt_count: attemptCount,
        failed_step: postSign.step,
        next_retry_at: nextRetryAt,
        last_error: postSign.errorMessage,
        pof_request_id: clean(input.pofRequestId)
      }
    });
  }
  return {
    postSignStatus: "queued",
    queueId: input.queueId,
    attemptCount,
    nextRetryAt,
    lastError: postSign.errorMessage
  };
}

export async function signPhysicianOrder(
  pofId: string,
  actor: { id: string; fullName: string },
  options?: {
    serviceRole?: boolean;
    signedAtIso?: string;
    pofRequestId?: string | null;
  }
): Promise<SignPhysicianOrderResult> {
  const signedAtIso = options?.signedAtIso ?? toEasternISO();
  const transition = await invokeSignPhysicianOrderRpc({
    pofId,
    actor,
    signedAtIso,
    pofRequestId: options?.pofRequestId,
    serviceRole: options?.serviceRole
  });

  return processSignedPhysicianOrderPostSignSync({
    pofId: transition.physician_order_id,
    memberId: transition.member_id,
    queueId: transition.queue_id,
    queueAttemptCount: transition.queue_attempt_count,
    actor,
    signedAtIso,
    pofRequestId: options?.pofRequestId,
    serviceRole: options?.serviceRole
  });
}

export async function retryQueuedPhysicianOrderPostSignSync(input?: {
  limit?: number;
  serviceRole?: boolean;
  actor?: { id: string | null; fullName: string | null };
}) {
  const serviceRole = input?.serviceRole ?? true;
  const now = toEasternISO();
  const limit = Math.min(100, Math.max(1, input?.limit ?? 25));
  const supabase = await createClient({ serviceRole });
  const { data, error } = await supabase
    .from("pof_post_sign_sync_queue")
    .select(
      "id, physician_order_id, member_id, pof_request_id, status, attempt_count, next_retry_at, signature_completed_at, queued_at, last_error, last_failed_step"
    )
    .eq("status", "queued")
    .order("next_retry_at", { ascending: true })
    .limit(limit);
  if (error) {
    if (isMissingPofPostSignQueueTableError(error)) throw pofPostSignQueueTableRequiredError();
    throw new Error(error.message);
  }

  const actor = input?.actor ?? {
    id: null,
    fullName: "System Post-Sign Sync Retry"
  };

  const rows = ((data ?? []) as PofPostSignSyncQueueRow[]).filter((row) => {
    const retryAt = clean(row.next_retry_at);
    if (!retryAt) return true;
    return Date.parse(retryAt) <= Date.parse(now);
  });

  let processed = 0;
  let succeeded = 0;
  let queued = 0;

  for (const row of rows) {
    processed += 1;
    const attemptCount = Math.max(0, Number(row.attempt_count ?? 0)) + 1;
    const postSign = await runPostSignSyncCascade({
      pofId: row.physician_order_id,
      memberId: row.member_id,
      syncTimestamp: now,
      serviceRole
    });

    if (postSign.ok) {
      await markPostSignQueueCompleted({
        queueId: row.id,
        attemptCount,
        actor,
        completedAt: now,
        pofRequestId: row.pof_request_id,
        serviceRole
      });
      succeeded += 1;
      continue;
    }

    const nextRetryAt = computePostSignRetryAt(attemptCount, now);
    await markPostSignQueueQueued({
      queueId: row.id,
      attemptCount,
      step: postSign.step,
      errorMessage: postSign.errorMessage,
      nextRetryAt,
      pofRequestId: row.pof_request_id,
      actor,
      queuedAt: now,
      serviceRole
    });
    queued += 1;
  }

  const agedQueueAlertSummary = await emitAgedPostSignSyncQueueAlerts({
    nowIso: now,
    serviceRole,
    actorUserId: actor.id
  });

  return {
    processed,
    succeeded,
    queued,
    agedQueueRows: agedQueueAlertSummary.agedQueueRows,
    agedQueueAlertsRaised: agedQueueAlertSummary.alertsRaised,
    agedQueueAlertAgeMinutes: agedQueueAlertSummary.alertAgeMinutes
  };
}

export async function syncMemberHealthProfileFromSignedPhysicianOrder(
  pofId: string,
  options?: {
    serviceRole?: boolean;
  }
) {
  const form = await getPhysicianOrderById(pofId, { serviceRole: options?.serviceRole });
  if (!form) throw new Error("Physician order not found for sync.");
  if (form.status !== "Signed") return null;
  await invokeSyncSignedPofToMemberClinicalProfileRpc({
    pofId,
    syncTimestamp: toEasternISO(),
    serviceRole: options?.serviceRole
  });

  return getMemberHealthProfile(form.memberId);
}

export async function getMemberHealthProfile(memberId: string) {
  const canonicalMemberId = await resolvePhysicianOrderMemberId(memberId, "getMemberHealthProfile");
  const supabase = await createClient();
  const { data, error } = await supabase.from("member_health_profiles").select("*").eq("member_id", canonicalMemberId).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function savePhysicianOrderForm(input: PhysicianOrderSaveInput) {
  return updatePhysicianOrder(input);
}

export async function buildPhysicianOrderPdfDataUrl(
  pofId: string,
  options?: {
    serviceRole?: boolean;
  }
) {
  const form = await getPhysicianOrderById(pofId, { serviceRole: options?.serviceRole });
  if (!form) throw new Error("Physician Order Form not found.");

  const now = toEasternISO();
  const buildPofDocumentPdfBytes = await loadPofDocumentPdfBuilder();
  const bytes = await buildPofDocumentPdfBytes({
    form,
    title: "Physician Order Form",
    metaLines: [`Generated: ${now}`]
  });
  return {
    form,
    fileName: `POF - ${form.memberNameSnapshot} - ${toEasternDate(now)}.pdf`,
    dataUrl: `data:application/pdf;base64,${Buffer.from(bytes).toString("base64")}`,
    generatedAt: now
  };
}
