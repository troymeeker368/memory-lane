import Link from "next/link";

import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import { listCompletedEnrollmentPacketRequests } from "@/lib/services/enrollment-packets-reporting";
import { formatOptionalDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

function firstValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default async function CompletedEnrollmentPacketsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireModuleAccess("sales");
  const params = await searchParams;
  const q = firstValue(params.q).trim();
  const statusParam = firstValue(params.status).trim().toLowerCase();
  const status = statusParam === "completed" || statusParam === "filed" ? statusParam : "all";
  const fromDate = firstValue(params.fromDate).trim();
  const toDate = firstValue(params.toDate).trim();
  const packets = await listCompletedEnrollmentPacketRequests({
    limit: 500,
    status,
    fromDate: fromDate || null,
    toDate: toDate || null,
    search: q || null
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Completed Enrollment Packets</CardTitle>
        <p className="mt-1 text-sm text-muted">Packets that caregivers have signed and moved to completed/filed status.</p>
        <form className="mt-3 grid gap-2 md:grid-cols-5" method="get">
          <input
            name="q"
            defaultValue={q}
            placeholder="Search member, caregiver, sender"
            className="h-10 rounded-lg border border-border px-3"
          />
          <select name="status" defaultValue={status} className="h-10 rounded-lg border border-border px-3">
            <option value="all">All Statuses</option>
            <option value="completed">Completed</option>
            <option value="filed">Filed</option>
          </select>
          <input name="fromDate" type="date" defaultValue={fromDate} className="h-10 rounded-lg border border-border px-3" />
          <input name="toDate" type="date" defaultValue={toDate} className="h-10 rounded-lg border border-border px-3" />
          <div className="flex gap-2">
            <button type="submit" className="h-10 rounded-lg bg-[#1B3E93] px-3 font-semibold text-white">
              Filter
            </button>
            <Link href="/sales/new-entries/completed-enrollment-packets" className="h-10 rounded-lg border border-border px-3 font-semibold leading-10 text-center">
              Clear
            </Link>
          </div>
        </form>
        <p className="mt-2 text-xs text-muted">Results: {packets.length}</p>
      </Card>

      <Card className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Member</th>
              <th>Lead</th>
              <th>Caregiver Email</th>
              <th>Status</th>
              <th>Sent</th>
              <th>Completed</th>
              <th>Sent By</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {packets.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center text-sm text-muted">
                  No completed enrollment packets found yet.
                </td>
              </tr>
            ) : (
              packets.map((packet) => (
                <tr key={packet.id}>
                  <td>{packet.memberName}</td>
                  <td>{packet.leadId ? packet.leadMemberName ?? packet.leadId : "-"}</td>
                  <td>{packet.caregiverEmail}</td>
                  <td className="capitalize">{packet.status.replace("_", " ")}</td>
                  <td>{formatOptionalDateTime(packet.sentAt)}</td>
                  <td>{formatOptionalDateTime(packet.completedAt)}</td>
                  <td>{packet.senderName ?? packet.senderUserId}</td>
                  <td>
                    <div className="flex flex-wrap gap-2">
                      <Link className="font-semibold text-brand" href={`/operations/member-command-center/${packet.memberId}`}>
                        Member
                      </Link>
                      {packet.leadId ? (
                        <Link className="font-semibold text-brand" href={`/sales/leads/${packet.leadId}`}>
                          Lead
                        </Link>
                      ) : null}
                    </div>
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
