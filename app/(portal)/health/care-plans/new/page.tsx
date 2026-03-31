import { NewCarePlanFormShell } from "@/components/forms/care-plan-form-shells";
import { Card, CardTitle } from "@/components/ui/card";
import { requireCarePlanAuthorizedUser } from "@/lib/services/care-plan-authorization";
import { getCarePlanTracks } from "@/lib/services/care-plans";
import { listMemberPickerOptionsSupabase } from "@/lib/services/shared-lookups-supabase";

export default async function NewCarePlanPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const authorizedUser = await requireCarePlanAuthorizedUser();
  const params = await searchParams;
  const initialMemberId = typeof params.memberId === "string" ? params.memberId : undefined;

  const [initialMembers, tracks] = await Promise.all([
    initialMemberId
      ? listMemberPickerOptionsSupabase({
          selectedId: initialMemberId,
          status: "active",
          limit: 1
        })
      : Promise.resolve([]),
    Promise.resolve(getCarePlanTracks())
  ]);
  const initialMemberOption = initialMembers[0] ?? null;

  return (
    <Card>
      <CardTitle>New Care Plan</CardTitle>
      <p className="mt-1 text-sm text-muted">Track wording is fixed to canonical Town Square Fort Mill source documents.</p>
      <div className="mt-3">
        <NewCarePlanFormShell
          tracks={tracks}
          initialMemberOption={initialMemberOption}
          signerNameDefault={authorizedUser.signatureName}
        />
      </div>
    </Card>
  );
}

