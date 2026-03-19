import { NewCarePlanFormShell } from "@/components/forms/care-plan-form-shells";
import { Card, CardTitle } from "@/components/ui/card";
import { requireCarePlanAuthorizedUser } from "@/lib/services/care-plan-authorization";
import { getCarePlanTracks } from "@/lib/services/care-plans";
import { getMembers } from "@/lib/services/documentation";

export default async function NewCarePlanPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const authorizedUser = await requireCarePlanAuthorizedUser();
  const params = await searchParams;
  const initialMemberId = typeof params.memberId === "string" ? params.memberId : undefined;

  const [members, tracks] = await Promise.all([getMembers(), Promise.resolve(getCarePlanTracks())]);

  return (
    <Card>
      <CardTitle>New Care Plan</CardTitle>
      <p className="mt-1 text-sm text-muted">Track wording is fixed to canonical Town Square Fort Mill source documents.</p>
      <div className="mt-3">
        <NewCarePlanFormShell
          members={members}
          tracks={tracks}
          initialMemberId={initialMemberId}
          signerNameDefault={authorizedUser.signatureName}
        />
      </div>
    </Card>
  );
}

