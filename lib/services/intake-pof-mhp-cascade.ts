import { createClient } from "@/lib/supabase/server";
import { calculateAssessmentTotal, getAssessmentTrack } from "@/lib/assessment";

import { type IntakeAssessmentForPofPrefill } from "@/lib/services/intake-to-pof-mapping";
import {
  createDraftPhysicianOrderFromAssessment,
  getActivePhysicianOrderForMember,
  getMemberHealthProfile,
  signPhysicianOrder,
  syncMemberHealthProfileFromSignedPhysicianOrder,
  updatePhysicianOrder
} from "@/lib/services/physician-orders-supabase";
import { toEasternISO } from "@/lib/timezone";

export async function createIntakeAssessment(input: {
  payload: {
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
  actor: { id: string; fullName: string; signoffName: string };
}) {
  const supabase = await createClient();
  const totalScore = calculateAssessmentTotal({
    orientationGeneralHealth: input.payload.scoreOrientationGeneralHealth,
    dailyRoutinesIndependence: input.payload.scoreDailyRoutinesIndependence,
    nutritionDietaryNeeds: input.payload.scoreNutritionDietaryNeeds,
    mobilitySafety: input.payload.scoreMobilitySafety,
    socialEmotionalWellness: input.payload.scoreSocialEmotionalWellness
  });
  const { recommendedTrack, admissionReviewRequired } = getAssessmentTrack(totalScore);
  const now = toEasternISO();

  const insertPayload = {
    member_id: input.payload.memberId,
    lead_id: input.payload.leadId ?? null,
    assessment_date: input.payload.assessmentDate,
    status: input.payload.complete ? "completed" : "draft",
    completed_by_user_id: input.actor.id,
    completed_by: input.actor.signoffName,
    signed_by: input.actor.signoffName,
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

  const { data, error } = await supabase.from("intake_assessments").insert(insertPayload).select("*").single();
  if (error) throw new Error(error.message);
  return data;
}

export async function autoCreateDraftPhysicianOrderFromIntake(input: {
  assessment: IntakeAssessmentForPofPrefill;
  actor: { id: string; fullName: string; signoffName?: string | null };
}) {
  return createDraftPhysicianOrderFromAssessment(input);
}

export { updatePhysicianOrder, signPhysicianOrder, syncMemberHealthProfileFromSignedPhysicianOrder, getActivePhysicianOrderForMember, getMemberHealthProfile };
