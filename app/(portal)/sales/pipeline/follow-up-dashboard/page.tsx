import Link from "next/link";

import { Card, CardTitle } from "@/components/ui/card";
import { MobileList } from "@/components/ui/mobile-list";
import { requireRoles } from "@/lib/auth";
import { getSalesWorkflows } from "@/lib/services/sales-workflows";
import { toEasternDate } from "@/lib/timezone";
import { formatDate } from "@/lib/utils";

type LeadRow = {
  id: string;
  member_name: string;
  stage: string;
  status: string;
  caregiver_name: string;
  caregiver_phone: string;
  next_follow_up_date: string | null;
  next_follow_up_type: string | null;
};

function asFollowUpDateValue(date: string | null): string {
  return date ?? "9999-12-31";
}

export default async function FollowUpDashboardPage() {
  await requireRoles(["admin"]);
  const { openLeads } = await getSalesWorkflows();

  const seenLeadIds = new Set<string>();
  const dedupedLeads = (openLeads as LeadRow[]).filter((lead) => {
    if (!lead.id || seenLeadIds.has(lead.id)) return false;
    seenLeadIds.add(lead.id);
    return true;
  });

  const leads = [...dedupedLeads].sort((a, b) => {
    const dateCompare = asFollowUpDateValue(a.next_follow_up_date).localeCompare(asFollowUpDateValue(b.next_follow_up_date));
    if (dateCompare !== 0) return dateCompare;
    return (a.member_name || "").localeCompare(b.member_name || "");
  });

  const today = toEasternDate();
  const overdue = leads.filter((lead) => Boolean(lead.next_follow_up_date && lead.next_follow_up_date < today));
  const dueToday = leads.filter((lead) => lead.next_follow_up_date === today);
  const upcoming = leads.filter((lead) => Boolean(lead.next_follow_up_date && lead.next_follow_up_date > today));
  const missingDate = leads.filter((lead) => !lead.next_follow_up_date);

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Follow Up Dashboard</CardTitle>
        <p className="mt-1 text-sm text-muted">Leads sorted by next follow-up date with quick access to lead detail and activity logging.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-border bg-white p-3">
            <p className="text-xs uppercase tracking-wide text-muted">Overdue</p>
            <p className="mt-1 text-2xl font-bold text-rose-700">{overdue.length}</p>
          </div>
          <div className="rounded-lg border border-border bg-white p-3">
            <p className="text-xs uppercase tracking-wide text-muted">Due Today</p>
            <p className="mt-1 text-2xl font-bold text-amber-700">{dueToday.length}</p>
          </div>
          <div className="rounded-lg border border-border bg-white p-3">
            <p className="text-xs uppercase tracking-wide text-muted">Upcoming</p>
            <p className="mt-1 text-2xl font-bold text-brand">{upcoming.length}</p>
          </div>
          <div className="rounded-lg border border-border bg-white p-3">
            <p className="text-xs uppercase tracking-wide text-muted">Missing Follow-Up Date</p>
            <p className="mt-1 text-2xl font-bold text-slate-700">{missingDate.length}</p>
          </div>
        </div>
      </Card>

      <MobileList
        items={leads.map((lead) => ({
          id: lead.id,
          title: lead.member_name,
          fields: [
            { label: "Next Follow-Up", value: lead.next_follow_up_date ? `${formatDate(lead.next_follow_up_date)} (${lead.next_follow_up_type ?? "-"})` : "Not set" },
            { label: "Stage / Status", value: `${lead.stage} / ${lead.status}` },
            { label: "Caregiver", value: lead.caregiver_name || "-" },
            { label: "Actions", value: <span className="inline-flex gap-2"><Link className="font-semibold text-brand" href={`/sales/leads/${lead.id}`}>Open Lead</Link><Link className="font-semibold text-brand" href={`/sales/new-entries/log-lead-activity?leadId=${lead.id}`}>Log Activity</Link></span> }
          ]
        }))}
      />

      <Card className="table-wrap hidden md:block">
        <CardTitle>Leads by Next Follow-Up Date</CardTitle>
        <table>
          <thead>
            <tr>
              <th>Next Follow-Up</th>
              <th>Lead Name</th>
              <th>Stage</th>
              <th>Status</th>
              <th>Type</th>
              <th>Caregiver</th>
              <th>Phone</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {leads.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center text-sm text-muted">No leads found.</td>
              </tr>
            ) : (
              leads.map((lead) => (
                <tr key={lead.id}>
                  <td>{lead.next_follow_up_date ? formatDate(lead.next_follow_up_date) : "Not set"}</td>
                  <td>
                    <Link className="font-semibold text-brand" href={`/sales/leads/${lead.id}`}>
                      {lead.member_name}
                    </Link>
                  </td>
                  <td>{lead.stage}</td>
                  <td>{lead.status}</td>
                  <td>{lead.next_follow_up_type ?? "-"}</td>
                  <td>{lead.caregiver_name || "-"}</td>
                  <td>{lead.caregiver_phone || "-"}</td>
                  <td>
                    <div className="flex flex-wrap gap-2 text-sm">
                      <Link className="font-semibold text-brand" href={`/sales/leads/${lead.id}`}>Open Lead</Link>
                      <Link className="font-semibold text-brand" href={`/sales/new-entries/log-lead-activity?leadId=${lead.id}`}>Log Activity</Link>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
