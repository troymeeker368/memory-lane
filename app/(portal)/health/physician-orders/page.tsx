import Link from "next/link";

import { Card, CardTitle } from "@/components/ui/card";
import { requireRoles } from "@/lib/auth";
import { canCreatePhysicianOrdersModuleForRole, PHYSICIAN_ORDER_MODULE_ROLES } from "@/lib/permissions";
import { resolveCanonicalMemberId } from "@/lib/services/canonical-person-ref";
import { listPhysicianOrderMemberLookup, listPhysicianOrdersPage } from "@/lib/services/physician-orders-read";
import { formatDate, formatDateTime } from "@/lib/utils";

function firstString(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function parsePageNumber(value: string | string[] | undefined) {
  const normalized = firstString(value)?.trim() ?? "";
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function buildPhysicianOrdersHref(input: {
  memberId: string;
  memberSearch: string;
  status: string;
  q: string;
  page: number;
}) {
  const params = new URLSearchParams();
  if (input.memberId) params.set("memberId", input.memberId);
  if (input.memberSearch) params.set("memberSearch", input.memberSearch);
  if (input.status && input.status !== "all") params.set("status", input.status);
  if (input.q) params.set("q", input.q);
  if (input.page > 1) params.set("page", String(input.page));
  const query = params.toString();
  return query ? `/health/physician-orders?${query}` : "/health/physician-orders";
}

function clinicalSyncLabel(status: "not_signed" | "pending" | "queued" | "failed" | "synced") {
  if (status === "synced") return "Synced";
  if (status === "failed") return "Failed";
  if (status === "queued") return "Queued";
  if (status === "pending") return "Pending";
  return "-";
}

export default async function PhysicianOrdersIndexPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const profile = await requireRoles(PHYSICIAN_ORDER_MODULE_ROLES);
  const canCreate = canCreatePhysicianOrdersModuleForRole(profile.role);
  const query = await searchParams;
  const memberId = firstString(query.memberId) ?? "";
  const memberSearch = firstString(query.memberSearch) ?? "";
  const status = firstString(query.status) ?? "all";
  const q = firstString(query.q) ?? "";
  const page = parsePageNumber(query.page);
  const canonicalMemberIdPromise = memberId
    ? resolveCanonicalMemberId(memberId, { actionLabel: "PhysicianOrdersIndexPage" })
    : Promise.resolve(memberId);
  const [members, canonicalMemberId, result] = await Promise.all([
    listPhysicianOrderMemberLookup({
      q: memberSearch,
      selectedId: memberId,
      limit: 25
    }),
    canonicalMemberIdPromise,
    canonicalMemberIdPromise.then((resolvedMemberId) =>
      listPhysicianOrdersPage({
        memberId: resolvedMemberId || undefined,
        status:
          status === "Draft" || status === "Sent" || status === "Signed" || status === "Expired" || status === "Superseded"
            ? status
            : "all",
        q,
        page,
        pageSize: 50
      })
    )
  ]);
  const { rows, page: currentPage, pageSize, totalRows, totalPages } = result;
  const hasPreviousPage = currentPage > 1;
  const hasNextPage = currentPage < totalPages;
  const rangeStart = rows.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const rangeEnd = rows.length === 0 ? 0 : rangeStart + rows.length - 1;

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Physician Orders</CardTitle>
        <p className="mt-1 text-sm text-muted">
          Structured nursing physician order workflow with status/signature tracking and member-linked file storage.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {canCreate ? (
            <Link
              href={canonicalMemberId ? `/health/physician-orders/new?memberId=${canonicalMemberId}` : "/health/physician-orders/new"}
              className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white"
            >
              New Physician Order
            </Link>
          ) : null}
          {canonicalMemberId ? (
            <Link
              href={`/operations/member-command-center/${canonicalMemberId}`}
              className="rounded-lg border border-border px-3 py-2 text-sm font-semibold"
            >
              Open Member Command Center
            </Link>
          ) : null}
        </div>
      </Card>

      <Card>
        <form className="grid gap-2 md:grid-cols-6" action="/health/physician-orders">
          <input
            name="memberSearch"
            defaultValue={memberSearch}
            placeholder="Search member name"
            className="h-10 rounded-lg border border-border px-3 text-sm"
          />
          <select name="memberId" defaultValue={canonicalMemberId} className="h-10 rounded-lg border border-border px-3 text-sm">
            <option value="">All members</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.display_name}
              </option>
            ))}
          </select>
          <select name="status" defaultValue={status} className="h-10 rounded-lg border border-border px-3 text-sm">
            <option value="all">All statuses</option>
            <option value="Draft">Draft</option>
            <option value="Sent">Sent</option>
            <option value="Signed">Signed</option>
            <option value="Expired">Expired</option>
            <option value="Superseded">Superseded</option>
          </select>
          <input
            name="q"
            defaultValue={q}
            placeholder="Search member, provider, or status"
            className="h-10 rounded-lg border border-border px-3 text-sm md:col-span-2"
          />
          <div className="flex gap-2">
            <button type="submit" className="h-10 rounded-lg bg-brand px-3 text-sm font-semibold text-white">
              Apply
            </button>
            <Link
              href="/health/physician-orders"
              className="h-10 rounded-lg border border-border px-3 text-center text-sm font-semibold leading-10"
            >
              Clear
            </Link>
          </div>
        </form>
        <p className="mt-2 text-xs text-muted">
          Search at least 2 letters to load a limited active-member picker for physician-order filters.
        </p>
        <p className="mt-1 text-xs text-muted">
          Showing {rangeStart}-{rangeEnd} of {totalRows} physician orders
        </p>
      </Card>

      <Card className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Member</th>
              <th>Status</th>
              <th>Level of Care</th>
              <th>Provider</th>
              <th>Sent</th>
              <th>Next Renewal Due</th>
              <th>Renewal Status</th>
              <th>Signed</th>
              <th>Clinical Sync</th>
              <th>Updated</th>
              <th>Open</th>
              <th>Print</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                  <td colSpan={12} className="text-sm text-muted">
                    No physician orders found for current filters.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.memberName}</td>
                  <td>{row.status}</td>
                  <td>{row.levelOfCare ?? "-"}</td>
                  <td>{row.providerName ?? "-"}</td>
                  <td>{row.completedDate ? formatDate(row.completedDate) : "-"}</td>
                  <td>{row.nextRenewalDueDate ? formatDate(row.nextRenewalDueDate) : "-"}</td>
                  <td>{row.renewalStatus}</td>
                  <td>{row.signedDate ? formatDate(row.signedDate) : "-"}</td>
                  <td>{clinicalSyncLabel(row.clinicalSyncStatus)}</td>
                  <td>{formatDateTime(row.updatedAt)}</td>
                  <td>
                    <Link href={`/health/physician-orders/${row.id}?from=list`} className="font-semibold text-brand">
                      Open
                    </Link>
                  </td>
                  <td>
                    <Link href={`/health/physician-orders/${row.id}/print`} className="font-semibold text-brand">
                      Print
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
          <span>
            Page {currentPage} of {totalPages}
          </span>
          <div className="flex items-center gap-2">
            {hasPreviousPage ? (
              <Link
                href={buildPhysicianOrdersHref({ memberId: canonicalMemberId, memberSearch, status, q, page: currentPage - 1 })}
                className="rounded-lg border border-border px-3 py-2 font-semibold text-primary-text"
              >
                Previous Page
              </Link>
            ) : null}
            {hasNextPage ? (
              <Link
                href={buildPhysicianOrdersHref({ memberId: canonicalMemberId, memberSearch, status, q, page: currentPage + 1 })}
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
