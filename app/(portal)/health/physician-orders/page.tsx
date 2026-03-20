import Link from "next/link";

import { Card, CardTitle } from "@/components/ui/card";
import { requireRoles } from "@/lib/auth";
import { canCreatePhysicianOrdersModuleForRole, PHYSICIAN_ORDER_MODULE_ROLES } from "@/lib/permissions";
import { resolveCanonicalMemberId } from "@/lib/services/canonical-person-ref";
import { getPhysicianOrders } from "@/lib/services/physician-orders-supabase";
import { listActiveMemberLookupSupabase } from "@/lib/services/shared-lookups-supabase";
import { formatDate, formatDateTime } from "@/lib/utils";

function firstString(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0];
  return value;
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
  const status = firstString(query.status) ?? "all";
  const q = firstString(query.q) ?? "";

  let canonicalMemberId = memberId;
  if (memberId) {
    canonicalMemberId = await resolveCanonicalMemberId(memberId, { actionLabel: "PhysicianOrdersIndexPage" });
  }

  const rows = await getPhysicianOrders({
    memberId: canonicalMemberId || undefined,
    status:
      status === "Draft" || status === "Sent" || status === "Signed" || status === "Expired" || status === "Superseded"
        ? status
        : "all",
    q
  });
  const members = await listActiveMemberLookupSupabase();

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
        <form className="grid gap-2 md:grid-cols-5" action="/health/physician-orders">
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
            placeholder="Search member/provider"
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
        <p className="mt-2 text-xs text-muted">Total: {rows.length}</p>
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
      </Card>
    </div>
  );
}
