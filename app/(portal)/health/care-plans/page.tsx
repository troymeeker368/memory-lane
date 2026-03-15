import Link from "next/link";

import { Card, CardTitle } from "@/components/ui/card";
import { requireCarePlanAuthorizedUser } from "@/lib/services/care-plan-authorization";
import { getCarePlanDashboard } from "@/lib/services/care-plans";
import { formatDate, formatOptionalDate } from "@/lib/utils";

function StatusLink({ status, href }: { status: string; href: string }) {
  if (status === "Due Soon" || status === "Overdue") {
    return (
      <Link className="font-semibold text-brand underline" href={href}>
        {status}
      </Link>
    );
  }

  return <span>{status}</span>;
}

function parsePage(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.floor(parsed);
}

export default async function CarePlansDashboardPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCarePlanAuthorizedUser();
  const params = await searchParams;
  const page = parsePage(params.page);
  const dashboard = await getCarePlanDashboard({ page, pageSize: 25 });
  const pageHref = (targetPage: number) => {
    const query = new URLSearchParams();
    if (targetPage > 1) query.set("page", String(targetPage));
    const search = query.toString();
    return search ? `/health/care-plans?${search}` : "/health/care-plans";
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Care Plans Dashboard</CardTitle>
        <p className="mt-1 text-sm text-muted">Initial review due within 30 days of enrollment; all subsequent reviews due every 180 days.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-5">
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Total Plans</p><p className="text-base font-semibold">{dashboard.summary.total}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Due Soon</p><p className="text-base font-semibold">{dashboard.summary.dueSoon}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Due Now</p><p className="text-base font-semibold">{dashboard.summary.dueNow}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Overdue</p><p className="text-base font-semibold">{dashboard.summary.overdue}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Recently Completed</p><p className="text-base font-semibold">{dashboard.summary.completedRecently}</p></div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href="/health/care-plans/new" className="rounded-lg border border-border bg-brand px-3 py-2 text-sm font-semibold text-white">New Care Plan</Link>
          <Link href="/health/care-plans/list" className="rounded-lg border border-border bg-brandSoft px-3 py-2 text-sm font-semibold text-brand">Care Plans List</Link>
          <Link href="/health/care-plans/due-report" className="rounded-lg border border-border bg-brandSoft px-3 py-2 text-sm font-semibold text-brand">Due Report</Link>
        </div>
      </Card>

      <Card className="table-wrap">
        <CardTitle>Upcoming / Overdue Reviews</CardTitle>
        <table>
          <thead><tr><th>Member</th><th>Track</th><th>Enrollment</th><th>Last Completed</th><th>Next Due</th><th>Status</th><th>Open</th></tr></thead>
          <tbody>
            {dashboard.plans.map((plan) => (
              <tr key={plan.id}>
                <td>
                  <Link className="font-semibold text-brand" href={`/health/care-plans/list?memberId=${plan.memberId}`}>
                    {plan.memberName}
                  </Link>
                </td>
                <td>{plan.track}</td>
                <td>{formatDate(plan.enrollmentDate)}</td>
                <td>{formatOptionalDate(plan.lastCompletedDate)}</td>
                <td>{formatDate(plan.nextDueDate)}</td>
                <td><StatusLink status={plan.status} href={plan.actionHref} /></td>
                <td>
                  <Link className="font-semibold text-brand" href={plan.openHref}>
                    {plan.hasExistingPlan ? "Details" : "Create"}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link
            href={dashboard.page > 1 ? pageHref(dashboard.page - 1) : "#"}
            className={`rounded border px-3 py-1 font-semibold ${dashboard.page > 1 ? "border-border text-brand" : "cursor-not-allowed border-border text-muted"}`}
          >
            Previous
          </Link>
          {Array.from({ length: dashboard.totalPages }, (_, index) => index + 1).map((pageNumber) => (
            <Link
              key={pageNumber}
              href={pageHref(pageNumber)}
              className={`rounded border px-3 py-1 ${pageNumber === dashboard.page ? "border-brand bg-brand text-white" : "border-border text-brand"}`}
            >
              {pageNumber}
            </Link>
          ))}
          <Link
            href={dashboard.page < dashboard.totalPages ? pageHref(dashboard.page + 1) : "#"}
            className={`rounded border px-3 py-1 font-semibold ${dashboard.page < dashboard.totalPages ? "border-border text-brand" : "cursor-not-allowed border-border text-muted"}`}
          >
            Next
          </Link>
        </div>
      </Card>

      <Card className="table-wrap">
        <CardTitle>Recently Completed Reviews</CardTitle>
        <table>
          <thead><tr><th>Review Date</th><th>Member</th><th>Track</th><th>Reviewed By</th><th>Summary</th><th>Next Due</th></tr></thead>
          <tbody>
            {dashboard.recentlyCompleted.map((row) => (
              <tr key={row.id}>
                <td>
                  <Link className="font-semibold text-brand" href={row.versionId ? `/health/care-plans/${row.carePlanId}/versions/${row.versionId}` : `/health/care-plans/${row.carePlanId}`}>
                    {formatDate(row.reviewDate)}
                  </Link>
                </td>
                <td>
                  <Link className="font-semibold text-brand" href={`/health/care-plans/list?memberId=${row.memberId}`}>
                    {row.memberName}
                  </Link>
                </td>
                <td>{row.track}</td>
                <td>{row.reviewedBy}</td>
                <td>{row.summary}</td>
                <td>{formatDate(row.nextDueDate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}


