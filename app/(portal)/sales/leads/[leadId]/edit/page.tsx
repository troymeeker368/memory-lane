import { notFound } from "next/navigation";

import { SalesInquiryForm, type LeadLookup, type PartnerLookup, type ReferralSourceLookup } from "@/components/forms/sales-inquiry-form";
import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import { getLeadDetail } from "@/lib/services/relations";
import { getSalesWorkflows } from "@/lib/services/sales-workflows";

export default async function EditLeadPage({ params }: { params: Promise<{ leadId: string }> }) {
  await requireModuleAccess("sales");
  const { leadId } = await params;
  const detail = await getLeadDetail(leadId);
  if (!detail) notFound();

  const { partners, referralSources } = await getSalesWorkflows();

  return (
    <Card>
      <CardTitle>Edit Lead</CardTitle>
      <div className="mt-3">
        <SalesInquiryForm
          key={`sales-edit-${leadId}`}
          partners={partners as PartnerLookup[]}
          referralSources={referralSources as ReferralSourceLookup[]}
          initialLead={detail.lead as LeadLookup}
        />
      </div>
    </Card>
  );
}
