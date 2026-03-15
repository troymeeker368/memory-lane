import Link from "next/link";

import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import { getSalesLeadListSupabase } from "@/lib/services/sales-crm-supabase";
import { formatOptionalDate } from "@/lib/utils";

export default async function SalesLostPage() {
  await requireModuleAccess("sales");
  const { rows } = await getSalesLeadListSupabase({ status: "lost" });

  return (
    <Card className="table-wrap">
      <CardTitle>Closed - Lost</CardTitle>
      <table>
        <thead><tr><th>Lead Name</th><th>Caregiver</th><th>Source</th><th>Lost Reason</th><th>Closed Date</th><th>Notes</th></tr></thead>
        <tbody>{rows.map((lead) => <tr key={lead.id}><td><Link className="font-semibold text-brand" href={`/sales/leads/${lead.id}`}>{lead.member_name}</Link></td><td>{lead.caregiver_name}</td><td>{lead.lead_source}</td><td>{lead.lost_reason ?? "-"}</td><td>{formatOptionalDate(lead.closed_date)}</td><td>{lead.notes_summary ?? "-"}</td></tr>)}</tbody>
      </table>
    </Card>
  );
}
