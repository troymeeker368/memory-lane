import { redirect } from "next/navigation";

export default async function PipelineLeadDetailRedirect({ params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = await params;
  redirect(`/sales/leads/${leadId}`);
}
