import "server-only";

import { Buffer } from "node:buffer";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { createClient } from "@/lib/supabase/server";
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
import { type IntakeAssessmentForPofPrefill, mapIntakeAssessmentToPofPrefill } from "@/lib/services/intake-to-pof-mapping";
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
  dose: string | null;
  quantity: string | null;
  form: string | null;
  route: string | null;
  routeLaterality: string | null;
  frequency: string | null;
  givenAtCenter: boolean;
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

function calculateRenewalDueDate(sentDate: string | null | undefined) {
  if (!sentDate) return null;
  const d = new Date(`${sentDate}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCFullYear(d.getUTCFullYear() + DEFAULT_PHYSICIAN_ORDER_RULE_SETTINGS.renewalIntervalYears);
  return d.toISOString().slice(0, 10);
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

function rowToForm(row: any): PhysicianOrderForm {
  const diagnosisRows = parseJsonArray<PhysicianOrderDiagnosis>(row.diagnoses, []);
  const allergyRows = parseJsonArray<PhysicianOrderAllergy>(row.allergies, []);
  const medications = parseJsonArray<PhysicianOrderMedication>(row.medications, []);
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
  const supabase = await createClient();
  const { data } = await supabase.from("members").select("id, display_name").eq("id", memberId).single();
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

  if (filters?.memberId) query = query.eq("member_id", filters.memberId);
  if (filters?.status && filters.status !== "all") query = query.eq("status", fromStatus(filters.status));

  const { data, error } = await query;
  if (error) {
    if (isMissingPhysicianOrdersTableError(error)) {
      console.warn("[physician-orders] public.physician_orders missing from schema cache. Returning empty list.");
      return [];
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
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("physician_orders")
    .select("*, members!physician_orders_member_id_fkey(display_name)")
    .eq("member_id", memberId)
    .order("updated_at", { ascending: false });
  if (error) {
    if (isMissingPhysicianOrdersTableError(error)) {
      console.warn("[physician-orders] public.physician_orders missing from schema cache. Returning empty list.");
      return [];
    }
    throw new Error(error.message);
  }
  return (data ?? []).map(rowToForm);
}

export async function getActivePhysicianOrderForMember(memberId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("physician_orders")
    .select("*, members!physician_orders_member_id_fkey(display_name)")
    .eq("member_id", memberId)
    .eq("is_active_signed", true)
    .maybeSingle();
  if (error) {
    if (isMissingPhysicianOrdersTableError(error)) return null;
    throw new Error(error.message);
  }
  return data ? rowToForm(data) : null;
}

export async function getPhysicianOrderById(pofId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("physician_orders")
    .select("*, members!physician_orders_member_id_fkey(display_name)")
    .eq("id", pofId)
    .maybeSingle();
  if (error) {
    if (isMissingPhysicianOrdersTableError(error)) return null;
    throw new Error(error.message);
  }
  return data ? rowToForm(data) : null;
}

export async function buildNewPhysicianOrderDraft(input: {
  memberId: string;
  actor: { id: string; fullName: string; signoffName?: string | null };
}): Promise<PhysicianOrderForm | null> {
  const member = await getMember(input.memberId);
  if (!member) return null;

  const supabase = await createClient();
  const { data: latestIntake } = await supabase
    .from("intake_assessments")
    .select("*")
    .eq("member_id", input.memberId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const mapped = latestIntake ? mapIntakeAssessmentToPofPrefill(latestIntake as IntakeAssessmentForPofPrefill) : null;
  const now = toEasternISO();

  return {
    id: "",
    memberId: input.memberId,
    intakeAssessmentId: latestIntake?.id ?? null,
    memberNameSnapshot: member.display_name,
    memberDobSnapshot: null,
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
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("physician_orders")
    .select("version_number")
    .eq("member_id", memberId)
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
  const supabase = await createClient();
  const existing = input.id ? await getPhysicianOrderById(input.id) : null;
  if (existing && existing.status === "Signed") {
    throw new Error("Signed physician orders are locked. Create a new order to make updates.");
  }

  const member = await getMember(input.memberId);
  if (!member) throw new Error("Member not found.");

  const now = toEasternISO();
  const sentAt = input.status === "Sent" || input.status === "Signed" ? now : null;
  const signedAt = input.status === "Signed" ? now : null;
  const nextRenewalDueDate = sentAt ? calculateRenewalDueDate(sentAt.slice(0, 10)) : null;

  const payload = {
    member_id: input.memberId,
    intake_assessment_id: clean(input.intakeAssessmentId),
    status: fromStatus(input.status),
    is_active_signed: input.status === "Signed",
    member_name_snapshot: member.display_name,
    member_dob_snapshot: clean(input.memberDobSnapshot),
    sex: input.sex,
    level_of_care: input.levelOfCare,
    dnr_selected: input.dnrSelected,
    vitals_blood_pressure: clean(input.vitalsBloodPressure),
    vitals_pulse: clean(input.vitalsPulse),
    vitals_oxygen_saturation: clean(input.vitalsOxygenSaturation),
    vitals_respiration: clean(input.vitalsRespiration),
    diagnoses: input.diagnosisRows,
    allergies: input.allergyRows,
    medications: input.medications,
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
    signed_by_name: input.status === "Signed" ? clean(input.providerName) ?? input.actor.fullName : null,
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
    if (input.status === "Signed") {
      await signPhysicianOrder(existing.id, input.actor);
    }
    const saved = await getPhysicianOrderById(existing.id);
    if (!saved) throw new Error("Unable to load saved physician order.");
    return saved;
  }

  const version = await nextVersionNumber(input.memberId);
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
  if (input.status === "Signed") {
    await signPhysicianOrder(data.id, input.actor);
  }
  const saved = await getPhysicianOrderById(data.id);
  if (!saved) throw new Error("Unable to load saved physician order.");
  return saved;
}

export async function signPhysicianOrder(pofId: string, actor: { id: string; fullName: string }) {
  const supabase = await createClient();
  const row = await getPhysicianOrderById(pofId);
  if (!row) throw new Error("Physician order not found.");

  const now = toEasternISO();
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

  await syncMemberHealthProfileFromSignedPhysicianOrder(pofId);
}

export async function syncMemberHealthProfileFromSignedPhysicianOrder(pofId: string) {
  const supabase = await createClient();
  const form = await getPhysicianOrderById(pofId);
  if (!form) throw new Error("Physician order not found for sync.");
  if (form.status !== "Signed") return null;

  const payload = {
    member_id: form.memberId,
    active_physician_order_id: form.id,
    diagnoses: form.diagnosisRows,
    allergies: form.allergyRows,
    medications: form.medications,
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
    last_synced_at: toEasternISO(),
    updated_at: toEasternISO()
  };

  const { error } = await supabase.from("member_health_profiles").upsert(payload, { onConflict: "member_id" });
  if (error) throw new Error(error.message);

  return getMemberHealthProfile(form.memberId);
}

export async function getMemberHealthProfile(memberId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("member_health_profiles").select("*").eq("member_id", memberId).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function savePhysicianOrderForm(input: PhysicianOrderSaveInput) {
  return updatePhysicianOrder(input);
}

export async function buildPhysicianOrderPdfDataUrl(pofId: string) {
  const form = await getPhysicianOrderById(pofId);
  if (!form) throw new Error("Physician Order Form not found.");

  const now = toEasternISO();
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([612, 792]);

  let y = 760;
  page.drawText("Physician Order Form", { x: 36, y, size: 16, font: bold, color: rgb(0.09, 0.24, 0.55) });
  y -= 20;
  page.drawText(`Generated: ${now}`, { x: 36, y, size: 9, font });
  y -= 20;
  page.drawText(`Member: ${form.memberNameSnapshot}`, { x: 36, y, size: 11, font: bold });
  y -= 14;
  page.drawText(`Status: ${form.status} | Provider: ${form.providerName ?? "-"}`, { x: 36, y, size: 10, font });
  y -= 14;
  page.drawText(`DOB: ${form.memberDobSnapshot ?? "-"} | DNR: ${form.dnrSelected ? "Yes" : "No"}`, { x: 36, y, size: 10, font });
  y -= 18;
  page.drawText("Diagnoses", { x: 36, y, size: 11, font: bold });
  y -= 14;
  if (form.diagnosisRows.length === 0) {
    page.drawText("No diagnoses entered.", { x: 36, y, size: 10, font });
    y -= 12;
  } else {
    form.diagnosisRows.slice(0, 10).forEach((row) => {
      page.drawText(`- ${row.diagnosisName}${row.diagnosisCode ? ` (${row.diagnosisCode})` : ""}`, {
        x: 36,
        y,
        size: 10,
        font
      });
      y -= 12;
    });
  }

  y -= 6;
  page.drawText("Orders Summary", { x: 36, y, size: 11, font: bold });
  y -= 14;
  page.drawText(`Diet: ${(form.careInformation.nutritionDiets ?? []).join(", ") || "-"}`, { x: 36, y, size: 10, font });
  y -= 12;
  page.drawText(`Mobility: ${form.careInformation.ambulatoryStatus ?? "-"}`, { x: 36, y, size: 10, font });
  y -= 12;
  page.drawText(
    `Medication Administration: Self ${form.careInformation.medAdministrationSelf ? "Yes" : "No"} / Nurse ${form.careInformation.medAdministrationNurse ? "Yes" : "No"}`,
    { x: 36, y, size: 10, font }
  );

  const bytes = await pdf.save();
  return {
    form,
    fileName: `POF - ${form.memberNameSnapshot} - ${toEasternDate(now)}.pdf`,
    dataUrl: `data:application/pdf;base64,${Buffer.from(bytes).toString("base64")}`,
    generatedAt: now
  };
}
