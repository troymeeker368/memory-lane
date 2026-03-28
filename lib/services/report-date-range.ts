import { toEasternDate } from "@/lib/timezone";

export interface ReportDateRange {
  from: string;
  to: string;
}

export interface ReportDateRangeWindow extends ReportDateRange {
  fromDate: Date;
  toDate: Date;
  fromDateTime: Date;
  toDateTime: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function isoDay(date: Date) {
  return toEasternDate(date);
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function endOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

export function parseDateInput(raw?: string) {
  if (!raw) return null;
  const parsed = new Date(`${raw}T00:00:00.000`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function resolveDateRangeWindow(
  rawFrom?: string,
  rawTo?: string,
  fallbackDays = 30,
  inclusiveFallback = false
): ReportDateRangeWindow {
  const today = startOfLocalDay(new Date());
  const parsedTo = parseDateInput(rawTo);
  const toDate = parsedTo ?? today;
  const fallbackOffset = inclusiveFallback ? Math.max(fallbackDays - 1, 0) : fallbackDays;
  const parsedFrom = parseDateInput(rawFrom);
  const fromDate = parsedFrom ?? new Date(toDate.getTime() - fallbackOffset * DAY_MS);
  const safeFrom = fromDate <= toDate ? fromDate : toDate;
  const safeTo = fromDate <= toDate ? toDate : fromDate;

  return {
    from: isoDay(safeFrom),
    to: isoDay(safeTo),
    fromDate: safeFrom,
    toDate: safeTo,
    fromDateTime: startOfLocalDay(safeFrom),
    toDateTime: endOfLocalDay(safeTo)
  };
}

export function resolveDateRange(rawFrom?: string, rawTo?: string, fallbackDays = 30): ReportDateRange {
  const resolved = resolveDateRangeWindow(rawFrom, rawTo, fallbackDays);
  return { from: resolved.from, to: resolved.to };
}
