import { SalesEnrollmentPacketStandaloneAction } from "@/components/sales/sales-enrollment-packet-standalone-action";
import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import { listCanonicalMemberLinksForLeadIds } from "@/lib/services/canonical-person-ref";
import { getEnrollmentPricingOverview } from "@/lib/services/enrollment-pricing";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function SendEnrollmentPacketStandalonePage() {
  await requireModuleAccess("sales");
  const supabase = await createClient();
  const [pricingOverview, { data: leadsData, error: leadsError }, { data: membersData, error: membersError }] = await Promise.all([
    getEnrollmentPricingOverview(),
    supabase
      .from("leads")
      .select("id, member_name, caregiver_email")
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("members")
      .select("id, display_name")
      .order("display_name", { ascending: true })
      .limit(1000)
  ]);
  if (leadsError) throw new Error(leadsError.message);
  if (membersError) throw new Error(membersError.message);

  const members = (membersData ?? []).map((row: any) => ({
    id: String(row.id),
    displayName: String(row.display_name ?? "")
  }));
  const leadIds = (leadsData ?? []).map((row: any) => String(row.id)).filter(Boolean);
  const memberLinkByLeadId = await listCanonicalMemberLinksForLeadIds(leadIds, {
    actionLabel: "SendEnrollmentPacketStandalonePage"
  });
  const leads = (leadsData ?? []).map((row: any) => ({
    id: String(row.id),
    memberName: String(row.member_name ?? ""),
    caregiverEmail: typeof row.caregiver_email === "string" ? row.caregiver_email : null,
    canonicalMemberId: memberLinkByLeadId.get(String(row.id))?.memberId ?? null
  }));

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Send Enrollment Packet</CardTitle>
        <p className="mt-2 text-sm text-muted">
          Standalone sales action for sending caregiver enrollment packets from one shared backend service.
        </p>
      </Card>
      <Card>
        <SalesEnrollmentPacketStandaloneAction
          leads={leads}
          members={members}
          pricingPreview={{
            communityFeeAmount: pricingOverview.activeCommunityFee?.amount ?? null,
            dailyRates: pricingOverview.activeDailyRates.map((tier) => ({
              id: tier.id,
              label: tier.label,
              minDaysPerWeek: tier.minDaysPerWeek,
              maxDaysPerWeek: tier.maxDaysPerWeek,
              dailyRate: tier.dailyRate
            })),
            issues: pricingOverview.issues
          }}
        />
      </Card>
    </div>
  );
}
