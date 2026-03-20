import Link from "next/link";

import { Card, CardBody, CardTitle } from "@/components/ui/card";
import { PunchStatusBadge, PunchTypeBadge } from "@/components/ui/punch-type-badge";
import { getCurrentProfile } from "@/lib/auth";
import { canView, normalizeRoleKey } from "@/lib/permissions";
import { getDailyAttendanceView } from "@/lib/services/attendance";
import { getDashboardAlerts, getDashboardStats } from "@/lib/services/dashboard";
import { listMemberHolds } from "@/lib/services/holds-supabase";
import { listMemberNameLookupSupabase } from "@/lib/services/member-command-center-supabase";
import { getOperationsTodayDate } from "@/lib/services/operations-calendar";
import { getSalesOpenLeadSummary } from "@/lib/services/sales-workflows";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime } from "@/lib/utils";

const HOLD_EXPIRY_LOOKAHEAD_DAYS = 14;
type AdminSnapshot = {
  membersData: Array<{ id: string; display_name: string }>;
  holds: Awaited<ReturnType<typeof listMemberHolds>>;
  ancillaryData: Array<{ service_date: string; amount: number | null; billing_status: string | null }>;
};

function toDateOnly(value: string | null | undefined) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  return raw.slice(0, 10);
}

function addDays(dateOnly: string, days: number) {
  const date = new Date(`${dateOnly}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return dateOnly;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatCurrency(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format((cents || 0) / 100);
}

function nowMs() {
  return Number(process.hrtime.bigint()) / 1_000_000;
}

function logDashboardTiming(step: string, startedAtMs: number, details?: Record<string, unknown>) {
  const elapsedMs = (nowMs() - startedAtMs).toFixed(1);
  const detailsText = details
    ? Object.entries(details)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(" ")
    : "";
  const suffix = detailsText ? ` ${detailsText}` : "";
  console.info(`[timing] route:/dashboard ${step} ${elapsedMs}ms${suffix}`);
}

async function withDashboardTiming<T>(step: string, loader: () => Promise<T>, details?: Record<string, unknown>) {
  const startedAt = nowMs();
  try {
    return await loader();
  } finally {
    logDashboardTiming(step, startedAt, details);
  }
}

export default async function DashboardPage() {
  const totalStartedAt = nowMs();

  try {
    const profileStartedAt = nowMs();
    const profile = await getCurrentProfile();
    logDashboardTiming("profile-resolution-complete", profileStartedAt, { role: profile.role });

    const permissionStartedAt = nowMs();
    const normalizedRole = normalizeRoleKey(profile.role);
    const isAdminOrCoordinator = normalizedRole === "admin" || normalizedRole === "coordinator";
    const canPunch = normalizedRole === "program-assistant";
    const canViewSales = canView(profile.permissions, "sales-activities");
    const canViewReports = canView(profile.permissions, "reports");
    const canViewOperations = canView(profile.permissions, "operations");
    logDashboardTiming("permission-checks", permissionStartedAt, {
      canViewSales,
      canViewReports,
      canViewOperations,
      isAdminOrCoordinator
    });

    const today = getOperationsTodayDate();
    const [stats, alerts, salesSummary, dailyAttendance, adminSnapshot] = await Promise.all([
      withDashboardTiming("service:getDashboardStats", () => getDashboardStats(profile.id)),
      withDashboardTiming("service:getDashboardAlerts", () => getDashboardAlerts()),
      canViewSales
        ? withDashboardTiming("service:getSalesOpenLeadSummary", () => getSalesOpenLeadSummary())
        : Promise.resolve({ unresolvedLeads: 0, unresolvedInquiryLeads: 0 }),
      canViewOperations
        ? withDashboardTiming("service:getDailyAttendanceView", () => getDailyAttendanceView({ selectedDate: today }))
        : Promise.resolve(null),
      isAdminOrCoordinator
        ? withDashboardTiming("query:adminSnapshot", async () => {
            const supabase = await createClient();
            const [membersData, holds, { data: ancillaryData }] = await Promise.all([
              listMemberNameLookupSupabase({ status: "all" }),
              listMemberHolds(),
              supabase
                .from("ancillary_charge_logs")
                .select("service_date, amount, billing_status")
                .gte("service_date", `${today.slice(0, 7)}-01`)
                .lte("service_date", `${today.slice(0, 7)}-31`)
            ]);
            return {
              membersData: membersData.map((member) => ({
                id: member.id,
                display_name: member.display_name
              })),
              holds,
              ancillaryData: ancillaryData ?? []
            } satisfies AdminSnapshot;
          })
        : Promise.resolve({ membersData: [], holds: [], ancillaryData: [] } satisfies AdminSnapshot)
    ]);

    const firstName = profile.full_name.trim().split(/\s+/)[0] || profile.full_name;
    const absentTodayRows = (dailyAttendance?.rows ?? []).filter((row) => row.recordStatus === "absent");
    const membersData = adminSnapshot.membersData;
    const holds = adminSnapshot.holds;
    const ancillaryData = adminSnapshot.ancillaryData;
    const expiryThreshold = addDays(today, HOLD_EXPIRY_LOOKAHEAD_DAYS);
    const activeHolds = holds.filter((row) => row.status === "active");
    const memberNameById = new Map(membersData.map((member) => [member.id, member.display_name] as const));
    const upcomingHolds = activeHolds
      .filter((hold) => toDateOnly(hold.start_date) && (toDateOnly(hold.start_date) as string) > today)
      .sort((left, right) => String(left.start_date).localeCompare(String(right.start_date)))
      .slice(0, 6);
    const expiringHolds = activeHolds
      .filter((hold) => {
        const endDate = toDateOnly(hold.end_date);
        if (!endDate) return false;
        return endDate >= today && endDate <= expiryThreshold;
      })
      .sort((left, right) => String(left.end_date).localeCompare(String(right.end_date)))
      .slice(0, 6);

    const monthlyAncillary = ancillaryData ?? [];
    const monthlyRevenueCents = monthlyAncillary.reduce((sum, row) => sum + Math.round(Number(row.amount ?? 0) * 100), 0);
    const unreconciledCharges = monthlyAncillary.filter((row) => String(row.billing_status ?? "Unbilled") !== "Billed").length;

    const unresolvedLeads = salesSummary.unresolvedLeads;
    const unresolvedInquiryLeads = salesSummary.unresolvedInquiryLeads;

    const incompleteAttendance = dailyAttendance
      ? {
          selectedDate: dailyAttendance.selectedDate,
          pendingWithoutStatus: dailyAttendance.summary.pendingMembers,
          checkInMissingCheckOut: dailyAttendance.summary.missingCheckOutMembers,
          checkOutMissingCheckIn: dailyAttendance.summary.missingCheckInMembers,
          totalIncomplete: dailyAttendance.summary.incompleteMembers
        }
      : null;

    const showIncompleteAttendanceFlag =
      (normalizedRole === "admin" || normalizedRole === "director") &&
      Boolean(incompleteAttendance && incompleteAttendance.totalIncomplete > 0);

    return (
      <div className="space-y-4">
        <header className="rounded-xl border border-border bg-white p-4">
          <p className="text-center text-xl font-bold text-brand">Welcome, {firstName}!</p>
          <h1 className="text-xl font-bold">Home Dashboard</h1>
          <p className="mt-1 text-sm text-muted">Today&apos;s operational priorities, quick links, and role-based activity.</p>
        </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardTitle>Today&apos;s Logs</CardTitle>
          <CardBody>
            <p className="text-2xl font-bold">{stats.todaysLogs}</p>
          </CardBody>
        </Card>
        <Card>
          <CardTitle>Missing Documentation</CardTitle>
          <CardBody>
            <p className="text-2xl font-bold">{stats.missingDocs}</p>
          </CardBody>
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

      {isAdminOrCoordinator ? (
        <section className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-muted">Operational Snapshot</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardTitle>Attendance Today</CardTitle>
              <CardBody>
                <p className="text-sm">Scheduled: <span className="font-semibold">{dailyAttendance?.summary?.scheduledMembers ?? 0}</span></p>
                <p className="text-sm">Present: <span className="font-semibold">{dailyAttendance?.summary?.presentMembers ?? 0}</span></p>
                <p className="text-sm">Absent: <span className="font-semibold">{dailyAttendance?.summary?.absentMembers ?? 0}</span></p>
                <Link href={`/operations/attendance?tab=daily-attendance&date=${today}`} className="mt-2 inline-block text-sm font-semibold text-brand">
                  Open Daily Attendance
                </Link>
              </CardBody>
            </Card>

            <Card>
              <CardTitle>Members Absent Today</CardTitle>
              <CardBody>
                {absentTodayRows.length === 0 ? (
                  <p className="text-sm text-muted">No absences recorded.</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {absentTodayRows.slice(0, 6).map((row) => (
                      <li key={`absent-${row.memberId}`}>
                        <span className="font-semibold">{row.memberName}</span>
                        {row.absentReason ? ` - ${row.absentReason === "Other" ? row.absentReasonOther || "Other" : row.absentReason}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardTitle>Revenue Snapshot (This Month)</CardTitle>
              <CardBody>
                <p className="text-sm">Recognized Charges: <span className="font-semibold">{formatCurrency(monthlyRevenueCents)}</span></p>
                <p className="text-sm">Unreconciled Entries: <span className="font-semibold">{unreconciledCharges}</span></p>
                {canViewReports ? (
                  <Link href="/reports/monthly-ancillary" className="mt-2 inline-block text-sm font-semibold text-brand">
                    Open Monthly Ancillary
                  </Link>
                ) : null}
              </CardBody>
            </Card>

            <Card>
              <CardTitle>Upcoming Holds</CardTitle>
              <CardBody>
                {upcomingHolds.length === 0 ? (
                  <p className="text-sm text-muted">No future holds scheduled.</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {upcomingHolds.map((hold) => (
                      <li key={`hold-upcoming-${hold.id}`}>
                        <span className="font-semibold">{memberNameById.get(hold.member_id) ?? "Member"}</span> - starts {formatDate(hold.start_date)}
                      </li>
                    ))}
                  </ul>
                )}
                <Link href="/operations/holds" className="mt-2 inline-block text-sm font-semibold text-brand">
                  Open Holds
                </Link>
              </CardBody>
            </Card>

            <Card>
              <CardTitle>Holds Expiring Soon</CardTitle>
              <CardBody>
                {expiringHolds.length === 0 ? (
                  <p className="text-sm text-muted">No holds expiring in the next {HOLD_EXPIRY_LOOKAHEAD_DAYS} days.</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {expiringHolds.map((hold) => (
                      <li key={`hold-expiring-${hold.id}`}>
                        <span className="font-semibold">{memberNameById.get(hold.member_id) ?? "Member"}</span> - ends {formatDate(hold.end_date as string)}
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardTitle>Unresolved Leads / Inquiries</CardTitle>
              <CardBody>
                <p className="text-sm">Open Leads: <span className="font-semibold">{unresolvedLeads}</span></p>
                <p className="text-sm">Inquiry Stage: <span className="font-semibold">{unresolvedInquiryLeads}</span></p>
                {canViewSales ? (
                  <Link href="/sales/pipeline" className="mt-2 inline-block text-sm font-semibold text-brand">
                    Open Sales Pipeline
                  </Link>
                ) : (
                  <p className="mt-2 text-xs text-muted">Sales module access is restricted for your role.</p>
                )}
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardTitle>Admin Quick Links</CardTitle>
            <CardBody className="flex flex-wrap gap-3">
              <Link href="/operations/attendance" className="text-sm font-semibold text-brand">Attendance</Link>
              <Link href="/operations/transportation-station" className="text-sm font-semibold text-brand">Transportation Station</Link>
              <Link href="/operations/holds" className="text-sm font-semibold text-brand">Holds</Link>
              <Link href="/reports/member-summary" className="text-sm font-semibold text-brand">Documentation Summary</Link>
              <Link href="/time-hr/user-management" className="text-sm font-semibold text-brand">User Management</Link>
              <Link href="/admin-reports/audit-trail" className="text-sm font-semibold text-brand">Audit Trail</Link>
            </CardBody>
          </Card>
        </section>
      ) : null}

      {showIncompleteAttendanceFlag && incompleteAttendance ? (
        <Card className="border-amber-300">
          <CardTitle>Attendance Incomplete Records</CardTitle>
          <CardBody>
            <p className="text-sm">
              {incompleteAttendance.totalIncomplete} incomplete attendance record(s) for {incompleteAttendance.selectedDate}.
            </p>
            <p className="mt-1 text-xs text-muted">
              Pending: {incompleteAttendance.pendingWithoutStatus} | Missing check-out: {incompleteAttendance.checkInMissingCheckOut} | Missing check-in: {incompleteAttendance.checkOutMissingCheckIn}
            </p>
            <Link
              href={`/operations/attendance?tab=daily-attendance&date=${incompleteAttendance.selectedDate}`}
              className="mt-2 inline-block text-sm font-semibold text-brand"
            >
              Open Daily Attendance
            </Link>
          </CardBody>
        </Card>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardTitle>Quick Actions</CardTitle>
          <CardBody className="space-x-2">
            <Link href="/documentation/activity" className="text-sm font-semibold text-brand">Participation Log</Link>
            <Link href="/documentation/toilet" className="text-sm font-semibold text-brand">Toilet Log</Link>
            {canPunch ? <Link href="/time-card" className="text-sm font-semibold text-brand">Clock In/Out</Link> : null}
            {!canPunch ? <Link href="/time-card/punch-history" className="text-sm font-semibold text-brand">Punch History</Link> : null}
          </CardBody>
        </Card>

        {normalizedRole === "nurse" ? (
          <Card>
            <CardTitle>Nursing Shortcuts</CardTitle>
            <CardBody className="space-x-2">
              <Link href="/health" className="text-sm font-semibold text-brand">Health Unit</Link>
              <Link href="/health/mar" className="text-sm font-semibold text-brand">MAR Workflow</Link>
              <Link href="/documentation/blood-sugar" className="text-sm font-semibold text-brand">Blood Sugar</Link>
              <Link href="/health/member-health-profiles" className="text-sm font-semibold text-brand">Member Health Profiles</Link>
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
              <p className="text-sm font-semibold">{alert.message}</p>
              {alert.actionHref && alert.actionLabel ? (
                <Link href={alert.actionHref} className="text-sm font-semibold text-brand">
                  {alert.actionLabel}
                </Link>
              ) : null}
            </div>
          </Card>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-muted">Recent Punches</h2>
        <Card className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {stats.latestPunches.map((p) => (
                <tr key={p.id}>
                  <td>
                    <PunchTypeBadge punchType={p.punch_type} />
                  </td>
                  <td>{formatDateTime(p.punch_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>
      </div>
    );
  } finally {
    logDashboardTiming("total", totalStartedAt);
  }
}
