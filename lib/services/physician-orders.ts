import "server-only";

import { Buffer } from "node:buffer";

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { getMockDb } from "@/lib/mock-repo";
import { readMockStateJson, writeMockStateJson } from "@/lib/mock-persistence";
import { getMemberCommandCenterDetail } from "@/lib/services/member-command-center";
import { getMemberHealthProfileDetail } from "@/lib/services/member-health-profiles";
import { toEasternDate, toEasternISO } from "@/lib/timezone";

export const POF_LEVEL_OF_CARE_OPTIONS = ["Home", "SNF", "MCU", "ALF", "ILF"] as const;
export const POF_NUTRITION_OPTIONS = [
  "Regular",
  "Soft",
  "Cardiac",
  "Diabetic",
  "Low sodium",
  "Renal",
  "Bland",
  "Puree",
  "Low residue",
  "Consistent Carb",
  "Other"
] as const;

export type PhysicianOrderStatus = "Draft" | "Completed" | "Signed";
export type ProviderSignatureStatus = "Pending" | "Signed";

export interface PhysicianOrderMedication {
  id: string;
  name: string;
  dose: string | null;
  route: string | null;
  frequency: string | null;
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
  diagnoses: string[];
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
  signedBy: string | null;
  signedDate: string | null;
  updatedByUserId: string | null;
  updatedByName: string | null;
  updatedAt: string;
}

interface PersistedPhysicianOrderState {
  version: 1;
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
  signedDate: string | null;
  updatedAt: string;
}

export interface PhysicianOrderSaveInput {
  id?: string | null;
  memberId: string;
  sex: "M" | "F" | null;
  levelOfCare: (typeof POF_LEVEL_OF_CARE_OPTIONS)[number] | null;
  dnrSelected: boolean;
  vitalsBloodPressure: string | null;
  vitalsPulse: string | null;
  vitalsOxygenSaturation: string | null;
  vitalsRespiration: string | null;
  diagnoses: string[];
  allergies: string[];
  medications: PhysicianOrderMedication[];
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

const STANDARD_STANDING_ORDERS = [
  "Tylenol 650mg by mouth every 4 hrs for pain/fever",
  "Ibuprofen 200mg by mouth every 8 hrs for pain",
  "Mylanta 10mL by mouth every 4 hrs for indigestion",
  "Benadryl 25mg by mouth every 6 hrs for itching"
] as const;

function clean(value: string | null | undefined) {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function sanitizeList(values: Array<string | null | undefined>) {
  return values.map((value) => clean(value)).filter((value): value is string => Boolean(value));
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
    joySparksNotes: null
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
  dnr: boolean;
  diagnoses: string[];
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

  const diagnoses = sanitizeList((mhp?.diagnoses ?? []).slice(0, 12).map((row) => row.diagnosis_name));
  const allergiesFromRows = sanitizeList(
    (mhp?.allergies ?? []).map((row) => {
      const name = clean(row.allergy_name);
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
      route: clean(row.route),
      frequency: clean(row.frequency)
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
    joySparksNotes: clean(member.joy_sparks) ?? clean(member.personal_notes)
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

  return { member, sex, dnr, diagnoses, allergies, medications, careInformation, operationalFlags, levelOfCare: "Home" as const };
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
      memberDobSnapshot: member.dob,
      sex: prefill?.sex ?? null,
      levelOfCare: prefill?.levelOfCare ?? "Home",
      dnrSelected: prefill?.dnr ?? false,
      vitalsBloodPressure: "120/80",
      vitalsPulse: "72",
      vitalsOxygenSaturation: "98",
      vitalsRespiration: "16",
      diagnoses: prefill?.diagnoses ?? [],
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
      signedBy: signedDate ? nurse.full_name : null,
      signedDate,
      updatedByUserId: nurse.id,
      updatedByName: nurse.full_name,
      updatedAt: createdAt
    };
  });
}

function readPersistedState(): PersistedPhysicianOrderState {
  const seeded = buildSeedForms();
  const fallback: PersistedPhysicianOrderState = {
    version: 1,
    counter: 9000 + seeded.length,
    forms: seeded
  };
  const candidate = readMockStateJson<PersistedPhysicianOrderState | null>(POF_STATE_FILE, null);
  if (!candidate || candidate.version !== 1 || !Array.isArray(candidate.forms)) {
    return fallback;
  }

  const normalizedForms = candidate.forms.map((row) => {
    const raw = row as PhysicianOrderForm & { vitalsTemperature?: string | null };
    return {
      ...row,
      vitalsOxygenSaturation:
        clean(raw.vitalsOxygenSaturation) ??
        clean(raw.vitalsTemperature) ??
        null
    } satisfies PhysicianOrderForm;
  });

  return {
    version: 1,
    counter: Number.isFinite(candidate.counter) ? candidate.counter : fallback.counter,
    forms: normalizedForms
  };
}

const initialState = readPersistedState();
let pofCounter = initialState.counter;
let pofForms: PhysicianOrderForm[] = initialState.forms;

function persistState() {
  writeMockStateJson<PersistedPhysicianOrderState>(POF_STATE_FILE, {
    version: 1,
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

export function buildNewPhysicianOrderDraft(input: {
  memberId: string;
  actor: { id: string; fullName: string };
}): PhysicianOrderForm | null {
  const prefill = buildPrefillFromMember(input.memberId);
  if (!prefill) return null;

  const now = toEasternISO();

  return {
    id: "",
    memberId: prefill.member.id,
    memberNameSnapshot: prefill.member.display_name,
    memberDobSnapshot: prefill.member.dob,
    sex: prefill.sex,
    levelOfCare: prefill.levelOfCare,
    dnrSelected: prefill.dnr,
    vitalsBloodPressure: null,
    vitalsPulse: null,
    vitalsOxygenSaturation: null,
    vitalsRespiration: null,
    diagnoses: prefill.diagnoses,
    allergies: prefill.allergies,
    medications: prefill.medications,
    standingOrders: [...STANDARD_STANDING_ORDERS],
    careInformation: prefill.careInformation,
    operationalFlags: prefill.operationalFlags,
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
        diagnoses: [],
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
        signedBy: null,
        signedDate: null,
        updatedByUserId: null,
        updatedByName: null,
        updatedAt: now
      };

  const normalizedMeds = input.medications
    .map((row, idx) => ({
      id: row.id || `${base.id || "pof"}-med-${idx + 1}`,
      name: row.name.trim(),
      dose: clean(row.dose),
      route: clean(row.route),
      frequency: clean(row.frequency)
    }))
    .filter((row) => row.name.length > 0);

  base.memberId = member.id;
  base.memberNameSnapshot = member.display_name;
  base.memberDobSnapshot = member.dob;
  base.sex = input.sex;
  base.levelOfCare = input.levelOfCare;
  base.dnrSelected = input.dnrSelected;
  base.vitalsBloodPressure = clean(input.vitalsBloodPressure);
  base.vitalsPulse = clean(input.vitalsPulse);
  base.vitalsOxygenSaturation = clean(input.vitalsOxygenSaturation);
  base.vitalsRespiration = clean(input.vitalsRespiration);
  base.diagnoses = sanitizeList(input.diagnoses);
  base.allergies = sanitizeList(input.allergies);
  base.medications = normalizedMeds;
  base.standingOrders = [...STANDARD_STANDING_ORDERS];
  base.careInformation = {
    ...defaultCareInformation(),
    ...input.careInformation,
    nutritionDiets: input.careInformation.nutritionDiets.length > 0 ? input.careInformation.nutritionDiets : ["Regular"],
    nutritionDietOther: clean(input.careInformation.nutritionDietOther),
    joySparksNotes: clean(input.careInformation.joySparksNotes),
    mobilityOtherText: clean(input.careInformation.mobilityOtherText),
    skinOther: clean(input.careInformation.skinOther),
    breathingOxygenLiters: clean(input.careInformation.breathingOxygenLiters)
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
  }

  if (input.status === "Signed") {
    base.providerSignatureStatus = "Signed";
    base.signedBy = clean(base.providerName) ?? input.actor.fullName;
    base.signedDate = clean(base.providerSignatureDate) ?? today;
  } else if (base.providerSignatureStatus !== "Signed") {
    base.signedBy = null;
    base.signedDate = null;
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
    `Operational Flags: Nut ${yesNo(flags.nutAllergy)}, Shellfish ${yesNo(flags.shellfishAllergy)}, Fish ${yesNo(flags.fishAllergy)}, Diabetic/Restricted Sweets ${yesNo(flags.diabeticRestrictedSweets)}, Oxygen ${yesNo(flags.oxygenRequirement)}, DNR ${yesNo(flags.dnr)}, No Photos ${yesNo(flags.noPhotos)}, Bathroom Assistance ${yesNo(flags.bathroomAssistance)}`,
    `Joy Sparks / Additional Notes: ${care.joySparksNotes ?? "-"}`
  ];
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

  const page1 = pdf.addPage([612, 792]);
  let y = 754;
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
  const diagnosesText = form.diagnoses.length > 0 ? form.diagnoses.map((line, idx) => `${idx + 1}. ${line}`).join(" | ") : "-";
  y = drawWrappedText({ page: page1, text: diagnosesText, x: 36, y, maxWidth: 540, lineHeight: 13, font, size: 10.5, color: text }) ?? y;

  y -= 10;
  page1.drawText("Allergies", { x: 36, y, size: 11, font: fontBold, color: blue });
  y -= 14;
  const allergiesText = form.allergies.length > 0 ? form.allergies.join(" | ") : "-";
  y = drawWrappedText({ page: page1, text: allergiesText, x: 36, y, maxWidth: 540, lineHeight: 13, font, size: 10.5, color: text }) ?? y;

  y -= 12;
  page1.drawText("Medications", { x: 36, y, size: 11, font: fontBold, color: blue });
  y -= 14;
  page1.drawText("Name", { x: 36, y, size: 10, font: fontBold, color: text });
  page1.drawText("Dose", { x: 262, y, size: 10, font: fontBold, color: text });
  page1.drawText("Route", { x: 360, y, size: 10, font: fontBold, color: text });
  page1.drawText("Frequency", { x: 450, y, size: 10, font: fontBold, color: text });
  y -= 12;
  page1.drawLine({ start: { x: 36, y }, end: { x: 576, y }, color: rgb(0.75, 0.78, 0.84), thickness: 1 });
  y -= 12;

  if (form.medications.length === 0) {
    page1.drawText("No medications entered.", { x: 36, y, size: 10, font, color: text });
    y -= 14;
  } else {
    form.medications.slice(0, 16).forEach((medication) => {
      page1.drawText(medication.name, { x: 36, y, size: 9.5, font, color: text, maxWidth: 220 });
      page1.drawText(medication.dose ?? "-", { x: 262, y, size: 9.5, font, color: text, maxWidth: 90 });
      page1.drawText(medication.route ?? "-", { x: 360, y, size: 9.5, font, color: text, maxWidth: 80 });
      page1.drawText(medication.frequency ?? "-", { x: 450, y, size: 9.5, font, color: text, maxWidth: 120 });
      y -= 13;
      if (y < 120) return;
    });
  }

  y -= 8;
  page1.drawText("Standing Orders (as needed medications at center)", { x: 36, y, size: 11, font: fontBold, color: blue });
  y -= 14;
  form.standingOrders.forEach((line, idx) => {
    const content = `${idx + 1}. ${line}`;
    y = drawWrappedText({ page: page1, text: content, x: 36, y, maxWidth: 540, lineHeight: 12, font, size: 10, color: text }) ?? y;
    y -= 2;
  });

  const page2 = pdf.addPage([612, 792]);
  let y2 = 754;
  page2.drawText("Member Care Information", { x: 36, y: y2, size: 15, font: fontBold, color: blue });
  y2 -= 22;
  toKeyValueLines(form).forEach((line) => {
    y2 = drawWrappedText({ page: page2, text: line, x: 36, y: y2, maxWidth: 540, lineHeight: 12, font, size: 10, color: text }) ?? y2;
    y2 -= 5;
  });

  const page3 = pdf.addPage([612, 792]);
  let y3 = 754;
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
