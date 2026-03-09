import Link from "next/link";
import { notFound } from "next/navigation";

import { Card, CardTitle } from "@/components/ui/card";
import { RelatedSection } from "@/components/ui/related-section";
import { requireRoles } from "@/lib/auth";
import { getReferralSourceDetail } from "@/lib/services/relations";
import { formatDate, formatDateTime, formatOptionalDate } from "@/lib/utils";

export default async function ReferralSourceDetailPage({ params }: { params: Promise<{ sourceId: string }> }) {
  await requireRoles(["admin"]);
  const { sourceId } = await params;
  const detail = await getReferralSourceDetail(sourceId);
  if (!detail) notFound();

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>{detail.referralSource.contact_name}</CardTitle>
        <div className="mt-2 grid gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Organization</p><p className="font-semibold">{detail.referralSource.organization_name}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Job Title</p><p className="font-semibold">{detail.referralSource.job_title || "-"}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Primary Phone</p><p className="font-semibold">{detail.referralSource.primary_phone || "-"}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Primary Email</p><p className="font-semibold">{detail.referralSource.primary_email || "-"}</p></div>
        </div>
        <p className="mt-2 text-sm text-muted">Preferred Contact: {detail.referralSource.preferred_contact_method || "-"}</p>
        <p className="text-sm text-muted">Last Touched: {formatOptionalDate(detail.referralSource.last_touched)}</p>
        {detail.partner ? <p className="text-sm">Community Partner: <Link className="font-semibold text-brand" href={`/sales/community-partners/organizations/${detail.partner.id}`}>{detail.partner.organization_name}</Link></p> : null}
        <div className="mt-2 flex flex-wrap gap-3 text-sm">
          <Link className="font-semibold text-brand" href={`/sales/new-entries/new-inquiry?referralSourceId=${detail.referralSource.id}`}>New Linked Lead / Inquiry</Link>
          <Link className="font-semibold text-brand" href={`/sales/new-entries/log-partner-activities?referralSourceId=${detail.referralSource.id}`}>Log Partner Activity</Link>
          <Link className="font-semibold text-brand" href="/sales/new-entries/new-referral-source">Edit Referral Source</Link>
        </div>
      </Card>

      <RelatedSection title="Linked Leads" count={detail.leads.length} viewAllHref="/sales/pipeline/leads-table" addHref={`/sales/new-entries/new-inquiry?referralSourceId=${detail.referralSource.id}`}>
        <div className="space-y-2">
          {detail.leads.slice(0, 20).map((lead) => (
            <div key={lead.id} className="rounded-lg border border-border p-3 text-sm">
              <p className="font-semibold">{lead.member_name || "(No member name)"} - {lead.stage}</p>
              <p className="text-muted">Caregiver: {lead.caregiver_name} | Inquiry: {formatDate(lead.inquiry_date)}</p>
              <Link className="font-semibold text-brand" href={`/sales/leads/${lead.id}`}>Open Lead</Link>
            </div>
          ))}
        </div>
      </RelatedSection>

      <RelatedSection title="Lead Activity History" count={detail.leadActivities.length} viewAllHref="/sales/new-entries/log-lead-activity" addHref={`/sales/new-entries/log-lead-activity?referralSourceId=${detail.referralSource.id}`}>
        <div className="space-y-2">
          {detail.leadActivities.slice(0, 20).map((activity) => (
            <div key={activity.id} className="rounded-lg border border-border p-3 text-sm">
              <p className="font-semibold">{formatDateTime(activity.activity_at)} - {activity.activity_type}</p>
              <p className="text-muted">Outcome: {activity.outcome}</p>
              <p>{activity.notes || "-"}</p>
            </div>
          ))}
        </div>
      </RelatedSection>

      <RelatedSection title="Partner Activities" count={detail.partnerActivities.length} viewAllHref="/sales/new-entries/log-partner-activities" addHref={`/sales/new-entries/log-partner-activities?referralSourceId=${detail.referralSource.id}`}>
        <div className="space-y-2">
          {detail.partnerActivities.slice(0, 20).map((activity) => (
            <div key={activity.id} className="rounded-lg border border-border p-3 text-sm">
              <p className="font-semibold">{formatDateTime(activity.activity_at)} - {activity.activity_type}</p>
              <p className="text-muted">Next: {activity.next_follow_up_date ? `${formatDate(activity.next_follow_up_date)} (${activity.next_follow_up_type ?? "-"})` : "-"}</p>
              <p>{activity.notes || "-"}</p>
            </div>
          ))}
        </div>
      </RelatedSection>
    </div>
  );
}