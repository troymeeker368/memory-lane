import { NewCarePlanForm } from "@/components/forms/care-plan-forms";
import { Card, CardTitle } from "@/components/ui/card";
import { requireRoles } from "@/lib/auth";
import { getCarePlanTemplates, getCarePlanTracks } from "@/lib/services/care-plans";
import { getMembers } from "@/lib/services/documentation";

export default async function NewCarePlanPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRoles(["admin", "manager", "nurse"]);
  const params = await searchParams;
  const initialMemberId = typeof params.memberId === "string" ? params.memberId : undefined;

  const [members, tracks, templates] = await Promise.all([getMembers(), Promise.resolve(getCarePlanTracks()), Promise.resolve(getCarePlanTemplates())]);

  return (
    <Card>
      <CardTitle>New Care Plan</CardTitle>
      <p className="mt-1 text-sm text-muted">Track templates prefill short-term and long-term goals. You can edit before saving.</p>
      <div className="mt-3">
        <NewCarePlanForm members={members} tracks={tracks} templates={templates} initialMemberId={initialMemberId} />
      </div>
    </Card>
  );
}

