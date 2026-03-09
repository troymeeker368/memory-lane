import { SalesInquiryForm } from "@/components/forms/sales-inquiry-form";
import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import { getSalesWorkflows } from "@/lib/services/sales-workflows";

export default async function NewInquiryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireModuleAccess("sales");
  const params = await searchParams;
  const { partners, referralSources } = await getSalesWorkflows();
  const partnerId = typeof params.partnerId === "string" ? params.partnerId : undefined;
  const referralSourceId = typeof params.referralSourceId === "string" ? params.referralSourceId : undefined;

  return (
    <Card>
      <CardTitle>New Inquiry</CardTitle>
      <p className="mt-1 text-sm text-muted">Leads workbook fields with partner/referral linkage and AppSheet-style contextual prefills.</p>
      <div className="mt-3">
        <SalesInquiryForm partners={partners as any[]} referralSources={referralSources as any[]} initialPartnerId={partnerId} initialReferralSourceId={referralSourceId} />
      </div>
    </Card>
  );
}