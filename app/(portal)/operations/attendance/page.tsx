import Link from "next/link";
import Image from "next/image";
import { unstable_noStore as noStore } from "next/cache";

import { DailyAttendancePanel } from "@/components/forms/daily-attendance-panel";
import { BackArrowButton } from "@/components/ui/back-arrow-button";
import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import {
  getDailyAttendanceView,
  getDailyCensusView,
  getDailyTrackSheetView,
  getUnscheduledAttendanceMemberOptions,
  getWeeklyAttendanceView,
  getWeeklyCensusView,
  type DailyTrackGroup
} from "@/lib/services/attendance";
import {
  coerceToOperationalWeekday,
  getOperationsTodayDate,
  normalizeOperationalDateOnly
} from "@/lib/services/operations-calendar";
import { formatDate } from "@/lib/utils";

type AttendanceTab = "daily-attendance" | "weekly-attendance" | "daily-census" | "daily-tracks" | "weekly-census";

const TAB_ITEMS: Array<{ key: AttendanceTab; label: string }> = [
  { key: "daily-attendance", label: "Daily Attendance" },
  { key: "weekly-attendance", label: "Weekly Attendance" },
  { key: "daily-census", label: "Daily Census" },
  { key: "daily-tracks", label: "Daily Tracks" },
  { key: "weekly-census", label: "Weekly Census" }
];

const WEEKDAY_LABELS: Record<string, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday"
};

const OPERATIONAL_WEEKDAYS = new Set(["monday", "tuesday", "wednesday", "thursday", "friday"]);

const LICENSED_MEMBER_CAP = 89;

function firstString(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function normalizeTab(value: string | undefined): AttendanceTab {
  if (
    value === "daily-attendance" ||
    value === "weekly-attendance" ||
    value === "daily-census" ||
    value === "daily-tracks" ||
    value === "weekly-census"
  ) {
    return value;
  }
  return "daily-attendance";
}

function filterMembersByQuery<T extends { memberName: string }>(rows: T[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return rows;
  return rows.filter((row) => row.memberName.toLowerCase().includes(normalized));
}

function filterTrackGroupsByQuery(
  groups: DailyTrackGroup[],
  query: string
) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return groups;
  return groups
    .map((group) => {
      const members = group.members.filter((member) => {
        return member.memberName.toLowerCase().includes(normalized);
      });
      const presentCount = members.filter((member) => member.attendanceStatus === "Present").length;
      const absentCount = members.filter((member) => member.attendanceStatus === "Absent").length;
      const pendingCount = members.length - presentCount - absentCount;
      return {
        ...group,
        members,
        memberCount: members.length,
        presentCount,
        absentCount,
        pendingCount
      };
    })
    .filter((group) => group.members.length > 0);
}

function getSundayForWeek(dateOnlyInput: string) {
  const dateOnly = normalizeOperationalDateOnly(dateOnlyInput);
  const parsed = new Date(`${dateOnly}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return dateOnly;
  parsed.setUTCDate(parsed.getUTCDate() - parsed.getUTCDay());
  return parsed.toISOString().slice(0, 10);
}

function coerceToOperationalWeekAnchor(dateOnlyInput: string) {
  const dateOnly = normalizeOperationalDateOnly(dateOnlyInput);
  const parsed = new Date(`${dateOnly}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return dateOnly;
  const day = parsed.getUTCDay();
  if (day === 0) {
    parsed.setUTCDate(parsed.getUTCDate() + 1);
    return parsed.toISOString().slice(0, 10);
  }
  if (day === 6) {
    parsed.setUTCDate(parsed.getUTCDate() - 5);
    return parsed.toISOString().slice(0, 10);
  }
  return dateOnly;
}

function memberInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "M";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
}

function formatUtilizationPercent(scheduledMembers: number, cap: number = LICENSED_MEMBER_CAP) {
  if (cap <= 0) return "N/A";
  return `${Math.round((scheduledMembers / cap) * 100)}%`;
}

export default async function OperationsAttendancePage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  noStore();
  const profile = await requireModuleAccess("operations");
  const canEdit = profile.role === "admin" || profile.role === "manager";
  const params = await searchParams;

  const selectedTab = normalizeTab(firstString(params.tab));
  const selectedDate = coerceToOperationalWeekday(
    normalizeOperationalDateOnly(firstString(params.date) ?? getOperationsTodayDate())
  );
  const selectedWeekAnchor = coerceToOperationalWeekAnchor(
    normalizeOperationalDateOnly(firstString(params.week) ?? selectedDate)
  );
  const selectedWeekSunday = getSundayForWeek(selectedWeekAnchor);
  const query = firstString(params.q) ?? "";

  const isDailyAttendanceTab = selectedTab === "daily-attendance";
  const isWeeklyAttendanceTab = selectedTab === "weekly-attendance";
  const isDailyCensusTab = selectedTab === "daily-census";
  const isDailyTracksTab = selectedTab === "daily-tracks";
  const isWeeklyCensusTab = selectedTab === "weekly-census";

  const dailyAttendance = isDailyAttendanceTab ? await getDailyAttendanceView({ selectedDate }) : null;
  const weeklyAttendance = isWeeklyAttendanceTab ? await getWeeklyAttendanceView({ anchorDate: selectedWeekAnchor }) : null;
  const dailyCensus = isDailyCensusTab ? await getDailyCensusView({ selectedDate }) : null;
  const dailyTracks = isDailyTracksTab ? await getDailyTrackSheetView({ selectedDate }) : null;
  const weeklyCensus = isWeeklyCensusTab ? await getWeeklyCensusView({ anchorDate: selectedWeekAnchor }) : null;

  const unscheduledMembers =
    isDailyAttendanceTab && dailyAttendance
      ? await getUnscheduledAttendanceMemberOptions({ selectedDate: dailyAttendance.selectedDate })
      : [];

  const weeklyAttendanceDays =
    isWeeklyAttendanceTab && weeklyAttendance
      ? weeklyAttendance.days.filter((day) => OPERATIONAL_WEEKDAYS.has(day.weekday))
      : [];
  const weeklyDays =
    isWeeklyAttendanceTab && weeklyAttendance
      ? weeklyAttendanceDays.map((day) => ({
          ...day,
          members: filterMembersByQuery(day.members, query)
        }))
      : [];
  const dailyTrackGroups = isDailyTracksTab && dailyTracks ? filterTrackGroupsByQuery(dailyTracks.groups, query) : [];
  const weeklyCensusDays =
    isWeeklyCensusTab && weeklyCensus ? weeklyCensus.days.filter((day) => OPERATIONAL_WEEKDAYS.has(day.weekday)) : [];

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <BackArrowButton fallbackHref="/operations" forceFallback ariaLabel="Back to operations" />
          <div>
            <CardTitle>Attendance</CardTitle>
            <p className="mt-1 text-sm text-muted">
              Real-time attendance and census tied to Member Command Center schedules, reusable for future billing and transportation planning.
            </p>
          </div>
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap gap-2">
          {TAB_ITEMS.map((tab) => (
            <Link
              key={tab.key}
              href={`/operations/attendance?tab=${tab.key}&date=${selectedDate}&week=${selectedWeekAnchor}`}
              className={`rounded-lg border px-3 py-2 text-sm font-semibold ${
                selectedTab === tab.key ? "border-brand bg-brand text-white" : "border-border text-brand"
              }`}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </Card>

      {selectedTab === "daily-attendance" && dailyAttendance ? (
        <Card className="table-wrap">
          <CardTitle>Daily Attendance</CardTitle>
          <form method="get" className="mt-3 grid gap-2 md:grid-cols-5">
            <input type="hidden" name="tab" value="daily-attendance" />
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold text-muted">Date</span>
              <input type="date" name="date" defaultValue={selectedDate} className="h-10 w-full rounded-lg border border-border px-3" />
            </label>
            <label className="space-y-1 text-sm md:col-span-2">
              <span className="text-xs font-semibold text-muted">Search</span>
              <input
                name="q"
                defaultValue={query}
                placeholder="Search member name"
                className="h-10 w-full rounded-lg border border-border px-3"
              />
            </label>
            <button type="submit" className="h-10 self-end rounded-lg bg-brand px-3 text-sm font-semibold text-white">
              Apply
            </button>
            <Link
              href={`/operations/attendance?tab=daily-attendance&date=${selectedDate}`}
              className="h-10 self-end rounded-lg border border-border px-3 text-center text-sm font-semibold leading-10"
            >
              Clear
            </Link>
          </form>

          <DailyAttendancePanel
            dailyAttendance={dailyAttendance}
            query={query}
            unscheduledMembers={unscheduledMembers}
            canEdit={canEdit}
          />
        </Card>
      ) : null}

      {selectedTab === "weekly-attendance" && weeklyAttendance ? (
        <Card className="table-wrap">
          <CardTitle>Weekly Attendance</CardTitle>
          <form method="get" className="mt-3 grid gap-2 md:grid-cols-5">
            <input type="hidden" name="tab" value="weekly-attendance" />
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold text-muted">Week Of</span>
              <input type="date" name="week" defaultValue={selectedWeekAnchor} className="h-10 w-full rounded-lg border border-border px-3" />
            </label>
            <label className="space-y-1 text-sm md:col-span-2">
              <span className="text-xs font-semibold text-muted">Search</span>
              <input
                name="q"
                defaultValue={query}
                placeholder="Search member name"
                className="h-10 w-full rounded-lg border border-border px-3"
              />
            </label>
            <button type="submit" className="h-10 self-end rounded-lg bg-brand px-3 text-sm font-semibold text-white">
              Apply
            </button>
            <Link
              href={`/operations/attendance?tab=weekly-attendance&week=${selectedWeekAnchor}`}
              className="h-10 self-end rounded-lg border border-border px-3 text-center text-sm font-semibold leading-10"
            >
              Clear
            </Link>
          </form>

          <div className="mt-2 grid gap-2 text-xs text-muted md:grid-cols-4">
            <p>Scheduled Member-Days: {weeklyAttendance.totals.scheduledMemberDays}</p>
            <p>Present Member-Days: {weeklyAttendance.totals.presentMemberDays}</p>
            <p>Absent Member-Days: {weeklyAttendance.totals.absentMemberDays}</p>
            <p>Pending Member-Days: {weeklyAttendance.totals.pendingMemberDays}</p>
          </div>

          <div className="mt-3 rounded-lg bg-brand px-3 py-2 text-center text-sm font-bold text-white">
            Week of {formatDate(selectedWeekSunday)}
          </div>

          <div className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-5">
            {weeklyDays.map((day) => (
              <div key={`weekly-day-card-${day.date}`} className="min-w-0 rounded-lg border border-border p-2">
                <p className="text-center text-xl font-semibold leading-tight text-fg">
                  {WEEKDAY_LABELS[day.weekday]}
                </p>
                <p className="mt-0.5 text-center text-lg font-semibold leading-tight text-muted">{day.scheduledMembers}</p>
                {query.trim().length > 0 ? (
                  <p className="text-[11px] text-muted">Showing: {day.members.length}</p>
                ) : null}

                {day.members.length === 0 ? (
                  <p className="mt-1 text-[11px] text-muted">No members match filter.</p>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {day.members.map((member) => (
                      <li key={`${day.date}-${member.memberId}`} className="flex min-w-0 items-center gap-1.5">
                        {member.photoUrl ? (
                          <Image
                            src={member.photoUrl}
                            alt={member.memberName}
                            width={22}
                            height={22}
                            className="h-[22px] w-[22px] rounded-full border border-border object-cover"
                          />
                        ) : (
                          <div className="flex h-[22px] w-[22px] items-center justify-center rounded-full border border-border bg-[#e8edf7] text-[8px] font-semibold text-brand">
                            {memberInitials(member.memberName)}
                          </div>
                        )}
                        <Link
                          href={`/operations/member-command-center/${member.memberId}`}
                          className="truncate text-xs font-semibold text-brand"
                          title={member.memberName}
                        >
                          {member.memberName}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {selectedTab === "daily-census" && dailyCensus ? (
        <Card>
          <CardTitle>Daily Census</CardTitle>
          <form method="get" className="mt-3 grid gap-2 md:grid-cols-4">
            <input type="hidden" name="tab" value="daily-census" />
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold text-muted">Date</span>
              <input type="date" name="date" defaultValue={selectedDate} className="h-10 w-full rounded-lg border border-border px-3" />
            </label>
            <button type="submit" className="h-10 self-end rounded-lg bg-brand px-3 text-sm font-semibold text-white">
              Apply
            </button>
            <Link
              href={`/operations/attendance?tab=daily-census&date=${selectedDate}`}
              className="h-10 self-end rounded-lg border border-border px-3 text-center text-sm font-semibold leading-10"
            >
              Clear
            </Link>
          </form>

          <p className="mt-3 text-sm font-semibold text-fg">
            {WEEKDAY_LABELS[dailyCensus.weekday]} ({formatDate(dailyCensus.selectedDate)})
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-lg border border-border p-3 text-sm">Scheduled Members: <strong>{dailyCensus.scheduledMembers}</strong></div>
            <div className="rounded-lg border border-border p-3 text-sm">Present Members: <strong>{dailyCensus.presentMembers}</strong></div>
            <div className="rounded-lg border border-border p-3 text-sm">Absent Members: <strong>{dailyCensus.absentMembers}</strong></div>
            <div className="rounded-lg border border-border p-3 text-sm">Not Checked In Yet: <strong>{dailyCensus.pendingMembers}</strong></div>
            <div className="rounded-lg border border-border p-3 text-sm">Transportation Needed: <strong>{dailyCensus.transportMembers}</strong></div>
            <div className="rounded-lg border border-border p-3 text-sm">
              Attendance Rate: <strong>{dailyCensus.attendanceRatePercent == null ? "N/A" : `${dailyCensus.attendanceRatePercent}%`}</strong>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-3 text-sm">
            <Link href={`/operations/attendance?tab=daily-attendance&date=${dailyCensus.selectedDate}`} className="font-semibold text-brand">
              Open Daily Attendance Roster
            </Link>
            <Link href={`/operations/attendance?tab=daily-tracks&date=${dailyCensus.selectedDate}`} className="font-semibold text-brand">
              Open Daily Tracks Sheet
            </Link>
            <Link href={`/operations/transportation-station?date=${dailyCensus.selectedDate}&shift=Both&bus=all`} className="font-semibold text-brand">
              Open Transportation Station
            </Link>
          </div>
        </Card>
      ) : null}

      {selectedTab === "daily-tracks" && dailyTracks ? (
        <Card className="table-wrap">
          <CardTitle>Daily Tracks</CardTitle>
          <form method="get" className="mt-3 grid gap-2 md:grid-cols-5">
            <input type="hidden" name="tab" value="daily-tracks" />
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold text-muted">Date</span>
              <input type="date" name="date" defaultValue={selectedDate} className="h-10 w-full rounded-lg border border-border px-3" />
            </label>
            <label className="space-y-1 text-sm md:col-span-2">
              <span className="text-xs font-semibold text-muted">Search</span>
              <input
                name="q"
                defaultValue={query}
                placeholder="Search member name"
                className="h-10 w-full rounded-lg border border-border px-3"
              />
            </label>
            <button type="submit" className="h-10 self-end rounded-lg bg-brand px-3 text-sm font-semibold text-white">
              Apply
            </button>
            <Link
              href={`/operations/attendance?tab=daily-tracks&date=${selectedDate}`}
              className="h-10 self-end rounded-lg border border-border px-3 text-center text-sm font-semibold leading-10"
            >
              Clear
            </Link>
          </form>

          <div className="mt-3 grid gap-2 text-xs text-muted md:grid-cols-3">
            <p>Date: {formatDate(dailyTracks.selectedDate)} ({WEEKDAY_LABELS[dailyTracks.weekday]})</p>
            <p>Scheduled Members: {dailyTracks.totalMembers}</p>
            <p>Track Groups: {dailyTrackGroups.length}</p>
          </div>

          {dailyTrackGroups.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No members match this date/filter.</p>
          ) : (
            <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {dailyTrackGroups.map((group) => (
                <div key={`track-group-${group.trackLabel}`} className="rounded-lg border border-border p-3">
                  <div className="border-b border-border pb-2">
                    <p className="text-sm font-semibold text-fg">{group.trackLabel}</p>
                    <p className="text-xs text-muted">Members: {group.memberCount}</p>
                  </div>
                  <ul className="mt-2 space-y-1">
                    {group.members.map((member) => (
                      <li key={`${group.trackLabel}-${member.memberId}`}>
                        <Link href={`/operations/member-command-center/${member.memberId}`} className="text-sm font-semibold text-brand">
                          {member.memberName}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Card>
      ) : null}

      {selectedTab === "weekly-census" && weeklyCensus ? (
        <Card className="table-wrap">
          <CardTitle>Weekly Census</CardTitle>
          <form method="get" className="mt-3 grid gap-2 md:grid-cols-4">
            <input type="hidden" name="tab" value="weekly-census" />
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold text-muted">Week Of</span>
              <input type="date" name="week" defaultValue={selectedWeekAnchor} className="h-10 w-full rounded-lg border border-border px-3" />
            </label>
            <button type="submit" className="h-10 self-end rounded-lg bg-brand px-3 text-sm font-semibold text-white">
              Apply
            </button>
            <Link
              href={`/operations/attendance?tab=weekly-census&week=${selectedWeekAnchor}`}
              className="h-10 self-end rounded-lg border border-border px-3 text-center text-sm font-semibold leading-10"
            >
              Clear
            </Link>
          </form>

          <p className="mt-3 text-xs text-muted">
            Week: {formatDate(weeklyCensus.weekStartDate)} - {formatDate(weeklyCensus.weekEndDate)}
          </p>

          <table className="mt-3">
            <thead>
              <tr>
                <th>Day</th>
                <th>Scheduled</th>
                <th>Present</th>
                <th>Absent</th>
                <th>Pending</th>
                <th>Transportation</th>
                <th>Utilization</th>
              </tr>
            </thead>
            <tbody>
              {weeklyCensusDays.map((day) => (
                <tr key={`weekly-census-${day.date}`}>
                  <td>{WEEKDAY_LABELS[day.weekday]} ({formatDate(day.date)})</td>
                  <td>{day.scheduledMembers}</td>
                  <td>{day.presentMembers}</td>
                  <td>{day.absentMembers}</td>
                  <td>{day.pendingMembers}</td>
                  <td>{day.transportMembers}</td>
                  <td>{formatUtilizationPercent(day.scheduledMembers)}</td>
                </tr>
              ))}
              <tr>
                <td className="font-semibold">Weekly Totals</td>
                <td className="font-semibold">{weeklyCensus.scheduledMemberDays}</td>
                <td className="font-semibold">{weeklyCensus.presentMemberDays}</td>
                <td className="font-semibold">{weeklyCensus.absentMemberDays}</td>
                <td className="font-semibold">{weeklyCensus.pendingMemberDays}</td>
                <td className="font-semibold">{weeklyCensus.transportMemberDays}</td>
                <td className="font-semibold">
                  {weeklyCensusDays.length > 0
                    ? formatUtilizationPercent(
                        Math.round(weeklyCensus.scheduledMemberDays / weeklyCensusDays.length)
                      )
                    : "N/A"}
                </td>
              </tr>
            </tbody>
          </table>

          <div className="mt-3 grid gap-2 text-sm md:grid-cols-3">
            <p>
              Utilization Rate (Scheduled / {LICENSED_MEMBER_CAP}):{" "}
              <strong>
                {weeklyCensusDays.length > 0
                  ? formatUtilizationPercent(
                      Math.round(weeklyCensus.scheduledMemberDays / weeklyCensusDays.length)
                    )
                  : "N/A"}
              </strong>
            </p>
            <p>Billing Basis (Scheduled Member-Days): <strong>{weeklyCensus.scheduledMemberDays}</strong></p>
            <p>Billing Basis (Present Member-Days): <strong>{weeklyCensus.presentMemberDays}</strong></p>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
