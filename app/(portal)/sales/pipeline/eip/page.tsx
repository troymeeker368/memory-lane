import Link from "next/link";

import { EnrollMemberAction } from "@/components/sales/enroll-member-action";
import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import { getSalesLeadListSupabase } from "@/lib/services/sales-crm-supabase";
import { formatDate, formatOptionalDate } from "@/lib/utils";

export default async function SalesEipPage() {
  await requireModuleAccess("sales");
  const { rows } = await getSalesLeadListSupabase({ status: "open", stage: "Enrollment in Progress" });

  return (
    <Card className="table-wrap">
      <CardTitle>Leads - Enrollment in Progress</CardTitle>
      <table>
        <thead><tr><th>Lead Name</th><th>Stage</th><th>Discovery Date</th><th>Projected Start Date</th><th>Caregiver</th><th>Follow-Up</th><th>Actions</th></tr></thead>
        <tbody>{rows.map((lead) => <tr key={lead.id}><td><Link className="font-semibold text-brand" href={`/sales/leads/${lead.id}`}>{lead.member_name}</Link></td><td>{lead.stage}</td><td>{formatOptionalDate(lead.discovery_date)}</td><td>{formatOptionalDate(lead.member_start_date)}</td><td>{lead.caregiver_name}</td><td>{lead.next_follow_up_date ? `${formatDate(lead.next_follow_up_date)} (${lead.next_follow_up_type ?? "-"})` : "-"}</td><td><EnrollMemberAction leadId={lead.id} /></td></tr>)}</tbody>
      </table>
    </Card>
  );
}
