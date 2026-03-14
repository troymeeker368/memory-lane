import Link from "next/link";
import { notFound } from "next/navigation";

import { Card, CardTitle } from "@/components/ui/card";
import { RelatedSection } from "@/components/ui/related-section";
import { requireModuleAccess } from "@/lib/auth";
import { formatPhoneDisplay } from "@/lib/phone";
import { getPartnerDetail } from "@/lib/services/relations";
import { formatDate, formatDateTime, formatOptionalDate } from "@/lib/utils";

export default async function CommunityPartnerOrganizationDetailPage({ params }: { params: Promise<{ partnerId: string }> }) {
  await requireModuleAccess("sales");
  const { partnerId } = await params;
  const detail = await getPartnerDetail(partnerId);
  if (!detail) notFound();

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>{detail.partner.organization_name}</CardTitle>
        <div className="mt-2 grid gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Category</p><p className="font-semibold">{detail.partner.referral_source_category}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Location</p><p className="font-semibold">{detail.partner.location || "-"}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Primary Phone</p><p className="font-semibold">{formatPhoneDisplay(detail.partner.primary_phone)}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Primary Email</p><p className="font-semibold">{detail.partner.primary_email || "-"}</p></div>
        </div>
        <p className="mt-2 text-sm text-muted">Notes: {detail.partner.notes || "-"}</p>
        <p className="text-sm text-muted">Last Touched: {formatOptionalDate(detail.partner.last_touched)}</p>
        <div className="mt-2 flex flex-wrap gap-3 text-sm">
          <Link className="font-semibold text-brand" href={`/sales/new-entries/new-inquiry?partnerId=${detail.partner.id}`}>New Linked Lead / Inquiry</Link>
          <Link className="font-semibold text-brand" href={`/sales/new-entries/log-partner-activities?partnerId=${detail.partner.id}`}>Log Partner Activity</Link>
          <Link className="font-semibold text-brand" href={`/sales/new-entries/new-community-partner`}>Edit Community Partner</Link>
        </div>
      </Card>

      <RelatedSection title="Linked Leads" count={detail.leads.length} viewAllHref="/sales/pipeline/leads-table" addHref={`/sales/new-entries/new-inquiry?partnerId=${detail.partner.id}`}>
        <div className="space-y-2">
          {detail.leads.slice(0, 20).map((lead) => (
            <div key={lead.id} className="rounded-lg border border-border p-3 text-sm">
              <p className="font-semibold">{lead.member_name || "(No member name)"} - {lead.stage}</p>
              <p className="text-muted">Caregiver: {lead.caregiver_name} | Source: {lead.lead_source}</p>
              <p className="text-muted">Inquiry: {formatDate(lead.inquiry_date)}</p>
              <Link className="font-semibold text-brand" href={`/sales/leads/${lead.id}`}>Open Lead</Link>
            </div>
          ))}
        </div>
      </RelatedSection>

      <RelatedSection title="Referral Sources" count={detail.referralSources.length} viewAllHref="/sales/community-partners/referral-sources" addHref="/sales/new-entries/new-referral-source">
        <div className="space-y-2">
          {detail.referralSources.slice(0, 20).map((source) => (
            <div key={source.id} className="rounded-lg border border-border p-3 text-sm">
              <p className="font-semibold">{source.contact_name}</p>
              <p className="text-muted">{source.organization_name}</p>
              <p className="text-muted">{formatPhoneDisplay(source.primary_phone)} | {source.primary_email || "-"}</p>
              <Link className="font-semibold text-brand" href={`/sales/community-partners/referral-sources/${source.id}`}>Open Referral Source</Link>
            </div>
          ))}
        </div>
      </RelatedSection>

      <RelatedSection title="Linked Partner Activities" count={detail.partnerActivities.length} viewAllHref="/sales/new-entries/log-partner-activities" addHref={`/sales/new-entries/log-partner-activities?partnerId=${detail.partner.id}`}>
        <div className="space-y-2">
          {detail.partnerActivities.slice(0, 20).map((activity) => (
            <div key={activity.id} className="rounded-lg border border-border p-3 text-sm">
              <p className="font-semibold">{formatDateTime(activity.activity_at)} - {activity.activity_type}</p>
              <p className="text-muted">Contact: {activity.contact_name || "-"}</p>
              <p className="text-muted">Next: {activity.next_follow_up_date ? `${formatDate(activity.next_follow_up_date)} (${activity.next_follow_up_type ?? "-"})` : "-"}</p>
              <p>{activity.notes || "-"}</p>
            </div>
          ))}
        </div>
      </RelatedSection>

      <RelatedSection title="Related Lead Activities" count={detail.leadActivities.length} viewAllHref="/sales/new-entries/log-lead-activity" addHref={`/sales/new-entries/log-lead-activity?partnerId=${detail.partner.id}`}>
        <div className="space-y-2">
          {detail.leadActivities.slice(0, 20).map((activity) => (
            <div key={activity.id} className="rounded-lg border border-border p-3 text-sm">
              <p className="font-semibold">{formatDateTime(activity.activity_at)} - {activity.activity_type}</p>
              <p className="text-muted">Member: {activity.member_name}</p>
              <p>{activity.notes || "-"}</p>
            </div>
          ))}
        </div>
      </RelatedSection>
    </div>
  );
}
