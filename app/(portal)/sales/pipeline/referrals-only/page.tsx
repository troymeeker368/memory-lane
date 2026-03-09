import Link from "next/link";

import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import { getSalesWorkflows } from "@/lib/services/sales-workflows";

export default async function SalesReferralsOnlyPage() {
  await requireModuleAccess("sales");
  const { referralOnlyLeads } = await getSalesWorkflows();

  return (
    <Card className="table-wrap">
      <CardTitle>Leads - Referrals Only</CardTitle>
      <table>
        <thead><tr><th>Lead Name</th><th>Stage</th><th>Caregiver</th><th>Source</th><th>Referral Name</th><th>Created By</th></tr></thead>
        <tbody>{referralOnlyLeads.map((lead: any) => <tr key={lead.id}><td><Link className="font-semibold text-brand" href={`/sales/leads/${lead.id}`}>{lead.member_name}</Link></td><td>{lead.stage}</td><td>{lead.caregiver_name}</td><td>{lead.lead_source}</td><td>{lead.referral_name ?? "-"}</td><td>{lead.created_by_name}</td></tr>)}</tbody>
      </table>
    </Card>
  );
}
