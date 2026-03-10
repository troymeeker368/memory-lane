import { toEasternDate } from "@/lib/timezone";

export type OperationsWeekdayKey =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export const OPERATIONS_WEEKDAY_KEYS: OperationsWeekdayKey[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday"
];

export interface OperationsWeekRange {
  startDate: string;
  endDate: string;
  dates: string[];
}

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseDateOnlyToUtc(value: string) {
  const [yearRaw, monthRaw, dayRaw] = value.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

function formatUtcDateOnly(date: Date): string {
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(dateOnly: string, days: number): string {
  const parsed = parseDateOnlyToUtc(dateOnly);
  if (!parsed) return dateOnly;
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return formatUtcDateOnly(parsed);
}

export function normalizeOperationalDateOnly(value?: string | null): string {
  const raw = String(value ?? "").trim();
  if (DATE_ONLY_PATTERN.test(raw)) return raw;
  return toEasternDate(raw || new Date());
}

export function getOperationsTodayDate(): string {
  return toEasternDate();
}

export function getFirstDayOfNextMonth(dateInput?: string | null): string {
  const baseDateOnly = normalizeOperationalDateOnly(dateInput ?? getOperationsTodayDate());
  const parsed = parseDateOnlyToUtc(baseDateOnly);
  if (!parsed) return baseDateOnly;
  parsed.setUTCMonth(parsed.getUTCMonth() + 1, 1);
  return formatUtcDateOnly(parsed);
}

export function getWeekdayForDate(dateOnlyInput: string): OperationsWeekdayKey {
  const dateOnly = normalizeOperationalDateOnly(dateOnlyInput);
  const parsed = parseDateOnlyToUtc(dateOnly);
  if (!parsed) return "monday";

  const day = parsed.getUTCDay();
  if (day === 1) return "monday";
  if (day === 2) return "tuesday";
  if (day === 3) return "wednesday";
  if (day === 4) return "thursday";
  if (day === 5) return "friday";
  if (day === 6) return "saturday";
  return "sunday";
}

export function coerceToOperationalWeekday(dateOnlyInput: string): string {
  const dateOnly = normalizeOperationalDateOnly(dateOnlyInput);
  const parsed = parseDateOnlyToUtc(dateOnly);
  if (!parsed) return dateOnly;
  const day = parsed.getUTCDay();
  if (day === 6) {
    parsed.setUTCDate(parsed.getUTCDate() + 2);
    return formatUtcDateOnly(parsed);
  }
  if (day === 0) {
    parsed.setUTCDate(parsed.getUTCDate() + 1);
    return formatUtcDateOnly(parsed);
  }
  return dateOnly;
}

function getMondayForDate(dateOnlyInput: string): string {
  const dateOnly = normalizeOperationalDateOnly(dateOnlyInput);
  const parsed = parseDateOnlyToUtc(dateOnly);
  if (!parsed) return dateOnly;

  const day = parsed.getUTCDay();
  const offsetToMonday = day === 0 ? -6 : 1 - day;
  parsed.setUTCDate(parsed.getUTCDate() + offsetToMonday);
  return formatUtcDateOnly(parsed);
}

export function getWeekRangeFromDate(dateOnlyInput: string): OperationsWeekRange {
  const startDate = getMondayForDate(dateOnlyInput);
  const dates = Array.from({ length: 7 }, (_, index) => addDays(startDate, index));
  return {
    startDate,
    endDate: dates[6] ?? startDate,
    dates
  };
}

export function getCurrentWeekRange(): OperationsWeekRange {
  return getWeekRangeFromDate(getOperationsTodayDate());
}

export function getWeekdayDatesForRange(range: OperationsWeekRange): string[] {
  return range.dates.filter((date) => OPERATIONS_WEEKDAY_KEYS.includes(getWeekdayForDate(date)));
}
