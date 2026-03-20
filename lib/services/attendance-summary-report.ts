import "server-only";

import { createClient } from "@/lib/supabase/server";
import {
  buildAttendanceFacts,
  countOpenCenterDays,
  listDatesInRange,
  type ReportingAttendanceRow,
  type ReportingClosureRow,
  type ReportingLocationRow,
  type ReportingMemberRow
} from "@/lib/services/admin-reporting-core";
import { loadExpectedAttendanceSupabaseContext } from "@/lib/services/expected-attendance-supabase";
import { toEasternDate } from "@/lib/timezone";

export const ATTENDANCE_REPORT_MONTH_OPTIONS = [
  { value: 1, label: "January", shortLabel: "Jan" },
  { value: 2, label: "February", shortLabel: "Feb" },
  { value: 3, label: "March", shortLabel: "Mar" },
  { value: 4, label: "April", shortLabel: "Apr" },
  { value: 5, label: "May", shortLabel: "May" },
  { value: 6, label: "June", shortLabel: "Jun" },
  { value: 7, label: "July", shortLabel: "Jul" },
  { value: 8, label: "August", shortLabel: "Aug" },
  { value: 9, label: "September", shortLabel: "Sep" },
  { value: 10, label: "October", shortLabel: "Oct" },
  { value: 11, label: "November", shortLabel: "Nov" },
  { value: 12, label: "December", shortLabel: "Dec" }
] as const;

export type AttendanceSummaryReportInput = {
  location: string | null;
  month: number;
  year: number;
};

type AttendanceMatrixRow = {
  location: string;
  dayCounts: number[];
};

type AttendanceMonthlySummaryRow = {
  location: string;
  monthValues: number[];
  yearTotal: number;
};

type AttendanceCensusSummaryRow = {
  location: string;
  monthValues: number[];
  yearTotal: number;
};

export interface AttendanceSummaryReportResult {
  filters: AttendanceSummaryReportInput & {
    monthLabel: string;
    monthShortLabel: string;
    monthTitle: string;
    selectedRange: { from: string; to: string };
    yearToSelectedMonthRange: { from: string; to: string };
  };
  availableLocations: string[];
  yearOptions: number[];
  matrix: {
    title: string;
    dayHeaders: number[];
    rows: AttendanceMatrixRow[];
    totalsRow: AttendanceMatrixRow;
  };
  totalMemberDays: {
    monthHeaders: string[];
    rows: AttendanceMonthlySummaryRow[];
    totalsRow: AttendanceMonthlySummaryRow;
  };
  averageDailyCensus: {
    monthHeaders: string[];
    rows: AttendanceCensusSummaryRow[];
    totalsRow: AttendanceCensusSummaryRow;
  };
}

function padMonth(value: number) {
  return String(value).padStart(2, "0");
}

function getMonthDateRange(year: number, month: number) {
  const start = `${year}-${padMonth(month)}-01`;
  const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return { from: start, to: end };
}

function escapeCsv(value: string | number | null | undefined) {
  const normalized = String(value ?? "");
  if (/[",\n]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
}

function buildCsv(lines: Array<Array<string | number | null | undefined>>) {
  return lines.map((line) => line.map((cell) => escapeCsv(cell)).join(",")).join("\n");
}

function createYearOptions(selectedYear: number) {
  const currentYear = Number(toEasternDate().slice(0, 4));
  const startYear = Math.min(currentYear - 5, selectedYear);
  const endYear = Math.max(currentYear + 1, selectedYear);
  const years: number[] = [];
  for (let year = endYear; year >= startYear; year -= 1) {
    years.push(year);
  }
  return years;
}

function normalizeMonth(rawValue: string | null | undefined) {
  const value = Number.parseInt(String(rawValue ?? "").trim(), 10);
  if (value >= 1 && value <= 12) return value;
  return Number(toEasternDate().slice(5, 7));
}

function normalizeYear(rawValue: string | null | undefined) {
  const fallback = Number(toEasternDate().slice(0, 4));
  const value = Number.parseInt(String(rawValue ?? "").trim(), 10);
  if (Number.isFinite(value) && value >= 2000 && value <= 2100) return value;
  return fallback;
}

export function resolveAttendanceSummaryReportInput(raw: Partial<Record<string, string | null | undefined>>) {
  return {
    location: raw.location ? String(raw.location).trim() || null : null,
    month: normalizeMonth(raw.month),
    year: normalizeYear(raw.year)
  } satisfies AttendanceSummaryReportInput;
}

async function loadAttendanceSummaryDataset(year: number) {
  const yearRange = { from: `${year}-01-01`, to: `${year}-12-31` };
  const supabase = await createClient();
  const { data: membersData, error: membersError } = await supabase
    .from("members")
    .select("id, display_name, status")
    .order("display_name", { ascending: true });

  if (membersError) throw new Error(`Unable to load members for attendance summary: ${membersError.message}`);

  const members = (membersData ?? []) as ReportingMemberRow[];
  const memberIds = members.map((member) => member.id);
  if (memberIds.length === 0) {
    return {
      members,
      memberLocationById: new Map<string, string>(),
      attendanceRecordByMemberDate: new Map<string, "present" | "absent">(),
      closureByDate: new Map<string, ReportingClosureRow>(),
      expectedContext: await loadExpectedAttendanceSupabaseContext({
        memberIds: [],
        startDate: yearRange.from,
        endDate: yearRange.to,
        includeAttendanceRecords: false
      })
    };
  }

  const [locationsResult, attendanceResult, closureResult, expectedContext] = await Promise.all([
    supabase.from("member_command_centers").select("member_id, location").in("member_id", memberIds),
    supabase
      .from("attendance_records")
      .select("member_id, attendance_date, status")
      .in("member_id", memberIds)
      .gte("attendance_date", yearRange.from)
      .lte("attendance_date", yearRange.to),
    supabase
      .from("center_closures")
      .select("closure_date, active, billable_override")
      .gte("closure_date", yearRange.from)
      .lte("closure_date", yearRange.to),
    loadExpectedAttendanceSupabaseContext({
      memberIds,
      startDate: yearRange.from,
      endDate: yearRange.to,
      includeAttendanceRecords: false
    })
  ]);

  if (locationsResult.error) throw new Error(`Unable to load member locations for attendance summary: ${locationsResult.error.message}`);
  if (attendanceResult.error) throw new Error(`Unable to load attendance records for attendance summary: ${attendanceResult.error.message}`);
  if (closureResult.error) throw new Error(`Unable to load center closures for attendance summary: ${closureResult.error.message}`);

  const memberLocationById = new Map<string, string>();
  ((locationsResult.data ?? []) as ReportingLocationRow[]).forEach((row) => {
    memberLocationById.set(row.member_id, String(row.location ?? "").trim() || "Unassigned");
  });
  members.forEach((member) => {
    if (!memberLocationById.has(member.id)) {
      memberLocationById.set(member.id, "Unassigned");
    }
  });

  const attendanceRecordByMemberDate = new Map<string, "present" | "absent">();
  ((attendanceResult.data ?? []) as ReportingAttendanceRow[]).forEach((row) => {
    attendanceRecordByMemberDate.set(`${row.member_id}:${row.attendance_date}`, row.status);
  });

  const closureByDate = new Map<string, ReportingClosureRow>();
  ((closureResult.data ?? []) as ReportingClosureRow[]).forEach((row) => {
    closureByDate.set(row.closure_date, row);
  });

  return {
    members,
    memberLocationById,
    attendanceRecordByMemberDate,
    closureByDate,
    expectedContext
  };
}

function average(value: number, divisor: number) {
  if (divisor <= 0) return 0;
  return Number((value / divisor).toFixed(2));
}

export async function getAttendanceSummaryReportData(
  input: AttendanceSummaryReportInput
): Promise<AttendanceSummaryReportResult> {
  const monthOption =
    ATTENDANCE_REPORT_MONTH_OPTIONS.find((option) => option.value === input.month) ?? ATTENDANCE_REPORT_MONTH_OPTIONS[0];
  const selectedRange = getMonthDateRange(input.year, monthOption.value);
  const yearToSelectedMonthRange = { from: `${input.year}-01-01`, to: selectedRange.to };
  const dataset = await loadAttendanceSummaryDataset(input.year);
  const facts = buildAttendanceFacts({
    range: { from: `${input.year}-01-01`, to: `${input.year}-12-31` },
    members: dataset.members,
    memberLocationById: dataset.memberLocationById,
    attendanceRecordByMemberDate: dataset.attendanceRecordByMemberDate,
    expectedContext: dataset.expectedContext
  });

  const availableLocations = Array.from(
    new Set(Array.from(dataset.memberLocationById.values()).map((value) => value || "Unassigned"))
  ).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
  const visibleLocations = input.location
    ? [input.location]
    : availableLocations;

  const presentByLocationDate = new Map<string, number>();
  const presentByLocationMonth = new Map<string, number[]>();
  facts.forEach((fact) => {
    if (!fact.present) return;
    presentByLocationDate.set(
      `${fact.location}:${fact.date}`,
      (presentByLocationDate.get(`${fact.location}:${fact.date}`) ?? 0) + 1
    );
    const monthIndex = Number.parseInt(fact.date.slice(5, 7), 10) - 1;
    const values = presentByLocationMonth.get(fact.location) ?? Array.from({ length: 12 }, () => 0);
    values[monthIndex] = (values[monthIndex] ?? 0) + 1;
    presentByLocationMonth.set(fact.location, values);
  });

  const monthOpenDayCounts = ATTENDANCE_REPORT_MONTH_OPTIONS.map((option) =>
    countOpenCenterDays({
      range: getMonthDateRange(input.year, option.value),
      closureByDate: dataset.closureByDate,
      countBillableOverrideAsOpen: true
    })
  );
  const yearToSelectedOpenDayCount = countOpenCenterDays({
    range: yearToSelectedMonthRange,
    closureByDate: dataset.closureByDate,
    countBillableOverrideAsOpen: true
  });

  const monthDays = listDatesInRange(selectedRange);
  const matrixRows = visibleLocations.map((location) => ({
    location,
    dayCounts: monthDays.map((date) => presentByLocationDate.get(`${location}:${date}`) ?? 0)
  }));
  const matrixTotalsRow = {
    location: "Totals",
    dayCounts: monthDays.map((_, dayIndex) =>
      matrixRows.reduce((sum, row) => sum + (row.dayCounts[dayIndex] ?? 0), 0)
    )
  } satisfies AttendanceMatrixRow;

  const totalMemberDaysRows = visibleLocations.map((location) => {
    const monthValues = [...(presentByLocationMonth.get(location) ?? Array.from({ length: 12 }, () => 0))];
    return {
      location,
      monthValues,
      yearTotal: monthValues.reduce((sum, value) => sum + value, 0)
    } satisfies AttendanceMonthlySummaryRow;
  });
  const totalMemberDaysTotalsRow = {
    location: "All Centers",
    monthValues: ATTENDANCE_REPORT_MONTH_OPTIONS.map((_, monthIndex) =>
      totalMemberDaysRows.reduce((sum, row) => sum + (row.monthValues[monthIndex] ?? 0), 0)
    ),
    yearTotal: totalMemberDaysRows.reduce((sum, row) => sum + row.yearTotal, 0)
  } satisfies AttendanceMonthlySummaryRow;

  const averageDailyCensusRows = visibleLocations.map((location) => {
    const memberDays = presentByLocationMonth.get(location) ?? Array.from({ length: 12 }, () => 0);
    const monthValues = memberDays.map((value, monthIndex) => average(value, monthOpenDayCounts[monthIndex] ?? 0));
    const yearTotal = average(
      memberDays.slice(0, monthOption.value).reduce((sum, value) => sum + value, 0),
      yearToSelectedOpenDayCount
    );
    return {
      location,
      monthValues,
      yearTotal
    } satisfies AttendanceCensusSummaryRow;
  });
  const averageDailyCensusTotalsRow = {
    location: "All Centers",
    monthValues: totalMemberDaysTotalsRow.monthValues.map((value, monthIndex) =>
      average(value, monthOpenDayCounts[monthIndex] ?? 0)
    ),
    yearTotal: average(
      totalMemberDaysTotalsRow.monthValues.slice(0, monthOption.value).reduce((sum, value) => sum + value, 0),
      yearToSelectedOpenDayCount
    )
  } satisfies AttendanceCensusSummaryRow;

  return {
    filters: {
      ...input,
      monthLabel: monthOption.label,
      monthShortLabel: monthOption.shortLabel,
      monthTitle: `${monthOption.label} ${input.year}`,
      selectedRange,
      yearToSelectedMonthRange
    },
    availableLocations,
    yearOptions: createYearOptions(input.year),
    matrix: {
      title: `${monthOption.label} ${input.year}`,
      dayHeaders: monthDays.map((date) => Number.parseInt(date.slice(8, 10), 10)),
      rows: matrixRows,
      totalsRow: matrixTotalsRow
    },
    totalMemberDays: {
      monthHeaders: ATTENDANCE_REPORT_MONTH_OPTIONS.map((option) => option.shortLabel),
      rows: totalMemberDaysRows,
      totalsRow: totalMemberDaysTotalsRow
    },
    averageDailyCensus: {
      monthHeaders: ATTENDANCE_REPORT_MONTH_OPTIONS.map((option) => option.shortLabel),
      rows: averageDailyCensusRows,
      totalsRow: averageDailyCensusTotalsRow
    }
  };
}

export function buildAttendanceDailyMatrixCsv(report: AttendanceSummaryReportResult) {
  return buildCsv([
    [report.matrix.title],
    ["Location", ...report.matrix.dayHeaders],
    ...report.matrix.rows.map((row) => [row.location, ...row.dayCounts]),
    [report.matrix.totalsRow.location, ...report.matrix.totalsRow.dayCounts]
  ]);
}

export function buildAttendanceMemberDaysCsv(report: AttendanceSummaryReportResult) {
  return buildCsv([
    ["Location", ...report.totalMemberDays.monthHeaders, "Year Total"],
    ...report.totalMemberDays.rows.map((row) => [row.location, ...row.monthValues, row.yearTotal]),
    [
      report.totalMemberDays.totalsRow.location,
      ...report.totalMemberDays.totalsRow.monthValues,
      report.totalMemberDays.totalsRow.yearTotal
    ]
  ]);
}

export function buildAttendanceAverageDailyCensusCsv(report: AttendanceSummaryReportResult) {
  return buildCsv([
    ["Location", ...report.averageDailyCensus.monthHeaders, "Year Total"],
    ...report.averageDailyCensus.rows.map((row) => [row.location, ...row.monthValues, row.yearTotal]),
    [
      report.averageDailyCensus.totalsRow.location,
      ...report.averageDailyCensus.totalsRow.monthValues,
      report.averageDailyCensus.totalsRow.yearTotal
    ]
  ]);
}
