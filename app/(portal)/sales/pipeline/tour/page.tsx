import Link from "next/link";

import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import { getSalesWorkflows } from "@/lib/services/sales-workflows";
import { formatDate, formatOptionalDate } from "@/lib/utils";

export default async function SalesTourPage() {
  await requireModuleAccess("sales");
  const { tourLeads } = await getSalesWorkflows();

  return (
    <Card className="table-wrap">
      <CardTitle>Leads - Tour</CardTitle>
      <table>
        <thead><tr><th>Lead Name</th><th>Caregiver</th><th>Tour Date</th><th>Tour Completed?</th><th>Next Follow-Up</th><th>Source</th></tr></thead>
        <tbody>{tourLeads.map((lead: any) => <tr key={lead.id}><td><Link className="font-semibold text-brand" href={`/sales/leads/${lead.id}`}>{lead.member_name}</Link></td><td>{lead.caregiver_name}</td><td>{formatOptionalDate(lead.tour_date)}</td><td>{lead.tour_completed ? "Yes" : "No"}</td><td>{lead.next_follow_up_date ? `${formatDate(lead.next_follow_up_date)} (${lead.next_follow_up_type ?? "-"})` : "-"}</td><td>{lead.lead_source}</td></tr>)}</tbody>
      </table>
    </Card>
  );
}
