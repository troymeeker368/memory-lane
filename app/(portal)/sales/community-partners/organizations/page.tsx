import Link from "next/link";

import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import { formatPhoneDisplay } from "@/lib/phone";
import {
  type SalesPartnerRow,
  type SalesReferralSourceRow,
  getCommunityPartnerDirectory,
  getReferralSourcesForPartners
} from "@/lib/services/sales-community-read";
import { formatOptionalDate } from "@/lib/utils";

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

function normalizeKey(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export default async function CommunityPartnerOrganizationsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireModuleAccess("sales");
  const params = await searchParams;

  const query = normalizeQuery(params.q);
  const requestedPage = parsePage(params.page);
  const partnerPage = await getCommunityPartnerDirectory({
    q: query || undefined,
    page: requestedPage,
    pageSize: 25
  });
  const pageRows = partnerPage.rows;
  const referralSources = await getReferralSourcesForPartners(pageRows.map((partner) => partner.id));

  const sourcesByPartner = new Map<string, SalesReferralSourceRow[]>();
  referralSources.forEach((source) => {
    const partnerKeys = [normalizeKey(source.partner_id)].filter(Boolean);
    partnerKeys.forEach((key) => {
      const existing = sourcesByPartner.get(key) ?? [];
      existing.push(source);
      sourcesByPartner.set(key, existing);
    });
  });
  const totalRows = partnerPage.totalRows;
  const totalPages = partnerPage.totalPages;
  const currentPage = partnerPage.page;
  const startIndex = (currentPage - 1) * partnerPage.pageSize;

  const pageHref = (page: number) => {
    const qs = new URLSearchParams();
    if (query) qs.set("q", query);
    qs.set("page", String(page));
    return `/sales/community-partners/organizations?${qs.toString()}`;
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Community Partner Organizations</CardTitle>
        <form className="mt-3 flex flex-wrap gap-2" method="get">
          <input
            type="text"
            name="q"
            defaultValue={query}
            placeholder="Search organization, category, contact, phone, email, location"
            className="h-10 min-w-[20rem] flex-1 rounded-lg border border-border bg-white px-3 text-sm text-fg"
          />
          <button type="submit" className="h-10 rounded-lg bg-brand px-3 text-sm font-semibold text-white">Search</button>
          <Link href="/sales/community-partners/organizations" className="h-10 rounded-lg border border-border px-3 text-sm font-semibold leading-10">Clear Filters</Link>
        </form>
        <p className="mt-2 text-xs text-muted">
          Showing {totalRows === 0 ? 0 : startIndex + 1} - {Math.min(startIndex + pageRows.length, totalRows)} of {totalRows} organizations
          (25 per page).
        </p>
      </Card>

      <Card className="table-wrap">
        <table>
          <thead><tr><th>Organization Name</th><th>Category</th><th>Contact</th><th>Primary Phone</th><th>Primary Email</th><th>Location</th><th>Last Touched</th><th>Active</th></tr></thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center text-sm text-muted">No organizations found.</td>
              </tr>
            ) : (
              pageRows.map((partner: SalesPartnerRow) => {
                const partnerKeys = [normalizeKey(partner.partner_id), normalizeKey(partner.id)].filter(Boolean);
                const linkedSources = partnerKeys.flatMap((key) => sourcesByPartner.get(key) ?? []);
                const linkedSource =
                  linkedSources[0] ?? null;

                return (
                  <tr key={partner.id}>
                    <td>
                      <Link className="font-semibold text-brand" href={`/sales/community-partners/organizations/${partner.id}`}>{partner.organization_name}</Link>
                    </td>
                    <td>{partner.category ?? "-"}</td>
                    <td>
                      {linkedSource ? (
                        <Link className="font-semibold text-brand" href={`/sales/community-partners/referral-sources/${linkedSource.id}`}>
                          {linkedSource.contact_name || "-"}
                        </Link>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td>{formatPhoneDisplay(partner.primary_phone)}</td>
                    <td>{partner.primary_email || "-"}</td>
                    <td>{partner.location || "-"}</td>
                    <td>{formatOptionalDate(partner.last_touched)}</td>
                    <td>{partner.active ? "Yes" : "No"}</td>
                  </tr>
                );
              })
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
