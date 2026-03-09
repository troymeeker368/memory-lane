import { NewReferralSourceForm } from "@/components/forms/sales-partner-source-forms";
import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import { getSalesWorkflows } from "@/lib/services/sales-workflows";

export default async function NewReferralSourcePage() {
  await requireModuleAccess("sales");
  const { partners } = await getSalesWorkflows();

  return (
    <Card>
      <CardTitle>New Referral Source</CardTitle>
      <div className="mt-3"><NewReferralSourceForm partners={partners as any[]} /></div>
    </Card>
  );
}