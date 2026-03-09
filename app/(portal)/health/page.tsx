import Link from "next/link";

import { BloodSugarForm } from "@/components/forms/workflow-forms";
import { Card, CardTitle } from "@/components/ui/card";
import { getCurrentProfile, requireModuleAccess } from "@/lib/auth";
import { getCarePlanDashboard } from "@/lib/services/care-plans";
import { getMembers } from "@/lib/services/documentation";
import { getHealthSnapshot } from "@/lib/services/health-workflows";
import { getClinicalOverview } from "@/lib/services/health";
import { formatDateTime, formatOptionalDateTime } from "@/lib/utils";

export default async function HealthPage() {
  await requireModuleAccess("health");
  const profile = await getCurrentProfile();
  const [{ mar, bloodSugar }, members, snapshot, carePlans] = await Promise.all([
    getClinicalOverview(),
    getMembers(),
    getHealthSnapshot(),
    Promise.resolve(getCarePlanDashboard())
  ]);

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Nursing Dashboard</CardTitle>
        <p className="mt-1 text-sm text-muted">Clinical overview for medication timing, glucose checks, member-specific health actions, and care plan due tracking.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">MAR Today</p><p className="text-base font-semibold">{snapshot.marToday.length}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Glucose Logs</p><p className="text-base font-semibold">{snapshot.bloodSugarHistory.length}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Member Actions</p><p className="text-base font-semibold">{snapshot.memberActions.length}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Care Plans</p><p className="text-base font-semibold">{carePlans.summary.total}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Due Soon</p><p className="text-base font-semibold">{carePlans.summary.dueSoon}</p></div>
          <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Overdue</p><p className="text-base font-semibold">{carePlans.summary.overdue}</p></div>
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          <Link href="/documentation/blood-sugar" className="font-semibold text-brand">Open Blood Sugar Workflow</Link>
          <Link href="/health/assessment" className="font-semibold text-brand">Open Assessment Workflow</Link>
          <Link href="/health/care-plans" className="font-semibold text-brand">Open Care Plans Dashboard</Link>
          <Link href="/health/care-plans/due-report" className="font-semibold text-brand">Open Care Plan Due Report</Link>
          {profile.role === "admin" || profile.role === "nurse" ? (
            <Link href="/health/physician-orders" className="font-semibold text-brand">Open Physician Orders</Link>
          ) : null}
          {profile.role === "admin" || profile.role === "nurse" ? (
            <Link href="/health/member-health-profiles" className="font-semibold text-brand">Open Member Health Profiles</Link>
          ) : null}
        </div>
      </Card>

      <Card>
        <CardTitle>Blood Sugar Testing Entry</CardTitle>
        <div className="mt-3"><BloodSugarForm members={members} /></div>
      </Card>

      <Card className="table-wrap">
        <CardTitle>MAR / Today</CardTitle>
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
            {mar.map((row: any) => (
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
            {bloodSugar.map((row: any) => (
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



