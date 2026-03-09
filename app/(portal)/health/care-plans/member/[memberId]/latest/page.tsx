import { redirect } from "next/navigation";

import { requireRoles } from "@/lib/auth";
import { getLatestCarePlanForMember } from "@/lib/services/care-plans";

export default async function LatestMemberCarePlanPage({
  params
}: {
  params: Promise<{ memberId: string }>;
}) {
  await requireRoles(["admin", "manager", "nurse"]);
  const { memberId } = await params;

  const latest = getLatestCarePlanForMember(memberId);
  if (!latest) {
    redirect(`/health/care-plans/new?memberId=${memberId}`);
  }

  redirect(`/health/care-plans/${latest.id}`);
}
