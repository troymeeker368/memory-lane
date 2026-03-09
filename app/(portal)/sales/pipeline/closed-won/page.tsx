import Link from "next/link";

import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import { getSalesWorkflows } from "@/lib/services/sales-workflows";
import { formatDate, formatOptionalDate } from "@/lib/utils";

export default async function SalesWonPage() {
  await requireModuleAccess("sales");
  const { wonLeads } = await getSalesWorkflows();

  return (
    <Card className="table-wrap">
      <CardTitle>Closed - Won</CardTitle>
      <table>
        <thead><tr><th>Lead Name</th><th>Caregiver</th><th>Source</th><th>Inquiry Date</th><th>Closed Date</th><th>Member Start Date</th></tr></thead>
        <tbody>{wonLeads.map((lead: any) => <tr key={lead.id}><td><Link className="font-semibold text-brand" href={`/sales/leads/${lead.id}`}>{lead.member_name}</Link></td><td>{lead.caregiver_name}</td><td>{lead.lead_source}</td><td>{formatDate(lead.inquiry_date)}</td><td>{formatOptionalDate(lead.closed_date)}</td><td>{formatOptionalDate(lead.member_start_date)}</td></tr>)}</tbody>
      </table>
    </Card>
  );
}
