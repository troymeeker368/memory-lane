import Link from "next/link";

import { Card, CardTitle } from "@/components/ui/card";
import { requireRoles } from "@/lib/auth";
import { getSalesWorkflows } from "@/lib/services/sales-workflows";
import { formatDate, formatOptionalDate } from "@/lib/utils";

export default async function SalesEipPage() {
  await requireRoles(["admin"]);
  const { eipLeads } = await getSalesWorkflows();

  return (
    <Card className="table-wrap">
      <CardTitle>Leads - Enrollment in Progress</CardTitle>
      <table>
        <thead><tr><th>Lead Name</th><th>Stage</th><th>Discovery Date</th><th>Projected Start Date</th><th>Caregiver</th><th>Follow-Up</th></tr></thead>
        <tbody>{eipLeads.map((lead: any) => <tr key={lead.id}><td><Link className="font-semibold text-brand" href={`/sales/leads/${lead.id}`}>{lead.member_name}</Link></td><td>{lead.stage}</td><td>{formatOptionalDate(lead.discovery_date)}</td><td>{formatOptionalDate(lead.member_start_date)}</td><td>{lead.caregiver_name}</td><td>{lead.next_follow_up_date ? `${formatDate(lead.next_follow_up_date)} (${lead.next_follow_up_type ?? "-"})` : "-"}</td></tr>)}</tbody>
      </table>
    </Card>
  );
}
