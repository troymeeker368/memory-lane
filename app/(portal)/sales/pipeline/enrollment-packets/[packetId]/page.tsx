import Link from "next/link";
import { notFound } from "next/navigation";

import { EnrollmentPacketDetailActions } from "@/components/sales/enrollment-packet-detail-actions";
import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import {
  getOperationalEnrollmentPacketById,
  listEnrollmentPacketAuditEvents
} from "@/lib/services/enrollment-packets";
import { formatDateTime, formatOptionalDateTime } from "@/lib/utils";

export default async function EnrollmentPacketDetailPage({
  params
}: {
  params: Promise<{ packetId: string }>;
}) {
  await requireModuleAccess("sales");
  const { packetId } = await params;
  const [packet, events] = await Promise.all([
    getOperationalEnrollmentPacketById(packetId),
    listEnrollmentPacketAuditEvents(packetId)
  ]);
  if (!packet) notFound();

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Enrollment Packet</CardTitle>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted">Status</p>
            <p className="font-semibold capitalize">{packet.status.replaceAll("_", " ")}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted">Lead</p>
            <p className="font-semibold">{packet.leadMemberName ?? packet.leadId ?? "-"}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted">Member</p>
            <p className="font-semibold">{packet.memberName}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted">Sent</p>
            <p className="font-semibold">{formatOptionalDateTime(packet.sentAt)}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted">Opened</p>
            <p className="font-semibold">{formatOptionalDateTime(packet.openedAt)}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted">Last Activity</p>
            <p className="font-semibold">{formatDateTime(packet.lastFamilyActivityAt ?? packet.updatedAt)}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted">Completed</p>
            <p className="font-semibold">{formatOptionalDateTime(packet.completedAt)}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted">Voided</p>
            <p className="font-semibold">{formatOptionalDateTime(packet.voidedAt)}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted">Initiated By</p>
            <p className="font-semibold">{packet.senderName ?? packet.senderUserId}</p>
          </div>
        </div>
        {packet.voidReason ? (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <span className="font-semibold">Void Reason:</span> {packet.voidReason}
          </div>
        ) : null}
        <div className="mt-4">
          <EnrollmentPacketDetailActions packetId={packet.id} leadId={packet.leadId} status={packet.status} />
        </div>
      </Card>

      <Card className="table-wrap">
        <CardTitle>Audit Trail</CardTitle>
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Event</th>
              <th>Actor</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-sm text-muted">
                  No audit events recorded yet.
                </td>
              </tr>
            ) : (
              events.map((event) => (
                <tr key={event.id}>
                  <td>{formatDateTime(event.timestamp)}</td>
                  <td>{event.eventType}</td>
                  <td>{event.actorName ?? event.actorEmail ?? event.actorUserId ?? "-"}</td>
                  <td>
                    <pre className="max-w-xl whitespace-pre-wrap text-xs text-muted">
                      {JSON.stringify(event.metadata, null, 2)}
                    </pre>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      <div className="flex flex-wrap gap-3 text-sm">
        <Link href="/sales/pipeline/enrollment-packets" className="font-semibold text-brand">
          Back to Enrollment Packets
        </Link>
        {packet.leadId ? (
          <Link href={`/sales/leads/${packet.leadId}`} className="font-semibold text-brand">
            Open Lead
          </Link>
        ) : null}
      </div>
    </div>
  );
}
