import Link from "next/link";

import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import { getSalesWorkflows } from "@/lib/services/sales-workflows";
import { formatOptionalDate } from "@/lib/utils";

const PAGE_SIZE = 25;

function parsePage(raw: string | string[] | undefined) {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.floor(parsed);
}

function normalizeQuery(raw: string | string[] | undefined) {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (value ?? "").trim();
}

function includesQuery(value: unknown, query: string) {
  return String(value ?? "").toLowerCase().includes(query.toLowerCase());
}

export default async function ReferralSourcesPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireModuleAccess("sales");
  const params = await searchParams;
  const { referralSources } = await getSalesWorkflows();

  const query = normalizeQuery(params.q);
  const requestedPage = parsePage(params.page);

  const seen = new Set<string>();
  const dedupedSources = (referralSources as any[]).filter((source) => {
    const key = String(source.id ?? "").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const filteredSources = query
    ? dedupedSources.filter((source) =>
        includesQuery(source.contact_name, query) ||
        includesQuery(source.organization_name, query) ||
        includesQuery(source.job_title, query) ||
        includesQuery(source.primary_phone, query) ||
        includesQuery(source.primary_email, query) ||
        includesQuery(source.preferred_contact_method, query)
      )
    : dedupedSources;

  const totalRows = filteredSources.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const currentPage = Math.min(requestedPage, totalPages);
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const pageRows = filteredSources.slice(startIndex, startIndex + PAGE_SIZE);

  const pageHref = (page: number) => {
    const qs = new URLSearchParams();
    if (query) qs.set("q", query);
    qs.set("page", String(page));
    return `/sales/community-partners/referral-sources?${qs.toString()}`;
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Referral Sources</CardTitle>
        <form className="mt-3 flex flex-wrap gap-2" method="get">
          <input
            type="text"
            name="q"
            defaultValue={query}
            placeholder="Search contact, organization, title, phone, email"
            className="h-10 min-w-[20rem] flex-1 rounded-lg border border-border bg-white px-3 text-sm text-fg"
          />
          <button type="submit" className="h-10 rounded-lg bg-brand px-3 text-sm font-semibold text-white">Search</button>
          <Link href="/sales/community-partners/referral-sources" className="h-10 rounded-lg border border-border px-3 text-sm font-semibold leading-10">Clear Filters</Link>
        </form>
        <p className="mt-2 text-xs text-muted">
          Showing {totalRows === 0 ? 0 : startIndex + 1} - {Math.min(startIndex + pageRows.length, totalRows)} of {totalRows} referral sources
          (25 per page).
        </p>
      </Card>

      <Card className="table-wrap">
        <table>
          <thead><tr><th>Contact Name</th><th>Organization</th><th>Job Title</th><th>Primary Phone</th><th>Primary Email</th><th>Preferred Contact</th><th>Last Touched</th><th>Active</th></tr></thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center text-sm text-muted">No referral sources found.</td>
              </tr>
            ) : (
              pageRows.map((source: any) => (
                <tr key={source.id}>
                  <td><Link className="font-semibold text-brand" href={`/sales/community-partners/referral-sources/${source.id}`}>{source.contact_name}</Link></td>
                  <td>{source.organization_name}</td>
                  <td>{source.job_title || "-"}</td>
                  <td>{source.primary_phone || "-"}</td>
                  <td>{source.primary_email || "-"}</td>
                  <td>{source.preferred_contact_method || "-"}</td>
                  <td>{formatOptionalDate(source.last_touched)}</td>
                  <td>{source.active ? "Yes" : "No"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link
            href={currentPage > 1 ? pageHref(currentPage - 1) : "#"}
            className={`rounded border px-3 py-1 font-semibold ${currentPage > 1 ? "border-border text-brand" : "cursor-not-allowed border-border text-muted"}`}
          >
            Previous
          </Link>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
            <Link
              key={page}
              href={pageHref(page)}
              className={`rounded border px-3 py-1 ${page === currentPage ? "border-brand bg-brand text-white" : "border-border text-brand"}`}
            >
              {page}
            </Link>
          ))}
          <Link
            href={currentPage < totalPages ? pageHref(currentPage + 1) : "#"}
            className={`rounded border px-3 py-1 font-semibold ${currentPage < totalPages ? "border-border text-brand" : "cursor-not-allowed border-border text-muted"}`}
          >
            Next
          </Link>
        </div>
      </Card>
    </div>
  );
}
