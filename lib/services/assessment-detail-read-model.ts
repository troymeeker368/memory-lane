import { createClient } from "@/lib/supabase/server";
import { resolveIntakeDraftPofReadiness, toIntakeDraftPofStatus } from "@/lib/services/intake-draft-pof-readiness";
import { listIntakePostSignFollowUpTasks } from "@/lib/services/intake-post-sign-follow-up";

export async function getAssessmentDetail(assessmentId: string) {
  const supabase = await createClient();
  const { data: assessment, error: assessmentError } = await supabase
    .from("intake_assessments")
    .select("*, member:members!intake_assessments_member_id_fkey(*)")
    .eq("id", assessmentId)
    .maybeSingle();
  if (assessmentError) throw new Error(assessmentError.message);
  if (!assessment) return null;

  const { getIntakeAssessmentSignatureState } = await import("@/lib/services/intake-assessment-esign");
  const signature = await getIntakeAssessmentSignatureState(assessmentId);
  const draftPofStatus = toIntakeDraftPofStatus(assessment.draft_pof_status);
  const draftPofReadinessStatus = resolveIntakeDraftPofReadiness({
    signatureStatus: signature.status,
    draftPofStatus
  });
  const followUpTasks = await listIntakePostSignFollowUpTasks({ assessmentId });
  const { data: responses, error: responsesError } = await supabase
    .from("assessment_responses")
    .select("*")
    .eq("assessment_id", assessmentId)
    .order("section_type", { ascending: true })
    .order("field_label", { ascending: true });
  if (responsesError) throw new Error(responsesError.message);

  return {
    assessment: {
      ...assessment,
      signed_by: signature.signedByName,
      signed_by_user_id: signature.signedByUserId,
      signed_at: signature.signedAt,
      signature_status: signature.status,
      draft_pof_status: draftPofStatus,
      draft_pof_readiness_status: draftPofReadinessStatus,
      draft_pof_ready: draftPofReadinessStatus === "draft_pof_ready",
      draft_pof_attempted_at: assessment.draft_pof_attempted_at ?? null,
      draft_pof_error: assessment.draft_pof_error ?? null,
      signature_metadata: signature.signatureMetadata,
      signature_artifact_storage_path: signature.signatureArtifactStoragePath,
      signature_artifact_member_file_id: signature.signatureArtifactMemberFileId,
      member_name: assessment.member?.display_name ?? "Unknown Member"
    },
    member: assessment.member ?? null,
    responses: responses ?? [],
    signature,
    followUpTasks
  };
}
