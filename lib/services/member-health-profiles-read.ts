import { getBillingPayorContact } from "@/lib/services/billing-payor-contacts";
import { getMemberCarePlanSnapshot } from "@/lib/services/care-plans-read";
import { resolveCanonicalMemberId } from "@/lib/services/canonical-person-ref";
import { getMemberHealthProfileAssessmentsSupabase as getMemberHealthProfileAssessmentsSupabaseModel } from "@/lib/services/member-health-profiles-supabase";
import { getMemberProgressNoteSummary } from "@/lib/services/notes-read";
import { getPhysicianOrdersForMember } from "@/lib/services/physician-orders-read";

export type { MhpTab } from "@/lib/services/member-health-profiles-supabase";
export {
  MHP_TABS,
  getMemberHealthProfileAssessmentsSupabase,
  getMemberHealthProfileDetailSupabase,
  getMemberHealthProfileIndexSupabase
} from "@/lib/services/member-health-profiles-supabase";

const MHP_OVERVIEW_HISTORY_LIMIT = 25;
const MHP_OVERVIEW_RELATED_ROW_LIMIT = 25;

async function resolveMemberHealthProfileOverviewMemberId(
  memberId: string,
  options?: { canonicalInput?: boolean }
) {
  if (options?.canonicalInput) return memberId;

  return resolveCanonicalMemberId(memberId, {
    actionLabel: "getMemberHealthProfileOverviewSupplement"
  });
}

export async function getMemberHealthProfileOverviewSupplement(
  memberId: string,
  options?: { canonicalInput?: boolean }
) {
  const canonicalMemberId = await resolveMemberHealthProfileOverviewMemberId(memberId, options);

  const [carePlanSnapshot, progressNoteSummary, billingPayor, relatedPhysicianOrders] =
    await Promise.all([
      getMemberCarePlanSnapshot(canonicalMemberId, { canonicalInput: true }),
      getMemberProgressNoteSummary(canonicalMemberId, { canonicalInput: true }),
      getBillingPayorContact(canonicalMemberId, {
        source: "getMemberHealthProfileOverviewSupplement",
        canonicalInput: true
      }),
      getPhysicianOrdersForMember(canonicalMemberId, {
        canonicalInput: true,
        limit: MHP_OVERVIEW_RELATED_ROW_LIMIT
      })
    ]);

  return {
    carePlanSummary: carePlanSnapshot.summary,
    progressNoteSummary,
    carePlanSnapshot,
    billingPayor,
    relatedPhysicianOrders
  };
}

type MemberHealthProfileOverviewSupplement = Awaited<ReturnType<typeof getMemberHealthProfileOverviewSupplement>>;
type MemberHealthProfileOverviewAssessments = Awaited<
  ReturnType<typeof getMemberHealthProfileAssessmentsSupabaseModel>
>;

export async function getMemberHealthProfileOverviewSummaryReadModel(
  memberId: string,
  options?: { canonicalInput?: boolean }
): Promise<
  MemberHealthProfileOverviewSupplement & {
    assessments: MemberHealthProfileOverviewAssessments;
  }
> {
  const canonicalMemberId = await resolveMemberHealthProfileOverviewMemberId(memberId, options);
  const [overviewData, assessments] = await Promise.all([
    getMemberHealthProfileOverviewSupplement(canonicalMemberId, {
      canonicalInput: true
    }),
    getMemberHealthProfileAssessmentsSupabaseModel(canonicalMemberId, {
      limit: MHP_OVERVIEW_HISTORY_LIMIT
    })
  ]);

  return {
    ...overviewData,
    assessments
  };
}
