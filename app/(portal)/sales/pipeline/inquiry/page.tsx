import Link from "next/link";

import { Card, CardTitle } from "@/components/ui/card";
import { requireRoles } from "@/lib/auth";
import { getSalesWorkflows } from "@/lib/services/sales-workflows";
import { formatDate } from "@/lib/utils";

export default async function SalesInquiryPage() {
  await requireRoles(["admin"]);
  const { inquiryLeads } = await getSalesWorkflows();

  return (
    <Card className="table-wrap">
      <CardTitle>Leads - Inquiry</CardTitle>
      <table>
        <thead>
          <tr><th>Lead Name</th><th>Caregiver</th><th>Relationship</th><th>Inquiry Date</th><th>Source</th><th>Referral Name</th><th>Likelihood</th><th>Notes</th></tr>
        </thead>
        <tbody>
          {inquiryLeads.map((lead: any) => (
            <tr key={lead.id}><td><Link className="font-semibold text-brand" href={`/sales/leads/${lead.id}`}>{lead.member_name}</Link></td><td>{lead.caregiver_name}</td><td>{lead.caregiver_relationship ?? "-"}</td><td>{formatDate(lead.inquiry_date)}</td><td>{lead.lead_source}</td><td>{lead.referral_name ?? "-"}</td><td>{lead.likelihood ?? "-"}</td><td>{lead.notes_summary ?? "-"}</td></tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
