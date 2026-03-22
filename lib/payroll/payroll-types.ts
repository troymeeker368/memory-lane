export const PAYROLL_PERIOD_DAYS = 14;
export const PAYROLL_WEEK_DAYS = 7;
export const PAYROLL_WEEKLY_OVERTIME_THRESHOLD_HOURS = 40;
export const PAYROLL_LUNCH_DEDUCTION_HOURS = 0.5;
export const PAYROLL_LUNCH_DEDUCTION_THRESHOLD_HOURS = 8;
export const PAYROLL_ANCHOR_DATE = "2026-03-08";

export interface PayrollPeriod {
  index: number;
  anchorDate: string;
  startDate: string;
  endDate: string;
  nextStartDate: string;
  label: string;
}

export interface PayrollDailyHours {
  timeInIso: string | null;
  timeOutIso: string | null;
  rawHours: number;
  lunchDeductionHours: number;
  workedHours: number;
  hasIncompletePunch: boolean;
  hasInvalidRange: boolean;
}

export interface PayrollPunchRecord {
  employeeId: string;
  employeeName: string;
  timestamp: string;
  type: "in" | "out";
  status: "active" | "voided";
}

export interface PayrollPtoRecord {
  employeeId: string;
  employeeName: string;
  workDate: string;
  hours: number;
  status: "pending" | "approved" | "denied";
}

export interface PayrollTimesheetDayRow {
  workDate: string;
  dayLabel: string;
  weekIndex: 1 | 2;
  timeInIso: string | null;
  timeOutIso: string | null;
  regularHours: number;
  overtimeHours: number;
  ptoHours: number;
  workedHours: number;
  rawHours: number;
  lunchDeductionHours: number;
  hasIncompletePunch: boolean;
  hasInvalidRange: boolean;
}

export interface PayrollWeekTotals {
  regularHours: number;
  overtimeHours: number;
  ptoHours: number;
  workedHours: number;
}

export type PayrollTimesheetTotals = PayrollWeekTotals;

export interface PayrollTimesheet {
  employeeId: string;
  employeeName: string;
  payPeriod: PayrollPeriod;
  fileName: string;
  rows: PayrollTimesheetDayRow[];
  week1Totals: PayrollWeekTotals;
  week2Totals: PayrollWeekTotals;
  totals: PayrollTimesheetTotals;
  issues: string[];
}

export interface PayrollBatchExport {
  payPeriod: PayrollPeriod;
  timesheets: PayrollTimesheet[];
  batchFileName: string;
  warnings: string[];
}
