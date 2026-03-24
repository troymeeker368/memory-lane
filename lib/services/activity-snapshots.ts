import { createClient } from "@/lib/supabase/server";
import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";
import { toEasternDate } from "@/lib/timezone";

const DAY_MS = 24 * 60 * 60 * 1000;
const SNAPSHOT_ACTIVITY_FEED_LIMIT = 200;

type StaffSnapshotReadModelRpcRow = {
  daily_activity: number | string | null;
  toilet: number | string | null;
  shower: number | string | null;
  transportation: number | string | null;
  blood_sugar: number | string | null;
  photo_upload: number | string | null;
  assessments: number | string | null;
  time_punches: number | string | null;
  lead_activities: number | string | null;
  partner_activities: number | string | null;
  activity_rows: unknown;
};

type MemberSnapshotReadModelRpcRow = {
  daily_activity: number | string | null;
  toilet: number | string | null;
  shower: number | string | null;
  transportation: number | string | null;
  blood_sugar: number | string | null;
  photos: number | string | null;
  ancillary: number | string | null;
  assessments: number | string | null;
  ancillary_total_cents: number | string | null;
  activity_rows: unknown;
};

type ActivityTimelineRpcRow = {
  id: string;
  activity_type: string | null;
  occurred_at: string | null;
  member_id: string | null;
  member_name: string | null;
  staff_user_id: string | null;
  staff_name: string | null;
  details_summary: string | null;
  source_href: string | null;
  source_table: string | null;
  source_kind: string | null;
};

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

function toCount(value: number | string | null | undefined) {
  return Number(value ?? 0);
}

function mapActivityTimelineRows(payload: unknown) {
  return Array.isArray(payload) ? ((payload as ActivityTimelineRpcRow[]) ?? []) : [];
}

async function loadStaffSnapshotReadModel(input: {
  staffUserId: string;
  staffName: string;
  fromIso: string;
  toIso: string;
  fromDate: string;
  toDate: string;
}) {
  const supabase = await createClient();
  const rows = await invokeSupabaseRpcOrThrow<StaffSnapshotReadModelRpcRow[]>(supabase, "rpc_get_staff_activity_snapshot", {
    p_staff_user_id: input.staffUserId,
    p_staff_name: input.staffName,
    p_from_ts: input.fromIso,
    p_to_ts: input.toIso,
    p_from_date: input.fromDate,
    p_to_date: input.toDate,
    p_source_limit: SNAPSHOT_ACTIVITY_FEED_LIMIT
  });
  const row = rows?.[0];
  return {
    counts: {
      dailyActivity: toCount(row?.daily_activity),
      toilet: toCount(row?.toilet),
      shower: toCount(row?.shower),
      transportation: toCount(row?.transportation),
      bloodSugar: toCount(row?.blood_sugar),
      photoUpload: toCount(row?.photo_upload),
      assessments: toCount(row?.assessments),
      timePunches: toCount(row?.time_punches),
      leadActivities: toCount(row?.lead_activities),
      partnerActivities: toCount(row?.partner_activities)
    } satisfies SnapshotCounts,
    rows: mapActivityTimelineRows(row?.activity_rows)
  };
}

async function loadMemberSnapshotReadModel(input: {
  memberId: string;
  fromIso: string;
  toIso: string;
  fromDate: string;
  toDate: string;
}) {
  const supabase = await createClient();
  const rows = await invokeSupabaseRpcOrThrow<MemberSnapshotReadModelRpcRow[]>(supabase, "rpc_get_member_activity_snapshot", {
    p_member_id: input.memberId,
    p_from_ts: input.fromIso,
    p_to_ts: input.toIso,
    p_from_date: input.fromDate,
    p_to_date: input.toDate,
    p_source_limit: SNAPSHOT_ACTIVITY_FEED_LIMIT
  });

  const row = rows?.[0];
  const counts = {
    dailyActivity: toCount(row?.daily_activity),
    toilet: toCount(row?.toilet),
    shower: toCount(row?.shower),
    transportation: toCount(row?.transportation),
    bloodSugar: toCount(row?.blood_sugar),
    photos: toCount(row?.photos),
    ancillary: toCount(row?.ancillary),
    assessments: toCount(row?.assessments),
    total: 0
  } satisfies MemberSnapshotCounts;
  counts.total =
    counts.dailyActivity +
    counts.toilet +
    counts.shower +
    counts.transportation +
    counts.bloodSugar +
    counts.photos +
    counts.ancillary +
    counts.assessments;

  return {
    counts,
    ancillaryTotalCents: toCount(row?.ancillary_total_cents),
    rows: mapActivityTimelineRows(row?.activity_rows)
  };
}

function formatTimelineRowForStaff(row: ActivityTimelineRpcRow): SnapshotActivity {
  return {
    id: `${row.source_kind || "activity"}-${row.id}`,
    type: row.activity_type ?? "Unknown Activity",
    when: row.occurred_at ?? new Date().toISOString(),
    memberName: row.member_name ?? "Unknown Member",
    details: row.details_summary ?? "",
    href: row.source_href ?? "/"
  };
}

function formatTimelineRowForMember(row: ActivityTimelineRpcRow, memberName: string): SnapshotActivity {
  return {
    id: `${row.source_kind || "activity"}-${row.id}`,
    type: row.activity_type ?? "Unknown Activity",
    when: row.occurred_at ?? new Date().toISOString(),
    memberName,
    details: row.details_summary ?? "",
    href: row.source_href ?? "/"
  };
}

export async function getStaffActivitySnapshot(staffSlug: string, rawFrom?: string, rawTo?: string) {
  const range = resolveRange(rawFrom, rawTo, 30);
  const supabase = await createClient();
  const { data: staffRows, error: staffError } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("active", true);

  if (staffError) throw new Error(`Unable to load staff activity snapshot roster: ${staffError.message}`);
  if (!staffRows) throw new Error("Unable to load staff activity snapshot roster: Supabase returned no staff rows.");

  const staff = staffRows.find((row) => staffNameToSlug(row.full_name) === staffSlug) ?? null;
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
      activities: [] as SnapshotActivity[],
      placeholderNotice: null
    };
  }

  const fromIso = range.fromDateTime.toISOString();
  const toIso = range.toDateTime.toISOString();
  const snapshot = await loadStaffSnapshotReadModel({
    staffUserId: staff.id,
    staffName: staff.full_name,
    fromIso,
    toIso,
    fromDate: range.from,
    toDate: range.to
  });

  const activities: SnapshotActivity[] = snapshot.rows.map(formatTimelineRowForStaff);

  return {
    staff: { id: staff.id, full_name: staff.full_name },
    range,
    counts: snapshot.counts,
    totalEntries: Object.values(snapshot.counts).reduce((sum, value) => sum + value, 0),
    activities: activities.sort((a, b) => (a.when < b.when ? 1 : -1)),
    placeholderNotice: null
  };
}

export async function getMemberActivitySnapshot(memberId: string, rawFrom?: string, rawTo?: string) {
  const range = resolveRange(rawFrom, rawTo, 30);
  const supabase = await createClient();
  const { data: memberRow, error: memberError } = await supabase
    .from("members")
    .select("id, display_name, status")
    .eq("id", memberId)
    .maybeSingle();

  if (memberError) throw new Error(`Unable to load member activity snapshot member row: ${memberError.message}`);
  if (!memberRow) {
    return {
      member: null,
      range,
      counts: null as MemberSnapshotCounts | null,
      ancillaryTotalCents: 0,
      activities: [] as SnapshotActivity[],
      placeholderNotice: null
    };
  }

  const fromIso = range.fromDateTime.toISOString();
  const toIso = range.toDateTime.toISOString();
  const snapshot = await loadMemberSnapshotReadModel({
    memberId: memberRow.id,
    fromIso,
    toIso,
    fromDate: range.from,
    toDate: range.to
  });

  const activities: SnapshotActivity[] = snapshot.rows.map((row) =>
    formatTimelineRowForMember(row, memberRow.display_name)
  );

  return {
    member: memberRow,
    range,
    counts: snapshot.counts,
    ancillaryTotalCents: snapshot.ancillaryTotalCents,
    activities: activities.sort((a, b) => (a.when < b.when ? 1 : -1)),
    placeholderNotice: null
  };
}

export async function getStaffSnapshotStaffOptions() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("active", true)
    .order("full_name");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({ id: row.id, full_name: row.full_name, slug: staffNameToSlug(row.full_name) }));
}
