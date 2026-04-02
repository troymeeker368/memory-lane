import { getBillingPayorContact } from "@/lib/services/billing-payor-contacts";
import { getMemberCarePlanSnapshot, getMemberCarePlanSummary } from "@/lib/services/care-plans-read";
import { resolveCanonicalMemberId } from "@/lib/services/canonical-person-ref";
import { getMemberProgressNoteSummary } from "@/lib/services/notes-read";
import { getPhysicianOrdersForMember } from "@/lib/services/physician-orders-read";

export type { MhpTab } from "@/lib/services/member-health-profiles-supabase";
export {
  MHP_TABS,
  getMemberHealthProfileAssessmentsSupabase,
  getMemberHealthProfileDetailSupabase,
  getMemberHealthProfileIndexSupabase
} from "@/lib/services/member-health-profiles-supabase";

export async function getMemberHealthProfileOverviewSupplement(
  memberId: string,
  options?: { canonicalInput?: boolean }
) {
  const canonicalMemberId = options?.canonicalInput
    ? memberId
    : await resolveCanonicalMemberId(memberId, {
        actionLabel: "getMemberHealthProfileOverviewSupplement"
      });

  const [carePlanSummary, progressNoteSummary, carePlanSnapshot, billingPayor, relatedPhysicianOrders] =
    await Promise.all([
      getMemberCarePlanSummary(canonicalMemberId, { canonicalInput: true }),
      getMemberProgressNoteSummary(canonicalMemberId, { canonicalInput: true }),
      getMemberCarePlanSnapshot(canonicalMemberId, { canonicalInput: true }),
      getBillingPayorContact(canonicalMemberId, {
        source: "getMemberHealthProfileOverviewSupplement",
        canonicalInput: true
      }),
      getPhysicianOrdersForMember(canonicalMemberId, { canonicalInput: true })
    ]);

  return {
    carePlanSummary,
    progressNoteSummary,
    carePlanSnapshot,
    billingPayor,
    relatedPhysicianOrders
  };
}
