import { SalesInquiryForm, type PartnerLookup, type ReferralSourceLookup } from "@/components/forms/sales-inquiry-form";
import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import { getLeadFormLookups } from "@/lib/services/leads-read";

export default async function NewInquiryPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireModuleAccess("sales");
  const params = await searchParams;
  const partnerId = typeof params.partnerId === "string" ? params.partnerId : undefined;
  const referralSourceId = typeof params.referralSourceId === "string" ? params.referralSourceId : undefined;
  const { partners, referralSources } = await getLeadFormLookups({
    includeLeads: false,
    includePartners: true,
    includeReferralSources: true,
    referralPartnerId: partnerId,
    includePartnerId: partnerId,
    includeReferralSourceId: referralSourceId
  });

  return (
    <Card>
      <CardTitle>New Inquiry</CardTitle>
      <p className="mt-1 text-sm text-muted">Leads workbook fields with partner/referral linkage and AppSheet-style contextual prefills.</p>
      <div className="mt-3">
        <SalesInquiryForm
          key={`sales-new-${partnerId ?? "none"}-${referralSourceId ?? "none"}`}
          partners={partners as PartnerLookup[]}
          referralSources={referralSources as ReferralSourceLookup[]}
          initialPartnerId={partnerId}
          initialReferralSourceId={referralSourceId}
        />
      </div>
    </Card>
  );
}
