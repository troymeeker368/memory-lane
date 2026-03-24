import Link from "next/link";

import { AncillaryPricingManager } from "@/components/forms/ancillary-pricing-manager";
import { OperationsSettingsManager } from "@/components/forms/operations-settings-manager";
import { BackArrowButton } from "@/components/ui/back-arrow-button";
import { Card, CardTitle } from "@/components/ui/card";
import { requireRoles } from "@/lib/auth";
import { getAncillarySummary } from "@/lib/services/ancillary";
import { getOperationalSettings } from "@/lib/services/operations-settings";

export default async function ManageAncillaryPricingPage() {
  await requireRoles(["admin"]);
  const [summary, operationalSettings] = await Promise.all([getAncillarySummary(), getOperationalSettings()]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <BackArrowButton fallbackHref="/operations/pricing" />
      </div>

      <Card>
        <CardTitle>Manage Ancillary Pricing</CardTitle>
        <p className="mt-1 text-sm text-muted">
          Configure charge amounts used by ancillary entry workflows.
        </p>
        <div className="mt-3">
          <AncillaryPricingManager categories={summary.categories as Array<{ id: string; name: string; price_cents: number }>} />
        </div>
        <div className="mt-3">
          <Link href="/ancillary" className="text-sm font-semibold text-brand">
            Open Ancillary Charges
          </Link>
        </div>
      </Card>

      <Card>
        <CardTitle>Operations Rules</CardTitle>
        <div className="mt-3">
          <OperationsSettingsManager
            initialBusNumbers={operationalSettings.busNumbers}
            initialMakeupPolicy={operationalSettings.makeupPolicy}
            initialLatePickupRules={operationalSettings.latePickupRules}
          />
        </div>
      </Card>
    </div>
  );
}
