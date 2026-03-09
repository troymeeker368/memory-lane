import { getMockDocumentationTracker } from "@/lib/mock-data";
import { getMockDb } from "@/lib/mock-repo";
import { isMockMode } from "@/lib/runtime";
import { canonicalLeadStatus } from "@/lib/canonical";
import { getCurrentPayPeriod, isDateInPayPeriod } from "@/lib/pay-period";
import { toEasternDate, toEasternISO } from "@/lib/timezone";

type StatusFilter = "On Time" | "Late" | "Missing";

export interface ReportDateRange {
  from: string;
  to: string;
}

export interface BaseReportFilters extends ReportDateRange {
  member?: string;
  staff?: string;
  status?: StatusFilter | "All";
  documentationType?: string;
}

function asDate(value?: string | null) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isoDay(date: Date) {
  return toEasternDate(date);
}

export function resolveDateRange(rawFrom?: string, rawTo?: string, fallbackDays = 30): ReportDateRange {
  const today = new Date();
  const end = rawTo ? new Date(rawTo) : today;
  if (Number.isNaN(end.getTime())) {
    return resolveDateRange(undefined, undefined, fallbackDays);
  }

  const start = rawFrom ? new Date(rawFrom) : new Date(end.getTime() - fallbackDays * 24 * 60 * 60 * 1000);
  if (Number.isNaN(start.getTime())) {
    return resolveDateRange(undefined, rawTo, fallbackDays);
  }

  return {
    from: isoDay(start),
    to: isoDay(end)
  };
}

function inDateRange(value: string | null | undefined, range: ReportDateRange) {
  if (!value) return false;
  const d = asDate(value);
  if (!d) return false;
  const from = asDate(`${range.from}T00:00:00.000Z`);
  const to = asDate(`${range.to}T23:59:59.999Z`);
  if (!from || !to) return false;
  return d >= from && d <= to;
}

function hoursBetween(start: string, end: string) {
  const s = asDate(start);
  const e = asDate(end);
  if (!s || !e) return 0;
  return (e.getTime() - s.getTime()) / 3600000;
}

function realTimeStatus(occurrenceAt: string, enteredAt: string | null): { status: StatusFilter; lateHours: number } {
  if (!enteredAt) {
    return { status: "Missing", lateHours: 0 };
  }

  const diff = hoursBetween(occurrenceAt, enteredAt);
  if (diff > 1) {
    return { status: "Late", lateHours: diff };
  }
  return { status: "On Time", lateHours: Math.max(diff, 0) };
}

function dailyStatus(occurrenceAt: string, enteredAt: string | null): { status: StatusFilter; lateHours: number } {
  if (!enteredAt) {
    return { status: "Missing", lateHours: 0 };
  }

  const diff = hoursBetween(occurrenceAt, enteredAt);
  if (diff > 48) {
    return { status: "Late", lateHours: diff - 48 };
  }
  return { status: "On Time", lateHours: Math.max(diff, 0) };
}

function statusPass(value: StatusFilter, requested?: string) {
  if (!requested || requested === "All") return true;
  return value === requested;
}

function normalizeDocTypeFilter(value?: string) {
  if (!value || value === "All") return undefined;
  return value;
}

function buildDays(range: ReportDateRange) {
  const out: string[] = [];
  let d = asDate(`${range.from}T00:00:00.000Z`);
  const end = asDate(`${range.to}T00:00:00.000Z`);
  if (!d || !end) return out;
  while (d <= end) {
    out.push(isoDay(d));
    d = new Date(d.getTime() + 86400000);
  }
  return out;
}

export async function getAdminReportLookups() {
  if (!isMockMode()) {
    // TODO(backend): Replace with lookup tables/views.
    return { staff: [], members: [], documentationTypes: [] as string[] };
  }

  const db = getMockDb();
  return {
    staff: db.staff.map((s) => ({ id: s.id, name: s.full_name })),
    members: db.members.map((m) => ({ id: m.id, name: m.display_name })),
    documentationTypes: ["Participation Log", "Toilet", "Shower", "Transportation", "Blood Sugar", "Photo Upload", "Assessment"]
  };
}

export async function getAdminStaffProductivity(filters: BaseReportFilters) {
  if (!isMockMode()) {
    // TODO(backend): Replace with SQL aggregate views.
    return [];
  }

  const db = getMockDb();
  const rows = db.staff.map((staff) => {
    const daily = db.dailyActivities.filter((r) => r.staff_user_id === staff.id && inDateRange(r.created_at, filters));
    const toilet = db.toiletLogs.filter((r) => r.staff_user_id === staff.id && inDateRange(r.event_at, filters));
    const shower = db.showerLogs.filter((r) => r.staff_user_id === staff.id && inDateRange(r.event_at, filters));
    const transport = db.transportationLogs.filter((r) => inDateRange(`${r.service_date}T00:00:00.000Z`, filters) && r.staff_user_id === staff.id);
    const bloodSugar = db.bloodSugarLogs.filter((r) => r.nurse_user_id === staff.id && inDateRange(r.checked_at, filters));
    const photos = db.photoUploads.filter((r) => r.uploaded_by === staff.id && inDateRange(r.uploaded_at, filters));
    const assessments = db.assessments.filter((r) => r.created_by_user_id === staff.id && inDateRange(r.created_at, filters));

    const total = daily.length + toilet.length + shower.length + transport.length + bloodSugar.length + photos.length + assessments.length;

    return {
      staff_id: staff.id,
      staff_name: staff.full_name,
      daily: daily.length,
      toilet: toilet.length,
      shower: shower.length,
      transportation: transport.length,
      blood_sugar: bloodSugar.length,
      photos: photos.length,
      assessments: assessments.length,
      total
    };
  });

  return rows
    .filter((row) => (!filters.staff || row.staff_id === filters.staff) && row.total > 0)
    .sort((a, b) => (a.total < b.total ? 1 : -1));
}

export async function getAdminTimelyDocumentation(filters: BaseReportFilters) {
  if (!isMockMode()) {
    // TODO(backend): Replace with docs timeliness computation over persisted logs.
    return [];
  }

  const db = getMockDb();
  const docTypeFilter = normalizeDocTypeFilter(filters.documentationType);

  const rows: Array<{
    id: string;
    member_id: string;
    member_name: string;
    documentation_type: string;
    occurrence_at: string;
    entered_at: string | null;
    staff_id: string | null;
    staff_name: string | null;
    status: StatusFilter;
    late_hours: number;
    drill_href: string;
  }> = [];

  db.dailyActivities.forEach((row) => {
    const occurrenceAt = `${row.activity_date}T12:00:00.000Z`;
    const enteredAt = row.timestamp || row.created_at || null;
    const result = dailyStatus(occurrenceAt, enteredAt);

    rows.push({
      id: `daily-${row.id}`,
      member_id: row.member_id,
      member_name: row.member_name,
      documentation_type: "Participation Log",
      occurrence_at: occurrenceAt,
      entered_at: enteredAt,
      staff_id: row.staff_user_id,
      staff_name: row.staff_name,
      status: result.status,
      late_hours: Number(result.lateHours.toFixed(2)),
      drill_href: "/documentation/activity"
    });
  });

  db.toiletLogs.forEach((row) => {
    const result = realTimeStatus(row.event_at, row.event_at || null);
    rows.push({
      id: `toilet-${row.id}`,
      member_id: row.member_id,
      member_name: row.member_name,
      documentation_type: "Toilet",
      occurrence_at: row.event_at,
      entered_at: row.event_at,
      staff_id: row.staff_user_id,
      staff_name: row.staff_name,
      status: result.status,
      late_hours: Number(result.lateHours.toFixed(2)),
      drill_href: "/documentation/toilet"
    });
  });

  db.showerLogs.forEach((row) => {
    const result = realTimeStatus(row.event_at, row.timestamp || row.event_at);
    rows.push({
      id: `shower-${row.id}`,
      member_id: row.member_id,
      member_name: row.member_name,
      documentation_type: "Shower",
      occurrence_at: row.event_at,
      entered_at: row.timestamp || row.event_at,
      staff_id: row.staff_user_id,
      staff_name: row.staff_name,
      status: result.status,
      late_hours: Number(result.lateHours.toFixed(2)),
      drill_href: "/documentation/shower"
    });
  });

  db.transportationLogs.forEach((row) => {
    const occurrenceAt = `${row.service_date}T${row.period === "AM" ? "08" : "16"}:00:00.000Z`;
    const enteredAt = row.timestamp || null;
    const result = realTimeStatus(occurrenceAt, enteredAt);
    rows.push({
      id: `transport-${row.id}`,
      member_id: row.member_id,
      member_name: row.member_name,
      documentation_type: "Transportation",
      occurrence_at: occurrenceAt,
      entered_at: enteredAt,
      staff_id: row.staff_user_id,
      staff_name: row.staff_name,
      status: result.status,
      late_hours: Number(result.lateHours.toFixed(2)),
      drill_href: "/documentation/transportation"
    });
  });

  db.bloodSugarLogs.forEach((row) => {
    const result = realTimeStatus(row.checked_at, row.checked_at);
    rows.push({
      id: `blood-${row.id}`,
      member_id: row.member_id,
      member_name: row.member_name,
      documentation_type: "Blood Sugar",
      occurrence_at: row.checked_at,
      entered_at: row.checked_at,
      staff_id: row.nurse_user_id,
      staff_name: row.nurse_name,
      status: result.status,
      late_hours: Number(result.lateHours.toFixed(2)),
      drill_href: "/documentation/blood-sugar"
    });
  });

  db.photoUploads.forEach((row) => {
    const occurrenceAt = `${row.upload_date}T12:00:00.000Z`;
    const result = realTimeStatus(occurrenceAt, row.uploaded_at);
    rows.push({
      id: `photo-${row.id}`,
      member_id: row.member_id,
      member_name: row.member_name,
      documentation_type: "Photo Upload",
      occurrence_at: occurrenceAt,
      entered_at: row.uploaded_at,
      staff_id: row.uploaded_by,
      staff_name: row.uploaded_by_name,
      status: result.status,
      late_hours: Number(result.lateHours.toFixed(2)),
      drill_href: "/documentation/photo-upload"
    });
  });

  db.assessments.forEach((row) => {
    const occurrenceAt = `${row.assessment_date}T12:00:00.000Z`;
    const result = realTimeStatus(occurrenceAt, row.created_at);
    rows.push({
      id: `assessment-${row.id}`,
      member_id: row.member_id,
      member_name: row.member_name,
      documentation_type: "Assessment",
      occurrence_at: occurrenceAt,
      entered_at: row.created_at,
      staff_id: row.created_by_user_id,
      staff_name: row.created_by_name,
      status: result.status,
      late_hours: Number(result.lateHours.toFixed(2)),
      drill_href: "/health/assessment"
    });
  });

  // Missing expectation model for Participation Log: one log per active member/day in selected range.
  const days = buildDays(filters);
  const seenDaily = new Set(rows.filter((r) => r.documentation_type === "Participation Log").map((r) => `${r.member_id}|${r.occurrence_at.slice(0, 10)}`));

  db.members
    .filter((member) => member.status === "active")
    .forEach((member) => {
      days.forEach((day) => {
        const key = `${member.id}|${day}`;
        if (seenDaily.has(key)) return;
        rows.push({
          id: `daily-missing-${member.id}-${day}`,
          member_id: member.id,
          member_name: member.display_name,
          documentation_type: "Participation Log",
          occurrence_at: `${day}T12:00:00.000Z`,
          entered_at: null,
          staff_id: null,
          staff_name: null,
          status: "Missing",
          late_hours: 0,
          drill_href: "/documentation/activity"
        });
      });
    });

  return rows
    .filter((row) => inDateRange(row.occurrence_at, filters))
    .filter((row) => (!filters.member || row.member_id === filters.member))
    .filter((row) => (!filters.staff || row.staff_id === filters.staff))
    .filter((row) => (!docTypeFilter || row.documentation_type === docTypeFilter))
    .filter((row) => statusPass(row.status, filters.status))
    .sort((a, b) => (a.occurrence_at < b.occurrence_at ? 1 : -1));
}

export async function getAdminAncillaryAudit(filters: BaseReportFilters) {
  if (!isMockMode()) {
    // TODO(backend): Replace with ancillary audit view.
    return [];
  }

  const db = getMockDb();
  return db.ancillaryLogs
    .filter((row) => inDateRange(`${row.service_date}T00:00:00.000Z`, filters))
    .filter((row) => (!filters.member || row.member_id === filters.member))
    .map((row) => {
      const quantity = row.quantity ?? 1;
      const unitPrice = quantity > 0 ? Math.round(row.amount_cents / quantity) : row.amount_cents;
      return {
        ...row,
        quantity,
        unit_price_cents: unitPrice,
        total_amount_cents: row.amount_cents,
        source_type: row.source_entity ? "Auto" : "Manual",
        reconciliation_status: row.reconciliation_status ?? "open",
        reconciled_by: row.reconciled_by ?? null,
        reconciled_at: row.reconciled_at ?? null,
        member_href: `/members/${row.member_id}`
      };
    })
    .sort((a, b) => (a.service_date < b.service_date ? 1 : -1));
}

export async function getAdminPayPeriodReview() {
  if (!isMockMode()) {
    // TODO(backend): Replace with pay-period report view.
    return [];
  }

  const db = getMockDb();
  const period = getCurrentPayPeriod();

  const byStaff = new Map<string, typeof db.timePunches>();
  db.timePunches
    .filter((p) => isDateInPayPeriod(p.punch_at, period))
    .forEach((p) => {
      const rows = byStaff.get(p.staff_user_id) ?? [];
      rows.push(p);
      byStaff.set(p.staff_user_id, rows);
    });

  return db.staff.map((staff) => {
    const rows = [...(byStaff.get(staff.id) ?? [])].sort((a, b) => (a.punch_at > b.punch_at ? 1 : -1));
    let totalHours = 0;
    let missingPunches = 0;
    let longShift = 0;

    for (let i = 0; i < rows.length; i += 1) {
      const current = rows[i];
      if (current.punch_type !== "in") continue;
      const out = rows[i + 1];
      if (!out || out.punch_type !== "out") {
        missingPunches += 1;
        continue;
      }

      const hours = hoursBetween(current.punch_at, out.punch_at);
      if (hours > 12) longShift += 1;
      if (hours > 0) totalHours += hours;
    }

    const mealDeduction = totalHours >= 6 ? 0.5 : 0;
    return {
      staff_id: staff.id,
      staff_name: staff.full_name,
      pay_period: period.label,
      total_hours_worked: Number(totalHours.toFixed(2)),
      meal_deduction_applied: mealDeduction,
      adjusted_hours: Number((totalHours - mealDeduction).toFixed(2)),
      missing_punches: missingPunches,
      long_shift_flags: longShift,
      approval_status: missingPunches > 0 || longShift > 0 ? "Needs Follow-up" : "Reviewed",
      staff_href: `/staff/${staff.id}`
    };
  });
}

export async function getAdminPunchExceptions(filters: ReportDateRange & { staff?: string }) {
  if (!isMockMode()) {
    // TODO(backend): Replace with punch exceptions view.
    return [];
  }

  const db = getMockDb();
  const items: Array<{
    id: string;
    staff_id: string;
    staff_name: string;
    exception_type: string;
    detail: string;
    when: string;
    staff_href: string;
  }> = [];

  db.staff.forEach((staff) => {
    if (filters.staff && staff.id !== filters.staff) return;
    const punches = db.timePunches
      .filter((p) => p.staff_user_id === staff.id)
      .filter((p) => inDateRange(p.punch_at, filters))
      .sort((a, b) => (a.punch_at > b.punch_at ? 1 : -1));

    for (let i = 0; i < punches.length; i += 1) {
      const current = punches[i];
      const next = punches[i + 1];
      if (current.punch_type === "in") {
        if (!next || next.punch_type !== "out") {
          items.push({
            id: `missing-out-${current.id}`,
            staff_id: staff.id,
            staff_name: staff.full_name,
            exception_type: "Missing clock out",
            detail: `No matching clock-out for ${current.punch_at}`,
            when: current.punch_at,
            staff_href: `/staff/${staff.id}`
          });
        } else {
          const duration = hoursBetween(current.punch_at, next.punch_at);
          if (duration > 12) {
            items.push({
              id: `long-shift-${current.id}`,
              staff_id: staff.id,
              staff_name: staff.full_name,
              exception_type: "Long shift",
              detail: `${duration.toFixed(2)}h shift between punches`,
              when: current.punch_at,
              staff_href: `/staff/${staff.id}`
            });
          }
        }
      }

      if (next && current.punch_type === next.punch_type) {
        items.push({
          id: `duplicate-${current.id}`,
          staff_id: staff.id,
          staff_name: staff.full_name,
          exception_type: "Duplicate pattern",
          detail: `Back-to-back ${current.punch_type.toUpperCase()} punches`,
          when: current.punch_at,
          staff_href: `/staff/${staff.id}`
        });
      }
    }
  });

  return items.sort((a, b) => (a.when < b.when ? 1 : -1));
}

export async function getAdminDocumentationByMember(filters: BaseReportFilters) {
  if (!isMockMode()) {
    // TODO(backend): Replace with member docs aggregate view.
    return [];
  }

  const db = getMockDb();

  return db.members
    .filter((member) => !filters.member || member.id === filters.member)
    .map((member) => {
      const daily = db.dailyActivities.filter((r) => r.member_id === member.id && inDateRange(r.created_at, filters));
      const toilet = db.toiletLogs.filter((r) => r.member_id === member.id && inDateRange(r.event_at, filters));
      const shower = db.showerLogs.filter((r) => r.member_id === member.id && inDateRange(r.event_at, filters));
      const transport = db.transportationLogs.filter((r) => r.member_id === member.id && inDateRange(`${r.service_date}T00:00:00.000Z`, filters));
      const blood = db.bloodSugarLogs.filter((r) => r.member_id === member.id && inDateRange(r.checked_at, filters));
      const photos = db.photoUploads.filter((r) => r.member_id === member.id && inDateRange(r.uploaded_at, filters));
      const assessments = db.assessments.filter((r) => r.member_id === member.id && inDateRange(r.created_at, filters));

      const total = daily.length + toilet.length + shower.length + transport.length + blood.length + photos.length + assessments.length;
      const lastDocumented = [
        daily[0]?.created_at,
        toilet[0]?.event_at,
        shower[0]?.event_at,
        transport[0] ? `${transport[0].service_date}T00:00:00.000Z` : undefined,
        blood[0]?.checked_at,
        photos[0]?.uploaded_at,
        assessments[0]?.created_at
      ]
        .filter(Boolean)
        .sort()
        .at(-1) ?? null;

      return {
        member_id: member.id,
        member_name: member.display_name,
        daily: daily.length,
        toilet: toilet.length,
        shower: shower.length,
        transportation: transport.length,
        blood_sugar: blood.length,
        photos: photos.length,
        assessments: assessments.length,
        total,
        last_documented_at: lastDocumented,
        member_href: `/members/${member.id}`
      };
    })
    .filter((row) => row.total > 0)
    .sort((a, b) => (a.total < b.total ? 1 : -1));
}

export async function getAdminLastToileted() {
  if (!isMockMode()) {
    // TODO(backend): Replace with last toileted view.
    return [];
  }

  const db = getMockDb();
  return db.members.map((member) => {
    const latest = db.toiletLogs.filter((row) => row.member_id === member.id).sort((a, b) => (a.event_at < b.event_at ? 1 : -1))[0];
    const gapHours = latest ? Number(hoursBetween(latest.event_at, toEasternISO()).toFixed(1)) : null;
    return {
      member_id: member.id,
      member_name: member.display_name,
      last_toileted_at: latest?.event_at ?? null,
      staff_name: latest?.staff_name ?? null,
      gap_hours: gapHours,
      member_href: `/members/${member.id}`
    };
  });
}

export async function getAdminCareTracker() {
  if (!isMockMode()) {
    // TODO(backend): Replace with care tracker view.
    return [];
  }

  return getMockDocumentationTracker();
}

export async function getAdminSalesPipelineSummary(filters: ReportDateRange) {
  if (!isMockMode()) {
    // TODO(backend): Replace with sales pipeline aggregate view.
    return { stageRows: [], inquirySeries: [] };
  }

  const db = getMockDb();
  const inRangeLeads = db.leads.filter((lead) => inDateRange(`${lead.inquiry_date}T00:00:00.000Z`, filters));

  const byStage = new Map<string, number>();
  let won = 0;
  let lost = 0;

  inRangeLeads.forEach((lead) => {
    byStage.set(lead.stage, (byStage.get(lead.stage) ?? 0) + 1);
    const status = canonicalLeadStatus(lead.status, lead.stage);
    if (status === "Won") won += 1;
    if (status === "Lost") lost += 1;
  });

  const inquiriesByDay = new Map<string, number>();
  inRangeLeads.forEach((lead) => {
    const key = lead.inquiry_date;
    inquiriesByDay.set(key, (inquiriesByDay.get(key) ?? 0) + 1);
  });

  return {
    stageRows: Array.from(byStage.entries()).map(([stage, count]) => ({ stage, count })).sort((a, b) => (a.stage > b.stage ? 1 : -1)),
    won,
    lost,
    inquirySeries: Array.from(inquiriesByDay.entries()).map(([date, count]) => ({ date, count })).sort((a, b) => (a.date > b.date ? 1 : -1))
  };
}

export async function getAdminCommunityPartnerPerformance(filters: ReportDateRange) {
  if (!isMockMode()) {
    // TODO(backend): Replace with community partner aggregate view.
    return [];
  }

  const db = getMockDb();

  return db.partners.map((partner) => {
    const linkedLeads = db.leads.filter(
      (lead) =>
        (lead.partner_id && lead.partner_id === partner.partner_id) ||
        lead.referral_name === partner.organization_name ||
        inDateRange(`${lead.inquiry_date}T00:00:00.000Z`, filters)
    );

    const won = linkedLeads.filter((lead) => canonicalLeadStatus(lead.status, lead.stage) === "Won").length;
    const lost = linkedLeads.filter((lead) => canonicalLeadStatus(lead.status, lead.stage) === "Lost").length;
    const open = linkedLeads.filter((lead) => {
      const status = canonicalLeadStatus(lead.status, lead.stage);
      return status === "Open" || status === "Nurture";
    }).length;

    const recentActivity = db.partnerActivities
      .filter((a) => a.partner_id === partner.partner_id)
      .sort((a, b) => (a.activity_at < b.activity_at ? 1 : -1))[0]?.activity_at;

    return {
      partner_id: partner.id,
      organization_name: partner.organization_name,
      primary_phone: partner.primary_phone,
      primary_email: partner.primary_email,
      linked_leads: linkedLeads.length,
      open,
      won,
      lost,
      recent_activity_at: recentActivity ?? null,
      partner_href: `/sales/community-partners/${partner.id}`
    };
  });
}

export async function getAdminLeadActivityReport(filters: ReportDateRange & { staff?: string; partner?: string; lead?: string }) {
  if (!isMockMode()) {
    // TODO(backend): Replace with lead activity joined report view.
    return [];
  }

  const db = getMockDb();

  return db.leadActivities
    .filter((row) => inDateRange(row.activity_at, filters))
    .filter((row) => (!filters.staff || row.completed_by_user_id === filters.staff))
    .filter((row) => (!filters.lead || row.lead_id === filters.lead))
    .map((row) => {
      const lead = db.leads.find((l) => l.id === row.lead_id);
      const partner = lead?.partner_id ? db.partners.find((p) => p.partner_id === lead.partner_id) : null;
      if (filters.partner && (!partner || partner.id !== filters.partner)) return null;

      return {
        ...row,
        stage: lead?.stage ?? "-",
        status: lead ? canonicalLeadStatus(lead.status, lead.stage) : "-",
        partner_name: partner?.organization_name ?? lead?.referral_name ?? "-",
        lead_href: lead ? `/sales/leads/${lead.id}` : "/sales"
      };
    })
    .filter(Boolean) as Array<any>;
}

export async function getAdminAssessmentStatus(filters: BaseReportFilters) {
  if (!isMockMode()) {
    // TODO(backend): Replace with assessment status view.
    return [];
  }

  const db = getMockDb();
  return db.assessments
    .filter((row) => inDateRange(`${row.assessment_date}T00:00:00.000Z`, filters))
    .filter((row) => (!filters.member || row.member_id === filters.member))
    .map((row) => ({
      id: row.id,
      member_id: row.member_id,
      member_name: row.member_name,
      assessment_date: row.assessment_date,
      reviewer_name: row.reviewer_name,
      signed_by: row.signed_by,
      completion_state: row.complete ? "Complete" : "Incomplete",
      missing_flag: row.complete ? "No" : "Yes",
      detail_href: `/reports/assessments/${row.id}`
    }))
    .sort((a, b) => (a.assessment_date < b.assessment_date ? 1 : -1));
}

export async function getAdminMemberServiceUtilization(filters: BaseReportFilters) {
  if (!isMockMode()) {
    // TODO(backend): Replace with member service utilization aggregate.
    return [];
  }

  const db = getMockDb();

  return db.members
    .filter((member) => !filters.member || member.id === filters.member)
    .map((member) => {
      const daily = db.dailyActivities.filter((r) => r.member_id === member.id && inDateRange(r.created_at, filters));
      const toilet = db.toiletLogs.filter((r) => r.member_id === member.id && inDateRange(r.event_at, filters));
      const shower = db.showerLogs.filter((r) => r.member_id === member.id && inDateRange(r.event_at, filters));
      const transportation = db.transportationLogs.filter((r) => r.member_id === member.id && inDateRange(`${r.service_date}T00:00:00.000Z`, filters));
      const blood = db.bloodSugarLogs.filter((r) => r.member_id === member.id && inDateRange(r.checked_at, filters));
      const photos = db.photoUploads.filter((r) => r.member_id === member.id && inDateRange(r.uploaded_at, filters));
      const assessments = db.assessments.filter((r) => r.member_id === member.id && inDateRange(r.created_at, filters));
      const ancillary = db.ancillaryLogs.filter((r) => r.member_id === member.id && inDateRange(`${r.service_date}T00:00:00.000Z`, filters));

      return {
        member_id: member.id,
        member_name: member.display_name,
        daily: daily.length,
        toilet: toilet.length,
        shower: shower.length,
        transportation: transportation.length,
        blood_sugar: blood.length,
        photos: photos.length,
        assessments: assessments.length,
        ancillary_count: ancillary.length,
        ancillary_total_cents: ancillary.reduce((sum, row) => sum + row.amount_cents, 0),
        total_services: daily.length + toilet.length + shower.length + transportation.length + blood.length + photos.length + assessments.length,
        member_href: `/members/${member.id}`
      };
    })
    .filter((row) => row.total_services > 0 || row.ancillary_count > 0)
    .sort((a, b) => (a.total_services < b.total_services ? 1 : -1));
}





