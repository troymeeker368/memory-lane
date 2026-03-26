import Link from "next/link";

import { EnrollmentPacketListActions } from "@/components/sales/enrollment-packet-list-actions";
import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import { listOperationalEnrollmentPackets } from "@/lib/services/enrollment-packets";
import { formatOptionalDateTime } from "@/lib/utils";

function firstValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default async function SalesEnrollmentPacketsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireModuleAccess("sales");
  const params = await searchParams;
  const q = firstValue(params.q).trim();
  const statusParam = firstValue(params.status).trim().toLowerCase();
  const status =
    statusParam === "draft" ||
    statusParam === "sent" ||
    statusParam === "in_progress" ||
    statusParam === "completed" ||
    statusParam === "voided" ||
    statusParam === "expired"
      ? statusParam
      : "all";
  const packets = await listOperationalEnrollmentPackets({
    limit: 500,
    status,
    search: q || null,
    includeCompleted: true
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Enrollment Packets</CardTitle>
        <p className="mt-1 text-sm text-muted">
          Manage draft, sent, in-progress, completed, expired, and voided packets from one canonical operational view.
        </p>
        <form className="mt-3 flex flex-wrap gap-2" method="get">
          <input
            name="q"
            defaultValue={q}
            placeholder="Search lead or caregiver"
            className="h-10 min-w-[240px] rounded-lg border border-border px-3"
          />
          <select name="status" defaultValue={status} className="h-10 rounded-lg border border-border px-3">
            <option value="all">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="sent">Sent</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="voided">Voided</option>
            <option value="expired">Expired</option>
          </select>
          <button type="submit" className="h-10 rounded-lg bg-[#1B3E93] px-3 font-semibold text-white">
            Filter
          </button>
          <Link href="/sales/pipeline/enrollment-packets" className="h-10 rounded-lg border border-border px-3 font-semibold leading-10">
            Clear
          </Link>
        </form>
        <p className="mt-2 text-xs text-muted">Results: {packets.length}</p>
      </Card>

      <Card className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Lead</th>
              <th>Status</th>
              <th>Sent</th>
              <th>Last Activity</th>
              <th>Completed</th>
              <th>Voided</th>
              <th>Initiated By</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {packets.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center text-sm text-muted">
                  No enrollment packets found for the current filters.
                </td>
              </tr>
            ) : (
              packets.map((packet) => (
                <tr key={packet.id}>
                  <td>{packet.leadMemberName ?? packet.memberName}</td>
                  <td className="capitalize">{packet.status.replaceAll("_", " ")}</td>
                  <td>{formatOptionalDateTime(packet.sentAt)}</td>
                  <td>{formatOptionalDateTime(packet.lastFamilyActivityAt ?? packet.updatedAt)}</td>
                  <td>
                    {formatOptionalDateTime(
                      packet.completedAt ??
                        (packet.status === "completed" ? packet.lastFamilyActivityAt ?? packet.updatedAt : null)
                    )}
                  </td>
                  <td>
                    <div className="space-y-1">
                      <p>{formatOptionalDateTime(packet.voidedAt)}</p>
                      {packet.voidReason ? <p className="max-w-xs text-xs text-muted">{packet.voidReason}</p> : null}
                    </div>
                  </td>
                  <td>{packet.senderName ?? packet.senderUserId}</td>
                  <td>
                    <EnrollmentPacketListActions packetId={packet.id} leadId={packet.leadId} status={packet.status} />
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
