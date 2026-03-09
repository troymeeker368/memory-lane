import Link from "next/link";

import { Card, CardTitle } from "@/components/ui/card";
import { requireRoles } from "@/lib/auth";
import { getSalesWorkflows } from "@/lib/services/sales-workflows";
import { formatDate } from "@/lib/utils";

export default async function SalesNurturePage() {
  await requireRoles(["admin"]);
  const { nurtureLeads } = await getSalesWorkflows();

  return (
    <Card className="table-wrap">
      <CardTitle>Leads - Nurture</CardTitle>
      <table>
        <thead><tr><th>Lead Name</th><th>Caregiver</th><th>Source</th><th>Likelihood</th><th>Follow Up</th><th>Notes</th></tr></thead>
        <tbody>{nurtureLeads.map((lead: any) => <tr key={lead.id}><td><Link className="font-semibold text-brand" href={`/sales/leads/${lead.id}`}>{lead.member_name}</Link></td><td>{lead.caregiver_name}</td><td>{lead.lead_source}</td><td>{lead.likelihood ?? "-"}</td><td>{lead.next_follow_up_date ? `${formatDate(lead.next_follow_up_date)} (${lead.next_follow_up_type ?? "-"})` : "-"}</td><td>{lead.notes_summary ?? "-"}</td></tr>)}</tbody>
      </table>
    </Card>
  );
}
