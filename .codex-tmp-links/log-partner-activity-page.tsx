import Link from "next/link";

import { SalesPartnerActivityForm } from "@/components/forms/sales-partner-activity-form";
import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import { getLeadActivityContextLookups, getLeadActivitySnapshot, getLeadFormLookups } from "@/lib/services/leads-read";
import { formatDate, formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";
type SalesActivitySnapshot = Awaited<ReturnType<typeof getLeadActivitySnapshot>>;
type PartnerActivityRow = SalesActivitySnapshot["partnerActivities"][number];

export default async function LogPartnerActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireModuleAccess("sales");
  const params = await searchParams;
  const leadId = typeof params.leadId === "string" ? params.leadId : undefined;
  const partnerId = typeof params.partnerId === "string" ? params.partnerId : undefined;
  const referralSourceId = typeof params.referralSourceId === "string" ? params.referralSourceId : undefined;
  const [{ partnerActivities }, { partners, referralSources }] = await Promise.all([
    getLeadActivitySnapshot({ includeLeadActivities: false }),
    getLeadFormLookups({
      includeLeads: false,
      includePartnerId: partnerId,
      includeReferralSourceId: referralSourceId
    })
  ]);
  const { leads } = await getLeadActivityContextLookups({
    leadIds: partnerActivities.map((activity) => activity.lead_id).filter((value): value is string => Boolean(value))
  });

  const leadNameById = new Map(leads.map((lead) => [lead.id, lead.member_name]));

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Log Partner Activities</CardTitle>
        <div className="mt-3">
          <SalesPartnerActivityForm
            partners={partners}
            referralSources={referralSources}
            initialLeadId={leadId}
            initialPartnerId={partnerId}
            initialReferralSourceId={referralSourceId}
          />
        </div>
      </Card>

      <Card className="table-wrap">
        <CardTitle>Recent Partner Activities</CardTitle>
        <table>
          <thead><tr><th>When</th><th>Organization</th><th>Contact</th><th>Type</th><th>Linked Lead</th><th>Completed By</th><th>Next Follow-Up</th><th>Notes</th></tr></thead>
          <tbody>
            {partnerActivities.map((activity: PartnerActivityRow) => (
              <tr key={activity.id}>
                <td>{formatDateTime(activity.activity_at)}</td>
                <td>{activity.organization_name}</td>
                <td>{activity.contact_name}</td>
                <td>{activity.activity_type}</td>
                <td>{activity.lead_id ? <Link className="font-semibold text-brand" href={`/sales/leads/${activity.lead_id}`}>{leadNameById.get(activity.lead_id) ?? "Open Lead"}</Link> : "-"}</td>
                <td>{activity.completed_by}</td>
                <td>{activity.next_follow_up_date ? `${formatDate(activity.next_follow_up_date)} (${activity.next_follow_up_type ?? "-"})` : "-"}</td>
                <td>{activity.notes ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
