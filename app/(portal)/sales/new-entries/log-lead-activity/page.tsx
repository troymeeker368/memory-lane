import Link from "next/link";

import { SalesLeadActivityForm } from "@/components/forms/sales-lead-activity-form";
import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import { getLeadActivitySnapshot, getLeadFormLookups } from "@/lib/services/leads-read";
import { formatDate, formatDateTime } from "@/lib/utils";

type SalesActivitySnapshot = Awaited<ReturnType<typeof getLeadActivitySnapshot>>;
type LeadActivityRow = SalesActivitySnapshot["activities"][number];

export default async function LogLeadActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireModuleAccess("sales");
  const params = await searchParams;

  const leadId = typeof params.leadId === "string" ? params.leadId : undefined;
  const partnerId = typeof params.partnerId === "string" ? params.partnerId : undefined;
  const referralSourceId = typeof params.referralSourceId === "string" ? params.referralSourceId : undefined;
  const [{ activities }, { leads, partners, referralSources }] = await Promise.all([
    getLeadActivitySnapshot({ leadId }),
    getLeadFormLookups({
      leadLimit: 500,
      includeLeadId: leadId,
      includePartnerId: partnerId,
      includeReferralSourceId: referralSourceId
    })
  ]);

  const selectedLead = leadId ? leads.find((lead) => lead.id === leadId) ?? null : null;
  const leadNameById = new Map(leads.map((lead) => [lead.id, lead.member_name]));

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>{selectedLead ? `Log Lead Activity - ${selectedLead.member_name}` : "Log Lead Activity"}</CardTitle>
        <div className="mt-3">
          <SalesLeadActivityForm
            leads={leads}
            partners={partners}
            referralSources={referralSources}
            initialLeadId={leadId}
            initialPartnerId={partnerId}
            initialReferralSourceId={referralSourceId}
            lockedLeadId={selectedLead?.id}
          />
        </div>
      </Card>

      <Card className="table-wrap">
        <CardTitle>{selectedLead ? `Recent Lead Activities - ${selectedLead.member_name}` : "Recent Lead Activities"}</CardTitle>
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
                  <td><Link className="font-semibold text-brand" href={`/sales/leads/${activity.lead_id}`}>{leadNameById.get(activity.lead_id) ?? activity.member_name}</Link></td>
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
    </div>
  );
}
