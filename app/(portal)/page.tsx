import Link from "next/link";

import { Card, CardBody, CardTitle } from "@/components/ui/card";
import { PunchStatusBadge, PunchTypeBadge } from "@/components/ui/punch-type-badge";
import { getCurrentProfile } from "@/lib/auth";
import { getDashboardAlerts, getDashboardStats } from "@/lib/services/dashboard";
import { formatDateTime } from "@/lib/utils";

export default async function DashboardPage() {
  const profile = await getCurrentProfile();
  const [stats, alerts] = await Promise.all([getDashboardStats(profile.id), getDashboardAlerts()]);
  const firstName = profile.full_name.trim().split(/\s+/)[0] || profile.full_name;

  const showLeadershipShortcuts = profile.role === "manager" || profile.role === "admin";
  const showNursingShortcuts = profile.role === "nurse";
  const canPunch = profile.role === "staff";
  const showIncompleteAttendanceFlag = profile.role === "admin" && stats.incompleteAttendance.totalIncomplete > 0;

  return (
    <>
      <header className="rounded-xl border border-border bg-white p-4">
        <p className="text-center text-xl font-bold text-brand">Welcome, {firstName}!</p>
        <h1 className="text-xl font-bold">Home Dashboard</h1>
        <p className="mt-1 text-sm text-muted">Operational overview for today, quick links, and role-specific priorities.</p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardTitle>Today&apos;s Logs</CardTitle>
          <CardBody><p className="text-2xl font-bold">{stats.todaysLogs}</p></CardBody>
        </Card>
        <Card>
          <CardTitle>Missing Documentation</CardTitle>
          <CardBody><p className="text-2xl font-bold">{stats.missingDocs}</p></CardBody>
        </Card>
        {canPunch ? (
          <Card>
            <CardTitle>Clock Status</CardTitle>
            <CardBody>
              <PunchStatusBadge status={stats.latestPunches[0]?.punch_type === "in" ? "Clocked In" : "Clocked Out"} />
            </CardBody>
          </Card>
        ) : null}
      </section>

      {showIncompleteAttendanceFlag ? (
        <section>
          <Card className="border-amber-300">
            <CardTitle>Attendance Incomplete Records</CardTitle>
            <CardBody>
              <p className="text-sm">
                {stats.incompleteAttendance.totalIncomplete} incomplete attendance record(s) for {stats.incompleteAttendance.selectedDate}.
              </p>
              <p className="mt-1 text-xs text-muted">
                Pending (not checked in and not absent): {stats.incompleteAttendance.pendingWithoutStatus} | Check-in without check-out: {stats.incompleteAttendance.checkInMissingCheckOut} | Check-out without check-in: {stats.incompleteAttendance.checkOutMissingCheckIn}
              </p>
              <Link
                href={`/operations/attendance?tab=daily-attendance&date=${stats.incompleteAttendance.selectedDate}`}
                className="mt-2 inline-block text-sm font-semibold text-brand"
              >
                Open Daily Attendance
              </Link>
            </CardBody>
          </Card>
        </section>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardTitle>Quick Actions</CardTitle>
          <CardBody className="space-x-2">
            <Link href="/documentation/activity" className="text-sm font-semibold text-brand">Participation Log</Link>
            <Link href="/documentation/toilet" className="text-sm font-semibold text-brand">Toilet Log</Link>
            {canPunch ? (
              <Link href="/time-card" className="text-sm font-semibold text-brand">Clock In/Out</Link>
            ) : null}
            {showLeadershipShortcuts ? (
              <Link href="/time-card/punch-history" className="text-sm font-semibold text-brand">Punch History</Link>
            ) : null}
          </CardBody>
        </Card>

        {showLeadershipShortcuts ? (
          <Card>
            <CardTitle>Manager/Admin Shortcuts</CardTitle>
            <CardBody className="space-x-2">
              <Link href="/reports" className="text-sm font-semibold text-brand">Reports</Link>
              <Link href="/reports/member-summary" className="text-sm font-semibold text-brand">Member Documentation Summary</Link>
              <Link href="/sales" className="text-sm font-semibold text-brand">Pipeline</Link>
              <Link href="/health/assessment" className="text-sm font-semibold text-brand">Assessments</Link>
            </CardBody>
          </Card>
        ) : null}

        {showNursingShortcuts ? (
          <Card>
            <CardTitle>Nursing Shortcuts</CardTitle>
            <CardBody className="space-x-2">
              <Link href="/health" className="text-sm font-semibold text-brand">Health Unit</Link>
              <Link href="/documentation/blood-sugar" className="text-sm font-semibold text-brand">Blood Sugar</Link>
            </CardBody>
          </Card>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-muted">Today&apos;s Important Items</h2>
        {alerts.length === 0 ? <Card>No active alerts.</Card> : null}
        {alerts.map((alert) => (
          <Card key={alert.id} className={alert.severity === "critical" ? "border-rose-200" : "border-amber-200"}>
            <div className="flex items-center justify-between gap-2">
              <div><p className="text-sm font-semibold">{alert.message}</p></div>
              <Link href={alert.actionHref} className="text-sm font-semibold text-brand">{alert.actionLabel}</Link>
            </div>
          </Card>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-muted">Recent Punches</h2>
        <Card className="table-wrap">
          <table>
            <thead><tr><th>Type</th><th>When</th></tr></thead>
            <tbody>
              {stats.latestPunches.map((p) => (
                <tr key={p.id}><td><PunchTypeBadge punchType={p.punch_type} /></td><td>{formatDateTime(p.punch_at)}</td></tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>
    </>
  );
}

