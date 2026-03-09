import Link from "next/link";

import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";

export default async function OperationsAdditionalChargesPage() {
  const profile = await requireModuleAccess("operations");

  return (
    <Card>
      <CardTitle>Additional Charges</CardTitle>
      <p className="mt-1 text-sm text-muted">Charge entry and reconciliation continue in Ancillary Charges while Operations structure is finalized.</p>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <Link href="/ancillary" className="font-semibold text-brand">Open Ancillary Charges</Link>
        {profile.role === "admin" ? (
          <Link href="/operations/additional-charges/manage-ancillary-pricing" className="font-semibold text-brand">
            Manage Ancillary Pricing
          </Link>
        ) : null}
      </div>
    </Card>
  );
}
