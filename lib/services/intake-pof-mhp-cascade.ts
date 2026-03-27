import { createClient } from "@/lib/supabase/server";
import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";
import { calculateAssessmentTotal, getAssessmentTrack } from "@/lib/assessment";

import { type IntakeAssessmentForPofPrefill } from "@/lib/services/intake-to-pof-mapping";
import {
  CommittedDraftPhysicianOrderReloadError,
  createDraftPhysicianOrderFromAssessment,
  signPhysicianOrder,
  syncMemberHealthProfileFromSignedPhysicianOrder,
  updatePhysicianOrder
} from "@/lib/services/physician-orders-supabase";
import { getActivePhysicianOrderForMember, getMemberHealthProfile } from "@/lib/services/physician-orders-read";
import { requireSignedIntakeAssessment } from "@/lib/services/intake-assessment-esign";
import { recordWorkflowEvent } from "@/lib/services/workflow-observability";
import { toEasternISO } from "@/lib/timezone";

export type CreateIntakeAssessmentPayload = {
  memberId: string;
  leadId?: string | null;
  assessmentDate: string;
  complete: boolean;
  feelingToday: string;
  healthLately: string;
  allergies: string;
  codeStatus: string;
  orientationDobVerified: boolean;
  orientationCityVerified: boolean;
  orientationYearVerified: boolean;
  orientationOccupationVerified: boolean;
  orientationNotes?: string;
  medicationManagementStatus: string;
  dressingSupportStatus: string;
  assistiveDevices?: string;
  incontinenceProducts?: string;
  onSiteMedicationUse?: string;
  onSiteMedicationList?: string;
  independenceNotes?: string;
  dietType: string;
  dietOther?: string;
  dietRestrictionsNotes?: string;
  mobilitySteadiness: string;
  fallsHistory?: string;
  mobilityAids?: string;
  mobilitySafetyNotes?: string;
  overwhelmedByNoise: boolean;
  socialTriggers?: string;
  emotionalWellnessNotes?: string;
  joySparks?: string;
  personalNotes?: string;
  scoreOrientationGeneralHealth: 15 | 10 | 5;
  scoreDailyRoutinesIndependence: 15 | 10 | 5;
  scoreNutritionDietaryNeeds: 15 | 10 | 5;
  scoreMobilitySafety: 15 | 10 | 5;
  scoreSocialEmotionalWellness: 15 | 10 | 5;
  transportCanEnterExitVehicle: string;
  transportAssistanceLevel: string;
  transportMobilityAid?: string;
  transportCanRemainSeatedBuckled: boolean;
  transportBehaviorConcern?: string;
  transportAppropriate: boolean;
  transportNotes?: string;
  vitalsHr: number;
  vitalsBp: string;
  vitalsO2Percent: number;
  vitalsRr: number;
  notes?: string;
};

const CREATE_INTAKE_ASSESSMENT_RPC = "rpc_create_intake_assessment_with_responses";
const CREATE_INTAKE_ASSESSMENT_MIGRATION = "0051_intake_assessment_atomic_creation_rpc.sql";

function isMissingRpcFunctionError(error: unknown, rpcName: string) {
  if (!error || typeof error !== "object") return false;
  const errorWithCause = error as {
    code?: string | null;
    message?: string | null;
    details?: string | null;
    hint?: string | null;
    cause?: {
      code?: string | null;
      message?: string | null;
      details?: string | null;
      hint?: string | null;
    } | null;
  };
  const code = String(errorWithCause.code ?? errorWithCause.cause?.code ?? "").toUpperCase();
  const message = [
    errorWithCause.message,
    errorWithCause.details,
    errorWithCause.hint,
    errorWithCause.cause?.message,
    errorWithCause.cause?.details,
    errorWithCause.cause?.hint
  ]
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase();
  const normalizedName = rpcName.toLowerCase();

  return (
    code === "PGRST202" ||
    code === "42883" ||
    message.includes(`function ${normalizedName}`) ||
    (message.includes(normalizedName) && message.includes("could not find")) ||
    (message.includes(normalizedName) && message.includes("does not exist")) ||
    (message.includes(normalizedName) && message.includes("schema cache"))
  );
}

function buildAssessmentResponseRows(input: {
  assessmentId: string;
  memberId: string;
  createdAt: string;
  values: Record<string, unknown>;
}) {
  const definition: Array<{ key: string; label: string; section: string; valueType?: "string" | "boolean" | "number" | "date" }> = [
    { key: "leadId", label: "Linked Lead ID", section: "Lead Intake Context" },
    { key: "leadStage", label: "Lead Stage at Assessment", section: "Lead Intake Context" },
    { key: "leadStatus", label: "Lead Status at Assessment", section: "Lead Intake Context" },
    { key: "feelingToday", label: "How Member Is Feeling Today", section: "Orientation & General Health" },
    { key: "healthLately", label: "Health Lately", section: "Orientation & General Health" },
    { key: "allergies", label: "Allergies", section: "Orientation & General Health" },
    { key: "codeStatus", label: "Code Status", section: "Orientation & General Health" },
    { key: "orientationDobVerified", label: "Orientation DOB Verified", section: "Orientation & General Health", valueType: "boolean" },
    { key: "orientationCityVerified", label: "Orientation City Verified", section: "Orientation & General Health", valueType: "boolean" },
    { key: "orientationYearVerified", label: "Orientation Current Year Verified", section: "Orientation & General Health", valueType: "boolean" },
    { key: "orientationOccupationVerified", label: "Orientation Former Occupation Verified", section: "Orientation & General Health", valueType: "boolean" },
    { key: "medicationManagementStatus", label: "Medication Management", section: "Independence & Daily Routines" },
    { key: "dressingSupportStatus", label: "Dressing Support", section: "Independence & Daily Routines" },
    { key: "assistiveDevices", label: "Assistive Devices", section: "Independence & Daily Routines" },
    { key: "incontinenceProducts", label: "Incontinence Products", section: "Independence & Daily Routines" },
    { key: "onSiteMedicationUse", label: "On-site Medication Use", section: "Independence & Daily Routines" },
    { key: "onSiteMedicationList", label: "On-site Medication List", section: "Independence & Daily Routines" },
    { key: "dietType", label: "Diet Type", section: "Diet & Nutrition" },
    { key: "dietOther", label: "Diet Other", section: "Diet & Nutrition" },
    { key: "dietRestrictionsNotes", label: "Diet Notes", section: "Diet & Nutrition" },
    { key: "mobilitySteadiness", label: "Steadiness / Mobility", section: "Mobility & Safety" },
    { key: "fallsHistory", label: "Falls History", section: "Mobility & Safety" },
    { key: "mobilityAids", label: "Mobility Aids", section: "Mobility & Safety" },
    { key: "mobilitySafetyNotes", label: "Mobility / Safety Notes", section: "Mobility & Safety" },
    { key: "overwhelmedByNoise", label: "Overwhelmed by Noise/Busyness", section: "Social Engagement & Emotional Wellness", valueType: "boolean" },
    { key: "socialTriggers", label: "Known Triggers", section: "Social Engagement & Emotional Wellness" },
    { key: "emotionalWellnessNotes", label: "Emotional Wellness Notes", section: "Social Engagement & Emotional Wellness" },
    { key: "joySparks", label: "Joy Sparks", section: "Personal Notes & Joy Sparks" },
    { key: "personalNotes", label: "Personal Notes", section: "Personal Notes & Joy Sparks" },
    { key: "scoreOrientationGeneralHealth", label: "Orientation & General Health Score", section: "Scoring", valueType: "number" },
    { key: "scoreDailyRoutinesIndependence", label: "Daily Routines & Independence Score", section: "Scoring", valueType: "number" },
    { key: "scoreNutritionDietaryNeeds", label: "Nutrition & Dietary Needs Score", section: "Scoring", valueType: "number" },
    { key: "scoreMobilitySafety", label: "Mobility & Safety Score", section: "Scoring", valueType: "number" },
    { key: "scoreSocialEmotionalWellness", label: "Social & Emotional Wellness Score", section: "Scoring", valueType: "number" },
    { key: "totalScore", label: "Total Score", section: "Scoring", valueType: "number" },
    { key: "recommendedTrack", label: "Recommended Track", section: "Scoring" },
    { key: "admissionReviewRequired", label: "Admission Review Required", section: "Scoring", valueType: "boolean" },
    { key: "transportCanEnterExitVehicle", label: "Can Enter/Exit Vehicle", section: "Transportation Screening" },
    { key: "transportAssistanceLevel", label: "Transport Assistance Level", section: "Transportation Screening" },
    { key: "transportMobilityAid", label: "Transport Mobility Aid", section: "Transportation Screening" },
    { key: "transportCanRemainSeatedBuckled", label: "Can Remain Seated and Buckled", section: "Transportation Screening", valueType: "boolean" },
    { key: "transportBehaviorConcern", label: "Transport Behavior Concern", section: "Transportation Screening" },
    { key: "transportAppropriate", label: "Appropriate for Center Transportation", section: "Transportation Screening", valueType: "boolean" },
    { key: "vitalsHr", label: "HR", section: "Vital Signs", valueType: "number" },
    { key: "vitalsBp", label: "BP", section: "Vital Signs" },
    { key: "vitalsO2Percent", label: "O2 %", section: "Vital Signs", valueType: "number" },
    { key: "vitalsRr", label: "RR", section: "Vital Signs", valueType: "number" }
  ];

  return definition.map((entry) => {
    const raw = input.values[entry.key];
    const inferredType = entry.valueType ?? (typeof raw === "boolean" ? "boolean" : typeof raw === "number" ? "number" : "string");
    return {
      assessment_id: input.assessmentId,
      member_id: input.memberId,
      field_key: entry.key,
      field_label: entry.label,
      section_type: entry.section,
      field_value: raw == null ? "" : String(raw),
      field_value_type: inferredType,
      created_at: input.createdAt
    };
  });
}

function buildIntakeAssessmentInsertPayload(input: {
  payload: CreateIntakeAssessmentPayload;
  actor: { id: string; fullName: string; signoffName: string };
}) {
  const totalScore = calculateAssessmentTotal({
    orientationGeneralHealth: input.payload.scoreOrientationGeneralHealth,
    dailyRoutinesIndependence: input.payload.scoreDailyRoutinesIndependence,
    nutritionDietaryNeeds: input.payload.scoreNutritionDietaryNeeds,
    mobilitySafety: input.payload.scoreMobilitySafety,
    socialEmotionalWellness: input.payload.scoreSocialEmotionalWellness
  });
  const { recommendedTrack, admissionReviewRequired } = getAssessmentTrack(totalScore);
  const now = toEasternISO();

  return {
    member_id: input.payload.memberId,
    lead_id: input.payload.leadId ?? null,
    assessment_date: input.payload.assessmentDate,
    status: input.payload.complete ? "completed" : "draft",
    completed_by_user_id: input.actor.id,
    completed_by: input.actor.signoffName,
    signed_by: null,
    signed_by_user_id: null,
    signed_at: null,
    signature_status: "unsigned",
    signature_metadata: {},
    draft_pof_status: "pending",
    draft_pof_attempted_at: null,
    draft_pof_error: null,
    complete: input.payload.complete,
    feeling_today: input.payload.feelingToday,
    health_lately: input.payload.healthLately,
    allergies: input.payload.allergies,
    code_status: input.payload.codeStatus,
    orientation_dob_verified: input.payload.orientationDobVerified,
    orientation_city_verified: input.payload.orientationCityVerified,
    orientation_year_verified: input.payload.orientationYearVerified,
    orientation_occupation_verified: input.payload.orientationOccupationVerified,
    orientation_notes: input.payload.orientationNotes ?? "",
    medication_management_status: input.payload.medicationManagementStatus,
    dressing_support_status: input.payload.dressingSupportStatus,
    assistive_devices: input.payload.assistiveDevices ?? "",
    incontinence_products: input.payload.incontinenceProducts ?? "",
    on_site_medication_use: input.payload.onSiteMedicationUse ?? "",
    on_site_medication_list: input.payload.onSiteMedicationList ?? "",
    independence_notes: input.payload.independenceNotes ?? "",
    diet_type: input.payload.dietType,
    diet_other: input.payload.dietOther ?? "",
    diet_restrictions_notes: input.payload.dietRestrictionsNotes ?? "",
    mobility_steadiness: input.payload.mobilitySteadiness,
    falls_history: input.payload.fallsHistory ?? "",
    mobility_aids: input.payload.mobilityAids ?? "",
    mobility_safety_notes: input.payload.mobilitySafetyNotes ?? "",
    overwhelmed_by_noise: input.payload.overwhelmedByNoise,
    social_triggers: input.payload.socialTriggers ?? "",
    emotional_wellness_notes: input.payload.emotionalWellnessNotes ?? "",
    joy_sparks: input.payload.joySparks ?? "",
    personal_notes: input.payload.personalNotes ?? "",
    score_orientation_general_health: input.payload.scoreOrientationGeneralHealth,
    score_daily_routines_independence: input.payload.scoreDailyRoutinesIndependence,
    score_nutrition_dietary_needs: input.payload.scoreNutritionDietaryNeeds,
    score_mobility_safety: input.payload.scoreMobilitySafety,
    score_social_emotional_wellness: input.payload.scoreSocialEmotionalWellness,
    total_score: totalScore,
    recommended_track: recommendedTrack,
    admission_review_required: admissionReviewRequired,
    transport_can_enter_exit_vehicle: input.payload.transportCanEnterExitVehicle,
    transport_assistance_level: input.payload.transportAssistanceLevel,
    transport_mobility_aid: input.payload.transportMobilityAid ?? "",
    transport_can_remain_seated_buckled: input.payload.transportCanRemainSeatedBuckled,
    transport_behavior_concern: input.payload.transportBehaviorConcern ?? "",
    transport_appropriate: input.payload.transportAppropriate,
    transport_notes: input.payload.transportNotes ?? "",
    vitals_hr: input.payload.vitalsHr,
    vitals_bp: input.payload.vitalsBp,
    vitals_o2_percent: input.payload.vitalsO2Percent,
    vitals_rr: input.payload.vitalsRr,
    notes: input.payload.notes ?? "",
    created_at: now,
    updated_at: now
  };
}

export type IntakeDraftPofStatus = "pending" | "created" | "failed";

export async function updateIntakeAssessmentDraftPofStatus(input: {
  assessmentId: string;
  status: IntakeDraftPofStatus;
  attemptedAt: string;
  error?: string | null;
}) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("intake_assessments")
    .update({
      draft_pof_status: input.status,
      draft_pof_attempted_at: input.attemptedAt,
      draft_pof_error: input.status === "failed" ? String(input.error ?? "").trim() || null : null,
      updated_at: input.attemptedAt
    })
    .eq("id", input.assessmentId);
  if (error) throw new Error(error.message);
}

export async function deleteIntakeAssessmentSupabase(assessmentId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("intake_assessments").delete().eq("id", assessmentId);
  if (error) throw new Error(error.message);
}

export async function createIntakeAssessmentWithResponses(input: {
  payload: CreateIntakeAssessmentPayload;
  actor: { id: string; fullName: string; signoffName: string };
  responseContext?: {
    leadStage?: string | null;
    leadStatus?: string | null;
  };
  serviceRole?: boolean;
}): Promise<IntakeAssessmentForPofPrefill> {
  const insertPayload = buildIntakeAssessmentInsertPayload({
    payload: input.payload,
    actor: input.actor
  });

  const responseRows = buildAssessmentResponseRows({
    assessmentId: "pending-rpc-assessment-id",
    memberId: input.payload.memberId,
    createdAt: String(insertPayload.created_at ?? toEasternISO()),
    values: {
      ...input.payload,
      leadId: input.payload.leadId ?? "",
      leadStage: input.responseContext?.leadStage ?? "",
      leadStatus: input.responseContext?.leadStatus ?? "",
      totalScore: Number(insertPayload.total_score ?? 0),
      recommendedTrack: String(insertPayload.recommended_track ?? ""),
      admissionReviewRequired: Boolean(insertPayload.admission_review_required)
    }
  }).map((row) => ({
    field_key: row.field_key,
    field_label: row.field_label,
    section_type: row.section_type,
    field_value: row.field_value,
    field_value_type: row.field_value_type,
    created_at: row.created_at
  }));

  const supabase = await createClient({ serviceRole: input.serviceRole });
  let rpcData: unknown;
  try {
    rpcData = await invokeSupabaseRpcOrThrow<unknown>(supabase, CREATE_INTAKE_ASSESSMENT_RPC, {
      p_assessment: insertPayload,
      p_response_rows: responseRows
    });
  } catch (error) {
    if (isMissingRpcFunctionError(error, CREATE_INTAKE_ASSESSMENT_RPC)) {
      throw new Error(
        `Intake assessment atomic creation RPC is not available. Apply Supabase migration ${CREATE_INTAKE_ASSESSMENT_MIGRATION} and refresh PostgREST schema cache.`
      );
    }
    throw error;
  }

  const assessment = (Array.isArray(rpcData) ? rpcData[0] : null) as IntakeAssessmentForPofPrefill | null;
  if (!assessment?.id) {
    throw new Error("Intake assessment creation RPC did not return the created assessment row.");
  }

  await recordWorkflowEvent({
    eventType: "intake_assessment_created",
    entityType: "intake_assessment",
    entityId: String(assessment.id),
    actorType: "user",
    actorUserId: input.actor.id,
    status: input.payload.complete ? "completed" : "draft",
    severity: "low",
    metadata: {
      member_id: input.payload.memberId,
      lead_id: input.payload.leadId ?? null,
      assessment_date: input.payload.assessmentDate,
      complete: input.payload.complete
    }
  });

  return assessment;
}

export async function autoCreateDraftPhysicianOrderFromIntake(input: {
  assessment: IntakeAssessmentForPofPrefill;
  actor: { id: string; fullName: string; signoffName?: string | null };
}) {
  const intakeSignature = await requireSignedIntakeAssessment(input.assessment.id);
  return createDraftPhysicianOrderFromAssessment({
    ...input,
    intakeSignature
  });
}

export {
  CommittedDraftPhysicianOrderReloadError,
  updatePhysicianOrder,
  signPhysicianOrder,
  syncMemberHealthProfileFromSignedPhysicianOrder,
  getActivePhysicianOrderForMember,
  getMemberHealthProfile
};
