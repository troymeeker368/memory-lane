import { easternDateTimeLocalToISO, toEasternDate } from "@/lib/timezone";

import {
  PAYROLL_ANCHOR_DATE,
  PAYROLL_PERIOD_DAYS,
  PAYROLL_WEEK_DAYS,
  type PayrollPeriod
} from "@/lib/payroll/payroll-types";

function parseDateOnlyToUtcMs(dateOnly: string) {
  return Date.parse(`${dateOnly}T00:00:00.000Z`);
}

export function addDays(dateOnly: string, days: number) {
  const date = new Date(`${dateOnly}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isDateOnly(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeReferenceDate(reference?: string | number | Date) {
  if (!reference) return toEasternDate();
  if (typeof reference === "string" && isDateOnly(reference)) {
    return reference;
  }
  return toEasternDate(reference);
}

function buildPayrollPeriod(startDate: string, index: number): PayrollPeriod {
  const endDate = addDays(startDate, PAYROLL_PERIOD_DAYS - 1);
  const nextStartDate = addDays(startDate, PAYROLL_PERIOD_DAYS);
  return {
    index,
    anchorDate: PAYROLL_ANCHOR_DATE,
    startDate,
    endDate,
    nextStartDate,
    label: `${startDate} to ${endDate}`
  };
}

export function getPayrollPeriodIndex(startDate: string) {
  return Math.floor(
    (parseDateOnlyToUtcMs(startDate) - parseDateOnlyToUtcMs(PAYROLL_ANCHOR_DATE)) /
      (PAYROLL_PERIOD_DAYS * 86400000)
  );
}

export function isAnchoredPayrollStart(startDate: string) {
  if (!isDateOnly(startDate)) return false;
  const diffDays =
    (parseDateOnlyToUtcMs(startDate) - parseDateOnlyToUtcMs(PAYROLL_ANCHOR_DATE)) / 86400000;
  return Number.isInteger(diffDays) && diffDays % PAYROLL_PERIOD_DAYS === 0;
}

export function assertAnchoredPayrollStart(startDate: string) {
  if (!isAnchoredPayrollStart(startDate)) {
    throw new Error(
      `overridePayPeriodStart must align to the payroll anchor ${PAYROLL_ANCHOR_DATE} in 14-day increments.`
    );
  }
}

export function resolvePayrollPeriod(input?: {
  referenceDate?: string | number | Date;
  overridePayPeriodStart?: string | null;
}) {
  const override = input?.overridePayPeriodStart?.trim();
  if (override) {
    assertAnchoredPayrollStart(override);
    return buildPayrollPeriod(override, getPayrollPeriodIndex(override));
  }

  const referenceDate = normalizeReferenceDate(input?.referenceDate);
  const diffDays = Math.floor(
    (parseDateOnlyToUtcMs(referenceDate) - parseDateOnlyToUtcMs(PAYROLL_ANCHOR_DATE)) / 86400000
  );
  const index = Math.floor(diffDays / PAYROLL_PERIOD_DAYS);
  const startDate = addDays(PAYROLL_ANCHOR_DATE, index * PAYROLL_PERIOD_DAYS);
  return buildPayrollPeriod(startDate, index);
}

export function listPayrollPeriods(input?: {
  referenceDate?: string | number | Date;
  previousCount?: number;
  nextCount?: number;
}) {
  const current = resolvePayrollPeriod({ referenceDate: input?.referenceDate });
  const previousCount = input?.previousCount ?? 6;
  const nextCount = input?.nextCount ?? 2;
  const periods: PayrollPeriod[] = [];

  for (let offset = -previousCount; offset <= nextCount; offset += 1) {
    const startDate = addDays(current.startDate, offset * PAYROLL_PERIOD_DAYS);
    periods.push(buildPayrollPeriod(startDate, current.index + offset));
  }

  return periods.sort((left, right) => (left.startDate < right.startDate ? 1 : -1));
}

export function getPayrollWeekDateRange(payPeriod: PayrollPeriod, weekIndex: 1 | 2) {
  const startDate =
    weekIndex === 1 ? payPeriod.startDate : addDays(payPeriod.startDate, PAYROLL_WEEK_DAYS);
  return {
    startDate,
    endDate: addDays(startDate, PAYROLL_WEEK_DAYS - 1)
  };
}

export function isDateInPayrollPeriod(workDate: string, payPeriod: PayrollPeriod) {
  return workDate >= payPeriod.startDate && workDate <= payPeriod.endDate;
}

export function getPayrollPeriodIsoBounds(payPeriod: PayrollPeriod) {
  return {
    startAtIso: easternDateTimeLocalToISO(`${payPeriod.startDate}T00:00`),
    endExclusiveIso: easternDateTimeLocalToISO(`${payPeriod.nextStartDate}T00:00`)
  };
}
