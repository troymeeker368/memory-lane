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

type MemberHealthProfileOverviewReadOptions = {
  canonicalInput?: boolean;
  includeRelatedPhysicianOrders?: boolean;
};

async function resolveMemberHealthProfileOverviewMemberId(
  memberId: string,
  options?: MemberHealthProfileOverviewReadOptions
) {
  if (options?.canonicalInput) return memberId;

  return resolveCanonicalMemberId(memberId, {
    actionLabel: "getMemberHealthProfileOverviewSupplement"
  });
}

export async function getMemberHealthProfileOverviewSupplement(
  memberId: string,
  options?: MemberHealthProfileOverviewReadOptions
) {
  const canonicalMemberId = await resolveMemberHealthProfileOverviewMemberId(memberId, options);
  const shouldLoadRelatedPhysicianOrders = options?.includeRelatedPhysicianOrders !== false;

  const [carePlanSnapshot, progressNoteSummary, billingPayor, relatedPhysicianOrders] =
    await Promise.all([
      getMemberCarePlanSnapshot(canonicalMemberId, { canonicalInput: true }),
      getMemberProgressNoteSummary(canonicalMemberId, { canonicalInput: true }),
      getBillingPayorContact(canonicalMemberId, {
        source: "getMemberHealthProfileOverviewSupplement",
        canonicalInput: true
      }),
      shouldLoadRelatedPhysicianOrders
        ? getPhysicianOrdersForMember(canonicalMemberId, {
            canonicalInput: true,
            limit: MHP_OVERVIEW_RELATED_ROW_LIMIT
          })
        : Promise.resolve([])
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
  options?: MemberHealthProfileOverviewReadOptions
): Promise<
  MemberHealthProfileOverviewSupplement & {
    assessments: MemberHealthProfileOverviewAssessments;
  }
> {
  const canonicalMemberId = await resolveMemberHealthProfileOverviewMemberId(memberId, options);
  const [overviewData, assessments] = await Promise.all([
    getMemberHealthProfileOverviewSupplement(canonicalMemberId, {
      canonicalInput: true,
      includeRelatedPhysicianOrders: options?.includeRelatedPhysicianOrders
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
