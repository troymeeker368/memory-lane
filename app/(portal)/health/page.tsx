import Link from "next/link";

import { BloodSugarFormShell } from "@/components/forms/workflow-forms-shells";
import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import { canAccessCarePlansForRole } from "@/lib/services/care-plan-authorization";
import { getHealthDashboardData } from "@/lib/services/health-dashboard";
import { formatDateTime, formatOptionalDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface MarRow {
  id: string;
  member_name: string;
  medication_name: string;
  due_at: string;
  administered_at: string | null;
  nurse_name: string | null;
  status: string;
}

interface BloodSugarRow {
  id: string;
  checked_at: string;
  member_name: string;
  reading_mg_dl: number | string;
  nurse_name: string | null;
  notes: string | null;
}

interface IncidentRow {
  id: string;
  incidentNumber: string;
  category: string;
  reportable: boolean;
  status: string;
  participantName: string | null;
  staffMemberName: string | null;
  incidentDateTime: string;
  location: string;
}

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export default async function HealthPage() {
  const profile = await requireModuleAccess("health");
  const canViewCarePlans = canAccessCarePlansForRole(profile.role);
  const dashboard = await getHealthDashboardData({ includeCarePlans: canViewCarePlans });
  const marRows = dashboard.marRows as MarRow[];
  const bloodSugarRows = dashboard.bloodSugarRows as BloodSugarRow[];
  const dueMedicationRows = dashboard.dueMedicationRows as MarRow[];
  const overdueMedicationRows = dashboard.overdueMedicationRows as MarRow[];
  const recentHealthDocs = dashboard.recentHealthDocs;
  const careAlerts = dashboard.careAlerts;
  const carePlans = dashboard.carePlans;
  const incidents = dashboard.incidents;
  const members = dashboard.members;
  const now = new Date();

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Nursing Dashboard</CardTitle>
        <p className="mt-1 text-sm text-muted">Medication priorities, health documentation, and member care alerts.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Meds Due (4h)</p><p className="text-base font-semibold">{dueMedicationRows.length}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Medication Alerts</p><p className="text-base font-semibold">{overdueMedicationRows.length}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Recent Health Docs</p><p className="text-base font-semibold">{recentHealthDocs.length}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Members w/ Alerts</p><p className="text-base font-semibold">{careAlerts.length}</p></div>
          {canViewCarePlans ? (
            <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Care Plans Due Soon</p><p className="text-base font-semibold">{carePlans.summary.dueSoon}</p></div>
          ) : null}
          {canViewCarePlans ? (
            <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Care Plans Overdue</p><p className="text-base font-semibold">{carePlans.summary.overdue}</p></div>
          ) : null}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="table-wrap">
          <CardTitle>Medication-Related Alerts</CardTitle>
          <table className="mt-3">
            <thead>
              <tr>
                <th>Member</th>
                <th>Medication</th>
                <th>Due</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {dueMedicationRows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-sm text-muted">No medication alerts in the next 4 hours.</td>
                </tr>
              ) : (
                dueMedicationRows.slice(0, 12).map((row) => (
                  <tr key={row.id}>
                    <td>{row.member_name}</td>
                    <td>{row.medication_name}</td>
                    <td>{formatDateTime(row.due_at)}</td>
                    <td>{parseDate(row.due_at) && (parseDate(row.due_at) as Date) < now ? "Overdue" : "Scheduled"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>

        <Card className="table-wrap">
          <CardTitle>Recent Health Documentation</CardTitle>
          <table className="mt-3">
            <thead>
              <tr>
                <th>When</th>
                <th>Member</th>
                <th>Type</th>
                <th>Summary</th>
              </tr>
            </thead>
            <tbody>
              {recentHealthDocs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-sm text-muted">No recent health documentation.</td>
                </tr>
              ) : (
                recentHealthDocs.slice(0, 12).map((row) => (
                  <tr key={row.id}>
                    <td>{formatDateTime(row.when)}</td>
                    <td>{row.memberName}</td>
                    <td>{row.source}</td>
                    <td>{row.detail}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="table-wrap">
          <CardTitle>Allergy / Diet / Care Alerts</CardTitle>
          <table className="mt-3">
            <thead>
              <tr>
                <th>Member</th>
                <th>Flags</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {careAlerts.length === 0 ? (
                <tr>
                  <td colSpan={3} className="text-sm text-muted">No care alerts flagged.</td>
                </tr>
              ) : (
                careAlerts.map((row) => (
                  <tr key={row.memberId}>
                    <td>
                      <Link href={`/health/member-health-profiles/${row.memberId}`} className="font-semibold text-brand">
                        {row.memberName}
                      </Link>
                    </td>
                    <td>{row.flags.join(", ")}</td>
                    <td>{row.summary}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>

        <Card>
          <CardTitle>Recent Incidents</CardTitle>
          <div className="mt-3 space-y-2">
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted">Submitted</p>
                <p className="text-base font-semibold">{incidents.counts.submitted}</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted">Returned</p>
                <p className="text-base font-semibold">{incidents.counts.returned}</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted">Approved</p>
                <p className="text-base font-semibold">{incidents.counts.approved}</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted">Reportable Open</p>
                <p className="text-base font-semibold">{incidents.counts.reportableOpen}</p>
              </div>
            </div>
            <div className="rounded-lg border border-border p-3">
              {incidents.recent.length === 0 ? (
                <p className="text-sm text-muted">No recent incidents have been recorded.</p>
              ) : (
                <div className="space-y-2">
                  {incidents.recent.slice(0, 4).map((incident: IncidentRow) => (
                    <div key={incident.id} className="flex items-start justify-between gap-3 border-b border-border pb-2 last:border-b-0 last:pb-0">
                      <div>
                        <Link href={`/documentation/incidents/${incident.id}`} className="font-semibold text-brand">
                          {incident.incidentNumber}
                        </Link>
                        <p className="text-xs text-muted">
                          {incident.participantName ?? incident.staffMemberName ?? "General incident"} | {incident.location}
                        </p>
                      </div>
                      <div className="text-right text-xs text-muted">
                        <p className="capitalize">{incident.status.replaceAll("_", " ")}</p>
                        <p>{formatDateTime(incident.incidentDateTime)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <Link href="/documentation/incidents" className="mt-3 inline-block text-sm font-semibold text-brand">
                Open Incident Workflow
              </Link>
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <CardTitle>Health Unit Quick Access</CardTitle>
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          <Link href="/health/mar" className="font-semibold text-brand">MAR Workflow</Link>
          <Link href="/documentation/blood-sugar" className="font-semibold text-brand">Blood Sugar Workflow</Link>
          <Link href="/documentation/incidents" className="font-semibold text-brand">Incident Reports</Link>
          <Link href="/health/assessment" className="font-semibold text-brand">New Intake Assessment</Link>
          <Link href="/health/physician-orders" className="font-semibold text-brand">Physician Orders / POF</Link>
          <Link href="/health/member-health-profiles" className="font-semibold text-brand">Member Health Profiles</Link>
          {canViewCarePlans ? <Link href="/health/care-plans" className="font-semibold text-brand">Care Plans</Link> : null}
        </div>
      </Card>

      <Card>
        <CardTitle>Blood Sugar Testing Entry</CardTitle>
        <div className="mt-3">
          <BloodSugarFormShell members={members} />
        </div>
      </Card>

      <Card className="table-wrap">
        <CardTitle>MAR / Today (Summary)</CardTitle>
        <p className="mb-2 text-xs text-muted">Use the dedicated MAR Workflow for Given / Not Given and PRN documentation.</p>
        <table>
          <thead>
            <tr>
              <th>Member</th>
              <th>Medication</th>
              <th>Due</th>
              <th>Administered</th>
              <th>Nurse</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {marRows.map((row) => (
              <tr key={row.id}>
                <td>{row.member_name}</td>
                <td>{row.medication_name}</td>
                <td>{formatDateTime(row.due_at)}</td>
                <td>{formatOptionalDateTime(row.administered_at)}</td>
                <td>{row.nurse_name ?? "-"}</td>
                <td>{row.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="table-wrap">
        <CardTitle>Blood Sugar History</CardTitle>
        <table>
          <thead>
            <tr>
              <th>Checked At</th>
              <th>Member</th>
              <th>Reading (mg/dL)</th>
              <th>Nurse</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {bloodSugarRows.map((row) => (
              <tr key={row.id}>
                <td>{formatDateTime(row.checked_at)}</td>
                <td>{row.member_name}</td>
                <td>{row.reading_mg_dl}</td>
                <td>{row.nurse_name ?? "-"}</td>
                <td>{row.notes ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
