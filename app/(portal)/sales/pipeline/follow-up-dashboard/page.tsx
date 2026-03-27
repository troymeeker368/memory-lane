import Link from "next/link";

import { Card, CardTitle } from "@/components/ui/card";
import { MobileList } from "@/components/ui/mobile-list";
import {
  buildSalesPipelinePageHref,
  parsePageNumber,
  SALES_PIPELINE_PAGE_SIZE
} from "@/app/(portal)/sales/pipeline/_stage-page";
import { requireModuleAccess } from "@/lib/auth";
import { formatPhoneDisplay } from "@/lib/phone";
import { getLeadFollowUpDashboard } from "@/lib/services/leads-read";
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

export default async function FollowUpDashboardPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, params] = await Promise.all([requireModuleAccess("sales"), searchParams]);
  const page = parsePageNumber(params.page);
  const dashboard = await getLeadFollowUpDashboard({
    page,
    pageSize: SALES_PIPELINE_PAGE_SIZE
  });
  const leads = dashboard.rows as LeadRow[];
  const rangeStart = leads.length === 0 ? 0 : (dashboard.page - 1) * dashboard.pageSize + 1;
  const rangeEnd = leads.length === 0 ? 0 : rangeStart + leads.length - 1;
  const hasPreviousPage = dashboard.page > 1;
  const hasNextPage = dashboard.page < dashboard.totalPages;

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Follow Up Dashboard</CardTitle>
        <p className="mt-1 text-sm text-muted">Leads sorted by next follow-up date with quick access to lead detail and activity logging.</p>
        <p className="mt-2 text-xs text-muted">
          Showing {rangeStart}-{rangeEnd} of {dashboard.totalRows} open leads
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-border bg-white p-3">
            <p className="text-xs uppercase tracking-wide text-muted">Overdue</p>
            <p className="mt-1 text-2xl font-bold text-rose-700">{dashboard.summary.overdue}</p>
          </div>
          <div className="rounded-lg border border-border bg-white p-3">
            <p className="text-xs uppercase tracking-wide text-muted">Due Today</p>
            <p className="mt-1 text-2xl font-bold text-amber-700">{dashboard.summary.dueToday}</p>
          </div>
          <div className="rounded-lg border border-border bg-white p-3">
            <p className="text-xs uppercase tracking-wide text-muted">Upcoming</p>
            <p className="mt-1 text-2xl font-bold text-brand">{dashboard.summary.upcoming}</p>
          </div>
          <div className="rounded-lg border border-border bg-white p-3">
            <p className="text-xs uppercase tracking-wide text-muted">Missing Follow-Up Date</p>
            <p className="mt-1 text-2xl font-bold text-slate-700">{dashboard.summary.missingDate}</p>
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
                  <td>{formatPhoneDisplay(lead.caregiver_phone)}</td>
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
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
          <span>
            Page {dashboard.page} of {dashboard.totalPages}
          </span>
          <div className="flex items-center gap-2">
            {hasPreviousPage ? (
              <Link
                href={buildSalesPipelinePageHref("/sales/pipeline/follow-up-dashboard", params, dashboard.page - 1)}
                className="rounded-lg border border-border px-3 py-2 font-semibold text-primary-text"
              >
                Previous Page
              </Link>
            ) : null}
            {hasNextPage ? (
              <Link
                href={buildSalesPipelinePageHref("/sales/pipeline/follow-up-dashboard", params, dashboard.page + 1)}
                className="rounded-lg border border-border px-3 py-2 font-semibold text-primary-text"
              >
                Next Page
              </Link>
            ) : null}
          </div>
        </div>
      </Card>
    </div>
  );
}
