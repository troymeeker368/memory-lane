import Link from "next/link";

import { CarePlanStatusLink } from "@/components/care-plans/care-plan-status-link";
import { Card, CardTitle } from "@/components/ui/card";
import { requireCarePlanAuthorizedUser } from "@/lib/services/care-plan-authorization";
import { getCarePlanTracks, getCarePlans } from "@/lib/services/care-plans";
import { listMemberPickerOptionsSupabase } from "@/lib/services/shared-lookups-supabase";
import { formatDate, formatOptionalDate } from "@/lib/utils";

function parsePage(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.floor(parsed);
}

export default async function CarePlanDueReportPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCarePlanAuthorizedUser();

  const params = await searchParams;
  const status = typeof params.status === "string" ? params.status : "All";
  const track = typeof params.track === "string" ? params.track : "All";
  const memberId = typeof params.memberId === "string" ? params.memberId : "All";
  const memberSearch = typeof params.memberSearch === "string" ? params.memberSearch : "";
  const page = parsePage(params.page);
  const [tracks, members, result] = await Promise.all([
    getCarePlanTracks(),
    listMemberPickerOptionsSupabase({
      q: memberSearch,
      selectedId: memberId === "All" ? null : memberId,
      status: "active",
      limit: 25
    }),
    getCarePlans({
      status,
      track: track === "All" ? undefined : track,
      memberId: memberId === "All" ? undefined : memberId,
      page,
      pageSize: 25
    })
  ]);
  const pageHref = (targetPage: number) => {
    const search = new URLSearchParams();
    if (status !== "All") search.set("status", status);
    if (track !== "All") search.set("track", track);
    if (memberSearch) search.set("memberSearch", memberSearch);
    if (memberId !== "All") search.set("memberId", memberId);
    if (targetPage > 1) search.set("page", String(targetPage));
    return `/health/care-plans/due-report?${search.toString()}`;
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Care Plan Due Report</CardTitle>
        <form className="mt-3 grid gap-2 md:grid-cols-5">
          <input name="memberSearch" defaultValue={memberSearch} placeholder="Search member name" className="h-10 rounded-lg border border-border px-3 text-sm" />
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
          <Link href="/health/care-plans/due-report" className="h-10 rounded-lg border border-border px-3 text-sm font-semibold leading-10 text-center text-brand">
            Clear Filters
          </Link>
        </form>
        <p className="mt-2 text-xs text-muted">Search at least 2 letters to load a limited active-member picker.</p>
      </Card>

      <Card className="table-wrap">
        <table>
          <thead><tr><th>Member</th><th>Track</th><th>Enrollment Date</th><th>Last Completed</th><th>Next Due Date</th><th>Status</th><th>Open</th></tr></thead>
          <tbody>
            {result.rows.map((plan) => (
              <tr key={plan.id}>
                <td><Link className="font-semibold text-brand" href={`/health/care-plans/list?memberId=${plan.memberId}`}>{plan.memberName}</Link></td>
                <td>{plan.track}</td>
                <td>{formatDate(plan.enrollmentDate)}</td>
                <td>{formatOptionalDate(plan.lastCompletedDate)}</td>
                <td>{formatDate(plan.nextDueDate)}</td>
                <td><CarePlanStatusLink status={plan.status} href={plan.actionHref} /></td>
                <td>
                  <Link href={plan.openHref} className="font-semibold text-brand">
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



