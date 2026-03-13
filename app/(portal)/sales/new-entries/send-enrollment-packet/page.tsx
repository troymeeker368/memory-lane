import { SalesEnrollmentPacketStandaloneAction } from "@/components/sales/sales-enrollment-packet-standalone-action";
import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import { getEnrollmentPricingOverview } from "@/lib/services/enrollment-pricing";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function SendEnrollmentPacketStandalonePage() {
  await requireModuleAccess("sales");
  const supabase = await createClient();
  const [pricingOverview, { data: leadsData, error: leadsError }] = await Promise.all([
    getEnrollmentPricingOverview(),
    supabase
      .from("leads")
      .select("id, member_name, caregiver_email")
      .order("created_at", { ascending: false })
      .limit(500)
  ]);
  if (leadsError) throw new Error(leadsError.message);
  const leads = (leadsData ?? []).map((row: any) => ({
    id: String(row.id),
    memberName: String(row.member_name ?? ""),
    caregiverEmail: typeof row.caregiver_email === "string" ? row.caregiver_email : null
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
