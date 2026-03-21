import { redirect } from "next/navigation";

import { requireCarePlanAuthorizedUser } from "@/lib/services/care-plan-authorization";
import { getLatestCarePlanForMember } from "@/lib/services/care-plans-read";

export default async function LatestMemberCarePlanPage({
  params
}: {
  params: Promise<{ memberId: string }>;
}) {
  await requireCarePlanAuthorizedUser();
  const { memberId } = await params;
  const latest = await getLatestCarePlanForMember(memberId);
  if (!latest) {
    redirect(`/health/care-plans/new?memberId=${memberId}`);
  }

  redirect(`/health/care-plans/${latest.id}`);
}
