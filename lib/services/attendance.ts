import { createClient } from "@/lib/supabase/server";
import {
  getCurrentWeekRange,
  getOperationsTodayDate,
  getWeekRangeFromDate,
  getWeekdayDatesForRange,
  getWeekdayForDate,
  normalizeOperationalDateOnly,
  type OperationsWeekdayKey
} from "@/lib/services/operations-calendar";
import {
  getPrimaryTransportSnapshotForDate,
  getScheduledDayAbbreviations,
  isMemberScheduledForDate
} from "@/lib/services/member-schedule-selectors";


type AttendanceStatusLabel = "Present" | "Checked Out" | "Absent" | "Not Checked In Yet" | "Not Scheduled";

type MemberRow = {
  id: string;
  display_name: string;
  status: "active" | "inactive";
  locker_number: string | null;
  latest_assessment_track: string | null;
};

type AttendanceScheduleRow = {
  id: string;
  member_id: string;
  monday: boolean;
  tuesday: boolean;
  wednesday: boolean;
  thursday: boolean;
  friday: boolean;
  transportation_required: boolean | null;
  transportation_mode: "Bus Stop" | "Door to Door" | null;
  transport_bus_number: string | null;
  transportation_bus_stop: string | null;
  transport_monday_period: "AM" | "PM" | null;
  transport_tuesday_period: "AM" | "PM" | null;
  transport_wednesday_period: "AM" | "PM" | null;
  transport_thursday_period: "AM" | "PM" | null;
  transport_friday_period: "AM" | "PM" | null;
  transport_monday_am_mode: "Bus Stop" | "Door to Door" | null;
  transport_monday_am_door_to_door_address: string | null;
  transport_monday_am_bus_number: string | null;
  transport_monday_am_bus_stop: string | null;
  transport_monday_pm_mode: "Bus Stop" | "Door to Door" | null;
  transport_monday_pm_door_to_door_address: string | null;
  transport_monday_pm_bus_number: string | null;
  transport_monday_pm_bus_stop: string | null;
  transport_tuesday_am_mode: "Bus Stop" | "Door to Door" | null;
  transport_tuesday_am_door_to_door_address: string | null;
  transport_tuesday_am_bus_number: string | null;
  transport_tuesday_am_bus_stop: string | null;
  transport_tuesday_pm_mode: "Bus Stop" | "Door to Door" | null;
  transport_tuesday_pm_door_to_door_address: string | null;
  transport_tuesday_pm_bus_number: string | null;
  transport_tuesday_pm_bus_stop: string | null;
  transport_wednesday_am_mode: "Bus Stop" | "Door to Door" | null;
  transport_wednesday_am_door_to_door_address: string | null;
  transport_wednesday_am_bus_number: string | null;
  transport_wednesday_am_bus_stop: string | null;
  transport_wednesday_pm_mode: "Bus Stop" | "Door to Door" | null;
  transport_wednesday_pm_door_to_door_address: string | null;
  transport_wednesday_pm_bus_number: string | null;
  transport_wednesday_pm_bus_stop: string | null;
  transport_thursday_am_mode: "Bus Stop" | "Door to Door" | null;
  transport_thursday_am_door_to_door_address: string | null;
  transport_thursday_am_bus_number: string | null;
  transport_thursday_am_bus_stop: string | null;
  transport_thursday_pm_mode: "Bus Stop" | "Door to Door" | null;
  transport_thursday_pm_door_to_door_address: string | null;
  transport_thursday_pm_bus_number: string | null;
  transport_thursday_pm_bus_stop: string | null;
  transport_friday_am_mode: "Bus Stop" | "Door to Door" | null;
  transport_friday_am_door_to_door_address: string | null;
  transport_friday_am_bus_number: string | null;
  transport_friday_am_bus_stop: string | null;
  transport_friday_pm_mode: "Bus Stop" | "Door to Door" | null;
  transport_friday_pm_door_to_door_address: string | null;
  transport_friday_pm_bus_number: string | null;
  transport_friday_pm_bus_stop: string | null;
  make_up_days_available: number | null;
};

type AttendanceRecordRow = {
  id: string;
  member_id: string;
  attendance_date: string;
  status: "present" | "absent";
  absent_reason: string | null;
  absent_reason_other: string | null;
  check_in_at: string | null;
  check_out_at: string | null;
  updated_at: string;
};

type HoldRow = {
  member_id: string;
  start_date: string;
  end_date: string | null;
  status: "active" | "ended";
};

export interface DailyAttendanceRow {
  memberId: string;
  memberName: string;
  photoUrl: string | null;
  lockerNumber: string | null;
  trackLabel: "Track 1" | "Track 2" | "Track 3" | "Unassigned";
  scheduledDays: string;
  attendanceRecordId: string | null;
  attendanceStatus: AttendanceStatusLabel;
  recordStatus: "present" | "absent" | null;
  absentReason: string | null;
  absentReasonOther: string | null;
  checkInAt: string | null;
  checkOutAt: string | null;
  transportRequired: boolean;
  transportType: "Bus Stop" | "Door to Door" | null;
  transportBusNumber: string | null;
  transportLocation: string | null;
}

export interface DailyAttendanceSummary {
  scheduledMembers: number;
  presentMembers: number;
  absentMembers: number;
  pendingMembers: number;
  transportMembers: number;
  missingCheckOutMembers: number;
  missingCheckInMembers: number;
  incompleteMembers: number;
  onHoldExcludedMembers: number;
}

export interface DailyAttendanceView {
  selectedDate: string;
  weekday: OperationsWeekdayKey;
  rows: DailyAttendanceRow[];
  summary: DailyAttendanceSummary;
}

export interface IncompleteAttendanceSummary {
  selectedDate: string;
  pendingWithoutStatus: number;
  checkInMissingCheckOut: number;
  checkOutMissingCheckIn: number;
  totalIncomplete: number;
}

export interface WeeklyAttendanceRow {
  memberId: string;
  memberName: string;
  lockerNumber: string | null;
  scheduledDays: string;
  dayStatuses: Record<string, AttendanceStatusLabel>;
}

export interface WeeklyAttendanceDaySummary {
  date: string;
  weekday: OperationsWeekdayKey;
  scheduledMembers: number;
  presentMembers: number;
  absentMembers: number;
  pendingMembers: number;
  transportMembers: number;
  members: Array<{
    memberId: string;
    memberName: string;
    photoUrl: string | null;
    attendanceStatus: AttendanceStatusLabel;
  }>;
}

export interface WeeklyAttendanceView {
  weekStartDate: string;
  weekEndDate: string;
  days: WeeklyAttendanceDaySummary[];
  rows: WeeklyAttendanceRow[];
  totals: {
    scheduledMemberDays: number;
    presentMemberDays: number;
    absentMemberDays: number;
    pendingMemberDays: number;
    attendanceRatePercent: number | null;
  };
}

export interface DailyCensusView {
  selectedDate: string;
  weekday: OperationsWeekdayKey;
  scheduledMembers: number;
  presentMembers: number;
  absentMembers: number;
  pendingMembers: number;
  transportMembers: number;
  onHoldExcludedMembers: number;
  attendanceRatePercent: number | null;
}

export interface WeeklyCensusView {
  weekStartDate: string;
  weekEndDate: string;
  days: WeeklyAttendanceDaySummary[];
  scheduledMemberDays: number;
  presentMemberDays: number;
  absentMemberDays: number;
  pendingMemberDays: number;
  transportMemberDays: number;
  attendanceRatePercent: number | null;
}

export interface DailyTrackMemberRow {
  memberId: string;
  memberName: string;
  photoUrl: string | null;
  lockerNumber: string | null;
  attendanceStatus: AttendanceStatusLabel;
  transportRequired: boolean;
  transportBusNumber: string | null;
}

export interface DailyTrackGroup {
  trackLabel: "Track 1" | "Track 2" | "Track 3" | "Unassigned";
  memberCount: number;
  presentCount: number;
  absentCount: number;
  pendingCount: number;
  members: DailyTrackMemberRow[];
}

export interface DailyTrackSheetView {
  selectedDate: string;
  weekday: OperationsWeekdayKey;
  totalMembers: number;
  groups: DailyTrackGroup[];
}

export interface UnscheduledAttendanceMemberOption {
  id: string;
  displayName: string;
  makeupBalance: number;
}

function sortByLastName(left: string, right: string) {
  const toSortKey = (value: string) => {
    const parts = value.trim().split(/\s+/).filter(Boolean);
    if (parts.length <= 1) return value.toLowerCase();
    return `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(" ")}`.toLowerCase();
  };
  return toSortKey(left).localeCompare(toSortKey(right), undefined, { sensitivity: "base" });
}

function getStatusLabel(input: {
  status: "present" | "absent" | null;
  checkInAt: string | null;
  checkOutAt: string | null;
}): AttendanceStatusLabel {
  const status = input.status;
  if (status === "present" && input.checkOutAt) return "Checked Out";
  if (status === "present") return "Present";
  if (status === "absent") return "Absent";
  if (input.checkOutAt) return "Checked Out";
  if (input.checkInAt) return "Present";
  return "Not Checked In Yet";
}

function normalizeTrackLabel(value: string | null | undefined): "Track 1" | "Track 2" | "Track 3" | "Unassigned" {
  if (value === "Track 1" || value === "Track 2" || value === "Track 3") return value;
  return "Unassigned";
}

function trackSortOrder(label: "Track 1" | "Track 2" | "Track 3" | "Unassigned") {
  if (label === "Track 1") return 1;
  if (label === "Track 2") return 2;
  if (label === "Track 3") return 3;
  return 4;
}

function isMissingSchemaObjectError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  const message = "message" in error ? String((error as { message?: unknown }).message ?? "") : "";
  return code === "PGRST205" || /does not exist|relation .* does not exist|schema cache/i.test(message);
}

function buildAttendanceRecordMap(records: AttendanceRecordRow[]) {
  const map = new Map<string, AttendanceRecordRow>();
  records.forEach((record) => {
    const key = `${record.member_id}:${record.attendance_date}`;
    const existing = map.get(key);
    if (!existing || record.updated_at > existing.updated_at) {
      map.set(key, record);
    }
  });
  return map;
}

function isHoldActiveForDate(hold: HoldRow, dateOnly: string) {
  if (hold.status !== "active") return false;
  if (dateOnly < hold.start_date) return false;
  if (hold.end_date && dateOnly > hold.end_date) return false;
  return true;
}

async function loadAttendanceBaseData(input: { startDate: string; endDate: string }) {
  const supabase = await createClient();
  const { data: membersData, error: membersError } = await supabase
    .from("members")
    .select("id, display_name, status, locker_number, latest_assessment_track")
    .eq("status", "active")
    .order("display_name", { ascending: true });

  if (membersError) throw new Error(membersError.message);

  const members = (membersData ?? []) as MemberRow[];
  const memberIds = members.map((member) => member.id);
  if (memberIds.length === 0) {
    return {
      members,
      schedules: [] as AttendanceScheduleRow[],
      attendanceRecords: [] as AttendanceRecordRow[],
      holds: [] as HoldRow[],
      mccPhotos: new Map<string, string | null>(),
      mhpPhotos: new Map<string, string | null>()
    };
  }

  const holdsFilter = `end_date.is.null,end_date.gte.${input.startDate}`;
  const [scheduleResult, attendanceResult, holdsResult, mccResult, mhpResult] = await Promise.all([
    supabase.from("member_attendance_schedules").select("*").in("member_id", memberIds),
    supabase
      .from("attendance_records")
      .select("id, member_id, attendance_date, status, absent_reason, absent_reason_other, check_in_at, check_out_at, updated_at")
      .in("member_id", memberIds)
      .gte("attendance_date", input.startDate)
      .lte("attendance_date", input.endDate),
    supabase
      .from("member_holds")
      .select("member_id, start_date, end_date, status")
      .in("member_id", memberIds)
      .eq("status", "active")
      .lte("start_date", input.endDate)
      .or(holdsFilter),
    supabase.from("member_command_centers").select("member_id, profile_image_url").in("member_id", memberIds),
    supabase.from("member_health_profiles").select("member_id, profile_image_url").in("member_id", memberIds)
  ]);

  if (scheduleResult.error) throw new Error(scheduleResult.error.message);
  if (attendanceResult.error) throw new Error(attendanceResult.error.message);
  if (holdsResult.error && !isMissingSchemaObjectError(holdsResult.error)) {
    throw new Error(holdsResult.error.message);
  }
  if (mccResult.error && !isMissingSchemaObjectError(mccResult.error)) {
    throw new Error(mccResult.error.message);
  }
  if (mhpResult.error && !isMissingSchemaObjectError(mhpResult.error)) {
    throw new Error(mhpResult.error.message);
  }

  const mccPhotos = new Map(
    (((mccResult.error ? [] : mccResult.data) ?? []) as Array<{ member_id: string; profile_image_url: string | null }>).map((row) => [
      row.member_id,
      row.profile_image_url ?? null
    ])
  );
  const mhpPhotos = new Map(
    (((mhpResult.error ? [] : mhpResult.data) ?? []) as Array<{ member_id: string; profile_image_url: string | null }>).map((row) => [
      row.member_id,
      row.profile_image_url ?? null
    ])
  );

  return {
    members,
    schedules: (scheduleResult.data ?? []) as AttendanceScheduleRow[],
    attendanceRecords: (attendanceResult.data ?? []) as AttendanceRecordRow[],
    holds: (holdsResult.error ? [] : holdsResult.data ?? []) as HoldRow[],
    mccPhotos,
    mhpPhotos
  };
}

function buildDailyRows(input: {
  selectedDate: string;
  members: MemberRow[];
  schedules: AttendanceScheduleRow[];
  attendanceRecords: AttendanceRecordRow[];
  holds: HoldRow[];
  mccPhotos: Map<string, string | null>;
  mhpPhotos: Map<string, string | null>;
}) {
  const recordMap = buildAttendanceRecordMap(input.attendanceRecords);
  const scheduleByMember = new Map(input.schedules.map((row) => [row.member_id, row] as const));
  const holdsByMember = new Map<string, HoldRow[]>();
  input.holds.forEach((hold) => {
    const existing = holdsByMember.get(hold.member_id) ?? [];
    existing.push(hold);
    holdsByMember.set(hold.member_id, existing);
  });

  const weekday = getWeekdayForDate(input.selectedDate);
  let onHoldExcludedMembers = 0;

  const rows = input.members
    .map((member) => {
      const schedule = scheduleByMember.get(member.id) ?? null;
      const scheduledForDate = isMemberScheduledForDate(schedule as any, input.selectedDate);
      if (!scheduledForDate) return null;

      const holdRows = holdsByMember.get(member.id) ?? [];
      if (holdRows.some((hold) => isHoldActiveForDate(hold, input.selectedDate))) {
        onHoldExcludedMembers += 1;
        return null;
      }

      const attendanceRecord = recordMap.get(`${member.id}:${input.selectedDate}`) ?? null;
      const transportSnapshot = getPrimaryTransportSnapshotForDate(schedule as any, input.selectedDate);

      return {
        memberId: member.id,
        memberName: member.display_name,
        photoUrl: input.mccPhotos.get(member.id) ?? input.mhpPhotos.get(member.id) ?? null,
        lockerNumber: member.locker_number,
        trackLabel: normalizeTrackLabel(member.latest_assessment_track),
        scheduledDays: getScheduledDayAbbreviations(schedule as any),
        attendanceRecordId: attendanceRecord?.id ?? null,
        attendanceStatus: getStatusLabel({
          status: attendanceRecord?.status ?? null,
          checkInAt: attendanceRecord?.check_in_at ?? null,
          checkOutAt: attendanceRecord?.check_out_at ?? null
        }),
        recordStatus: attendanceRecord?.status ?? null,
        absentReason: attendanceRecord?.absent_reason ?? null,
        absentReasonOther: attendanceRecord?.absent_reason_other ?? null,
        checkInAt: attendanceRecord?.check_in_at ?? null,
        checkOutAt: attendanceRecord?.check_out_at ?? null,
        transportRequired: transportSnapshot.required,
        transportType: transportSnapshot.mode,
        transportBusNumber: transportSnapshot.busNumber,
        transportLocation:
          transportSnapshot.mode === "Bus Stop"
            ? transportSnapshot.busStop
            : transportSnapshot.mode === "Door to Door"
              ? transportSnapshot.doorToDoorAddress
              : null
      } satisfies DailyAttendanceRow;
    })
    .filter((row): row is DailyAttendanceRow => Boolean(row))
    .sort((left, right) => sortByLastName(left.memberName, right.memberName));

  const summary = rows.reduce<DailyAttendanceSummary>(
    (acc, row) => {
      acc.scheduledMembers += 1;
      if (row.recordStatus === "present") acc.presentMembers += 1;
      else if (row.recordStatus === "absent") acc.absentMembers += 1;
      else acc.pendingMembers += 1;
      if (row.transportRequired) acc.transportMembers += 1;
      if (row.recordStatus === "present" && row.checkInAt && !row.checkOutAt) acc.missingCheckOutMembers += 1;
      if (row.recordStatus === "present" && !row.checkInAt && row.checkOutAt) acc.missingCheckInMembers += 1;
      return acc;
    },
    {
      scheduledMembers: 0,
      presentMembers: 0,
      absentMembers: 0,
      pendingMembers: 0,
      transportMembers: 0,
      missingCheckOutMembers: 0,
      missingCheckInMembers: 0,
      incompleteMembers: 0,
      onHoldExcludedMembers
    }
  );

  summary.incompleteMembers =
    summary.pendingMembers + summary.missingCheckOutMembers + summary.missingCheckInMembers;

  return { rows, summary, weekday };
}

export async function getDailyAttendanceView(input?: { selectedDate?: string | null }): Promise<DailyAttendanceView> {
  const selectedDate = normalizeOperationalDateOnly(input?.selectedDate ?? getOperationsTodayDate());
  const base = await loadAttendanceBaseData({ startDate: selectedDate, endDate: selectedDate });
  const daily = buildDailyRows({
    selectedDate,
    members: base.members,
    schedules: base.schedules,
    attendanceRecords: base.attendanceRecords,
    holds: base.holds,
    mccPhotos: base.mccPhotos,
    mhpPhotos: base.mhpPhotos
  });

  return {
    selectedDate,
    weekday: daily.weekday,
    rows: daily.rows,
    summary: daily.summary
  };
}

export async function getUnscheduledAttendanceMemberOptions(input?: {
  selectedDate?: string | null;
}): Promise<UnscheduledAttendanceMemberOption[]> {
  const selectedDate = normalizeOperationalDateOnly(input?.selectedDate ?? getOperationsTodayDate());
  const base = await loadAttendanceBaseData({ startDate: selectedDate, endDate: selectedDate });
  const scheduleByMember = new Map(base.schedules.map((row) => [row.member_id, row] as const));
  const holdsByMember = new Map<string, HoldRow[]>();
  base.holds.forEach((hold) => {
    const existing = holdsByMember.get(hold.member_id) ?? [];
    existing.push(hold);
    holdsByMember.set(hold.member_id, existing);
  });

  return base.members
    .filter((member) => {
      const schedule = scheduleByMember.get(member.id) ?? null;
      if (schedule && isMemberScheduledForDate(schedule as any, selectedDate)) {
        return false;
      }
      const holdRows = holdsByMember.get(member.id) ?? [];
      if (holdRows.some((hold) => isHoldActiveForDate(hold, selectedDate))) {
        return false;
      }
      return true;
    })
    .map((member) => ({
      id: member.id,
      displayName: member.display_name,
      makeupBalance: Math.max(0, Number(scheduleByMember.get(member.id)?.make_up_days_available ?? 0))
    }))
    .sort((left, right) => sortByLastName(left.displayName, right.displayName));
}

export async function getWeeklyAttendanceView(input?: { anchorDate?: string | null }): Promise<WeeklyAttendanceView> {
  const anchorDate = normalizeOperationalDateOnly(input?.anchorDate ?? getOperationsTodayDate());
  const range = getWeekRangeFromDate(anchorDate);
  const weekdayDates = getWeekdayDatesForRange(range);
  const base = await loadAttendanceBaseData({ startDate: range.startDate, endDate: range.endDate });

  const dayViews = weekdayDates.map((date) => {
    const daily = buildDailyRows({
      selectedDate: date,
      members: base.members,
      schedules: base.schedules,
      attendanceRecords: base.attendanceRecords,
      holds: base.holds,
      mccPhotos: base.mccPhotos,
      mhpPhotos: base.mhpPhotos
    });

    return {
      date,
      weekday: daily.weekday,
      scheduledMembers: daily.summary.scheduledMembers,
      presentMembers: daily.summary.presentMembers,
      absentMembers: daily.summary.absentMembers,
      pendingMembers: daily.summary.pendingMembers,
      transportMembers: daily.summary.transportMembers,
      members: daily.rows.map((row) => ({
        memberId: row.memberId,
        memberName: row.memberName,
        photoUrl: row.photoUrl,
        attendanceStatus: row.attendanceStatus
      })),
      rows: daily.rows
    };
  });

  const rowMap = new Map<string, WeeklyAttendanceRow>();
  dayViews.forEach((day) => {
    day.rows.forEach((row) => {
      const existing = rowMap.get(row.memberId);
      if (!existing) {
        rowMap.set(row.memberId, {
          memberId: row.memberId,
          memberName: row.memberName,
          lockerNumber: row.lockerNumber,
          scheduledDays: row.scheduledDays,
          dayStatuses: {
            [day.date]: row.attendanceStatus
          }
        });
      } else {
        existing.dayStatuses[day.date] = row.attendanceStatus;
      }
    });
  });

  const rows = Array.from(rowMap.values())
    .map((row) => {
      const normalizedStatuses: Record<string, AttendanceStatusLabel> = {};
      weekdayDates.forEach((date) => {
        normalizedStatuses[date] = row.dayStatuses[date] ?? "Not Scheduled";
      });
      return {
        ...row,
        dayStatuses: normalizedStatuses
      };
    })
    .sort((left, right) => sortByLastName(left.memberName, right.memberName));

  const totals = dayViews.reduce(
    (acc, day) => {
      acc.scheduledMemberDays += day.scheduledMembers;
      acc.presentMemberDays += day.presentMembers;
      acc.absentMemberDays += day.absentMembers;
      acc.pendingMemberDays += day.pendingMembers;
      return acc;
    },
    {
      scheduledMemberDays: 0,
      presentMemberDays: 0,
      absentMemberDays: 0,
      pendingMemberDays: 0,
      attendanceRatePercent: null as number | null
    }
  );

  totals.attendanceRatePercent =
    totals.scheduledMemberDays > 0 ? Math.round((totals.presentMemberDays / totals.scheduledMemberDays) * 100) : null;

  return {
    weekStartDate: range.startDate,
    weekEndDate: range.endDate,
    days: dayViews.map(({ rows: dayRows, ...day }) => {
      void dayRows;
      return day;
    }),
    rows,
    totals
  };
}

export async function getDailyCensusView(input?: { selectedDate?: string | null }): Promise<DailyCensusView> {
  const daily = await getDailyAttendanceView({ selectedDate: input?.selectedDate });
  return {
    selectedDate: daily.selectedDate,
    weekday: daily.weekday,
    scheduledMembers: daily.summary.scheduledMembers,
    presentMembers: daily.summary.presentMembers,
    absentMembers: daily.summary.absentMembers,
    pendingMembers: daily.summary.pendingMembers,
    transportMembers: daily.summary.transportMembers,
    onHoldExcludedMembers: daily.summary.onHoldExcludedMembers,
    attendanceRatePercent:
      daily.summary.scheduledMembers > 0
        ? Math.round((daily.summary.presentMembers / daily.summary.scheduledMembers) * 100)
        : null
  };
}

export async function getWeeklyCensusView(input?: { anchorDate?: string | null }): Promise<WeeklyCensusView> {
  const weekly = await getWeeklyAttendanceView({ anchorDate: input?.anchorDate ?? getCurrentWeekRange().startDate });
  const transportMemberDays = weekly.days.reduce((sum, day) => sum + day.transportMembers, 0);
  return {
    weekStartDate: weekly.weekStartDate,
    weekEndDate: weekly.weekEndDate,
    days: weekly.days,
    scheduledMemberDays: weekly.totals.scheduledMemberDays,
    presentMemberDays: weekly.totals.presentMemberDays,
    absentMemberDays: weekly.totals.absentMemberDays,
    pendingMemberDays: weekly.totals.pendingMemberDays,
    transportMemberDays,
    attendanceRatePercent: weekly.totals.attendanceRatePercent
  };
}

export async function getIncompleteAttendanceSummary(input?: { selectedDate?: string | null }): Promise<IncompleteAttendanceSummary> {
  const daily = await getDailyAttendanceView({ selectedDate: input?.selectedDate });
  return {
    selectedDate: daily.selectedDate,
    pendingWithoutStatus: daily.summary.pendingMembers,
    checkInMissingCheckOut: daily.summary.missingCheckOutMembers,
    checkOutMissingCheckIn: daily.summary.missingCheckInMembers,
    totalIncomplete: daily.summary.incompleteMembers
  };
}

export async function getDailyTrackSheetView(input?: { selectedDate?: string | null }): Promise<DailyTrackSheetView> {
  const daily = await getDailyAttendanceView({ selectedDate: input?.selectedDate });
  const groupsMap = new Map<"Track 1" | "Track 2" | "Track 3" | "Unassigned", DailyTrackGroup>();

  daily.rows.forEach((row) => {
    const existing =
      groupsMap.get(row.trackLabel) ??
      ({
        trackLabel: row.trackLabel,
        memberCount: 0,
        presentCount: 0,
        absentCount: 0,
        pendingCount: 0,
        members: []
      } satisfies DailyTrackGroup);

    existing.memberCount += 1;
    if (row.recordStatus === "present") existing.presentCount += 1;
    else if (row.recordStatus === "absent") existing.absentCount += 1;
    else existing.pendingCount += 1;

    existing.members.push({
      memberId: row.memberId,
      memberName: row.memberName,
      photoUrl: row.photoUrl,
      lockerNumber: row.lockerNumber,
      attendanceStatus: row.attendanceStatus,
      transportRequired: row.transportRequired,
      transportBusNumber: row.transportBusNumber
    });
    groupsMap.set(row.trackLabel, existing);
  });

  const groups = Array.from(groupsMap.values())
    .map((group) => ({
      ...group,
      members: [...group.members].sort((left, right) => sortByLastName(left.memberName, right.memberName))
    }))
    .sort((left, right) => trackSortOrder(left.trackLabel) - trackSortOrder(right.trackLabel));

  return {
    selectedDate: daily.selectedDate,
    weekday: daily.weekday,
    totalMembers: daily.summary.scheduledMembers,
    groups
  };
}
