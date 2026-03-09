import { getMockDb } from "@/lib/mock-repo";
import { isMockMode } from "@/lib/runtime";
import { toEasternDate } from "@/lib/timezone";

const DAY_MS = 24 * 60 * 60 * 1000;

function asDate(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseDateInput(raw?: string) {
  if (!raw) return null;
  const parsed = new Date(`${raw}T00:00:00.000`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function resolveRange(rawFrom?: string, rawTo?: string, fallbackDays = 30) {
  const now = new Date();
  const toDate = parseDateInput(rawTo) ?? new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const fromDate = parseDateInput(rawFrom) ?? new Date(toDate.getTime() - (fallbackDays - 1) * DAY_MS);

  const safeFrom = fromDate <= toDate ? fromDate : toDate;
  const safeTo = fromDate <= toDate ? toDate : fromDate;

  return {
    from: toEasternDate(safeFrom),
    to: toEasternDate(safeTo),
    fromDateTime: new Date(safeFrom.getFullYear(), safeFrom.getMonth(), safeFrom.getDate(), 0, 0, 0, 0),
    toDateTime: new Date(safeTo.getFullYear(), safeTo.getMonth(), safeTo.getDate(), 23, 59, 59, 999)
  };
}

function inRange(value: string | null | undefined, fromDateTime: Date, toDateTime: Date) {
  const parsed = asDate(value);
  if (!parsed) return false;
  return parsed >= fromDateTime && parsed <= toDateTime;
}

function inRangeByServiceDate(value: string | null | undefined, fromDateTime: Date, toDateTime: Date) {
  if (!value) return false;
  const parsed = asDate(`${value}T12:00:00.000`);
  if (!parsed) return false;
  return parsed >= fromDateTime && parsed <= toDateTime;
}

export function staffNameToSlug(staffName: string) {
  return staffName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface SnapshotActivity {
  id: string;
  type: string;
  when: string;
  memberName: string;
  details: string;
  href: string;
}

interface SnapshotCounts {
  dailyActivity: number;
  toilet: number;
  shower: number;
  transportation: number;
  bloodSugar: number;
  photoUpload: number;
  assessments: number;
  timePunches: number;
  leadActivities: number;
  partnerActivities: number;
}

export async function getStaffActivitySnapshot(staffSlug: string, rawFrom?: string, rawTo?: string) {
  const range = resolveRange(rawFrom, rawTo, 30);
  if (!isMockMode()) {
    // TODO(backend): Replace with joined staff activity snapshot query/view.
    return {
      staff: null,
      range,
      counts: {
        dailyActivity: 0,
        toilet: 0,
        shower: 0,
        transportation: 0,
        bloodSugar: 0,
        photoUpload: 0,
        assessments: 0,
        timePunches: 0,
        leadActivities: 0,
        partnerActivities: 0
      } as SnapshotCounts,
      totalEntries: 0,
      activities: [] as SnapshotActivity[]
    };
  }

  const db = getMockDb();
  const staff = db.staff.find((row) => staffNameToSlug(row.full_name) === staffSlug) ?? null;
  if (!staff) {
    return {
      staff: null,
      range,
      counts: {
        dailyActivity: 0,
        toilet: 0,
        shower: 0,
        transportation: 0,
        bloodSugar: 0,
        photoUpload: 0,
        assessments: 0,
        timePunches: 0,
        leadActivities: 0,
        partnerActivities: 0
      } as SnapshotCounts,
      totalEntries: 0,
      activities: [] as SnapshotActivity[]
    };
  }

  const { fromDateTime, toDateTime } = range;
  const activities: SnapshotActivity[] = [];

  const dailyRows = db.dailyActivities.filter((row) => row.staff_user_id === staff.id && inRange(row.created_at || row.timestamp, fromDateTime, toDateTime));
  dailyRows.forEach((row) =>
    activities.push({
      id: `daily-${row.id}`,
      type: "Participation Log",
      when: row.created_at || row.timestamp,
      memberName: row.member_name,
      details: `Participation ${row.participation}%`,
      href: "/documentation/activity"
    })
  );

  const toiletRows = db.toiletLogs.filter((row) => row.staff_user_id === staff.id && inRange(row.event_at, fromDateTime, toDateTime));
  toiletRows.forEach((row) =>
    activities.push({
      id: `toilet-${row.id}`,
      type: "Toilet Log",
      when: row.event_at,
      memberName: row.member_name,
      details: `${row.use_type}${row.briefs ? " | Briefs changed" : ""}`,
      href: "/documentation/toilet"
    })
  );

  const showerRows = db.showerLogs.filter((row) => row.staff_user_id === staff.id && inRange(row.event_at, fromDateTime, toDateTime));
  showerRows.forEach((row) =>
    activities.push({
      id: `shower-${row.id}`,
      type: "Shower Log",
      when: row.event_at,
      memberName: row.member_name,
      details: row.laundry ? "Laundry included" : "Shower only",
      href: "/documentation/shower"
    })
  );

  const transportRows = db.transportationLogs.filter(
    (row) =>
      row.staff_user_id === staff.id &&
      (inRange(row.timestamp, fromDateTime, toDateTime) || inRangeByServiceDate(row.service_date, fromDateTime, toDateTime))
  );
  transportRows.forEach((row) =>
    activities.push({
      id: `transport-${row.id}`,
      type: "Transportation",
      when: row.timestamp || `${row.service_date}T12:00:00.000`,
      memberName: row.member_name,
      details: `${row.period} ${row.transport_type}`,
      href: "/documentation/transportation"
    })
  );

  const bloodRows = db.bloodSugarLogs.filter((row) => row.nurse_user_id === staff.id && inRange(row.checked_at, fromDateTime, toDateTime));
  bloodRows.forEach((row) =>
    activities.push({
      id: `blood-${row.id}`,
      type: "Blood Sugar",
      when: row.checked_at,
      memberName: row.member_name,
      details: `${row.reading_mg_dl} mg/dL`,
      href: "/documentation/blood-sugar"
    })
  );

  const photoRows = db.photoUploads.filter((row) => row.uploaded_by === staff.id && inRange(row.uploaded_at, fromDateTime, toDateTime));
  photoRows.forEach((row) =>
    activities.push({
      id: `photo-${row.id}`,
      type: "Photo Upload",
      when: row.uploaded_at,
      memberName: row.member_name,
      details: row.file_name,
      href: "/documentation/photo-upload"
    })
  );

  const assessmentRows = db.assessments.filter((row) => row.created_by_user_id === staff.id && inRange(row.created_at, fromDateTime, toDateTime));
  assessmentRows.forEach((row) =>
    activities.push({
      id: `assessment-${row.id}`,
      type: "Assessment",
      when: row.created_at,
      memberName: row.member_name,
      details: row.complete ? "Complete" : "Incomplete",
      href: "/health/assessment"
    })
  );

  const punchRows = db.timePunches.filter((row) => row.staff_user_id === staff.id && inRange(row.punch_at, fromDateTime, toDateTime));
  punchRows.forEach((row) =>
    activities.push({
      id: `punch-${row.id}`,
      type: "Time Punch",
      when: row.punch_at,
      memberName: row.within_fence === null || row.within_fence === undefined ? "Unknown" : row.within_fence ? "Yes" : "No",
      details: row.punch_type.toUpperCase(),
      href: "/time-card"
    })
  );

  const leadRows = db.leadActivities.filter((row) => row.completed_by_user_id === staff.id && inRange(row.activity_at, fromDateTime, toDateTime));
  leadRows.forEach((row) =>
    activities.push({
      id: `lead-activity-${row.id}`,
      type: "Lead Activity",
      when: row.activity_at,
      memberName: row.member_name,
      details: `${row.activity_type} | ${row.outcome}`,
      href: `/sales/leads/${row.lead_id}`
    })
  );

  const partnerRows = db.partnerActivities.filter(
    (row) =>
      ((row.completed_by_user_id && row.completed_by_user_id === staff.id) || row.completed_by === staff.full_name) &&
      inRange(row.activity_at, fromDateTime, toDateTime)
  );
  partnerRows.forEach((row) =>
    activities.push({
      id: `partner-activity-${row.id}`,
      type: "Partner Activity",
      when: row.activity_at,
      memberName: row.organization_name,
      details: row.activity_type,
      href: "/sales/new-entries/log-partner-activities"
    })
  );

  const counts: SnapshotCounts = {
    dailyActivity: dailyRows.length,
    toilet: toiletRows.length,
    shower: showerRows.length,
    transportation: transportRows.length,
    bloodSugar: bloodRows.length,
    photoUpload: photoRows.length,
    assessments: assessmentRows.length,
    timePunches: punchRows.length,
    leadActivities: leadRows.length,
    partnerActivities: partnerRows.length
  };

  return {
    staff,
    range,
    counts,
    totalEntries: Object.values(counts).reduce((sum, value) => sum + value, 0),
    activities: activities.sort((a, b) => (a.when < b.when ? 1 : -1))
  };
}

interface MemberSnapshotCounts {
  dailyActivity: number;
  toilet: number;
  shower: number;
  transportation: number;
  bloodSugar: number;
  photos: number;
  ancillary: number;
  assessments: number;
  total: number;
}

export async function getMemberActivitySnapshot(memberId: string, rawFrom?: string, rawTo?: string) {
  const range = resolveRange(rawFrom, rawTo, 30);
  if (!isMockMode()) {
    // TODO(backend): Replace with joined member summary query/view.
    return {
      member: null,
      range,
      counts: null as MemberSnapshotCounts | null,
      ancillaryTotalCents: 0,
      activities: [] as SnapshotActivity[]
    };
  }

  const db = getMockDb();
  const member = db.members.find((row) => row.id === memberId) ?? null;
  if (!member) {
    return {
      member: null,
      range,
      counts: null as MemberSnapshotCounts | null,
      ancillaryTotalCents: 0,
      activities: [] as SnapshotActivity[]
    };
  }

  const { fromDateTime, toDateTime } = range;
  const activities: SnapshotActivity[] = [];

  const dailyRows = db.dailyActivities.filter((row) => row.member_id === member.id && inRange(row.created_at || row.timestamp, fromDateTime, toDateTime));
  dailyRows.forEach((row) =>
    activities.push({
      id: `daily-${row.id}`,
      type: "Participation Log",
      when: row.created_at || row.timestamp,
      memberName: member.display_name,
      details: `${row.staff_name} | Participation ${row.participation}%`,
      href: "/documentation/activity"
    })
  );

  const toiletRows = db.toiletLogs.filter((row) => row.member_id === member.id && inRange(row.event_at, fromDateTime, toDateTime));
  toiletRows.forEach((row) =>
    activities.push({
      id: `toilet-${row.id}`,
      type: "Toilet Log",
      when: row.event_at,
      memberName: member.display_name,
      details: `${row.staff_name} | ${row.use_type}`,
      href: "/documentation/toilet"
    })
  );

  const showerRows = db.showerLogs.filter((row) => row.member_id === member.id && inRange(row.event_at, fromDateTime, toDateTime));
  showerRows.forEach((row) =>
    activities.push({
      id: `shower-${row.id}`,
      type: "Shower Log",
      when: row.event_at,
      memberName: member.display_name,
      details: `${row.staff_name}${row.laundry ? " | Laundry" : ""}`,
      href: "/documentation/shower"
    })
  );

  const transportRows = db.transportationLogs.filter(
    (row) =>
      row.member_id === member.id &&
      (inRange(row.timestamp, fromDateTime, toDateTime) || inRangeByServiceDate(row.service_date, fromDateTime, toDateTime))
  );
  transportRows.forEach((row) =>
    activities.push({
      id: `transport-${row.id}`,
      type: "Transportation",
      when: row.timestamp || `${row.service_date}T12:00:00.000`,
      memberName: member.display_name,
      details: `${row.staff_name} | ${row.transport_type}`,
      href: "/documentation/transportation"
    })
  );

  const bloodRows = db.bloodSugarLogs.filter((row) => row.member_id === member.id && inRange(row.checked_at, fromDateTime, toDateTime));
  bloodRows.forEach((row) =>
    activities.push({
      id: `blood-${row.id}`,
      type: "Blood Sugar",
      when: row.checked_at,
      memberName: member.display_name,
      details: `${row.reading_mg_dl} mg/dL | ${row.nurse_name}`,
      href: "/documentation/blood-sugar"
    })
  );

  const photoRows = db.photoUploads.filter((row) => row.member_id === member.id && inRange(row.uploaded_at, fromDateTime, toDateTime));
  photoRows.forEach((row) =>
    activities.push({
      id: `photo-${row.id}`,
      type: "Photo Upload",
      when: row.uploaded_at,
      memberName: member.display_name,
      details: `${row.uploaded_by_name} | ${row.file_name}`,
      href: "/documentation/photo-upload"
    })
  );

  const ancillaryRows = db.ancillaryLogs.filter(
    (row) => row.member_id === member.id && (inRange(row.created_at || row.timestamp, fromDateTime, toDateTime) || inRangeByServiceDate(row.service_date, fromDateTime, toDateTime))
  );
  ancillaryRows.forEach((row) =>
    activities.push({
      id: `ancillary-${row.id}`,
      type: "Ancillary Charge",
      when: row.created_at || row.timestamp,
      memberName: member.display_name,
      details: `${row.category_name} x${row.quantity} | $${(row.amount_cents / 100).toFixed(2)}`,
      href: "/reports/monthly-ancillary"
    })
  );

  const assessmentRows = db.assessments.filter((row) => row.member_id === member.id && inRange(row.created_at, fromDateTime, toDateTime));
  assessmentRows.forEach((row) =>
    activities.push({
      id: `assessment-${row.id}`,
      type: "Assessment",
      when: row.created_at,
      memberName: member.display_name,
      details: `${row.reviewer_name} | ${row.complete ? "Complete" : "Incomplete"}`,
      href: `/reports/assessments/${row.id}`
    })
  );

  const counts: MemberSnapshotCounts = {
    dailyActivity: dailyRows.length,
    toilet: toiletRows.length,
    shower: showerRows.length,
    transportation: transportRows.length,
    bloodSugar: bloodRows.length,
    photos: photoRows.length,
    ancillary: ancillaryRows.length,
    assessments: assessmentRows.length,
    total: dailyRows.length + toiletRows.length + showerRows.length + transportRows.length + bloodRows.length + photoRows.length + ancillaryRows.length + assessmentRows.length
  };

  return {
    member,
    range,
    counts,
    ancillaryTotalCents: ancillaryRows.reduce((sum, row) => sum + row.amount_cents, 0),
    activities: activities.sort((a, b) => (a.when < b.when ? 1 : -1))
  };
}


export async function getStaffSnapshotStaffOptions() {
  if (!isMockMode()) {
    // TODO(backend): Load staff selector options from profiles/staff table.
    return [] as Array<{ id: string; full_name: string; slug: string }>;
  }

  const db = getMockDb();
  return db.staff
    .filter((row) => row.active)
    .map((row) => ({ id: row.id, full_name: row.full_name, slug: staffNameToSlug(row.full_name) }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
}

