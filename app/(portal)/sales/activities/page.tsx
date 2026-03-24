import Link from "next/link";

import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import {
  getLeadActivitySnapshot,
  getLeadActivityContextLookups,
  type SalesPartnerRow,
  type SalesReferralSourceRow
} from "@/lib/services/leads-read";
import { formatDate, formatDateTime } from "@/lib/utils";

type SalesActivitySnapshot = Awaited<ReturnType<typeof getLeadActivitySnapshot>>;
type LeadActivityRow = SalesActivitySnapshot["activities"][number];
type PartnerActivityRow = SalesActivitySnapshot["partnerActivities"][number];

export default async function SalesRecentActivityPage() {
  const [ , snapshot] = await Promise.all([
    requireModuleAccess("sales"),
    getLeadActivitySnapshot()
  ]);
  const { activities, partnerActivities } = snapshot;
  const leadIds = new Set<string>();
  const partnerIds = new Set<string>();
  const referralSourceIds = new Set<string>();

  activities.forEach((activity) => {
    if (activity.lead_id) leadIds.add(activity.lead_id);
  });
  partnerActivities.forEach((activity) => {
    if (activity.lead_id) leadIds.add(activity.lead_id);
    if (activity.partner_id) partnerIds.add(activity.partner_id);
    if (activity.referral_source_id) referralSourceIds.add(activity.referral_source_id);
  });

  const { leads, partners, referralSources } =
    leadIds.size || partnerIds.size || referralSourceIds.size
      ? await getLeadActivityContextLookups({
          leadIds: [...leadIds],
          partnerIds: [...partnerIds],
          referralSourceIds: [...referralSourceIds]
        })
      : { leads: [], partners: [], referralSources: [] };

  const leadNameById = new Map(leads.map((lead) => [lead.id, lead.member_name]));
  const partnerByPartnerId = new Map<string, SalesPartnerRow>();
  partners.forEach((partner) => {
    if (partner.partner_id) partnerByPartnerId.set(String(partner.partner_id), partner);
    if (partner.id) partnerByPartnerId.set(String(partner.id), partner);
  });
  const referralById = new Map<string, SalesReferralSourceRow>();
  referralSources.forEach((source) => {
    if (source.referral_source_id) referralById.set(String(source.referral_source_id), source);
    if (source.id) referralById.set(String(source.id), source);
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Recent Lead Activity</CardTitle>
        <p className="mt-1 text-sm text-muted">Operational recent activity across lead follow-up and partner outreach.</p>
      </Card>

      <Card className="table-wrap">
        <CardTitle>Recent Lead Activities</CardTitle>
        <table>
          <thead><tr><th>When</th><th>Lead Name</th><th>Type</th><th>Outcome</th><th>Lost Reason</th><th>Next Follow-Up</th><th>By</th><th>Notes</th></tr></thead>
          <tbody>
            {activities.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center text-sm text-muted">No lead activities found.</td>
              </tr>
            ) : (
              activities.map((activity: LeadActivityRow) => (
                <tr key={activity.id}>
                  <td>{formatDateTime(activity.activity_at)}</td>
                  <td>
                    <Link className="font-semibold text-brand" href={`/sales/leads/${activity.lead_id}`}>
                      {leadNameById.get(activity.lead_id) ?? activity.member_name}
                    </Link>
                  </td>
                  <td>{activity.activity_type}</td>
                  <td>{activity.outcome}</td>
                  <td>{activity.lost_reason ?? "-"}</td>
                  <td>{activity.next_follow_up_date ? `${formatDate(activity.next_follow_up_date)} (${activity.next_follow_up_type ?? "-"})` : "-"}</td>
                  <td>{activity.completed_by_name}</td>
                  <td>{activity.notes ?? "-"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      <Card className="table-wrap">
        <CardTitle>Recent Partner Activities</CardTitle>
        <table>
          <thead><tr><th>When</th><th>Organization</th><th>Contact</th><th>Type</th><th>Next Follow-Up</th><th>By</th><th>Linked Lead</th><th>Notes</th></tr></thead>
          <tbody>
            {partnerActivities.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center text-sm text-muted">No partner activities found.</td>
              </tr>
            ) : (
              partnerActivities.map((activity: PartnerActivityRow) => {
                const partner = partnerByPartnerId.get(activity.partner_id);
                const referral = activity.referral_source_id ? referralById.get(activity.referral_source_id) : null;

                return (
                  <tr key={activity.id}>
                    <td>{formatDateTime(activity.activity_at)}</td>
                    <td>
                      {partner ? (
                        <Link className="font-semibold text-brand" href={`/sales/community-partners/organizations/${partner.id}`}>
                          {activity.organization_name || partner.organization_name}
                        </Link>
                      ) : (
                        activity.organization_name || "-"
                      )}
                    </td>
                    <td>{activity.contact_name || referral?.contact_name || "-"}</td>
                    <td>{activity.activity_type}</td>
                    <td>{activity.next_follow_up_date ? `${formatDate(activity.next_follow_up_date)} (${activity.next_follow_up_type ?? "-"})` : "-"}</td>
                    <td>{activity.completed_by || activity.completed_by_name || "-"}</td>
                    <td>{activity.lead_id ? <Link className="font-semibold text-brand" href={`/sales/leads/${activity.lead_id}`}>{leadNameById.get(activity.lead_id) ?? "Open"}</Link> : "-"}</td>
                    <td>{activity.notes || "-"}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
