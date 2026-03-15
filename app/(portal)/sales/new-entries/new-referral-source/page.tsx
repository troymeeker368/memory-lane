import { NewReferralSourceForm } from "@/components/forms/sales-partner-source-forms";
import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import { getSalesFormLookupsSupabase } from "@/lib/services/sales-crm-supabase";

export default async function NewReferralSourcePage() {
  await requireModuleAccess("sales");
  const { partners } = await getSalesFormLookupsSupabase();

  return (
    <Card>
      <CardTitle>New Referral Source</CardTitle>
      <div className="mt-3"><NewReferralSourceForm partners={partners as any[]} /></div>
    </Card>
  );
}
