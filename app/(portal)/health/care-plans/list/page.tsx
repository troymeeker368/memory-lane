import Link from "next/link";

import { CarePlanStatusLink } from "@/components/care-plans/care-plan-status-link";
import { Card, CardTitle } from "@/components/ui/card";
import { requireCarePlanAuthorizedUser } from "@/lib/services/care-plan-authorization";
import {
  getCarePlanPostSignReadinessDetail,
  getCarePlanPostSignReadinessLabel,
  getCarePlanTracks,
  getCarePlans
} from "@/lib/services/care-plans";
import { getMembers } from "@/lib/services/documentation";
import { formatDate, formatOptionalDate } from "@/lib/utils";

function parsePage(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.floor(parsed);
}

function postSignReadinessClassName(status: "not_started" | "signed_pending_snapshot" | "signed_pending_caregiver_dispatch" | "ready") {
  if (status === "ready") return "bg-emerald-100 text-emerald-800";
  if (status === "not_started") return "bg-slate-100 text-slate-700";
  return "bg-amber-100 text-amber-800";
}

export default async function CarePlansListPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCarePlanAuthorizedUser();

  const params = await searchParams;
  const status = typeof params.status === "string" ? params.status : "All";
  const track = typeof params.track === "string" ? params.track : "All";
  const memberId = typeof params.memberId === "string" ? params.memberId : "All";
  const query = typeof params.q === "string" ? params.q : "";
  const page = parsePage(params.page);
  const [tracks, members, result] = await Promise.all([
    getCarePlanTracks(),
    getMembers(),
    getCarePlans({
    status,
    track: track === "All" ? undefined : track,
    memberId: memberId === "All" ? undefined : memberId,
    query: query || undefined,
    page,
    pageSize: 25
  })]);
  const sortedPlans = [...result.rows].sort((a, b) => {
    const aDate = a.lastCompletedDate || a.reviewDate || a.enrollmentDate;
    const bDate = b.lastCompletedDate || b.reviewDate || b.enrollmentDate;
    if (aDate === bDate) {
      return a.memberName.localeCompare(b.memberName);
    }
    return aDate < bDate ? 1 : -1;
  });
  const pageHref = (targetPage: number) => {
    const search = new URLSearchParams();
    if (query) search.set("q", query);
    if (status !== "All") search.set("status", status);
    if (track !== "All") search.set("track", track);
    if (memberId !== "All") search.set("memberId", memberId);
    if (targetPage > 1) search.set("page", String(targetPage));
    return `/health/care-plans/list?${search.toString()}`;
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Care Plans List</CardTitle>
        <form className="mt-3 grid gap-2 md:grid-cols-6">
          <input name="q" defaultValue={query} placeholder="Search member/track" className="h-10 rounded-lg border border-border px-3 text-sm" />
          <select name="status" defaultValue={status} className="h-10 rounded-lg border border-border px-3 text-sm">
            <option>All</option>
            <option>Due Soon</option>
            <option>Due Now</option>
            <option>Overdue</option>
            <option>Completed</option>
          </select>
          <select name="track" defaultValue={track} className="h-10 rounded-lg border border-border px-3 text-sm">
            <option>All</option>
            {tracks.map((value) => <option key={value}>{value}</option>)}
          </select>
          <select name="memberId" defaultValue={memberId} className="h-10 rounded-lg border border-border px-3 text-sm">
            <option value="All">All Members</option>
            {members.map((member) => <option key={member.id} value={member.id}>{member.display_name}</option>)}
          </select>
          <button type="submit" className="h-10 rounded-lg bg-brand px-3 text-sm font-semibold text-white">Apply</button>
          <Link href="/health/care-plans/list" className="h-10 rounded-lg border border-border px-3 text-sm font-semibold leading-10 text-center text-brand">
            Clear Filters
          </Link>
        </form>
      </Card>

      <Card className="table-wrap">
        <table>
          <thead><tr><th>Member</th><th>Track</th><th>Enrollment</th><th>Last Review</th><th>Next Due</th><th>Status</th><th>Post-Sign Readiness</th><th>Completed By</th><th>Open</th></tr></thead>
          <tbody>
            {sortedPlans.map((plan) => (
              <tr key={plan.id}>
                <td><Link className="font-semibold text-brand" href={`/health/care-plans/list?memberId=${plan.memberId}`}>{plan.memberName}</Link></td>
                <td>{plan.track}</td>
                <td>{formatDate(plan.enrollmentDate)}</td>
                <td>{formatOptionalDate(plan.lastCompletedDate)}</td>
                <td>{formatDate(plan.nextDueDate)}</td>
                <td><CarePlanStatusLink status={plan.status} href={plan.actionHref} /></td>
                <td>
                  <div className="space-y-1">
                    <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${postSignReadinessClassName(plan.postSignReadinessStatus)}`}>
                      {getCarePlanPostSignReadinessLabel(plan.postSignReadinessStatus)}
                    </span>
                    {getCarePlanPostSignReadinessDetail(plan.postSignReadinessStatus) ? (
                      <p className="max-w-xs text-xs text-muted">{getCarePlanPostSignReadinessDetail(plan.postSignReadinessStatus)}</p>
                    ) : null}
                  </div>
                </td>
                <td>{plan.completedBy ?? "-"}</td>
                <td>
                  <Link
                    className="font-semibold text-brand"
                    href={plan.hasExistingPlan ? `${plan.openHref}?view=detail` : plan.openHref}
                  >
                    {plan.hasExistingPlan ? "Detail" : "Create"}
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
            href={result.page > 1 ? pageHref(result.page - 1) : "#"}
            className={`rounded border px-3 py-1 font-semibold ${result.page > 1 ? "border-border text-brand" : "cursor-not-allowed border-border text-muted"}`}
          >
            Previous
          </Link>
          {Array.from({ length: result.totalPages }, (_, index) => index + 1).map((pageNumber) => (
            <Link
              key={pageNumber}
              href={pageHref(pageNumber)}
              className={`rounded border px-3 py-1 ${pageNumber === result.page ? "border-brand bg-brand text-white" : "border-border text-brand"}`}
            >
              {pageNumber}
            </Link>
          ))}
          <Link
            href={result.page < result.totalPages ? pageHref(result.page + 1) : "#"}
            className={`rounded border px-3 py-1 font-semibold ${result.page < result.totalPages ? "border-border text-brand" : "cursor-not-allowed border-border text-muted"}`}
          >
            Next
          </Link>
        </div>
      </Card>
    </div>
  );
}



