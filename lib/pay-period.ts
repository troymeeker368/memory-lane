import { easternDateTimeLocalToISO, toEasternDate } from "@/lib/timezone";

export const PAY_PERIOD_ANCHOR_DATE = "2026-02-23";

export interface PayPeriodWindow {
  index: number;
  startDate: string;
  endDate: string;
  nextStartDate: string;
  label: string;
  startAtIso: string;
  endExclusiveIso: string;
}

function parseDateOnlyToUtcMs(dateOnly: string): number {
  return Date.parse(`${dateOnly}T00:00:00.000Z`);
}

function addDays(dateOnly: string, days: number): string {
  const d = new Date(`${dateOnly}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toDateOnly(input?: string | number | Date): string {
  if (!input) return toEasternDate();
  if (typeof input === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return input;
  }
  return toEasternDate(input);
}

export function getCurrentPayPeriod(reference?: string | number | Date): PayPeriodWindow {
  const currentDate = toDateOnly(reference);
  const diffDays = Math.floor((parseDateOnlyToUtcMs(currentDate) - parseDateOnlyToUtcMs(PAY_PERIOD_ANCHOR_DATE)) / 86400000);
  const index = Math.floor(diffDays / 14);
  const startDate = addDays(PAY_PERIOD_ANCHOR_DATE, index * 14);
  const endDate = addDays(startDate, 13);
  const nextStartDate = addDays(startDate, 14);

  return {
    index,
    startDate,
    endDate,
    nextStartDate,
    label: `${startDate} to ${endDate}`,
    startAtIso: easternDateTimeLocalToISO(`${startDate}T00:00`),
    endExclusiveIso: easternDateTimeLocalToISO(`${nextStartDate}T00:00`)
  };
}

export function isDateInPayPeriod(input: string | number | Date, period: Pick<PayPeriodWindow, "startDate" | "endDate">): boolean {
  const day = toDateOnly(input);
  return day >= period.startDate && day <= period.endDate;
}
