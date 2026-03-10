import Link from "next/link";

import { Card, CardTitle } from "@/components/ui/card";
import { requireNavItemAccess } from "@/lib/auth";
import { getCarePlanTracks, getCarePlans } from "@/lib/services/care-plans";
import { getMembers } from "@/lib/services/documentation";
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

export default async function CarePlansListPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireNavItemAccess("/health/care-plans");

  const params = await searchParams;
  const status = typeof params.status === "string" ? params.status : "All";
  const track = typeof params.track === "string" ? params.track : "All";
  const memberId = typeof params.memberId === "string" ? params.memberId : "All";
  const query = typeof params.q === "string" ? params.q : "";
  const members = await getMembers();
  const tracks = getCarePlanTracks();
  const plans = getCarePlans({
    status,
    track: track === "All" ? undefined : track,
    memberId: memberId === "All" ? undefined : memberId,
    query: query || undefined
  });
  const sortedPlans = [...plans].sort((a, b) => {
    const aDate = a.lastCompletedDate || a.reviewDate || a.enrollmentDate;
    const bDate = b.lastCompletedDate || b.reviewDate || b.enrollmentDate;
    if (aDate === bDate) {
      return a.memberName.localeCompare(b.memberName);
    }
    return aDate < bDate ? 1 : -1;
  });

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
          <thead><tr><th>Member</th><th>Track</th><th>Enrollment</th><th>Last Review</th><th>Next Due</th><th>Status</th><th>Completed By</th><th>Open</th></tr></thead>
          <tbody>
            {sortedPlans.map((plan) => (
              <tr key={plan.id}>
                <td><Link className="font-semibold text-brand" href={`/health/care-plans/list?memberId=${plan.memberId}`}>{plan.memberName}</Link></td>
                <td>{plan.track}</td>
                <td>{formatDate(plan.enrollmentDate)}</td>
                <td>{formatOptionalDate(plan.lastCompletedDate)}</td>
                <td>{formatDate(plan.nextDueDate)}</td>
                <td><StatusLink status={plan.status} href={plan.actionHref} /></td>
                <td>{plan.completedBy ?? "-"}</td>
                <td>
                  <Link className="font-semibold text-brand" href={plan.openHref}>
                    {plan.hasExistingPlan ? "Detail" : "Create"}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}



