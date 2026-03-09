import Link from "next/link";

import { AncillaryPricingManager } from "@/components/forms/ancillary-pricing-manager";
import { BackArrowButton } from "@/components/ui/back-arrow-button";
import { Card, CardTitle } from "@/components/ui/card";
import { requireRoles } from "@/lib/auth";
import { getAncillarySummary } from "@/lib/services/ancillary";

export default async function ManageAncillaryPricingPage() {
  await requireRoles(["admin"]);
  const summary = await getAncillarySummary();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <BackArrowButton fallbackHref="/operations/additional-charges" />
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
    </div>
  );
}
