import Link from "next/link";

import { Card, CardTitle } from "@/components/ui/card";
import { requireRoles } from "@/lib/auth";
import { firstSearchParam, parseEnumSearchParam, parsePositivePageParam } from "@/lib/search-params";
import { getMemberHealthProfileIndexSupabase } from "@/lib/services/member-health-profiles-supabase";

function getInitials(displayName: string) {
  const parts = displayName
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) return "NA";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
}

export default async function MemberHealthProfilesPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRoles(["admin", "nurse"]);
  const params = await searchParams;
  const q = firstSearchParam(params.q) ?? "";
  const status = parseEnumSearchParam(firstSearchParam(params.status), ["all", "active", "inactive"] as const, "active");
  const page = parsePositivePageParam(firstSearchParam(params.page));

  const result = await getMemberHealthProfileIndexSupabase({ q, status, page, pageSize: 25 });
  const pageHref = (targetPage: number) => {
    const query = new URLSearchParams();
    if (q) query.set("q", q);
    if (status !== "active") query.set("status", status);
    if (targetPage > 1) query.set("page", String(targetPage));
    const search = query.toString();
    return search ? `/health/member-health-profiles?${search}` : "/health/member-health-profiles";
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Member Health Profiles</CardTitle>
        <p className="mt-1 text-sm text-muted">
          Nurse/Admin clinical profiles tied directly to each member record.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted">Profiles</p>
            <p className="text-lg font-semibold">{result.totalRows}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted">Active Members</p>
            <p className="text-lg font-semibold">{result.activeCount}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted">Members with Alerts</p>
            <p className="text-lg font-semibold">{result.withAlertsCount}</p>
          </div>
        </div>
      </Card>

      <Card className="table-wrap">
        <CardTitle>Profile List</CardTitle>
        <form className="mt-3 grid gap-2 md:grid-cols-4" method="get">
          <input
            name="q"
            defaultValue={q}
            placeholder="Search member"
            className="h-10 rounded-lg border border-border px-3"
          />
          <select name="status" defaultValue={status} className="h-10 rounded-lg border border-border px-3">
            <option value="all">All Statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <button type="submit" className="h-10 rounded-lg bg-brand px-3 text-sm font-semibold text-white">
            Apply
          </button>
          <Link href="/health/member-health-profiles" className="h-10 rounded-lg border border-border px-3 text-sm font-semibold leading-10 text-center">
            Clear
          </Link>
        </form>

        <table className="mt-3">
          <thead>
            <tr>
              <th>Member</th>
              <th>Status</th>
              <th>Code Status</th>
              <th>Track</th>
              <th>Alerts</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center text-sm text-muted">
                  No members match this filter.
                </td>
              </tr>
            ) : (
              result.rows.map((row) => (
                <tr key={row.member.id}>
                  <td>
                    <div className="flex items-center gap-2">
                      {row.profile.profile_image_url ? (
                        <Link href={`/health/member-health-profiles/${row.member.id}`} aria-label={`Open ${row.member.display_name} profile`}>
                          <img
                            src={row.profile.profile_image_url}
                            alt={`${row.member.display_name} profile`}
                            className="h-10 w-10 rounded-full border border-border object-cover"
                          />
                        </Link>
                      ) : (
                        <Link
                          href={`/health/member-health-profiles/${row.member.id}`}
                          aria-label={`Open ${row.member.display_name} profile`}
                          className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-slate-100 text-[11px] font-semibold text-primary-text"
                        >
                          {getInitials(row.member.display_name)}
                        </Link>
                      )}
                      <Link className="font-semibold text-brand" href={`/health/member-health-profiles/${row.member.id}`}>
                        {row.member.display_name}
                      </Link>
                    </div>
                  </td>
                  <td>
                    <Link className="capitalize font-semibold text-brand" href={`/members/${row.member.id}#discharge-actions`}>
                      {row.member.status}
                    </Link>
                  </td>
                  <td>{row.profile.code_status ?? row.member.code_status ?? "-"}</td>
                  <td>{row.member.latest_assessment_track ?? "-"}</td>
                  <td>{row.alerts.length > 0 ? row.alerts.join(" | ") : "-"}</td>
                </tr>
              ))
            )}
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
