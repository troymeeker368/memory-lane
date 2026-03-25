import Link from "next/link";

import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import { listMembersPageSupabase } from "@/lib/services/member-command-center-read";
import { formatOptionalDate } from "@/lib/utils";

function firstQueryValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function parsePageNumber(value: string | string[] | undefined) {
  const normalized = firstQueryValue(value).trim();
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function buildMembersHref(input: {
  query: string;
  statusFilter: string;
  page: number;
}) {
  const params = new URLSearchParams();
  if (input.query) params.set("q", input.query);
  if (input.statusFilter && input.statusFilter !== "all") params.set("status", input.statusFilter);
  if (input.page > 1) params.set("page", String(input.page));
  const query = params.toString();
  return query ? `/members?${query}` : "/members";
}

export default async function MembersPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, params] = await Promise.all([requireModuleAccess("documentation"), searchParams]);
  const query = typeof params.q === "string" ? params.q.trim() : "";
  const statusFilter = typeof params.status === "string" ? params.status : "all";
  const page = parsePageNumber(params.page);

  const { rows, page: currentPage, totalPages, totalRows, pageSize } = await listMembersPageSupabase({
    q: query,
    status: statusFilter === "active" || statusFilter === "inactive" ? statusFilter : "all",
    page,
    pageSize: 50
  });
  const hasPreviousPage = currentPage > 1;
  const hasNextPage = currentPage < totalPages;
  const rangeStart = rows.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const rangeEnd = rows.length === 0 ? 0 : rangeStart + rows.length - 1;

  return (
    <Card className="table-wrap">
      <CardTitle>Members / Participants</CardTitle>
      <form className="mt-3 grid gap-2 sm:grid-cols-4" method="get">
        <input
          name="q"
          defaultValue={query}
          placeholder="Search member"
          className="h-10 rounded-lg border border-border px-3"
        />
        <select name="status" defaultValue={statusFilter} className="h-10 rounded-lg border border-border px-3">
          <option value="all">All Statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <button type="submit" className="h-10 rounded-lg bg-[#1B3E93] px-3 font-semibold text-white">
          Filter
        </button>
        <Link href="/members" className="h-10 rounded-lg border border-border px-3 font-semibold leading-10 text-center">
          Clear Filters
        </Link>
      </form>

      <p className="mt-2 text-xs text-muted">
        Showing {rangeStart}-{rangeEnd} of {totalRows} members
      </p>

      <table className="mt-3">
        <thead>
          <tr>
            <th>Member</th>
            <th>Status</th>
            <th>Enrollment Date</th>
            <th>Discharge Date</th>
            <th>Discharge Reason</th>
            <th>Disposition</th>
            <th>Open</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((member) => (
            <tr key={member.id}>
              <td>{member.display_name}</td>
              <td className="capitalize">{member.status}</td>
              <td>{formatOptionalDate(member.enrollment_date)}</td>
              <td>{formatOptionalDate(member.discharge_date)}</td>
              <td>{member.discharge_reason ?? "-"}</td>
              <td>{member.discharge_disposition ?? "-"}</td>
              <td>
                <Link href={`/members/${member.id}`} className="font-semibold text-brand">
                  Details
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
        <span>
          Page {currentPage} of {totalPages}
        </span>
        <div className="flex items-center gap-2">
          {hasPreviousPage ? (
            <Link
              href={buildMembersHref({ query, statusFilter, page: currentPage - 1 })}
              className="rounded-lg border border-border px-3 py-2 font-semibold text-primary-text"
            >
              Previous Page
            </Link>
          ) : null}
          {hasNextPage ? (
            <Link
              href={buildMembersHref({ query, statusFilter, page: currentPage + 1 })}
              className="rounded-lg border border-border px-3 py-2 font-semibold text-primary-text"
            >
              Next Page
            </Link>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
