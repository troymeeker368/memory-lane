import { NewCommunityPartnerForm } from "@/components/forms/sales-partner-source-forms";
import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";

export default async function NewCommunityPartnerPage() {
  await requireModuleAccess("sales");

  return (
    <Card>
      <CardTitle>New Community Partner</CardTitle>
      <div className="mt-3"><NewCommunityPartnerForm /></div>
    </Card>
  );
}