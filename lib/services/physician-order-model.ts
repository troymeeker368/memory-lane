import {
  POF_ALLERGY_GROUP_OPTIONS,
  POF_LEVEL_OF_CARE_OPTIONS
} from "@/lib/services/physician-order-config";
import type {
  PhysicianOrderClinicalSyncDetail,
  PhysicianOrderClinicalSyncStatus
} from "@/lib/services/physician-order-clinical-sync";

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
  clinicalSyncDetail: PhysicianOrderClinicalSyncDetail | null;
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
  clinicalSyncDetail: PhysicianOrderClinicalSyncDetail | null;
  updatedAt: string;
}

export interface PhysicianOrderMemberHistoryRow {
  id: string;
  memberId: string;
  memberNameSnapshot: string;
  status: PhysicianOrderStatus;
  providerName: string | null;
  completedDate: string | null;
  nextRenewalDueDate: string | null;
  signedDate: string | null;
  clinicalSyncStatus: PhysicianOrderClinicalSyncStatus;
  clinicalSyncDetail: PhysicianOrderClinicalSyncDetail | null;
  updatedByName: string | null;
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

export function defaultAdlProfile(): PhysicianOrderAdlProfile {
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

export function defaultOrientationProfile(): PhysicianOrderOrientationProfile {
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

export function defaultCareInformation(): PhysicianOrderCareInformation {
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

export function defaultOperationalFlags(): PhysicianOrderOperationalFlags {
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
