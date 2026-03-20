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
  getTransportSlotForScheduleDay
} from "@/lib/services/member-schedule-selectors";
import {
  loadExpectedAttendanceSupabaseContext,
  resolveExpectedAttendanceFromSupabaseContext,
  type ExpectedAttendanceSupabaseContext
} from "@/lib/services/expected-attendance-supabase";
import { calculateAttendanceRatePercent } from "@/lib/services/attendance-rate";
import { ATTENDANCE_SCHEDULE_SELECT } from "@/lib/services/attendance-selects";
import {
  type ScheduleWeekdayKey
} from "@/lib/services/schedule-changes-supabase";


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

const WEEKDAY_ABBREVIATIONS: Record<ScheduleWeekdayKey, string> = {
  monday: "M",
  tuesday: "Tu",
  wednesday: "W",
  thursday: "Th",
  friday: "F"
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

function formatScheduledDays(days: ScheduleWeekdayKey[]) {
  if (days.length === 0) return "-";
  return days.map((day) => WEEKDAY_ABBREVIATIONS[day]).join(", ");
}

function toScheduleWeekday(weekday: OperationsWeekdayKey): ScheduleWeekdayKey | null {
  if (
    weekday === "monday" ||
    weekday === "tuesday" ||
    weekday === "wednesday" ||
    weekday === "thursday" ||
    weekday === "friday"
  ) {
    return weekday;
  }
  return null;
}

function getTransportSnapshotForWeekday(input: {
  schedule: AttendanceScheduleRow | null;
  weekday: OperationsWeekdayKey;
}) {
  if (!input.schedule || input.schedule.transportation_required !== true) {
    return {
      required: false,
      mode: null as "Bus Stop" | "Door to Door" | null,
      busNumber: null as string | null,
      busStop: null as string | null,
      doorToDoorAddress: null as string | null
    };
  }

  const weekday = toScheduleWeekday(input.weekday);
  if (!weekday) {
    return {
      required: false,
      mode: null as "Bus Stop" | "Door to Door" | null,
      busNumber: null as string | null,
      busStop: null as string | null,
      doorToDoorAddress: null as string | null
    };
  }

  const amSlot = getTransportSlotForScheduleDay(input.schedule as Parameters<typeof getTransportSlotForScheduleDay>[0], weekday, "AM");
  const pmSlot = getTransportSlotForScheduleDay(input.schedule as Parameters<typeof getTransportSlotForScheduleDay>[0], weekday, "PM");
  const mode = amSlot.mode ?? pmSlot.mode;
  return {
    required: Boolean(mode),
    mode,
    busNumber: amSlot.busNumber ?? pmSlot.busNumber,
    busStop: amSlot.busStop ?? pmSlot.busStop,
    doorToDoorAddress: amSlot.doorToDoorAddress ?? pmSlot.doorToDoorAddress
  };
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
  const emptyExpectedAttendanceContext: ExpectedAttendanceSupabaseContext = {
    startDate: input.startDate,
    endDate: input.endDate,
    schedulesByMember: new Map(),
    holdsByMember: new Map(),
    scheduleChangesByMember: new Map(),
    centerClosures: [],
    attendanceRecordByMemberDate: new Map()
  };
  if (memberIds.length === 0) {
    return {
      members,
      schedules: [] as AttendanceScheduleRow[],
      attendanceRecords: [] as AttendanceRecordRow[],
      expectedAttendanceContext: emptyExpectedAttendanceContext,
      mccPhotos: new Map<string, string | null>(),
      mhpPhotos: new Map<string, string | null>()
    };
  }

  const [scheduleResult, attendanceResult, expectedAttendanceContext, mccResult, mhpResult] = await Promise.all([
    supabase.from("member_attendance_schedules").select(ATTENDANCE_SCHEDULE_SELECT).in("member_id", memberIds),
    supabase
      .from("attendance_records")
      .select("id, member_id, attendance_date, status, absent_reason, absent_reason_other, check_in_at, check_out_at, updated_at")
      .in("member_id", memberIds)
      .gte("attendance_date", input.startDate)
      .lte("attendance_date", input.endDate),
    loadExpectedAttendanceSupabaseContext({
      memberIds,
      startDate: input.startDate,
      endDate: input.endDate,
      includeAttendanceRecords: false,
      includeSchedules: false
    }),
    supabase.from("member_command_centers").select("member_id, profile_image_url").in("member_id", memberIds),
    supabase.from("member_health_profiles").select("member_id, profile_image_url").in("member_id", memberIds)
  ]);

  if (scheduleResult.error) throw new Error(scheduleResult.error.message);
  if (attendanceResult.error) throw new Error(attendanceResult.error.message);
  if (mccResult.error) throw new Error(mccResult.error.message);
  if (mhpResult.error) throw new Error(mhpResult.error.message);

  const mccPhotos = new Map(
    (((mccResult.data) ?? []) as Array<{ member_id: string; profile_image_url: string | null }>).map((row) => [
      row.member_id,
      row.profile_image_url ?? null
    ])
  );
  const mhpPhotos = new Map(
    (((mhpResult.data) ?? []) as Array<{ member_id: string; profile_image_url: string | null }>).map((row) => [
      row.member_id,
      row.profile_image_url ?? null
    ])
  );

    return {
      members,
      schedules: (scheduleResult.data ?? []) as AttendanceScheduleRow[],
      attendanceRecords: (attendanceResult.data ?? []) as AttendanceRecordRow[],
      expectedAttendanceContext,
      mccPhotos,
      mhpPhotos
    };
}

function buildDailyRows(input: {
  selectedDate: string;
  members: MemberRow[];
  schedules: AttendanceScheduleRow[];
  attendanceRecords: AttendanceRecordRow[];
  expectedAttendanceContext: ExpectedAttendanceSupabaseContext;
  mccPhotos: Map<string, string | null>;
  mhpPhotos: Map<string, string | null>;
}) {
  const recordMap = buildAttendanceRecordMap(input.attendanceRecords);
  const scheduleByMember = new Map(input.schedules.map((row) => [row.member_id, row] as const));

  const weekday = getWeekdayForDate(input.selectedDate);
  let onHoldExcludedMembers = 0;

  const rows = input.members
    .map((member) => {
      const schedule = scheduleByMember.get(member.id) ?? null;
      const attendanceRecord = recordMap.get(`${member.id}:${input.selectedDate}`) ?? null;
      const resolution = resolveExpectedAttendanceFromSupabaseContext({
        context: input.expectedAttendanceContext,
        memberId: member.id,
        date: input.selectedDate,
        baseScheduleOverride: schedule,
        hasUnscheduledAttendanceAddition: Boolean(attendanceRecord)
      });

      if (resolution.blockedBy === "member-hold" && resolution.scheduledFromSchedule) {
        onHoldExcludedMembers += 1;
      }
      if (!resolution.isScheduled) {
        return null;
      }

      const transportSnapshot = getTransportSnapshotForWeekday({
        schedule,
        weekday: resolution.weekday
      });

      return {
        memberId: member.id,
        memberName: member.display_name,
        photoUrl: input.mccPhotos.get(member.id) ?? input.mhpPhotos.get(member.id) ?? null,
        lockerNumber: member.locker_number,
        trackLabel: normalizeTrackLabel(member.latest_assessment_track),
        scheduledDays: formatScheduledDays(resolution.effectiveDays),
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
    expectedAttendanceContext: base.expectedAttendanceContext,
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
  const dateIsCenterClosed = base.expectedAttendanceContext.centerClosures.some(
    (closure) => closure.closure_date === selectedDate
  );
  if (dateIsCenterClosed) return [];

  const scheduleByMember = new Map(base.schedules.map((row) => [row.member_id, row] as const));
  const recordMap = buildAttendanceRecordMap(base.attendanceRecords);

  return base.members
    .filter((member) => {
      const schedule = scheduleByMember.get(member.id) ?? null;
      const attendanceRecord = recordMap.get(`${member.id}:${selectedDate}`) ?? null;
      const resolution = resolveExpectedAttendanceFromSupabaseContext({
        context: base.expectedAttendanceContext,
        memberId: member.id,
        date: selectedDate,
        baseScheduleOverride: schedule,
        hasUnscheduledAttendanceAddition: Boolean(attendanceRecord)
      });
      if (resolution.isScheduled || resolution.blockedBy === "member-hold") {
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
      expectedAttendanceContext: base.expectedAttendanceContext,
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

  totals.attendanceRatePercent = calculateAttendanceRatePercent({
    presentMemberDays: totals.presentMemberDays,
    scheduledMemberDays: totals.scheduledMemberDays
  });

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
    attendanceRatePercent: calculateAttendanceRatePercent({
      presentMemberDays: daily.summary.presentMembers,
      scheduledMemberDays: daily.summary.scheduledMembers
    })
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
