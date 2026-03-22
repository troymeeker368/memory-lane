import type { PayrollPeriod } from "@/lib/payroll/payroll-types";

function slugifySegment(value: string) {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .toLowerCase();
}

export function buildPayrollTimesheetFileName(employeeName: string, payPeriod: PayrollPeriod) {
  const employeeSegment = slugifySegment(employeeName) || "employee";
  return `${employeeSegment}_${payPeriod.startDate}_to_${payPeriod.endDate}.xlsx`;
}

export function buildPayrollBatchFileName(payPeriod: PayrollPeriod) {
  return `payroll-timesheets_${payPeriod.startDate}_to_${payPeriod.endDate}.zip`;
}
