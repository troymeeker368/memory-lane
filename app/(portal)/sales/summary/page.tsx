import Link from "next/link";

import { Card, CardTitle } from "@/components/ui/card";
import { requireRoles } from "@/lib/auth";
import { canonicalLeadStatus } from "@/lib/canonical";
import { getSalesWorkflows } from "@/lib/services/sales-workflows";
import { formatDate } from "@/lib/utils";

function dateDaysAgo(days: number) {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() - days);
  return now.toISOString().slice(0, 10);
}

function percent(part: number, total: number) {
  if (!total) return 0;
  return Number(((part / total) * 100).toFixed(1));
}

export default async function SalesSummaryPage() {
  await requireRoles(["admin"]);

  const { stageCounts, openLeads, eipLeads, wonLeads, lostLeads } = await getSalesWorkflows();
  const allLeads = [...openLeads, ...wonLeads, ...lostLeads];
  const recentInquiries = [...allLeads]
    .sort((left, right) => (left.inquiry_date < right.inquiry_date ? 1 : -1))
    .slice(0, 10);
  const convertedOrEnrolledCount = allLeads.filter(
    (lead) =>
      canonicalLeadStatus(lead.status, lead.stage) === "Won" ||
      Boolean(String(lead.member_start_date ?? "").trim())
  ).length;
  const recentInquiryActivityCount = allLeads.filter((lead) => lead.inquiry_date >= dateDaysAgo(30)).length;
  const totalLeadCount = allLeads.length;
  const nonReferralStageRows = stageCounts.filter((row) => row.stage !== "Referrals Only");
  const maxStageCount = Math.max(...nonReferralStageRows.map((row) => row.count), 1);

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Sales Summary (Admin)</CardTitle>
        <p className="mt-1 text-sm text-muted">
          Lightweight foundation dashboard for lead pipeline visibility and inquiry activity trends.
        </p>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardTitle>Total Leads</CardTitle>
          <p className="mt-2 text-2xl font-bold text-brand">{totalLeadCount}</p>
        </Card>
        <Card>
          <CardTitle>EIP Leads</CardTitle>
          <p className="mt-2 text-2xl font-bold text-brand">{eipLeads.length}</p>
        </Card>
        <Card>
          <CardTitle>Converted / Enrolled</CardTitle>
          <p className="mt-2 text-2xl font-bold text-brand">{convertedOrEnrolledCount}</p>
          <p className="mt-1 text-xs text-muted">{percent(convertedOrEnrolledCount, totalLeadCount)}% conversion coverage</p>
        </Card>
        <Card>
          <CardTitle>Recent Inquiry Activity</CardTitle>
          <p className="mt-2 text-2xl font-bold text-brand">{recentInquiryActivityCount}</p>
          <p className="mt-1 text-xs text-muted">Inquiries created in the last 30 days</p>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardTitle>Leads by Stage</CardTitle>
          <div className="mt-3 space-y-2">
            {nonReferralStageRows.length === 0 ? (
              <p className="text-sm text-muted">No stage data available.</p>
            ) : (
              nonReferralStageRows.map((row) => {
                const widthPercent = Math.max(6, Math.round((row.count / maxStageCount) * 100));
                return (
                  <div key={row.stage} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span>{row.stage}</span>
                      <span className="font-semibold">{row.count}</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-brandSoft">
                      <div className="h-2 rounded-full bg-brand" style={{ width: `${widthPercent}%` }} />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </Card>

        <Card className="table-wrap">
          <CardTitle>Recent Inquiries</CardTitle>
          <table>
            <thead>
              <tr>
                <th>Prospect</th>
                <th>Inquiry Date</th>
                <th>Stage / Status</th>
                <th>Next Follow-Up</th>
              </tr>
            </thead>
            <tbody>
              {recentInquiries.length === 0 ? (
                <tr>
                  <td colSpan={4}>No recent inquiries.</td>
                </tr>
              ) : (
                recentInquiries.map((lead) => (
                  <tr key={lead.id}>
                    <td>
                      <Link className="font-semibold text-brand" href={`/sales/leads/${lead.id}`}>
                        {lead.member_name}
                      </Link>
                    </td>
                    <td>{formatDate(lead.inquiry_date)}</td>
                    <td>
                      {lead.stage} / {canonicalLeadStatus(lead.status, lead.stage)}
                    </td>
                    <td>{lead.next_follow_up_date ? formatDate(lead.next_follow_up_date) : "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
