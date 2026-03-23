import { NewReferralSourceForm } from "@/components/forms/sales-partner-source-forms";
import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import { getLeadFormLookups } from "@/lib/services/leads-read";

export default async function NewReferralSourcePage() {
  await requireModuleAccess("sales");
  const { partners } = await getLeadFormLookups({ includeLeads: false });

  return (
    <Card>
      <CardTitle>New Referral Source</CardTitle>
      <div className="mt-3"><NewReferralSourceForm partners={partners} /></div>
    </Card>
  );
}
