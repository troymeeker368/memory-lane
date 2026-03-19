import type { EnrollmentPacketIntakePayload } from "@/lib/services/enrollment-packet-intake-payload";

type StringLikePayloadKey = {
  [K in keyof EnrollmentPacketIntakePayload]: EnrollmentPacketIntakePayload[K] extends string | null | undefined ? K : never;
}[keyof EnrollmentPacketIntakePayload];

export type StringMap = {
  sourceField: StringLikePayloadKey;
  targetField: string;
};

export const ENROLLMENT_PACKET_MAPPING_MEMBER_SELECT =
  "id, preferred_name, legal_first_name, legal_last_name, dob, enrollment_date, ssn_last4, updated_at";

export const MEMBER_STRING_MAP: StringMap[] = [
  { sourceField: "memberLegalFirstName", targetField: "legal_first_name" },
  { sourceField: "memberLegalLastName", targetField: "legal_last_name" },
  { sourceField: "memberPreferredName", targetField: "preferred_name" },
  { sourceField: "memberSsnLast4", targetField: "ssn_last4" },
  { sourceField: "memberDob", targetField: "dob" },
  { sourceField: "requestedStartDate", targetField: "enrollment_date" }
];

export const MCC_STRING_MAP: StringMap[] = [
  { sourceField: "maritalStatus", targetField: "marital_status" },
  { sourceField: "memberAddressLine1", targetField: "street_address" },
  { sourceField: "memberCity", targetField: "city" },
  { sourceField: "memberState", targetField: "state" },
  { sourceField: "memberZip", targetField: "zip" },
  { sourceField: "guardianPoaStatus", targetField: "guardian_poa_status" },
  { sourceField: "guardianPoaStatus", targetField: "power_of_attorney" },
  { sourceField: "referredBy", targetField: "original_referral_source" },
  { sourceField: "pcpName", targetField: "pcp_name" },
  { sourceField: "pcpPhone", targetField: "pcp_phone" },
  { sourceField: "pcpFax", targetField: "pcp_fax" },
  { sourceField: "pcpAddress", targetField: "pcp_address" },
  { sourceField: "pharmacy", targetField: "pharmacy" },
  { sourceField: "livingSituation", targetField: "living_situation" },
  { sourceField: "insuranceSummaryReference", targetField: "insurance_summary_reference" },
  { sourceField: "branchOfService", targetField: "veteran_branch" }
];

export const MHP_STRING_MAP: StringMap[] = [
  { sourceField: "pcpName", targetField: "provider_name" },
  { sourceField: "pcpPhone", targetField: "provider_phone" },
  { sourceField: "hospitalPreference", targetField: "hospital_preference" },
  { sourceField: "dietaryRestrictions", targetField: "dietary_restrictions" },
  { sourceField: "oxygenUse", targetField: "oxygen_use" },
  { sourceField: "memoryStage", targetField: "memory_severity" },
  { sourceField: "fallsHistory", targetField: "falls_history" },
  { sourceField: "physicalHealthProblems", targetField: "physical_health_problems" },
  { sourceField: "behavioralNotes", targetField: "cognitive_behavior_comments" },
  { sourceField: "communicationStyle", targetField: "communication_style" },
  { sourceField: "adlMobilityLevel", targetField: "ambulation" },
  { sourceField: "adlTransferLevel", targetField: "transferring" },
  { sourceField: "toiletingBathingAssistance", targetField: "bathing" },
  { sourceField: "toiletingBathingAssistance", targetField: "toileting" },
  { sourceField: "continenceStatus", targetField: "bladder_continence" },
  { sourceField: "continenceStatus", targetField: "bowel_continence" },
  { sourceField: "incontinenceProducts", targetField: "incontinence_products" },
  { sourceField: "hearingStatus", targetField: "hearing" },
  { sourceField: "dressingFeedingIndependence", targetField: "dressing" },
  { sourceField: "dressingFeedingIndependence", targetField: "eating" },
  { sourceField: "dentures", targetField: "dental" },
  { sourceField: "speechHearingVision", targetField: "speech_comments" },
  { sourceField: "glassesHearingAidsCataracts", targetField: "glasses_hearing_aids_cataracts" },
  { sourceField: "intakeClinicalNotes", targetField: "intake_notes" }
];

export function buildDefaultCommandCenterSnapshot(memberId: string): Record<string, unknown> {
  return {
    id: `mcc-${memberId}`,
    member_id: memberId,
    gender: null,
    marital_status: null,
    street_address: null,
    city: null,
    state: null,
    zip: null,
    guardian_poa_status: null,
    power_of_attorney: null,
    original_referral_source: null,
    pcp_name: null,
    pcp_phone: null,
    pcp_fax: null,
    pcp_address: null,
    pharmacy: null,
    living_situation: null,
    insurance_summary_reference: null,
    veteran_branch: null,
    is_veteran: null,
    photo_consent: null
  };
}

export function buildDefaultAttendanceScheduleSnapshot(memberId: string, enrollmentDate: string | null): Record<string, unknown> {
  return {
    id: `attendance-${memberId}`,
    member_id: memberId,
    enrollment_date: enrollmentDate,
    monday: false,
    tuesday: false,
    wednesday: false,
    thursday: false,
    friday: false,
    transportation_required: null,
    transportation_mode: null,
    daily_rate: null,
    attendance_days_per_week: 0
  };
}

export function buildDefaultMhpSnapshot(): Record<string, unknown> {
  return {
    provider_name: null,
    provider_phone: null,
    hospital_preference: null,
    dietary_restrictions: null,
    oxygen_use: null,
    memory_severity: null,
    falls_history: null,
    physical_health_problems: null,
    cognitive_behavior_comments: null,
    communication_style: null,
    ambulation: null,
    transferring: null,
    bathing: null,
    toileting: null,
    bladder_continence: null,
    bowel_continence: null,
    incontinence_products: null,
    hearing: null,
    dressing: null,
    eating: null,
    dental: null,
    speech_comments: null,
    glasses_hearing_aids_cataracts: null,
    intake_notes: null,
    mental_health_history: null,
    mobility_aids: null,
    wandering: null,
    combative_disruptive: null,
    disorientation: null,
    agitation_resistive: null,
    sleep_issues: null
  };
}
