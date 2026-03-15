import { createClient } from "@/lib/supabase/server";

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
      signature_metadata: signature.signatureMetadata,
      signature_artifact_storage_path: signature.signatureArtifactStoragePath,
      signature_artifact_member_file_id: signature.signatureArtifactMemberFileId,
      member_name: assessment.member?.display_name ?? "Unknown Member"
    },
    member: assessment.member ?? null,
    responses: responses ?? [],
    signature
  };
}
