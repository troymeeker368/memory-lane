import type { AppRole, UserProfile } from "@/types/app";
import { canonicalLeadStatus } from "@/lib/canonical";

import { getMockDb } from "@/lib/mock-repo";
import { getCurrentPayPeriod } from "@/lib/pay-period";
import { getMockRole } from "@/lib/runtime";
import { toEasternDate, toEasternISO } from "@/lib/timezone";
import { getDefaultPermissionSet } from "@/lib/permissions";

function todayIsoDate() {
  return toEasternDate();
}

function twoWeeksAgoIso() {
  return getCurrentPayPeriod().startAtIso;
}

export function getMockProfile(roleOverride?: AppRole, selectedUserId?: string | null): UserProfile {
  const db = getMockDb();
  const role = roleOverride ?? getMockRole();
  const roleStaff = db.staff
    .filter((staff) => staff.active && staff.role === role)
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

  const selectedStaff = selectedUserId ? roleStaff.find((staff) => staff.id === selectedUserId) : null;
  const staff = selectedStaff ?? roleStaff[0] ?? db.staff.find((s) => s.role === role) ?? db.staff[0];

  return {
    id: staff.id,
    email: staff.email || `${staff.full_name.toLowerCase().replace(/\s+/g, ".")}@memorylane.local`,
    full_name: staff.full_name,
    role,
    active: staff.active,
    staff_id: staff.id.slice(-4),
    permissions: getDefaultPermissionSet(role)
  };
}

export function getMockUsersByRole(role?: AppRole) {
  const db = getMockDb();
  return db.staff
    .filter((staff) => (role ? staff.role === role : true))
    .filter((staff) => staff.active)
    .map((staff) => ({
      id: staff.id,
      full_name: staff.full_name,
      role: staff.role
    }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
}

export function getMockMembers() {
  const db = getMockDb();
  return db.members.filter((m) => m.status === "active");
}

export function getMockDashboardStats(userId?: string) {
  const db = getMockDb();
  const today = todayIsoDate();

  return {
    todaysLogs: db.dailyActivities.filter((d) => d.activity_date === today).length + db.toiletLogs.filter((d) => d.event_at.startsWith(today)).length,
    missingDocs: db.members.length - new Set(db.dailyActivities.filter((d) => d.activity_date === today).map((d) => d.member_id)).size,
    latestPunches: db.timePunches
      .filter((p) => (userId ? p.staff_user_id === userId : true))
      .sort((a, b) => (a.punch_at < b.punch_at ? 1 : -1))
      .slice(0, 5)
  };
}

export function getMockDashboardAlerts() {
  const db = getMockDb();
  const unresolvedPunchIssues = db.timePunches.filter((p) => p.within_fence === false).length;
  const missingDaily = getMockDashboardStats().missingDocs;

  const alerts = [] as { id: string; severity: "warning" | "critical"; message: string; actionLabel: string; actionHref: string }[];

  if (missingDaily > 0) {
    alerts.push({
      id: "missing-daily",
      severity: "critical",
      message: `${missingDaily} members missing participation log entries today.`,
      actionLabel: "Open Documentation",
      actionHref: "/documentation"
    });
  }

  if (unresolvedPunchIssues > 0) {
    alerts.push({
      id: "clock-issues",
      severity: "warning",
      message: `${unresolvedPunchIssues} time punches recorded outside geofence.`,
      actionLabel: "Review Time Card",
      actionHref: "/time-card"
    });
  }

  return alerts;
}

export function getMockTimeCardOverview(userId?: string) {
  const db = getMockDb();
  const punches = db.timePunches
    .filter((p) => (userId ? p.staff_user_id === userId : true))
    .sort((a, b) => (a.punch_at < b.punch_at ? 1 : -1));

  const latest = punches[0];
  const currentStatus = latest?.punch_type === "in" ? "Clocked In" : "Clocked Out";

  return {
    periodStart: twoWeeksAgoIso(),
    currentStatus,
    punches,
    exceptions: punches
      .filter((p) => !p.within_fence)
      .map((p) => ({ id: `ex-${p.id}`, exception_type: "geofence", message: `Outside fence at ${p.distance_meters ?? "?"}m`, resolved: false }))
      .slice(0, 20)
  };
}

function computeHoursForStaff(staffId: string) {
  const db = getMockDb();
  const items = db.timePunches
    .filter((p) => p.staff_user_id === staffId)
    .sort((a, b) => (a.punch_at > b.punch_at ? 1 : -1));

  let total = 0;
  for (let i = 0; i < items.length - 1; i += 1) {
    const first = items[i];
    const second = items[i + 1];
    if (first.punch_type === "in" && second.punch_type === "out") {
      const diff = (new Date(second.punch_at).getTime() - new Date(first.punch_at).getTime()) / 3600000;
      if (diff > 0) total += diff;
    }
  }
  return Number(total.toFixed(2));
}

export function getMockManagerTimeReview() {
  const db = getMockDb();
  return db.staff.map((s) => {
    const regularHours = computeHoursForStaff(s.id);
    const mealDeductHours = regularHours >= 6 ? 0.5 : 0;
    return {
      staff_name: s.full_name,
      pay_period: getCurrentPayPeriod().label,
      total_hours_worked: regularHours,
      meal_deduction_applied: mealDeductHours,
      adjusted_hours: Number((regularHours - mealDeductHours).toFixed(2)),
      exception_notes: regularHours > 12 ? "Long shift flagged" : "-",
      approval_status: s.role === "staff" ? "Pending" : "Reviewed",
      regular_hours: regularHours,
      meal_deduct_hours: mealDeductHours,
      payable_hours: Number((regularHours - mealDeductHours).toFixed(2)),
      exception_count: db.timePunches.filter((p) => p.staff_user_id === s.id && !p.within_fence).length
    };
  });
}

export function getMockDocumentationSummary() {
  const db = getMockDb();
  const today = todayIsoDate();
  const perStaff = new Map<string, { staff_name: string; participation_count: number; toilet_count: number; shower_count: number; transport_count: number; ancillary_count: number }>();

  db.staff.forEach((s) => {
    perStaff.set(s.id, {
      staff_name: s.full_name,
      participation_count: 0,
      toilet_count: 0,
      shower_count: 0,
      transport_count: 0,
      ancillary_count: 0
    });
  });

  db.dailyActivities.filter((x) => x.activity_date === today).forEach((x) => {
    const row = perStaff.get(x.staff_user_id);
    if (row) row.participation_count += 1;
  });

  db.toiletLogs.filter((x) => x.event_at.startsWith(today)).forEach((x) => {
    const row = perStaff.get(x.staff_user_id);
    if (row) row.toilet_count += 1;
  });

  db.showerLogs.filter((x) => x.event_at.startsWith(today)).forEach((x) => {
    const row = perStaff.get(x.staff_user_id);
    if (row) row.shower_count += 1;
  });

  db.transportationLogs.filter((x) => x.service_date === today).forEach((x) => {
    const row = perStaff.get(x.staff_user_id);
    if (row) row.transport_count += 1;
  });

  db.ancillaryLogs.filter((x) => x.service_date === today).forEach((x) => {
    const row = perStaff.get(x.staff_user_id);
    if (row) row.ancillary_count += 1;
  });

  const todayRows = Array.from(perStaff.values()).map((row) => {
    const total = row.participation_count + row.toilet_count + row.shower_count + row.transport_count + row.ancillary_count;
    return {
      ...row,
      total_count: total,
      uploaded_today: total > 0
    };
  });

  const timely = todayRows.map((row) => {
    const total = row.total_count || 1;
    const onTime = Math.max(total - 1, 0);
    const late = total - onTime;
    return {
      staff_name: row.staff_name,
      on_time: onTime,
      late,
      total,
      on_time_percent: onTime / total
    };
  });

  return {
    today: todayRows,
    timely
  };
}

export function getMockDocumentationTracker() {
  const db = getMockDb();
  return db.members.map((m, idx) => ({
    id: `tracker-${m.id}`,
    member_name: m.display_name,
    assigned_staff_name: db.staff[idx % db.staff.length].full_name,
    next_care_plan_due: toEasternDate(new Date(Date.now() + (idx + 2) * 86400000)),
    next_progress_note_due: toEasternDate(new Date(Date.now() + (idx + 1) * 86400000)),
    care_plan_done: idx % 2 === 0,
    note_done: idx % 3 === 0
  }));
}

export function getMockClinicalOverview() {
  const db = getMockDb();

  const mar = db.members.slice(0, 3).map((m, i) => ({
    id: `mar-${i + 1}`,
    member_name: m.display_name,
    medication_name: i % 2 === 0 ? "Donepezil 10mg" : "Metformin 500mg",
    due_at: toEasternISO(new Date(Date.now() + (i + 1) * 3600000)),
    administered_at: i === 0 ? null : toEasternISO(new Date(Date.now() - i * 7200000)),
    nurse_name: db.staff.find((s) => s.role === "nurse")?.full_name ?? "Nurse",
    status: i === 0 ? "scheduled" : "administered"
  }));

  const bloodSugar = db.bloodSugarLogs.map((b) => ({
    id: b.id,
    checked_at: b.checked_at,
    member_name: b.member_name,
    reading_mg_dl: b.reading_mg_dl,
    nurse_name: b.nurse_name,
    notes: b.notes
  }));

  return { mar, bloodSugar };
}

export function getMockAncillarySummary(monthKey?: string, options?: { staffUserId?: string | null }) {
  const db = getMockDb();
  const formatMonth = (serviceDate: string) => {
    const d = new Date(serviceDate);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  };

  const scopedLogs = options?.staffUserId
    ? db.ancillaryLogs.filter((log) => log.staff_user_id === options.staffUserId)
    : db.ancillaryLogs;

  const allMonths = Array.from(new Set(scopedLogs.map((l) => formatMonth(l.service_date)))).sort((a, b) => (a < b ? 1 : -1));
  const selectedMonth = monthKey && allMonths.includes(monthKey) ? monthKey : allMonths[0] ?? formatMonth(toEasternISO());

  const filteredLogs = scopedLogs.filter((l) => formatMonth(l.service_date) === selectedMonth);

  const monthlyMap = new Map<string, { month_label: string; category_name: string; total_count: number; total_amount_cents: number }>();
  filteredLogs.forEach((l) => {
    const month = new Date(l.service_date).toLocaleString("en-US", { month: "short", year: "numeric" }).replace(" ", "-");
    const key = `${month}-${l.category_name}`;
    const current = monthlyMap.get(key) ?? { month_label: month, category_name: l.category_name, total_count: 0, total_amount_cents: 0 };
    current.total_count += l.quantity ?? 1;
    current.total_amount_cents += l.amount_cents;
    monthlyMap.set(key, current);
  });

  const perMemberMap = new Map<
    string,
    {
      member_name: string;
      items: Array<{ id: string; service_date: string; category_name: string; quantity: number; unit_amount_cents: number; total_amount_cents: number; source_entity: string | null }>;
      subtotal_cents: number;
    }
  >();

  filteredLogs.forEach((log) => {
    const existing = perMemberMap.get(log.member_id) ?? {
      member_name: log.member_name,
      items: [],
      subtotal_cents: 0
    };

    const qty = log.quantity ?? 1;
    const unitAmount = Math.round(log.amount_cents / qty);

    existing.items.push({
      id: log.id,
      service_date: log.service_date,
      category_name: log.category_name,
      quantity: qty,
      unit_amount_cents: unitAmount,
      total_amount_cents: log.amount_cents,
      source_entity: log.source_entity ?? null
    });

    existing.subtotal_cents += log.amount_cents;
    perMemberMap.set(log.member_id, existing);
  });

  const monthlyByMember = Array.from(perMemberMap.values())
    .map((m) => ({ ...m, items: m.items.sort((a, b) => (a.service_date < b.service_date ? 1 : -1)) }))
    .sort((a, b) => (a.member_name > b.member_name ? 1 : -1));

  const monthlyGrandTotalCents = monthlyByMember.reduce((sum, m) => sum + m.subtotal_cents, 0);

  return {
    categories: db.ancillaryCategories,
    logs: scopedLogs,
    monthly: Array.from(monthlyMap.values()),
    availableMonths: allMonths,
    selectedMonth,
    monthlyByMember,
    monthlyGrandTotalCents
  };
}

export function getMockLeadsSnapshot() {
  const db = getMockDb();

  const stageMap = new Map<string, number>();
  db.leads.filter((l) => { const status = canonicalLeadStatus(l.status, l.stage); return status === "Open" || status === "Nurture"; }).forEach((l) => {
    stageMap.set(l.stage, (stageMap.get(l.stage) ?? 0) + 1);
  });

  const stages = Array.from(stageMap.entries()).map(([stage, count]) => ({ stage, count }));

  return {
    leads: db.leads,
    stages,
    activities: db.leadActivities
  };
}

export function getMockReferralSources() {
  return getMockDb().referralSources;
}

export function getMockReportingSnapshot() {
  const db = getMockDb();
  const docs = getMockDocumentationSummary();

  const toiletedMap = new Map<string, { member_name: string; last_toileted_at: string; staff_name: string }>();
  db.toiletLogs.forEach((t) => {
    const current = toiletedMap.get(t.member_id);
    if (!current || current.last_toileted_at < t.event_at) {
      toiletedMap.set(t.member_id, {
        member_name: t.member_name,
        last_toileted_at: t.event_at,
        staff_name: t.staff_name
      });
    }
  });

  return {
    timelyDocs: docs.timely,
    careTracker: getMockDocumentationTracker(),
    toileted: Array.from(toiletedMap.values())
  };
}














