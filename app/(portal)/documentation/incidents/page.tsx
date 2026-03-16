import Link from "next/link";

import { Card, CardTitle } from "@/components/ui/card";
import { MobileList } from "@/components/ui/mobile-list";
import { requireModuleAccess } from "@/lib/auth";
import { listIncidentDashboard } from "@/lib/services/incidents";
import { formatDateTime } from "@/lib/utils";

export default async function IncidentReportsPage() {
  await requireModuleAccess("documentation");
  const dashboard = await listIncidentDashboard({ limit: 50 });

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Incident Reports</CardTitle>
        <p className="mt-1 text-sm text-muted">
          Lightweight incident capture with director review and a state-ready audit trail.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-5">
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted">Total</p>
            <p className="text-lg font-semibold">{dashboard.counts.total}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted">Submitted</p>
            <p className="text-lg font-semibold">{dashboard.counts.submitted}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted">Returned</p>
            <p className="text-lg font-semibold">{dashboard.counts.returned}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted">Approved</p>
            <p className="text-lg font-semibold">{dashboard.counts.approved}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted">Reportable Open</p>
            <p className="text-lg font-semibold">{dashboard.counts.reportableOpen}</p>
          </div>
        </div>
        <div className="mt-3">
          <Link href="/documentation/incidents/new" className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white">
            New Incident
          </Link>
        </div>
      </Card>

      <MobileList
        items={dashboard.recent.map((row) => ({
          id: row.id,
          title: row.incidentNumber,
          fields: [
            { label: "Category", value: row.category },
            { label: "Status", value: row.status },
            { label: "When", value: formatDateTime(row.incidentDateTime) },
            { label: "Location", value: row.location },
            { label: "Open", value: <Link href={`/documentation/incidents/${row.id}`} className="font-semibold text-brand">View</Link> }
          ]
        }))}
      />

      <Card className="table-wrap hidden md:block">
        <CardTitle>Incident Queue</CardTitle>
        <table className="mt-3">
          <thead>
            <tr>
              <th>Incident</th>
              <th>Category</th>
              <th>Status</th>
              <th>Reportable</th>
              <th>Involved</th>
              <th>Incident Time</th>
              <th>Location</th>
              <th>Reporter</th>
            </tr>
          </thead>
          <tbody>
            {dashboard.recent.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center text-sm text-muted">
                  No incidents have been recorded yet.
                </td>
              </tr>
            ) : (
              dashboard.recent.map((row) => (
                <tr key={row.id}>
                  <td>
                    <Link href={`/documentation/incidents/${row.id}`} className="font-semibold text-brand">
                      {row.incidentNumber}
                    </Link>
                  </td>
                  <td className="capitalize">{row.category.replaceAll("_", " ")}</td>
                  <td className="capitalize">{row.status.replaceAll("_", " ")}</td>
                  <td>{row.reportable ? "Yes" : "No"}</td>
                  <td>{row.participantName ?? row.staffMemberName ?? "-"}</td>
                  <td>{formatDateTime(row.incidentDateTime)}</td>
                  <td>{row.location}</td>
                  <td>{row.reporterName}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
