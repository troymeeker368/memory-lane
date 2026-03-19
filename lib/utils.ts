import { EASTERN_TIME_ZONE } from "@/lib/timezone";

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function isValidDate(date: Date): boolean {
  return Number.isFinite(date.getTime());
}

function formatDateOnlyString(value: string): string | null {
  const trimmed = value.trim();
  const match = DATE_ONLY_PATTERN.exec(trimmed);
  if (!match) return null;

  const [, year, month, day] = match;
  return `${month}/${day}/${year}`;
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function formatDate(value: string | number | Date): string {
  if (typeof value === "string") {
    const formattedDateOnly = formatDateOnlyString(value);
    if (formattedDateOnly) return formattedDateOnly;
  }

  const date = typeof value === "number" ? excelSerialToDate(value) : new Date(value);
  if (!isValidDate(date)) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    timeZone: EASTERN_TIME_ZONE
  }).format(date);
}

export function formatDateTime(value: string | number | Date): string {
  const date = typeof value === "number" ? excelSerialToDate(value) : new Date(value);
  if (!isValidDate(date)) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: EASTERN_TIME_ZONE
  }).format(date);
}

export function formatOptionalDate(value: string | number | Date | null | undefined, fallback = "-"): string {
  if (!value) return fallback;
  return formatDate(value);
}

export function formatOptionalDateTime(value: string | number | Date | null | undefined, fallback = "-"): string {
  if (!value) return fallback;
  return formatDateTime(value);
}

export function excelSerialToDate(serial: number): Date {
  const excelEpoch = new Date(Date.UTC(1899, 11, 30));
  return new Date(excelEpoch.getTime() + serial * 24 * 60 * 60 * 1000);
}
