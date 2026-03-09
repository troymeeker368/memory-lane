import Link from "next/link";

import { SalesLeadActivityForm } from "@/components/forms/sales-lead-activity-form";
import { Card, CardTitle } from "@/components/ui/card";
import { requireRoles } from "@/lib/auth";
import { getSalesWorkflows } from "@/lib/services/sales-workflows";
import { formatDate, formatDateTime } from "@/lib/utils";

export default async function LogLeadActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRoles(["admin"]);
  const params = await searchParams;
  const { openLeads, wonLeads, lostLeads, activities, partners, referralSources } = await getSalesWorkflows();

  const leadId = typeof params.leadId === "string" ? params.leadId : undefined;
  const partnerId = typeof params.partnerId === "string" ? params.partnerId : undefined;
  const referralSourceId = typeof params.referralSourceId === "string" ? params.referralSourceId : undefined;

  const allLeads = [...openLeads, ...wonLeads, ...lostLeads].reduce<any[]>((acc, lead) => {
    if (acc.some((row) => row.id === lead.id)) return acc;
    acc.push(lead);
    return acc;
  }, []);

  const selectedLead = leadId ? allLeads.find((lead) => lead.id === leadId) ?? null : null;
  const filteredActivities = selectedLead ? activities.filter((activity: any) => activity.lead_id === selectedLead.id) : activities;
  const leadNameById = new Map(allLeads.map((lead: any) => [lead.id, lead.member_name]));

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>{selectedLead ? `Log Lead Activity - ${selectedLead.member_name}` : "Log Lead Activity"}</CardTitle>
        <div className="mt-3">
          <SalesLeadActivityForm
            leads={allLeads as any[]}
            partners={partners as any[]}
            referralSources={referralSources as any[]}
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
            {filteredActivities.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center text-sm text-muted">No lead activities found.</td>
              </tr>
            ) : (
              filteredActivities.map((activity: any) => (
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
