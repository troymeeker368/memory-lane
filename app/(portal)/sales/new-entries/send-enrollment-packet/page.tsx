import { SalesEnrollmentPacketStandaloneAction } from "@/components/sales/sales-enrollment-packet-standalone-action";
import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import { getEnrollmentPricingOverview } from "@/lib/services/enrollment-pricing";

export const dynamic = "force-dynamic";

export default async function SendEnrollmentPacketStandalonePage() {
  await requireModuleAccess("sales");
  const pricingOverview = await getEnrollmentPricingOverview();

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
