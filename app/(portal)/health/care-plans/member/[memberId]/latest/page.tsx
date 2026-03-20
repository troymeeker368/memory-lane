import { redirect } from "next/navigation";

import { resolveCanonicalMemberId } from "@/lib/services/canonical-person-ref";
import { requireCarePlanAuthorizedUser } from "@/lib/services/care-plan-authorization";
import { getLatestCarePlanForMember } from "@/lib/services/care-plans";

export default async function LatestMemberCarePlanPage({
  params
}: {
  params: Promise<{ memberId: string }>;
}) {
  await requireCarePlanAuthorizedUser();
  const { memberId } = await params;
  const canonicalMemberId = await resolveCanonicalMemberId(memberId, { actionLabel: "LatestMemberCarePlanPage" });

  const latest = await getLatestCarePlanForMember(canonicalMemberId);
  if (!latest) {
    redirect(`/health/care-plans/new?memberId=${canonicalMemberId}`);
  }

  redirect(`/health/care-plans/${latest.id}`);
}
