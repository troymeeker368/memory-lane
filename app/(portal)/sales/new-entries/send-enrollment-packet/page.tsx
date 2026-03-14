import { SalesEnrollmentPacketStandaloneAction } from "@/components/sales/sales-enrollment-packet-standalone-action";
import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import { getEnrollmentPricingOverview } from "@/lib/services/enrollment-pricing";
import { getSalesWorkflows } from "@/lib/services/sales-workflows";

export const dynamic = "force-dynamic";

export default async function SendEnrollmentPacketStandalonePage() {
  await requireModuleAccess("sales");
  const [pricingOverview, workflows] = await Promise.all([
    getEnrollmentPricingOverview(),
    getSalesWorkflows()
  ]);
  const leads = workflows.openLeads.slice(0, 500).map((row: any) => ({
    id: String(row.id),
    memberName: String(row.member_name ?? ""),
    caregiverEmail: typeof row.caregiver_email === "string" ? row.caregiver_email : null,
    memberStartDate: typeof row.member_start_date === "string" ? row.member_start_date : null
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
