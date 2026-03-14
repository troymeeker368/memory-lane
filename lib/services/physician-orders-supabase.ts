import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

import { resolveCanonicalMemberRef } from "@/lib/services/canonical-person-ref";
import { createClient } from "@/lib/supabase/server";
import { buildPofDocumentPdfBytes } from "@/lib/services/pof-document-pdf";
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
import { ensureMemberCommandCenterProfileSupabase } from "@/lib/services/member-command-center-supabase";
import { generateMarSchedulesForMember, syncPofMedicationsFromSignedOrder } from "@/lib/services/mar-workflow";
import { type IntakeAssessmentForPofPrefill, mapIntakeAssessmentToPofPrefill } from "@/lib/services/intake-to-pof-mapping";
import type { IntakeAssessmentSignatureState } from "@/lib/services/intake-assessment-esign";
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
  supersededAt: string | null;
  supersededByPofId: string | null;
  updatedByUserId: string | null;
  updatedByName: string | null;
  updatedAt: string;
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

function clean(value: string | null | undefined) {
  const normalized = (value ?? "").trim();
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

function rowToForm(row: any): PhysicianOrderForm {
  const diagnosisRows = sanitizeDiagnosisRows(parseJsonArray<PhysicianOrderDiagnosis>(row.diagnoses, []));
  const allergyRows = sanitizeAllergyRows(parseJsonArray<PhysicianOrderAllergy>(row.allergies, []));
  const medications = sanitizeMedicationRows(parseJsonArray<PhysicianOrderMedication>(row.medications, []));
  const standingOrders = parseJsonArray<string>(row.standing_orders, []);
  const careInformation = parseJsonObject<PhysicianOrderCareInformation>(row.clinical_support, defaultCareInformation());
  const operationalFlags = parseJsonObject<PhysicianOrderOperationalFlags>(row.operational_flags, defaultOperationalFlags());
  const providerSignatureStatus: ProviderSignatureStatus = row.signed_at ? "Signed" : "Pending";

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
    status: toStatus(row.status),
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
    supersededAt: row.superseded_at,
    supersededByPofId: row.superseded_by,
    updatedByUserId: row.updated_by_user_id,
    updatedByName: row.updated_by_name,
    updatedAt: row.updated_at
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

  return (data ?? [])
    .map((row: any) => ({
      id: row.id,
      memberId: row.member_id,
      memberName: row.members?.display_name ?? "Unknown Member",
      status: toStatus(row.status),
      levelOfCare: row.level_of_care,
      providerName: row.provider_name,
      completedDate: row.sent_at ? String(row.sent_at).slice(0, 10) : null,
      nextRenewalDueDate: row.next_renewal_due_date,
      renewalStatus: resolveRenewalStatus(row.next_renewal_due_date),
      signedDate: row.signed_at ? String(row.signed_at).slice(0, 10) : null,
      updatedAt: row.updated_at
    }))
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
  return (data ?? []).map(rowToForm);
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
  return data ? rowToForm(data) : null;
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
  return data ? rowToForm(data) : null;
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
    careInformation: mapped
      ? ({ ...defaultCareInformation(), ...mapped.careInformation } as PhysicianOrderCareInformation)
      : defaultCareInformation(),
    operationalFlags: mapped
      ? ({ ...defaultOperationalFlags(), ...mapped.operationalFlags } as PhysicianOrderOperationalFlags)
      : defaultOperationalFlags(),
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
    supersededAt: null,
    supersededByPofId: null,
    updatedByUserId: input.actor.id,
    updatedByName: input.actor.fullName,
    updatedAt: now
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
  const { data: existing, error: existingError } = await supabase
    .from("physician_orders")
    .select("id")
    .eq("intake_assessment_id", input.assessment.id)
    .in("status", ["draft", "sent"])
    .limit(1)
    .maybeSingle();
  if (existingError) {
    if (isMissingPhysicianOrdersTableError(existingError)) throw physicianOrdersTableRequiredError();
    throw new Error(existingError.message);
  }

  if (existing?.id) {
    const existingForm = await getPhysicianOrderById(existing.id);
    if (!existingForm) throw new Error("Unable to load existing draft physician order.");
    return existingForm;
  }

  const member = await getMember(input.assessment.member_id);
  if (!member) throw new Error("Member not found for intake assessment.");

  const mapped = mapIntakeAssessmentToPofPrefill(input.assessment);
  const now = toEasternISO();
  const version = await nextVersionNumber(input.assessment.member_id);

  const payload = {
    member_id: input.assessment.member_id,
    intake_assessment_id: input.assessment.id,
    version_number: version,
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

  const { data, error } = await supabase.from("physician_orders").insert(payload).select("id").single();
  if (error) {
    if (isMissingPhysicianOrdersTableError(error)) throw physicianOrdersTableRequiredError();
    throw new Error(error.message);
  }
  const saved = await getPhysicianOrderById(data.id);
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
      throw new Error(error.message);
    }
    if (wantsSigned) {
      await signPhysicianOrder(existing.id, input.actor);
    }
    const saved = await getPhysicianOrderById(existing.id);
    if (!saved) throw new Error("Unable to load saved physician order.");
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
    throw new Error(error.message);
  }
  if (wantsSigned) {
    await signPhysicianOrder(data.id, input.actor);
  }
  const saved = await getPhysicianOrderById(data.id);
  if (!saved) throw new Error("Unable to load saved physician order.");
  return saved;
}

export async function signPhysicianOrder(
  pofId: string,
  actor: { id: string; fullName: string },
  options?: {
    serviceRole?: boolean;
    signedAtIso?: string;
  }
) {
  const supabase = await createClient({ serviceRole: options?.serviceRole });
  const row = await getPhysicianOrderById(pofId, { serviceRole: options?.serviceRole });
  if (!row) throw new Error("Physician order not found.");

  const now = options?.signedAtIso ?? toEasternISO();
  const { error: supersedeError } = await supabase
    .from("physician_orders")
    .update({
      status: "superseded",
      is_active_signed: false,
      superseded_by: pofId,
      superseded_at: now,
      updated_by_user_id: actor.id,
      updated_by_name: actor.fullName,
      updated_at: now
    })
    .eq("member_id", row.memberId)
    .eq("is_active_signed", true)
    .neq("id", pofId);

  if (supersedeError) {
    if (isMissingPhysicianOrdersTableError(supersedeError)) throw physicianOrdersTableRequiredError();
    throw new Error(supersedeError.message);
  }

  const { error: signError } = await supabase
    .from("physician_orders")
    .update({
      status: "signed",
      is_active_signed: true,
      signed_at: now,
      sent_at: now,
      signed_by_name: row.providerName ?? actor.fullName,
      effective_at: now,
      updated_by_user_id: actor.id,
      updated_by_name: actor.fullName,
      updated_at: now
    })
    .eq("id", pofId);

  if (signError) {
    if (isMissingPhysicianOrdersTableError(signError)) throw physicianOrdersTableRequiredError();
    throw new Error(signError.message);
  }

  await syncMemberHealthProfileFromSignedPhysicianOrder(pofId, { serviceRole: options?.serviceRole });
  await syncPofMedicationsFromSignedOrder({ physicianOrderId: pofId, serviceRole: options?.serviceRole });
  const scheduleStartDate = toEasternDate(now);
  const scheduleEndDate = addDaysDateOnly(scheduleStartDate, 30);
  await generateMarSchedulesForMember({
    memberId: row.memberId,
    startDate: scheduleStartDate,
    endDate: scheduleEndDate,
    serviceRole: options?.serviceRole
  });
}

function toMemberAllergyGroup(value: PhysicianOrderAllergy["allergyGroup"]) {
  if (value === "food" || value === "medication" || value === "environmental") return value;
  return "environmental";
}

function joinUnique(values: Array<string | null | undefined>, separator = ", ") {
  const deduped = Array.from(
    new Set(values.map((value) => clean(value)).filter((value): value is string => Boolean(value)))
  );
  return deduped.join(separator);
}

export async function syncMemberHealthProfileFromSignedPhysicianOrder(
  pofId: string,
  options?: {
    serviceRole?: boolean;
  }
) {
  const supabase = await createClient({ serviceRole: options?.serviceRole });
  const form = await getPhysicianOrderById(pofId, { serviceRole: options?.serviceRole });
  if (!form) throw new Error("Physician order not found for sync.");
  if (form.status !== "Signed") return null;
  const now = toEasternISO();
  const signedDate = form.signedDate ?? toEasternDate(now);
  const diagnosisRows = sanitizeDiagnosisRows(form.diagnosisRows);
  const allergyRows = sanitizeAllergyRows(form.allergyRows);
  const medicationRows = sanitizeMedicationRows(form.medications);
  const actorUserId = clean(form.updatedByUserId) ?? clean(form.createdByUserId);
  const actorName = clean(form.updatedByName) ?? clean(form.createdByName);

  const payload = {
    member_id: form.memberId,
    active_physician_order_id: form.id,
    diagnoses: diagnosisRows,
    allergies: allergyRows,
    medications: medicationRows,
    diet: {
      nutritionDiets: form.careInformation.nutritionDiets,
      nutritionDietOther: form.careInformation.nutritionDietOther
    },
    mobility: {
      ambulatoryStatus: form.careInformation.ambulatoryStatus,
      mobilityIndependent: form.careInformation.mobilityIndependent,
      mobilityWalker: form.careInformation.mobilityWalker,
      mobilityWheelchair: form.careInformation.mobilityWheelchair,
      mobilityScooter: form.careInformation.mobilityScooter,
      mobilityOther: form.careInformation.mobilityOther,
      mobilityOtherText: form.careInformation.mobilityOtherText
    },
    adl_support: form.careInformation.adlProfile,
    continence: {
      bladderContinent: form.careInformation.bladderContinent,
      bladderIncontinent: form.careInformation.bladderIncontinent,
      bowelContinent: form.careInformation.bowelContinent,
      bowelIncontinent: form.careInformation.bowelIncontinent
    },
    behavior_orientation: form.careInformation.orientationProfile,
    clinical_support: form.careInformation,
    operational_flags: form.operationalFlags,
    profile_notes: form.careInformation.orientationProfile.cognitiveBehaviorComments,
    joy_sparks: form.careInformation.joySparksNotes,
    last_synced_at: now,
    updated_at: now
  };

  const [{ error: mhpError }, { error: clearDiagnosisError }, { error: clearMedicationError }, { error: clearAllergyError }] =
    await Promise.all([
      supabase.from("member_health_profiles").upsert(payload, { onConflict: "member_id" }),
      supabase.from("member_diagnoses").delete().eq("member_id", form.memberId),
      supabase.from("member_medications").delete().eq("member_id", form.memberId),
      supabase.from("member_allergies").delete().eq("member_id", form.memberId)
    ]);
  if (mhpError) throw new Error(mhpError.message);
  if (clearDiagnosisError) throw new Error(clearDiagnosisError.message);
  if (clearMedicationError) throw new Error(clearMedicationError.message);
  if (clearAllergyError) throw new Error(clearAllergyError.message);

  if (diagnosisRows.length > 0) {
    const { error } = await supabase.from("member_diagnoses").insert(
      diagnosisRows.map((row) => ({
        id: randomUUID(),
        member_id: form.memberId,
        diagnosis_type: row.diagnosisType,
        diagnosis_name: row.diagnosisName,
        diagnosis_code: null,
        date_added: signedDate,
        comments: null,
        created_by_user_id: actorUserId,
        created_by_name: actorName,
        created_at: now,
        updated_at: now
      }))
    );
    if (error) throw new Error(error.message);
  }

  if (medicationRows.length > 0) {
    const { error } = await supabase.from("member_medications").insert(
      medicationRows.map((row) => ({
        id: randomUUID(),
        member_id: form.memberId,
        medication_name: row.name,
        date_started: signedDate,
        medication_status: "active",
        inactivated_at: null,
        dose: row.dose,
        quantity: row.quantity,
        form: row.form,
        frequency: row.frequency,
        route: row.route,
        route_laterality: row.routeLaterality,
        comments: row.comments,
        created_by_user_id: actorUserId,
        created_by_name: actorName,
        created_at: now,
        updated_at: now
      }))
    );
    if (error) throw new Error(error.message);
  }

  if (allergyRows.length > 0) {
    const { error } = await supabase.from("member_allergies").insert(
      allergyRows.map((row, index) => ({
        id: `allergy-${randomUUID().replace(/-/g, "")}-${index + 1}`,
        member_id: form.memberId,
        allergy_group: toMemberAllergyGroup(row.allergyGroup),
        allergy_name: row.allergyName,
        severity: row.severity,
        comments: row.comments,
        created_by_user_id: actorUserId,
        created_by_name: actorName,
        created_at: now,
        updated_at: now
      }))
    );
    if (error) throw new Error(error.message);
  }

  const ensuredMcc = await ensureMemberCommandCenterProfileSupabase(form.memberId, {
    serviceRole: options?.serviceRole,
    actor: { userId: actorUserId, name: actorName }
  });
  if (ensuredMcc?.id) {
    const nutritionDiets = form.careInformation.nutritionDiets ?? [];
    const primaryDiet =
      nutritionDiets.find((diet) => diet.toLowerCase() !== "regular") ??
      nutritionDiets[0] ??
      "Regular";
    const foodAllergies = joinUnique(
      allergyRows
        .filter((row) => toMemberAllergyGroup(row.allergyGroup) === "food")
        .map((row) => row.allergyName)
    );
    const medicationAllergies = joinUnique(
      allergyRows
        .filter((row) => toMemberAllergyGroup(row.allergyGroup) === "medication")
        .map((row) => row.allergyName)
    );
    const environmentalAllergies = joinUnique(
      allergyRows
        .filter((row) => toMemberAllergyGroup(row.allergyGroup) === "environmental")
        .map((row) => row.allergyName)
    );
    const { error: mccUpdateError } = await supabase
      .from("member_command_centers")
      .update({
        code_status: form.dnrSelected ? "DNR" : "Full Code",
        dnr: form.dnrSelected,
        diet_type: primaryDiet,
        dietary_preferences_restrictions: joinUnique([
          form.careInformation.nutritionDietOther,
          form.careInformation.joySparksNotes
        ], " | "),
        no_known_allergies: allergyRows.length === 0,
        medication_allergies: medicationAllergies || null,
        food_allergies: foodAllergies || null,
        environmental_allergies: environmentalAllergies || null,
        source_assessment_id: form.intakeAssessmentId,
        source_assessment_at: form.signedDate ?? null,
        updated_by_user_id: actorUserId,
        updated_by_name: actorName,
        updated_at: now
      })
      .eq("id", ensuredMcc.id);
    if (mccUpdateError) throw new Error(mccUpdateError.message);
  }

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
