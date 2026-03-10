import "server-only";

import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { getMockDb } from "@/lib/mock-repo";
import { readMockStateJson, writeMockStateJson } from "@/lib/mock-persistence";
import { getMemberCommandCenterDetail } from "@/lib/services/member-command-center";
import { getMemberHealthProfileDetail } from "@/lib/services/member-health-profiles";
import {
  DEFAULT_PHYSICIAN_ORDER_RULE_SETTINGS,
  OPHTHALMIC_LATERALITY_OPTIONS,
  OTIC_LATERALITY_OPTIONS,
  POF_ALLERGY_GROUP_OPTIONS,
  POF_CENTER_ADDRESS,
  POF_CENTER_LOGO_PUBLIC_PATH,
  POF_CENTER_NAME,
  POF_CENTER_PHONE,
  POF_DEFAULT_MEDICATION_FORM,
  POF_DEFAULT_MEDICATION_QUANTITY,
  POF_DEFAULT_MEDICATION_ROUTE,
  POF_LEVEL_OF_CARE_OPTIONS,
  POF_MEDICATION_FORM_OPTIONS,
  POF_MEDICATION_ROUTE_OPTIONS,
  POF_NUTRITION_OPTIONS,
  POF_STANDING_ORDER_OPTIONS
} from "@/lib/services/physician-order-config";
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

export type PhysicianOrderStatus = "Draft" | "Completed" | "Signed";
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
  updatedByUserId: string | null;
  updatedByName: string | null;
  updatedAt: string;
}

interface PersistedPhysicianOrderState {
  version: 1 | 2;
  counter: number;
  forms: PhysicianOrderForm[];
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
  actor: {
    id: string;
    fullName: string;
  };
}

const POF_STATE_FILE = "physician-orders.json";

const STANDARD_STANDING_ORDERS: string[] = [...POF_STANDING_ORDER_OPTIONS];

function clean(value: string | null | undefined) {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function sanitizeList(values: Array<string | null | undefined> | null | undefined) {
  return (values ?? []).map((value) => clean(value)).filter((value): value is string => Boolean(value));
}

function safeFileName(value: string) {
  return value.replace(/[<>:"/\\|?*]/g, "").trim();
}

function withDuplicateSuffix(fileName: string, timestampIso: string) {
  const extension = ".pdf";
  if (!fileName.toLowerCase().endsWith(extension)) return fileName;
  const root = fileName.slice(0, -extension.length);
  const suffix = timestampIso.slice(11, 19).replaceAll(":", "");
  return `${root} - ${suffix}${extension}`;
}

function findMemberById(memberId: string) {
  const db = getMockDb();
  return db.members.find((row) => row.id === memberId) ?? null;
}

function parseBoolFromFunctional(value: string | null | undefined) {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) return false;
  return normalized.includes("yes") || normalized.includes("need") || normalized.includes("assist") || normalized.includes("cue");
}

function parseOrientationAnswer(value: string | null | undefined): "Yes" | "No" | null {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "yes" || normalized === "true" || normalized === "1" || normalized === "verified") return "Yes";
  if (normalized === "no" || normalized === "false" || normalized === "0" || normalized === "not verified") return "No";
  return null;
}

function addYearsToDate(dateOnly: string | null | undefined, years: number) {
  const normalized = (dateOnly ?? "").trim();
  if (!normalized) return null;
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setUTCFullYear(parsed.getUTCFullYear() + years);
  return parsed.toISOString().slice(0, 10);
}

function calculateRenewalDueDate(completedDate: string | null | undefined) {
  return addYearsToDate(completedDate, DEFAULT_PHYSICIAN_ORDER_RULE_SETTINGS.renewalIntervalYears);
}

function resolveRenewalStatus(nextRenewalDueDate: string | null | undefined): PhysicianOrderRenewalStatus {
  const dueDate = (nextRenewalDueDate ?? "").trim();
  if (!dueDate) return "Missing Completion";
  const today = toEasternDate();
  if (dueDate < today) return "Overdue";

  const parsedDue = new Date(`${dueDate}T00:00:00.000Z`);
  const parsedToday = new Date(`${today}T00:00:00.000Z`);
  if (Number.isNaN(parsedDue.getTime()) || Number.isNaN(parsedToday.getTime())) return "Current";
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysUntilDue = Math.ceil((parsedDue.getTime() - parsedToday.getTime()) / msPerDay);
  if (daysUntilDue <= DEFAULT_PHYSICIAN_ORDER_RULE_SETTINGS.renewalDueSoonDays) return "Due Soon";
  return "Current";
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

function buildPrefillFromMember(memberId: string): {
  member: NonNullable<ReturnType<typeof findMemberById>>;
  sex: "M" | "F" | null;
  memberDob: string | null;
  dnr: boolean;
  diagnosisRows: PhysicianOrderDiagnosis[];
  diagnoses: string[];
  allergyRows: PhysicianOrderAllergy[];
  allergies: string[];
  medications: PhysicianOrderMedication[];
  careInformation: PhysicianOrderCareInformation;
  operationalFlags: PhysicianOrderOperationalFlags;
  levelOfCare: (typeof POF_LEVEL_OF_CARE_OPTIONS)[number];
} | null {
  const member = findMemberById(memberId);
  if (!member) return null;

  const mcc = getMemberCommandCenterDetail(memberId);
  const mhp = getMemberHealthProfileDetail(memberId);

  const sexRaw = (clean(mcc?.profile.gender) ?? clean(mhp?.profile.gender) ?? "").toUpperCase();
  const sex: "M" | "F" | null = sexRaw === "M" || sexRaw === "F" ? sexRaw : null;
  const codeStatus = clean(mcc?.profile.code_status) ?? clean(mhp?.profile.code_status) ?? clean(member.code_status);
  const dnr = codeStatus === "DNR" || mcc?.profile.dnr === true || mhp?.profile.dnr === true;

  const memberDob = clean(member.dob) ?? clean(mhp?.member.dob) ?? clean(mhp?.profile.orientation_dob);
  const diagnosisRows: PhysicianOrderDiagnosis[] = (mhp?.diagnoses ?? [])
    .slice(0, 12)
    .map((row, idx) => {
      const diagnosisType: PhysicianOrderDiagnosis["diagnosisType"] = idx === 0 ? "primary" : "secondary";
      return {
        id: row.id || `prefill-dx-${memberId}-${idx + 1}`,
        diagnosisType,
        diagnosisName: row.diagnosis_name.trim(),
        diagnosisCode: clean(row.diagnosis_code)
      };
    })
    .filter((row) => row.diagnosisName.length > 0);
  const diagnoses = diagnosisRows.map((row) => row.diagnosisName);

  const allergyRows: PhysicianOrderAllergy[] = (mhp?.allergies ?? [])
    .slice(0, 12)
    .map((row, idx) => ({
      id: row.id || `prefill-allergy-${memberId}-${idx + 1}`,
      allergyGroup: row.allergy_group,
      allergyName: row.allergy_name.trim(),
      severity: clean(row.severity),
      comments: clean(row.comments)
    }))
    .filter((row) => row.allergyName.length > 0);

  const allergiesFromRows = sanitizeList(
    allergyRows.map((row) => {
      const name = clean(row.allergyName);
      if (!name) return null;
      const severity = clean(row.severity);
      return severity ? `${name} (${severity})` : name;
    })
  );
  const allergies =
    allergiesFromRows.length > 0
      ? allergiesFromRows
      : sanitizeList([
          mcc?.profile.medication_allergies,
          mcc?.profile.food_allergies,
          mcc?.profile.environmental_allergies,
          member.allergies
        ]);

  const medications: PhysicianOrderMedication[] = (mhp?.medications ?? [])
    .filter((row) => row.medication_status !== "inactive")
    .slice(0, 12)
    .map((row, idx) => ({
      id: row.id || `prefill-med-${memberId}-${idx + 1}`,
      name: row.medication_name,
      dose: clean(row.dose),
      quantity: clean(row.quantity) ?? POF_DEFAULT_MEDICATION_QUANTITY,
      form: clean(row.form) ?? POF_DEFAULT_MEDICATION_FORM,
      route: clean(row.route) ?? POF_DEFAULT_MEDICATION_ROUTE,
      routeLaterality: clean(row.route_laterality),
      frequency: clean(row.frequency),
      givenAtCenter: false,
      comments: clean(row.comments)
    }));

  const nutritionSeed = clean(mcc?.profile.diet_type) ?? clean(mhp?.profile.diet_type) ?? "Regular";
  const nutritionDiets = POF_NUTRITION_OPTIONS.includes(nutritionSeed as (typeof POF_NUTRITION_OPTIONS)[number])
    ? [nutritionSeed]
    : ["Other"];
  const nutritionDietOther = nutritionDiets.includes("Other") ? nutritionSeed : null;

  const careInformation: PhysicianOrderCareInformation = {
    ...defaultCareInformation(),
    disorientedIntermittently: Boolean(
      member.orientation_dob_verified === false ||
        member.orientation_city_verified === false ||
        member.orientation_year_verified === false ||
        member.orientation_occupation_verified === false
    ),
    personalCareDressing: parseBoolFromFunctional(mhp?.profile.dressing),
    personalCareToileting: parseBoolFromFunctional(mhp?.profile.toileting),
    personalCareMedication: parseBoolFromFunctional(mhp?.profile.medication_manager_name),
    ambulatoryStatus: clean(mhp?.profile.ambulation)?.toLowerCase().includes("frequent")
      ? "Non"
      : clean(mhp?.profile.ambulation)?.toLowerCase().includes("unsteady")
        ? "Semi"
        : "Full",
    mobilityIndependent: !parseBoolFromFunctional(member.mobility_aids),
    mobilityWalker: (member.mobility_aids ?? "").toLowerCase().includes("walker"),
    mobilityWheelchair: (member.mobility_aids ?? "").toLowerCase().includes("wheelchair"),
    functionalLimitationSight: (mhp?.profile.vision ?? "").toLowerCase().includes("impaired"),
    functionalLimitationHearing:
      (mhp?.profile.hearing ?? "").toLowerCase().includes("hard") ||
      (mhp?.profile.hearing ?? "").toLowerCase().includes("aid"),
    functionalLimitationSpeech:
      (mhp?.profile.speech_verbal_status ?? "").toLowerCase().includes("limited") ||
      (mhp?.profile.speech_verbal_status ?? "").toLowerCase().includes("non"),
    activitiesPassive: (member.social_triggers ?? "").toLowerCase().includes("overwhelmed"),
    activitiesActive: true,
    activitiesGroupParticipation: true,
    stimulationAfraidLoudNoises: (member.social_triggers ?? "").toLowerCase().includes("noise"),
    stimulationEasilyOverwhelmed: (member.social_triggers ?? "").toLowerCase().includes("overwhelm"),
    stimulationAdaptsEasily: !(member.social_triggers ?? "").toLowerCase().includes("overwhelm"),
    medAdministrationSelf: Boolean(mhp?.profile.may_self_medicate),
    medAdministrationNurse: mhp?.profile.may_self_medicate === true ? false : true,
    bladderIncontinent:
      (mhp?.profile.bladder_continence ?? "").toLowerCase().includes("incontinent") ||
      (member.incontinence_products ?? "").trim().length > 0,
    bowelIncontinent: (mhp?.profile.bowel_continence ?? "").toLowerCase().includes("incontinent"),
    bladderContinent:
      !((mhp?.profile.bladder_continence ?? "").toLowerCase().includes("incontinent") ||
        (member.incontinence_products ?? "").trim().length > 0),
    bowelContinent: !(mhp?.profile.bowel_continence ?? "").toLowerCase().includes("incontinent"),
    breathingRoomAir: true,
    breathingOxygenTank: (mhp?.equipment ?? []).some(
      (row) =>
        row.equipment_type.toLowerCase().includes("oxygen") &&
        (clean(row.status)?.toLowerCase() ?? "active") === "active"
    ),
    nutritionDiets,
    nutritionDietOther,
    joySparksNotes: clean(member.joy_sparks) ?? clean(member.personal_notes),
    adlProfile: {
      ...defaultAdlProfile(),
      ambulation: clean(mhp?.profile.ambulation),
      transferring: clean(mhp?.profile.transferring),
      bathing: clean(mhp?.profile.bathing),
      dressing: clean(mhp?.profile.dressing),
      eating: clean(mhp?.profile.eating),
      bladderContinence: clean(mhp?.profile.bladder_continence),
      bowelContinence: clean(mhp?.profile.bowel_continence),
      toileting: clean(mhp?.profile.toileting),
      toiletingNeeds: clean(mhp?.profile.toileting_needs),
      toiletingComments: clean(mhp?.profile.toileting_comments),
      hearing: clean(mhp?.profile.hearing),
      vision: clean(mhp?.profile.vision),
      dental: clean(mhp?.profile.dental),
      speechVerbalStatus: clean(mhp?.profile.speech_verbal_status),
      speechComments: clean(mhp?.profile.speech_comments),
      hygieneGrooming: clean(mhp?.profile.personal_appearance_hygiene_grooming),
      maySelfMedicate: mhp?.profile.may_self_medicate ?? null,
      medicationManagerName: clean(mhp?.profile.medication_manager_name)
    },
    orientationProfile: {
      ...defaultOrientationProfile(),
      orientationDob: parseOrientationAnswer(mhp?.profile.orientation_dob),
      orientationCity: parseOrientationAnswer(mhp?.profile.orientation_city),
      orientationCurrentYear: parseOrientationAnswer(mhp?.profile.orientation_current_year),
      orientationFormerOccupation: parseOrientationAnswer(mhp?.profile.orientation_former_occupation),
      disorientation: mhp?.profile.disorientation ?? null,
      memoryImpairment: clean(mhp?.profile.memory_impairment),
      memorySeverity: clean(mhp?.profile.memory_severity),
      cognitiveBehaviorComments: clean(mhp?.profile.cognitive_behavior_comments)
    }
  };

  const lowerAllergies = allergies.join(" ").toLowerCase();
  const lowerDiet = `${mcc?.profile.diet_type ?? ""} ${mcc?.profile.dietary_preferences_restrictions ?? ""} ${
    mhp?.profile.diet_type ?? ""
  } ${mhp?.profile.dietary_restrictions ?? ""}`.toLowerCase();
  const operationalFlags: PhysicianOrderOperationalFlags = {
    ...defaultOperationalFlags(),
    nutAllergy: /nut|peanut|tree nut/.test(lowerAllergies),
    shellfishAllergy: /shellfish|shrimp|lobster|crab/.test(lowerAllergies),
    fishAllergy: /(^|\b)(fish|salmon|tuna|cod)(\b|$)/.test(lowerAllergies),
    diabeticRestrictedSweets: /diabetic|restricted sweets|no sugar/.test(lowerDiet),
    oxygenRequirement: careInformation.breathingOxygenTank,
    dnr,
    noPhotos: mcc?.profile.photo_consent === false || mhp?.profile.photo_consent === false,
    bathroomAssistance:
      parseBoolFromFunctional(mhp?.profile.toileting) || parseBoolFromFunctional(mhp?.profile.toileting_needs)
  };

  if (careInformation.breathingOxygenTank && !careInformation.breathingOxygenLiters) {
    careInformation.breathingOxygenLiters = "2";
  }

  return {
    member,
    sex,
    memberDob,
    dnr,
    diagnosisRows,
    diagnoses,
    allergyRows,
    allergies,
    medications,
    careInformation,
    operationalFlags,
    levelOfCare: "Home" as const
  };
}

function buildSeedForms(): PhysicianOrderForm[] {
  const db = getMockDb();
  const nurse = db.staff.find((row) => row.role === "nurse") ?? db.staff.find((row) => row.role === "admin") ?? db.staff[0];
  if (!nurse) return [];

  const members = db.members.filter((row) => row.status === "active").slice(0, 8);
  const statuses: PhysicianOrderStatus[] = ["Signed", "Completed", "Draft", "Signed", "Completed", "Draft", "Signed", "Draft"];

  return members.map((member, idx) => {
    const prefill = buildPrefillFromMember(member.id);
    const createdAt = toEasternISO();
    const status = statuses[idx] ?? "Draft";
    const completedDate = status === "Draft" ? null : toEasternDate();
    const signedDate = status === "Signed" ? toEasternDate() : null;
    return {
      id: `pof-seed-${idx + 1}`,
      memberId: member.id,
      memberNameSnapshot: member.display_name,
      memberDobSnapshot: prefill?.memberDob ?? member.dob,
      sex: prefill?.sex ?? null,
      levelOfCare: prefill?.levelOfCare ?? "Home",
      dnrSelected: prefill?.dnr ?? false,
      vitalsBloodPressure: "120/80",
      vitalsPulse: "72",
      vitalsOxygenSaturation: "98",
      vitalsRespiration: "16",
      diagnosisRows: prefill?.diagnosisRows ?? [],
      diagnoses: prefill?.diagnoses ?? [],
      allergyRows: prefill?.allergyRows ?? [],
      allergies: prefill?.allergies ?? [],
      medications: prefill?.medications ?? [],
      standingOrders: [...STANDARD_STANDING_ORDERS],
      careInformation: prefill?.careInformation ?? defaultCareInformation(),
      operationalFlags: prefill?.operationalFlags ?? defaultOperationalFlags(),
      providerName: null,
      providerSignature: null,
      providerSignatureDate: signedDate,
      status,
      providerSignatureStatus: status === "Signed" ? "Signed" : "Pending",
      createdByUserId: nurse.id,
      createdByName: nurse.full_name,
      createdAt,
      completedByUserId: completedDate ? nurse.id : null,
      completedByName: completedDate ? nurse.full_name : null,
      completedDate,
      nextRenewalDueDate: calculateRenewalDueDate(completedDate),
      signedBy: signedDate ? nurse.full_name : null,
      signedDate,
      updatedByUserId: nurse.id,
      updatedByName: nurse.full_name,
      updatedAt: createdAt
    };
  });
}

function normalizeDiagnosisRows(
  diagnosisRows: Array<Partial<PhysicianOrderDiagnosis>> | null | undefined,
  fallbackDiagnoses: Array<string | null | undefined>,
  baseId: string
) {
  const fromRows = (diagnosisRows ?? [])
    .map((row, idx) => {
      const diagnosisType: PhysicianOrderDiagnosis["diagnosisType"] = idx === 0 ? "primary" : "secondary";
      return {
        id: clean(row.id) ?? `${baseId}-dx-${idx + 1}`,
        diagnosisType,
        diagnosisName: String(row.diagnosisName ?? "").trim(),
        diagnosisCode: clean(row.diagnosisCode)
      };
    })
    .filter((row) => row.diagnosisName.length > 0);
  if (fromRows.length > 0) return fromRows;

  return sanitizeList(fallbackDiagnoses).map((diagnosisName, idx) => {
    const diagnosisType: PhysicianOrderDiagnosis["diagnosisType"] = idx === 0 ? "primary" : "secondary";
    return {
      id: `${baseId}-dx-${idx + 1}`,
      diagnosisType,
      diagnosisName,
      diagnosisCode: null
    };
  });
}

function normalizeAllergyRows(
  allergyRows: Array<Partial<PhysicianOrderAllergy>> | null | undefined,
  fallbackAllergies: Array<string | null | undefined>,
  baseId: string
) {
  const fromRows = (allergyRows ?? [])
    .map((row, idx) => ({
      id: clean(row.id) ?? `${baseId}-allergy-${idx + 1}`,
      allergyGroup:
        row.allergyGroup === "food" || row.allergyGroup === "medication" || row.allergyGroup === "environmental" || row.allergyGroup === "other"
          ? row.allergyGroup
          : "medication",
      allergyName: String(row.allergyName ?? "").trim(),
      severity: clean(row.severity),
      comments: clean(row.comments)
    }))
    .filter((row) => row.allergyName.length > 0);
  if (fromRows.length > 0) return fromRows;

  return sanitizeList(fallbackAllergies).map((allergyName, idx) => ({
    id: `${baseId}-allergy-${idx + 1}`,
    allergyGroup: "medication" as const,
    allergyName,
    severity: null,
    comments: null
  }));
}

function normalizeMedicationRows(
  medications: Array<Partial<PhysicianOrderMedication>> | null | undefined,
  baseId: string
) {
  return (medications ?? [])
    .map((row, idx) => {
      const route = clean(row.route) ?? POF_DEFAULT_MEDICATION_ROUTE;
      const normalizedRoute = route.toLowerCase();
      const laterality = clean(row.routeLaterality);
      const requiresOphthLaterality = normalizedRoute === "ophthalmic";
      const requiresOticLaterality = normalizedRoute === "otic";
      const validLaterality =
        requiresOphthLaterality && laterality && OPHTHALMIC_LATERALITY_OPTIONS.includes(laterality as (typeof OPHTHALMIC_LATERALITY_OPTIONS)[number])
          ? laterality
          : requiresOticLaterality && laterality && OTIC_LATERALITY_OPTIONS.includes(laterality as (typeof OTIC_LATERALITY_OPTIONS)[number])
            ? laterality
            : null;

      return {
        id: clean(row.id) ?? `${baseId}-med-${idx + 1}`,
        name: String(row.name ?? "").trim(),
        dose: clean(row.dose),
        quantity: clean(row.quantity) ?? POF_DEFAULT_MEDICATION_QUANTITY,
        form: clean(row.form) ?? POF_DEFAULT_MEDICATION_FORM,
        route,
        routeLaterality: validLaterality,
        frequency: clean(row.frequency),
        givenAtCenter: row.givenAtCenter === true,
        comments: clean(row.comments)
      } satisfies PhysicianOrderMedication;
    })
    .filter((row) => row.name.length > 0);
}

function normalizeCareInformation(careInformation: Partial<PhysicianOrderCareInformation> | null | undefined) {
  const base = defaultCareInformation();
  const incoming = careInformation ?? {};

  return {
    ...base,
    ...incoming,
    nutritionDiets: Array.isArray(incoming.nutritionDiets) && incoming.nutritionDiets.length > 0 ? incoming.nutritionDiets : base.nutritionDiets,
    nutritionDietOther: clean(incoming.nutritionDietOther),
    joySparksNotes: clean(incoming.joySparksNotes),
    mobilityOtherText: clean(incoming.mobilityOtherText),
    skinOther: clean(incoming.skinOther),
    breathingOxygenLiters: clean(incoming.breathingOxygenLiters),
    adlProfile: {
      ...base.adlProfile,
      ...(incoming.adlProfile ?? {}),
      ambulation: clean(incoming.adlProfile?.ambulation),
      transferring: clean(incoming.adlProfile?.transferring),
      bathing: clean(incoming.adlProfile?.bathing),
      dressing: clean(incoming.adlProfile?.dressing),
      eating: clean(incoming.adlProfile?.eating),
      bladderContinence: clean(incoming.adlProfile?.bladderContinence),
      bowelContinence: clean(incoming.adlProfile?.bowelContinence),
      toileting: clean(incoming.adlProfile?.toileting),
      toiletingNeeds: clean(incoming.adlProfile?.toiletingNeeds),
      toiletingComments: clean(incoming.adlProfile?.toiletingComments),
      hearing: clean(incoming.adlProfile?.hearing),
      vision: clean(incoming.adlProfile?.vision),
      dental: clean(incoming.adlProfile?.dental),
      speechVerbalStatus: clean(incoming.adlProfile?.speechVerbalStatus),
      speechComments: clean(incoming.adlProfile?.speechComments),
      hygieneGrooming: clean(incoming.adlProfile?.hygieneGrooming),
      maySelfMedicate: incoming.adlProfile?.maySelfMedicate ?? null,
      medicationManagerName: clean(incoming.adlProfile?.medicationManagerName)
    },
    orientationProfile: {
      ...base.orientationProfile,
      ...(incoming.orientationProfile ?? {}),
      orientationDob: parseOrientationAnswer(incoming.orientationProfile?.orientationDob),
      orientationCity: parseOrientationAnswer(incoming.orientationProfile?.orientationCity),
      orientationCurrentYear: parseOrientationAnswer(incoming.orientationProfile?.orientationCurrentYear),
      orientationFormerOccupation: parseOrientationAnswer(incoming.orientationProfile?.orientationFormerOccupation),
      disorientation: incoming.orientationProfile?.disorientation ?? null,
      memoryImpairment: clean(incoming.orientationProfile?.memoryImpairment),
      memorySeverity: clean(incoming.orientationProfile?.memorySeverity),
      cognitiveBehaviorComments: clean(incoming.orientationProfile?.cognitiveBehaviorComments)
    }
  } satisfies PhysicianOrderCareInformation;
}

function readPersistedState(): PersistedPhysicianOrderState {
  const seeded = buildSeedForms();
  const fallback: PersistedPhysicianOrderState = {
    version: 2,
    counter: 9000 + seeded.length,
    forms: seeded
  };
  const candidate = readMockStateJson<PersistedPhysicianOrderState | null>(POF_STATE_FILE, null);
  if (!candidate || !Array.isArray(candidate.forms)) {
    return fallback;
  }

  const normalizedForms = candidate.forms.map((row) => {
    const raw = row as PhysicianOrderForm & { vitalsTemperature?: string | null; diagnosisRows?: PhysicianOrderDiagnosis[]; allergyRows?: PhysicianOrderAllergy[] };
    const baseId = clean(raw.id) ?? `pof-legacy-${Math.random().toString(36).slice(2, 8)}`;
    const diagnosisRows = normalizeDiagnosisRows(raw.diagnosisRows, raw.diagnoses ?? [], baseId);
    const diagnoses = diagnosisRows.map((entry) => entry.diagnosisName);
    const allergyRows = normalizeAllergyRows(raw.allergyRows, raw.allergies ?? [], baseId);
    const allergies = allergyRows.map((entry) => (entry.severity ? `${entry.allergyName} (${entry.severity})` : entry.allergyName));
    const completedDate = clean(raw.completedDate);
    return {
      ...row,
      diagnosisRows,
      diagnoses,
      allergyRows,
      allergies,
      medications: normalizeMedicationRows(raw.medications, baseId),
      standingOrders: (
        sanitizeList(raw.standingOrders).filter((line) => STANDARD_STANDING_ORDERS.includes(line)).length > 0
          ? sanitizeList(raw.standingOrders).filter((line) => STANDARD_STANDING_ORDERS.includes(line))
          : [...STANDARD_STANDING_ORDERS]
      ),
      careInformation: normalizeCareInformation(raw.careInformation),
      memberDobSnapshot: clean(raw.memberDobSnapshot),
      vitalsOxygenSaturation:
        clean(raw.vitalsOxygenSaturation) ??
        clean(raw.vitalsTemperature) ??
        null,
      nextRenewalDueDate: clean(raw.nextRenewalDueDate) ?? calculateRenewalDueDate(completedDate),
      completedDate
    } satisfies PhysicianOrderForm;
  });

  return {
    version: 2,
    counter: Number.isFinite(candidate.counter) ? candidate.counter : fallback.counter,
    forms: normalizedForms
  };
}

const initialState = readPersistedState();
let pofCounter = initialState.counter;
let pofForms: PhysicianOrderForm[] = initialState.forms;

function persistState() {
  writeMockStateJson<PersistedPhysicianOrderState>(POF_STATE_FILE, {
    version: 2,
    counter: pofCounter,
    forms: pofForms
  });
}

function nextId() {
  pofCounter += 1;
  return `pof-${pofCounter}`;
}

function sortByUpdatedDesc(rows: PhysicianOrderForm[]) {
  return [...rows].sort((left, right) => (left.updatedAt < right.updatedAt ? 1 : -1));
}

export function getPhysicianOrders(filters?: {
  memberId?: string | null;
  status?: PhysicianOrderStatus | "all";
  q?: string;
}): PhysicianOrderIndexRow[] {
  const memberId = clean(filters?.memberId);
  const q = (filters?.q ?? "").trim().toLowerCase();
  const status = filters?.status ?? "all";

  return sortByUpdatedDesc(pofForms)
    .filter((row) => (memberId ? row.memberId === memberId : true))
    .filter((row) => (status === "all" ? true : row.status === status))
    .filter((row) => {
      if (!q) return true;
      return (
        row.memberNameSnapshot.toLowerCase().includes(q) ||
        String(row.providerName ?? "").toLowerCase().includes(q) ||
        row.status.toLowerCase().includes(q)
      );
    })
    .map((row) => ({
      id: row.id,
      memberId: row.memberId,
      memberName: row.memberNameSnapshot,
      status: row.status,
      levelOfCare: row.levelOfCare,
      providerName: row.providerName,
      completedDate: row.completedDate,
      nextRenewalDueDate: row.nextRenewalDueDate,
      renewalStatus: resolveRenewalStatus(row.nextRenewalDueDate),
      signedDate: row.signedDate,
      updatedAt: row.updatedAt
    }));
}

export function getPhysicianOrdersForMember(memberId: string) {
  return sortByUpdatedDesc(pofForms).filter((row) => row.memberId === memberId);
}

export function getLatestPhysicianOrderForMember(memberId: string) {
  return getPhysicianOrdersForMember(memberId)[0] ?? null;
}

export function getPhysicianOrderById(pofId: string) {
  return pofForms.find((row) => row.id === pofId) ?? null;
}

export interface PhysicianOrderRenewalTrackerRow {
  memberId: string;
  memberName: string;
  pofId: string | null;
  completedDate: string | null;
  nextRenewalDueDate: string | null;
  renewalStatus: PhysicianOrderRenewalStatus;
}

export function getPhysicianOrderRenewalTracker() {
  const db = getMockDb();
  return db.members
    .filter((member) => member.status === "active")
    .map((member) => {
      const latestCompleted = getPhysicianOrdersForMember(member.id).find((row) => row.completedDate);
      const nextRenewalDueDate = latestCompleted?.nextRenewalDueDate ?? null;
      return {
        memberId: member.id,
        memberName: member.display_name,
        pofId: latestCompleted?.id ?? null,
        completedDate: latestCompleted?.completedDate ?? null,
        nextRenewalDueDate,
        renewalStatus: resolveRenewalStatus(nextRenewalDueDate)
      } satisfies PhysicianOrderRenewalTrackerRow;
    })
    .sort((left, right) => left.memberName.localeCompare(right.memberName, undefined, { sensitivity: "base" }));
}

export function buildNewPhysicianOrderDraft(input: {
  memberId: string;
  actor: { id: string; fullName: string; signoffName?: string | null };
}): PhysicianOrderForm | null {
  const prefill = buildPrefillFromMember(input.memberId);
  if (!prefill) return null;

  const now = toEasternISO();

  return {
    id: "",
    memberId: prefill.member.id,
    memberNameSnapshot: prefill.member.display_name,
    memberDobSnapshot: prefill.memberDob,
    sex: prefill.sex,
    levelOfCare: prefill.levelOfCare,
    dnrSelected: prefill.dnr,
    vitalsBloodPressure: null,
    vitalsPulse: null,
    vitalsOxygenSaturation: null,
    vitalsRespiration: null,
    diagnosisRows: prefill.diagnosisRows,
    diagnoses: prefill.diagnoses,
    allergyRows: prefill.allergyRows,
    allergies: prefill.allergies,
    medications: prefill.medications,
    standingOrders: [...STANDARD_STANDING_ORDERS],
    careInformation: prefill.careInformation,
    operationalFlags: prefill.operationalFlags,
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
    updatedByUserId: input.actor.id,
    updatedByName: input.actor.fullName,
    updatedAt: now
  };
}

export function savePhysicianOrderForm(input: PhysicianOrderSaveInput): PhysicianOrderForm {
  const member = findMemberById(input.memberId);
  if (!member) {
    throw new Error("Member not found.");
  }

  const now = toEasternISO();
  const today = toEasternDate(now);
  const existing = input.id ? getPhysicianOrderById(input.id) : null;

  const base: PhysicianOrderForm = existing
    ? { ...existing }
    : {
        id: nextId(),
        memberId: member.id,
        memberNameSnapshot: member.display_name,
        memberDobSnapshot: member.dob,
        sex: null,
        levelOfCare: "Home",
        dnrSelected: false,
        vitalsBloodPressure: null,
        vitalsPulse: null,
        vitalsOxygenSaturation: null,
        vitalsRespiration: null,
        diagnosisRows: [],
        diagnoses: [],
        allergyRows: [],
        allergies: [],
        medications: [],
        standingOrders: [...STANDARD_STANDING_ORDERS],
        careInformation: defaultCareInformation(),
        operationalFlags: defaultOperationalFlags(),
        providerName: null,
        providerSignature: null,
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
        updatedByUserId: null,
        updatedByName: null,
        updatedAt: now
      };

  const diagnosisRows = normalizeDiagnosisRows(input.diagnosisRows, input.diagnoses, base.id || "pof");
  const allergyRows = normalizeAllergyRows(input.allergyRows, input.allergies, base.id || "pof");
  const normalizedMeds = normalizeMedicationRows(input.medications, base.id || "pof");
  const selectedStandingOrders = sanitizeList(input.standingOrders).filter((line) => STANDARD_STANDING_ORDERS.includes(line));

  base.memberId = member.id;
  base.memberNameSnapshot = member.display_name;
  base.memberDobSnapshot = clean(input.memberDobSnapshot) ?? clean(member.dob);
  base.sex = input.sex;
  base.levelOfCare = input.levelOfCare;
  base.dnrSelected = input.dnrSelected;
  base.vitalsBloodPressure = clean(input.vitalsBloodPressure);
  base.vitalsPulse = clean(input.vitalsPulse);
  base.vitalsOxygenSaturation = clean(input.vitalsOxygenSaturation);
  base.vitalsRespiration = clean(input.vitalsRespiration);
  base.diagnosisRows = diagnosisRows;
  base.diagnoses = diagnosisRows.map((row) => row.diagnosisName);
  base.allergyRows = allergyRows;
  base.allergies = allergyRows.map((row) => (row.severity ? `${row.allergyName} (${row.severity})` : row.allergyName));
  base.medications = normalizedMeds;
  base.standingOrders = selectedStandingOrders;
  base.careInformation = {
    ...normalizeCareInformation(base.careInformation),
    ...normalizeCareInformation(input.careInformation)
  };
  base.operationalFlags = {
    ...defaultOperationalFlags(),
    ...input.operationalFlags,
    dnr: input.dnrSelected
  };
  base.providerName = clean(input.providerName);
  base.providerSignature = clean(input.providerSignature);
  base.providerSignatureDate = clean(input.providerSignatureDate);
  base.status = input.status;
  base.updatedAt = now;
  base.updatedByUserId = input.actor.id;
  base.updatedByName = input.actor.fullName;

  if (input.status === "Draft") {
    base.providerSignatureStatus = "Pending";
  }

  if (input.status === "Completed" || input.status === "Signed") {
    base.completedByUserId = base.completedByUserId ?? input.actor.id;
    base.completedByName = base.completedByName ?? input.actor.fullName;
    base.completedDate = base.completedDate ?? today;
    base.nextRenewalDueDate = calculateRenewalDueDate(base.completedDate);
  }

  if (input.status === "Signed") {
    base.providerSignatureStatus = "Signed";
    base.signedBy = clean(base.providerName) ?? input.actor.fullName;
    base.signedDate = clean(base.providerSignatureDate) ?? today;
  } else if (base.providerSignatureStatus !== "Signed") {
    base.signedBy = null;
    base.signedDate = null;
  }

  if (input.status === "Draft" && !base.completedDate) {
    base.nextRenewalDueDate = null;
  }

  if (!existing) {
    pofForms = [base, ...pofForms];
  } else {
    pofForms = pofForms.map((row) => (row.id === base.id ? base : row));
  }

  persistState();
  return base;
}

function drawWrappedText(input: {
  page: import("pdf-lib").PDFPage;
  text: string;
  x: number;
  y: number;
  maxWidth: number;
  lineHeight: number;
  font: import("pdf-lib").PDFFont;
  size: number;
  color?: ReturnType<typeof rgb>;
}) {
  const words = input.text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (input.font.widthOfTextAtSize(next, input.size) <= input.maxWidth) {
      current = next;
      return;
    }
    if (current) lines.push(current);
    current = word;
  });
  if (current) lines.push(current);

  let y = input.y;
  lines.forEach((line) => {
    input.page.drawText(line, {
      x: input.x,
      y,
      size: input.size,
      font: input.font,
      color: input.color ?? rgb(0.1, 0.1, 0.1)
    });
    y -= input.lineHeight;
  });
  return y;
}

function yesNo(value: boolean) {
  return value ? "Yes" : "No";
}

function toKeyValueLines(form: PhysicianOrderForm) {
  const care = form.careInformation;
  const flags = form.operationalFlags;
  const adl = care.adlProfile;
  const orientation = care.orientationProfile;
  return [
    `Disoriented: Constantly ${yesNo(care.disorientedConstantly)} | Intermittently ${yesNo(care.disorientedIntermittently)}`,
    `Inappropriate Behavior: Wanderer ${yesNo(care.inappropriateBehaviorWanderer)}, Verbal Aggression ${yesNo(care.inappropriateBehaviorVerbalAggression)}, Aggression ${yesNo(care.inappropriateBehaviorAggression)}`,
    `Personal Care Assistance: Bathing ${yesNo(care.personalCareBathing)}, Feeding ${yesNo(care.personalCareFeeding)}, Dressing ${yesNo(care.personalCareDressing)}, Medication ${yesNo(care.personalCareMedication)}, Toileting ${yesNo(care.personalCareToileting)}`,
    `Ambulatory Status: ${care.ambulatoryStatus ?? "-"}`,
    `Mobility: Independent ${yesNo(care.mobilityIndependent)}, Walker ${yesNo(care.mobilityWalker)}, Wheelchair ${yesNo(care.mobilityWheelchair)}, Scooter ${yesNo(care.mobilityScooter)}, Other ${yesNo(care.mobilityOther)}${care.mobilityOtherText ? ` (${care.mobilityOtherText})` : ""}`,
    `Functional Limitations: Sight ${yesNo(care.functionalLimitationSight)}, Hearing ${yesNo(care.functionalLimitationHearing)}, Speech ${yesNo(care.functionalLimitationSpeech)}`,
    `Activities/Social: Passive ${yesNo(care.activitiesPassive)}, Active ${yesNo(care.activitiesActive)}, Group Participation ${yesNo(care.activitiesGroupParticipation)}, Prefers Alone ${yesNo(care.activitiesPrefersAlone)}`,
    `Neurological (Convulsions/Seizures): ${yesNo(care.neurologicalConvulsionsSeizures)}`,
    `Stimulation: Afraid Loud Noises ${yesNo(care.stimulationAfraidLoudNoises)}, Easily Overwhelmed ${yesNo(care.stimulationEasilyOverwhelmed)}, Adapts Easily ${yesNo(care.stimulationAdaptsEasily)}`,
    `Medication Administration: Self ${yesNo(care.medAdministrationSelf)}, Nurse ${yesNo(care.medAdministrationNurse)}`,
    `Bladder: Continent ${yesNo(care.bladderContinent)}, Incontinent ${yesNo(care.bladderIncontinent)}`,
    `Bowel: Continent ${yesNo(care.bowelContinent)}, Incontinent ${yesNo(care.bowelIncontinent)}`,
    `Skin: Normal ${yesNo(care.skinNormal)}${care.skinOther ? ` | Other: ${care.skinOther}` : ""}`,
    `Breathing: Room Air ${yesNo(care.breathingRoomAir)}, Oxygen Tank ${yesNo(care.breathingOxygenTank)}${care.breathingOxygenLiters ? ` (${care.breathingOxygenLiters}L)` : ""}`,
    `Nutrition/Diet: ${(care.nutritionDiets.length > 0 ? care.nutritionDiets.join(", ") : "-")}${care.nutritionDietOther ? ` | Other: ${care.nutritionDietOther}` : ""}`,
    `MHP-Aligned ADLs: Ambulation ${adl.ambulation ?? "-"}, Transferring ${adl.transferring ?? "-"}, Bathing ${adl.bathing ?? "-"}, Dressing ${adl.dressing ?? "-"}, Eating ${adl.eating ?? "-"}`,
    `MHP-Aligned ADLs: Bladder ${adl.bladderContinence ?? "-"}, Bowel ${adl.bowelContinence ?? "-"}, Toileting ${adl.toileting ?? "-"}, Toileting Needs ${adl.toiletingNeeds ?? "-"}`,
    `MHP-Aligned ADLs: Hearing ${adl.hearing ?? "-"}, Vision ${adl.vision ?? "-"}, Dental ${adl.dental ?? "-"}, Speech ${adl.speechVerbalStatus ?? "-"}, Self Medicate ${adl.maySelfMedicate == null ? "-" : yesNo(adl.maySelfMedicate)}`,
    `Orientation: DOB ${orientation.orientationDob ?? "-"}, City ${orientation.orientationCity ?? "-"}, Year ${orientation.orientationCurrentYear ?? "-"}, Occupation ${orientation.orientationFormerOccupation ?? "-"}, Disorientation ${orientation.disorientation == null ? "-" : yesNo(orientation.disorientation)}`,
    `Operational Flags: Nut ${yesNo(flags.nutAllergy)}, Shellfish ${yesNo(flags.shellfishAllergy)}, Fish ${yesNo(flags.fishAllergy)}, Diabetic/Restricted Sweets ${yesNo(flags.diabeticRestrictedSweets)}, Oxygen ${yesNo(flags.oxygenRequirement)}, DNR ${yesNo(flags.dnr)}, No Photos ${yesNo(flags.noPhotos)}, Bathroom Assistance ${yesNo(flags.bathroomAssistance)}`,
    `Joy Sparks / Additional Notes: ${care.joySparksNotes ?? "-"}`
  ];
}

function publicAssetPath(publicPath: string) {
  const normalized = publicPath.startsWith("/") ? publicPath.slice(1) : publicPath;
  return path.join(process.cwd(), "public", normalized);
}

async function loadPofLogoImage(pdf: PDFDocument) {
  try {
    const bytes = await readFile(publicAssetPath(POF_CENTER_LOGO_PUBLIC_PATH));
    return await pdf.embedPng(bytes);
  } catch {
    return null;
  }
}

function drawPofHeader(input: {
  page: import("pdf-lib").PDFPage;
  font: import("pdf-lib").PDFFont;
  fontBold: import("pdf-lib").PDFFont;
  textColor: ReturnType<typeof rgb>;
  brandColor: ReturnType<typeof rgb>;
  logo: import("pdf-lib").PDFImage | null;
  generatedAt: string;
}) {
  const { page, font, fontBold, textColor, brandColor, logo, generatedAt } = input;
  const pageWidth = page.getWidth();
  let y = 760;

  if (logo) {
    const logoHeight = 38;
    const scaled = logo.scale(logoHeight / logo.height);
    const logoWidth = Math.min(scaled.width, 160);
    page.drawImage(logo, {
      x: 36,
      y: y - logoHeight + 4,
      width: logoWidth,
      height: logoHeight
    });
  }

  const centerTitle = POF_CENTER_NAME;
  const centerX = pageWidth / 2;
  page.drawText(centerTitle, {
    x: centerX - fontBold.widthOfTextAtSize(centerTitle, 14) / 2,
    y,
    size: 14,
    font: fontBold,
    color: brandColor
  });
  y -= 14;
  page.drawText(POF_CENTER_ADDRESS, {
    x: centerX - font.widthOfTextAtSize(POF_CENTER_ADDRESS, 9.5) / 2,
    y,
    size: 9.5,
    font,
    color: textColor
  });
  y -= 12;
  page.drawText(POF_CENTER_PHONE, {
    x: centerX - font.widthOfTextAtSize(POF_CENTER_PHONE, 9.5) / 2,
    y,
    size: 9.5,
    font,
    color: textColor
  });

  const generated = `Generated: ${generatedAt} (ET)`;
  page.drawText(generated, {
    x: pageWidth - font.widthOfTextAtSize(generated, 8.5) - 36,
    y: 760,
    size: 8.5,
    font,
    color: textColor
  });
  page.drawLine({
    start: { x: 36, y: 712 },
    end: { x: pageWidth - 36, y: 712 },
    color: rgb(0.75, 0.78, 0.84),
    thickness: 1
  });
  return 694;
}

export async function buildPhysicianOrderPdfDataUrl(pofId: string) {
  const form = getPhysicianOrderById(pofId);
  if (!form) {
    throw new Error("Physician Order Form not found.");
  }

  const member = findMemberById(form.memberId);
  const memberName = member?.display_name ?? form.memberNameSnapshot;
  const now = toEasternISO();

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const text = rgb(0.1, 0.1, 0.1);
  const blue = rgb(0.09, 0.24, 0.55);
  const logo = await loadPofLogoImage(pdf);

  const page1 = pdf.addPage([612, 792]);
  let y = drawPofHeader({
    page: page1,
    font,
    fontBold,
    textColor: text,
    brandColor: blue,
    logo,
    generatedAt: now
  });
  page1.drawText("Physician Order & Physical Exam Form", { x: 36, y, size: 15, font: fontBold, color: blue });
  y -= 20;
  page1.drawText(`Member: ${memberName}`, { x: 36, y, size: 11, font: fontBold, color: text });
  page1.drawText(`DOB: ${form.memberDobSnapshot ?? "-"}`, { x: 265, y, size: 11, font, color: text });
  page1.drawText(`Sex: ${form.sex ?? "-"}`, { x: 380, y, size: 11, font, color: text });
  page1.drawText(`Level of Care: ${form.levelOfCare ?? "-"}`, { x: 450, y, size: 11, font, color: text });
  y -= 16;
  page1.drawText(`DNR Selected: ${yesNo(form.dnrSelected)}`, { x: 36, y, size: 10.5, font, color: text });
  page1.drawText(`Status: ${form.status}`, { x: 220, y, size: 10.5, font, color: text });
  page1.drawText(`Provider Signature Status: ${form.providerSignatureStatus}`, { x: 340, y, size: 10.5, font, color: text });
  y -= 18;
  page1.drawText("Vital Signs", { x: 36, y, size: 11, font: fontBold, color: blue });
  y -= 14;
  page1.drawText(
    `BP: ${form.vitalsBloodPressure ?? "-"}   Pulse: ${form.vitalsPulse ?? "-"}   O2%: ${form.vitalsOxygenSaturation ?? "-"}   Resp: ${form.vitalsRespiration ?? "-"}`,
    { x: 36, y, size: 10.5, font, color: text }
  );

  y -= 22;
  page1.drawText("Diagnoses", { x: 36, y, size: 11, font: fontBold, color: blue });
  y -= 14;
  page1.drawText("Type", { x: 36, y, size: 9.5, font: fontBold, color: text });
  page1.drawText("Diagnosis", { x: 108, y, size: 9.5, font: fontBold, color: text });
  page1.drawText("Code", { x: 458, y, size: 9.5, font: fontBold, color: text });
  y -= 10;
  page1.drawLine({ start: { x: 36, y }, end: { x: 576, y }, color: rgb(0.75, 0.78, 0.84), thickness: 1 });
  y -= 10;
  if (form.diagnosisRows.length === 0) {
    page1.drawText("No diagnoses entered.", { x: 36, y, size: 9.5, font, color: text });
    y -= 13;
  } else {
    form.diagnosisRows.slice(0, 8).forEach((row) => {
      page1.drawText(row.diagnosisType, { x: 36, y, size: 9.2, font, color: text, maxWidth: 62 });
      page1.drawText(row.diagnosisName, { x: 108, y, size: 9.2, font, color: text, maxWidth: 340 });
      page1.drawText(row.diagnosisCode ?? "-", { x: 458, y, size: 9.2, font, color: text, maxWidth: 116 });
      y -= 12;
    });
  }

  y -= 10;
  page1.drawText("Allergies", { x: 36, y, size: 11, font: fontBold, color: blue });
  y -= 14;
  page1.drawText("Group", { x: 36, y, size: 9.5, font: fontBold, color: text });
  page1.drawText("Allergy", { x: 118, y, size: 9.5, font: fontBold, color: text });
  page1.drawText("Severity", { x: 376, y, size: 9.5, font: fontBold, color: text });
  page1.drawText("Comments", { x: 452, y, size: 9.5, font: fontBold, color: text });
  y -= 10;
  page1.drawLine({ start: { x: 36, y }, end: { x: 576, y }, color: rgb(0.75, 0.78, 0.84), thickness: 1 });
  y -= 10;
  if (form.allergyRows.length === 0) {
    page1.drawText("No allergies entered.", { x: 36, y, size: 9.5, font, color: text });
    y -= 13;
  } else {
    form.allergyRows.slice(0, 8).forEach((row) => {
      page1.drawText(row.allergyGroup, { x: 36, y, size: 9.2, font, color: text, maxWidth: 70 });
      page1.drawText(row.allergyName, { x: 118, y, size: 9.2, font, color: text, maxWidth: 250 });
      page1.drawText(row.severity ?? "-", { x: 376, y, size: 9.2, font, color: text, maxWidth: 70 });
      page1.drawText(row.comments ?? "-", { x: 452, y, size: 9.2, font, color: text, maxWidth: 120 });
      y -= 12;
    });
  }

  y -= 12;
  page1.drawText("Medications", { x: 36, y, size: 11, font: fontBold, color: blue });
  y -= 14;
  page1.drawText("Name", { x: 36, y, size: 10, font: fontBold, color: text });
  page1.drawText("Dose", { x: 196, y, size: 10, font: fontBold, color: text });
  page1.drawText("Qty", { x: 272, y, size: 10, font: fontBold, color: text });
  page1.drawText("Form", { x: 316, y, size: 10, font: fontBold, color: text });
  page1.drawText("Route", { x: 388, y, size: 10, font: fontBold, color: text });
  page1.drawText("Frequency", { x: 468, y, size: 10, font: fontBold, color: text });
  y -= 12;
  page1.drawLine({ start: { x: 36, y }, end: { x: 576, y }, color: rgb(0.75, 0.78, 0.84), thickness: 1 });
  y -= 12;

  if (form.medications.length === 0) {
    page1.drawText("No medications entered.", { x: 36, y, size: 10, font, color: text });
    y -= 14;
  } else {
    form.medications.slice(0, 16).forEach((medication) => {
      const routeText = medication.routeLaterality ? `${medication.route ?? "-"} (${medication.routeLaterality})` : (medication.route ?? "-");
      page1.drawText(medication.name, { x: 36, y, size: 8.9, font, color: text, maxWidth: 156 });
      page1.drawText(medication.dose ?? "-", { x: 196, y, size: 8.9, font, color: text, maxWidth: 72 });
      page1.drawText(medication.quantity ?? "-", { x: 272, y, size: 8.9, font, color: text, maxWidth: 40 });
      page1.drawText(medication.form ?? "-", { x: 316, y, size: 8.9, font, color: text, maxWidth: 68 });
      page1.drawText(routeText, { x: 388, y, size: 8.9, font, color: text, maxWidth: 76 });
      page1.drawText(medication.frequency ?? "-", { x: 468, y, size: 8.9, font, color: text, maxWidth: 108 });
      y -= 13;
      if (y < 120) return;
    });
  }

  y -= 8;
  page1.drawText("Standing Orders (as needed medications at center)", { x: 36, y, size: 11, font: fontBold, color: blue });
  y -= 14;
  if (form.standingOrders.length === 0) {
    page1.drawText("No standing orders selected.", { x: 36, y, size: 10, font, color: text });
    y -= 12;
  } else {
    form.standingOrders.forEach((line, idx) => {
      const content = `${idx + 1}. ${line}`;
      y = drawWrappedText({ page: page1, text: content, x: 36, y, maxWidth: 540, lineHeight: 12, font, size: 10, color: text }) ?? y;
      y -= 2;
    });
  }

  const page2 = pdf.addPage([612, 792]);
  let y2 = drawPofHeader({
    page: page2,
    font,
    fontBold,
    textColor: text,
    brandColor: blue,
    logo,
    generatedAt: now
  });
  page2.drawText("Member Care Information", { x: 36, y: y2, size: 15, font: fontBold, color: blue });
  y2 -= 22;
  toKeyValueLines(form).forEach((line) => {
    y2 = drawWrappedText({ page: page2, text: line, x: 36, y: y2, maxWidth: 540, lineHeight: 12, font, size: 10, color: text }) ?? y2;
    y2 -= 5;
  });

  const page3 = pdf.addPage([612, 792]);
  let y3 = drawPofHeader({
    page: page3,
    font,
    fontBold,
    textColor: text,
    brandColor: blue,
    logo,
    generatedAt: now
  });
  page3.drawText("Provider Signature & Audit", { x: 36, y: y3, size: 15, font: fontBold, color: blue });
  y3 -= 22;
  const auditLines = [
    `Provider Name: ${form.providerName ?? "-"}`,
    `Provider Signature: ${form.providerSignature ?? "-"}`,
    `Provider Signature Date: ${form.providerSignatureDate ?? "-"}`,
    `Status: ${form.status}`,
    `Provider Signature Status: ${form.providerSignatureStatus}`,
    `Created By: ${form.createdByName}`,
    `Created Date: ${form.createdAt}`,
    `Completed By: ${form.completedByName ?? "-"}`,
    `Completed Date: ${form.completedDate ?? "-"}`,
    `Signed By: ${form.signedBy ?? "-"}`,
    `Signed Date: ${form.signedDate ?? "-"}`,
    `Last Updated By: ${form.updatedByName ?? "-"}`,
    `Last Updated At: ${form.updatedAt}`,
    `PDF Generated At: ${now}`
  ];
  auditLines.forEach((line) => {
    y3 = drawWrappedText({ page: page3, text: line, x: 36, y: y3, maxWidth: 540, lineHeight: 13, font, size: 10.5, color: text }) ?? y3;
    y3 -= 4;
  });

  const bytes = await pdf.save();
  const dataUrl = `data:application/pdf;base64,${Buffer.from(bytes).toString("base64")}`;
  const baseFileName = `POF - ${safeFileName(memberName)} - ${toEasternDate(now)}.pdf`;
  const db = getMockDb();
  const duplicate = db.memberFiles.some(
    (row) => row.member_id === form.memberId && row.file_name.toLowerCase() === baseFileName.toLowerCase()
  );
  const fileName = duplicate ? withDuplicateSuffix(baseFileName, now) : baseFileName;

  return { form, fileName, dataUrl, generatedAt: now };
}
