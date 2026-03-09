import { redirect } from "next/navigation";

export default async function AssessmentReportRedirect({ params }: { params: Promise<{ assessmentId: string }> }) {
  const { assessmentId } = await params;
  redirect(`/health/assessment/${assessmentId}`);
}
