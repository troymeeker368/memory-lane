import { getMockDb } from "@/lib/mock-repo";
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
import { isMemberOnHoldOnDate } from "@/lib/services/holds";

type AttendanceStatusLabel = "Present" | "Checked Out" | "Absent" | "Not Checked In Yet" | "Not Scheduled";

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
  transportBusNumber: "1" | "2" | "3" | null;
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
  transportBusNumber: "1" | "2" | "3" | null;
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

function buildAttendanceRecordMap() {
  const db = getMockDb();
  const map = new Map<string, (typeof db.attendanceRecords)[number]>();
  db.attendanceRecords.forEach((record) => {
    const key = `${record.member_id}:${record.attendance_date}`;
    const existing = map.get(key);
    if (!existing || record.updated_at > existing.updated_at) {
      map.set(key, record);
    }
  });
  return map;
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

function buildDailyRows(selectedDate: string) {
  const db = getMockDb();
  const recordMap = buildAttendanceRecordMap();
  const profileByMember = new Map(db.memberCommandCenters.map((row) => [row.member_id, row] as const));
  const healthProfileByMember = new Map(db.memberHealthProfiles.map((row) => [row.member_id, row] as const));
  const scheduleByMember = new Map(db.memberAttendanceSchedules.map((row) => [row.member_id, row] as const));
  const weekday = getWeekdayForDate(selectedDate);

  let onHoldExcludedMembers = 0;

  const rows = db.members
    .filter((member) => member.status === "active")
    .map((member) => {
      const schedule = scheduleByMember.get(member.id) ?? null;
      const scheduledForDate = isMemberScheduledForDate(schedule, selectedDate);
      if (!scheduledForDate) return null;
      if (isMemberOnHoldOnDate(member.id, selectedDate)) {
        onHoldExcludedMembers += 1;
        return null;
      }

      const attendanceRecord = recordMap.get(`${member.id}:${selectedDate}`) ?? null;
      const transportSnapshot = getPrimaryTransportSnapshotForDate(schedule, selectedDate);
      const profile = profileByMember.get(member.id);
      const healthProfile = healthProfileByMember.get(member.id);

      return {
        memberId: member.id,
        memberName: member.display_name,
        photoUrl: profile?.profile_image_url ?? healthProfile?.profile_image_url ?? null,
        lockerNumber: member.locker_number,
        trackLabel: normalizeTrackLabel(member.latest_assessment_track),
        scheduledDays: getScheduledDayAbbreviations(schedule),
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

export function getDailyAttendanceView(input?: { selectedDate?: string | null }): DailyAttendanceView {
  const selectedDate = normalizeOperationalDateOnly(input?.selectedDate ?? getOperationsTodayDate());
  const daily = buildDailyRows(selectedDate);
  return {
    selectedDate,
    weekday: daily.weekday,
    rows: daily.rows,
    summary: daily.summary
  };
}

export function getWeeklyAttendanceView(input?: { anchorDate?: string | null }): WeeklyAttendanceView {
  const anchorDate = normalizeOperationalDateOnly(input?.anchorDate ?? getOperationsTodayDate());
  const range = getWeekRangeFromDate(anchorDate);
  const weekdayDates = getWeekdayDatesForRange(range);
  const dayViews = weekdayDates.map((date) => {
    const daily = buildDailyRows(date);
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
    days: dayViews.map(({ rows, ...day }) => {
      void rows;
      return day;
    }),
    rows,
    totals
  };
}

export function getDailyCensusView(input?: { selectedDate?: string | null }): DailyCensusView {
  const daily = getDailyAttendanceView({ selectedDate: input?.selectedDate });
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

export function getWeeklyCensusView(input?: { anchorDate?: string | null }): WeeklyCensusView {
  const weekly = getWeeklyAttendanceView({ anchorDate: input?.anchorDate ?? getCurrentWeekRange().startDate });
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

export function getIncompleteAttendanceSummary(input?: { selectedDate?: string | null }): IncompleteAttendanceSummary {
  const daily = getDailyAttendanceView({ selectedDate: input?.selectedDate });
  return {
    selectedDate: daily.selectedDate,
    pendingWithoutStatus: daily.summary.pendingMembers,
    checkInMissingCheckOut: daily.summary.missingCheckOutMembers,
    checkOutMissingCheckIn: daily.summary.missingCheckInMembers,
    totalIncomplete: daily.summary.incompleteMembers
  };
}

export function getDailyTrackSheetView(input?: { selectedDate?: string | null }): DailyTrackSheetView {
  const daily = getDailyAttendanceView({ selectedDate: input?.selectedDate });
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
