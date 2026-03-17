import { randomUUID } from "node:crypto";

import { toEasternDate } from "@/lib/timezone";
import type {
  AttendanceSettingWeekdays,
  DateRange,
  ScheduleTemplateRow
} from "@/lib/services/billing-types";

export function normalizeDateOnly(value: string | null | undefined, fallback = toEasternDate()) {
  const dateOnly = String(value ?? "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(dateOnly) ? dateOnly : fallback;
}

export function startOfMonth(value: string | null | undefined) {
  const dateOnly = normalizeDateOnly(value);
  return `${dateOnly.slice(0, 7)}-01`;
}

export function addDays(dateOnly: string, days: number) {
  const parsed = new Date(`${normalizeDateOnly(dateOnly)}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function addMonths(dateOnly: string, months: number) {
  const parsed = new Date(`${normalizeDateOnly(dateOnly)}T00:00:00.000Z`);
  parsed.setUTCMonth(parsed.getUTCMonth() + months, 1);
  return parsed.toISOString().slice(0, 10);
}

export function endOfMonth(value: string | null | undefined) {
  const parsed = new Date(`${startOfMonth(value)}T00:00:00.000Z`);
  parsed.setUTCMonth(parsed.getUTCMonth() + 1, 0);
  return parsed.toISOString().slice(0, 10);
}

export function previousMonth(monthStart: string) {
  return addMonths(startOfMonth(monthStart), -1);
}

export function toMonthRange(monthStartValue: string): DateRange {
  const start = startOfMonth(monthStartValue);
  return { start, end: endOfMonth(start) };
}

export function toDateRange(start: string, end: string): DateRange {
  const normalizedStart = normalizeDateOnly(start);
  const normalizedEnd = normalizeDateOnly(end, normalizedStart);
  return normalizedStart <= normalizedEnd
    ? { start: normalizedStart, end: normalizedEnd }
    : { start: normalizedEnd, end: normalizedStart };
}

export function isWithin(dateOnly: string | null | undefined, range: DateRange) {
  const normalized = normalizeDateOnly(dateOnly, "");
  if (!normalized) return false;
  return normalized >= range.start && normalized <= range.end;
}

export function toAmount(value: number | null | undefined) {
  if (!Number.isFinite(value)) return 0;
  return Number(Number(value).toFixed(2));
}

export function asNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function randomTextId(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

export function buildInvoiceNumber(invoiceMonth: string, sequence: number) {
  const yyyymm = startOfMonth(invoiceMonth).slice(0, 7).replace("-", "");
  return `INV-${yyyymm}-${String(sequence + 1).padStart(4, "0")}`;
}

export function buildCustomInvoiceNumber(periodStart: string, sequence: number) {
  const yyyymm = startOfMonth(periodStart).slice(0, 7).replace("-", "");
  return `CINV-${yyyymm}-${String(sequence + 1).padStart(4, "0")}`;
}

export function escapeCsv(value: string | number | null | undefined) {
  const stringValue = String(value ?? "");
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

export function weekdayKey(dateOnly: string) {
  const day = new Date(`${dateOnly}T00:00:00.000Z`).getUTCDay();
  if (day === 0) return "sunday" as const;
  if (day === 1) return "monday" as const;
  if (day === 2) return "tuesday" as const;
  if (day === 3) return "wednesday" as const;
  if (day === 4) return "thursday" as const;
  if (day === 5) return "friday" as const;
  return "saturday" as const;
}

export function scheduleIncludesDate(schedule: ScheduleTemplateRow | null | undefined, dateOnly: string) {
  if (!schedule) return false;
  const day = weekdayKey(dateOnly);
  if (day === "monday") return schedule.monday;
  if (day === "tuesday") return schedule.tuesday;
  if (day === "wednesday") return schedule.wednesday;
  if (day === "thursday") return schedule.thursday;
  if (day === "friday") return schedule.friday;
  if (day === "saturday") return schedule.saturday;
  return schedule.sunday;
}

export function attendanceSettingIncludesDate(attendanceSetting: AttendanceSettingWeekdays | null | undefined, dateOnly: string) {
  if (!attendanceSetting) return false;
  const day = weekdayKey(dateOnly);
  if (day === "monday") return Boolean(attendanceSetting.monday);
  if (day === "tuesday") return Boolean(attendanceSetting.tuesday);
  if (day === "wednesday") return Boolean(attendanceSetting.wednesday);
  if (day === "thursday") return Boolean(attendanceSetting.thursday);
  if (day === "friday") return Boolean(attendanceSetting.friday);
  return false;
}
