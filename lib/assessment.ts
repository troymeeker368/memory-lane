export const ASSESSMENT_SCORE_OPTIONS = [15, 10, 5] as const;

export type AssessmentScore = (typeof ASSESSMENT_SCORE_OPTIONS)[number];
export type AssessmentTrack = "Track 1" | "Track 2" | "Track 3" | "Review Required";

export interface IntakeAssessmentScores {
  orientationGeneralHealth: AssessmentScore;
  dailyRoutinesIndependence: AssessmentScore;
  nutritionDietaryNeeds: AssessmentScore;
  mobilitySafety: AssessmentScore;
  socialEmotionalWellness: AssessmentScore;
}

export function calculateAssessmentTotal(scores: IntakeAssessmentScores) {
  return (
    scores.orientationGeneralHealth +
    scores.dailyRoutinesIndependence +
    scores.nutritionDietaryNeeds +
    scores.mobilitySafety +
    scores.socialEmotionalWellness
  );
}

export function getAssessmentTrack(totalScore: number): {
  recommendedTrack: AssessmentTrack;
  admissionReviewRequired: boolean;
} {
  if (totalScore >= 61 && totalScore <= 75) {
    return { recommendedTrack: "Track 1", admissionReviewRequired: false };
  }

  if (totalScore >= 41 && totalScore <= 60) {
    return { recommendedTrack: "Track 2", admissionReviewRequired: false };
  }

  if (totalScore >= 25 && totalScore <= 40) {
    return { recommendedTrack: "Track 3", admissionReviewRequired: false };
  }

  return { recommendedTrack: "Review Required", admissionReviewRequired: true };
}
