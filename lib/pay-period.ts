import { getPayrollPeriodIsoBounds, resolvePayrollPeriod } from "@/lib/payroll/payroll-period";
import { PAYROLL_ANCHOR_DATE } from "@/lib/payroll/payroll-types";
import { toEasternDate } from "@/lib/timezone";

export const PAY_PERIOD_ANCHOR_DATE = PAYROLL_ANCHOR_DATE;

export interface PayPeriodWindow {
  index: number;
  startDate: string;
  endDate: string;
  nextStartDate: string;
  label: string;
  startAtIso: string;
  endExclusiveIso: string;
}

function toDateOnly(input?: string | number | Date): string {
  if (!input) return toEasternDate();
  if (typeof input === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return input;
  }
  return toEasternDate(input);
}

export function getCurrentPayPeriod(reference?: string | number | Date): PayPeriodWindow {
  const period = resolvePayrollPeriod({ referenceDate: toDateOnly(reference) });
  const bounds = getPayrollPeriodIsoBounds(period);

  return {
    index: period.index,
    startDate: period.startDate,
    endDate: period.endDate,
    nextStartDate: period.nextStartDate,
    label: period.label,
    startAtIso: bounds.startAtIso,
    endExclusiveIso: bounds.endExclusiveIso
  };
}

export function isDateInPayPeriod(input: string | number | Date, period: Pick<PayPeriodWindow, "startDate" | "endDate">): boolean {
  const day = toDateOnly(input);
  return day >= period.startDate && day <= period.endDate;
}
