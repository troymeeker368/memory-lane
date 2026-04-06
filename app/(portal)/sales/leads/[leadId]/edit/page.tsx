import { notFound } from "next/navigation";

import { SalesInquiryForm, type LeadLookup, type PartnerLookup, type ReferralSourceLookup } from "@/components/forms/sales-inquiry-form";
import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import { getLeadById, getLeadFormLookups } from "@/lib/services/leads-read";

export default async function EditLeadPage({ params }: { params: Promise<{ leadId: string }> }) {
  await requireModuleAccess("sales");
  const { leadId } = await params;
  const detail = await getLeadById(leadId);
  if (!detail) notFound();

  const { partners, referralSources } = await getLeadFormLookups({
    includeLeads: false,
    includePartners: true,
    includeReferralSources: true,
    referralPartnerId: detail.lead.partner_id,
    includePartnerId: detail.lead.partner_id,
    includeReferralSourceId: detail.lead.referral_source_id
  });

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
