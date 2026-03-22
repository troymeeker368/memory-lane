import { toEasternDate } from "@/lib/timezone";

import {
  PAYROLL_LUNCH_DEDUCTION_HOURS,
  PAYROLL_LUNCH_DEDUCTION_THRESHOLD_HOURS,
  PAYROLL_WEEKLY_OVERTIME_THRESHOLD_HOURS,
  type PayrollDailyHours,
  type PayrollWeekTotals
} from "@/lib/payroll/payroll-types";

export function roundPayrollHours(value: number) {
  return Number(value.toFixed(2));
}

function toMs(value: string | null) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function calculatePayrollDailyHours(input: {
  timeInIso: string | null;
  timeOutIso: string | null;
}): PayrollDailyHours {
  const timeInMs = toMs(input.timeInIso);
  const timeOutMs = toMs(input.timeOutIso);
  const hasIncompletePunch = !input.timeInIso || !input.timeOutIso;
  const hasInvalidRange =
    !hasIncompletePunch &&
    timeInMs != null &&
    timeOutMs != null &&
    timeOutMs < timeInMs;

  let rawHours = 0;
  if (!hasIncompletePunch && !hasInvalidRange && timeInMs != null && timeOutMs != null) {
    rawHours = Math.max(0, (timeOutMs - timeInMs) / 3600000);
  }

  const lunchDeductionHours =
    rawHours > PAYROLL_LUNCH_DEDUCTION_THRESHOLD_HOURS ? PAYROLL_LUNCH_DEDUCTION_HOURS : 0;
  const workedHours = Math.max(rawHours - lunchDeductionHours, 0);

  return {
    timeInIso: input.timeInIso,
    timeOutIso: input.timeOutIso,
    rawHours: roundPayrollHours(Math.max(rawHours, 0)),
    lunchDeductionHours: roundPayrollHours(lunchDeductionHours),
    workedHours: roundPayrollHours(workedHours),
    hasIncompletePunch,
    hasInvalidRange
  };
}

export function getWeekIndexForPayrollDate(payPeriodStartDate: string, workDate: string): 1 | 2 {
  const diffDays =
    (Date.parse(`${workDate}T00:00:00.000Z`) - Date.parse(`${payPeriodStartDate}T00:00:00.000Z`)) /
    86400000;
  return diffDays >= 7 ? 2 : 1;
}

export function allocateWeeklyPayrollOvertime<T extends { workDate: string; workedHours: number }>(
  payPeriodStartDate: string,
  rows: T[]
) {
  const orderedRows = [...rows].sort((left, right) =>
    left.workDate === right.workDate ? 0 : left.workDate > right.workDate ? 1 : -1
  );
  const runningWorkedByWeek = new Map<1 | 2, number>([
    [1, 0],
    [2, 0]
  ]);

  return orderedRows.map((row) => {
    const weekIndex = getWeekIndexForPayrollDate(payPeriodStartDate, row.workDate);
    const runningWorked = runningWorkedByWeek.get(weekIndex) ?? 0;
    const regularRemaining = Math.max(0, PAYROLL_WEEKLY_OVERTIME_THRESHOLD_HOURS - runningWorked);
    const regularHours = roundPayrollHours(Math.min(row.workedHours, regularRemaining));
    const overtimeHours = roundPayrollHours(Math.max(row.workedHours - regularHours, 0));
    runningWorkedByWeek.set(weekIndex, roundPayrollHours(runningWorked + row.workedHours));
    return {
      workDate: row.workDate,
      weekIndex,
      regularHours,
      overtimeHours
    };
  });
}

export function sumPayrollWeekTotals<T extends { regularHours: number; overtimeHours: number; ptoHours: number; workedHours: number }>(
  rows: T[]
): PayrollWeekTotals {
  return rows.reduce<PayrollWeekTotals>(
    (totals, row) => ({
      regularHours: roundPayrollHours(totals.regularHours + row.regularHours),
      overtimeHours: roundPayrollHours(totals.overtimeHours + row.overtimeHours),
      ptoHours: roundPayrollHours(totals.ptoHours + row.ptoHours),
      workedHours: roundPayrollHours(totals.workedHours + row.workedHours)
    }),
    {
      regularHours: 0,
      overtimeHours: 0,
      ptoHours: 0,
      workedHours: 0
    }
  );
}

export function getPayrollDayLabel(workDate: string) {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short"
  }).format(new Date(`${workDate}T12:00:00Z`));
  return weekday;
}

export function groupPayrollPunchesByDate<T extends { timestamp: string }>(rows: T[]) {
  const grouped = new Map<string, T[]>();
  rows.forEach((row) => {
    const workDate = toEasternDate(row.timestamp);
    const existing = grouped.get(workDate) ?? [];
    existing.push(row);
    grouped.set(workDate, existing);
  });
  return grouped;
}
