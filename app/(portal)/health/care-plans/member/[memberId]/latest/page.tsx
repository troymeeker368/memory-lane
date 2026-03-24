import { redirect } from "next/navigation";

import { requireCarePlanAuthorizedUser } from "@/lib/services/care-plan-authorization";
import { getLatestCarePlanIdForMember } from "@/lib/services/care-plans-read";

export default async function LatestMemberCarePlanPage({
  params
}: {
  params: Promise<{ memberId: string }>;
}) {
  await requireCarePlanAuthorizedUser();
  const { memberId } = await params;
  const latestCarePlanId = await getLatestCarePlanIdForMember(memberId);
  if (!latestCarePlanId) {
    redirect(`/health/care-plans/new?memberId=${memberId}`);
  }

  redirect(`/health/care-plans/${latestCarePlanId}`);
}
