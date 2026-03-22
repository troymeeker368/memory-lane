import { addDays } from "@/lib/payroll/payroll-period";
import {
  allocateWeeklyPayrollOvertime,
  calculatePayrollDailyHours,
  getPayrollDayLabel,
  getWeekIndexForPayrollDate,
  groupPayrollPunchesByDate,
  roundPayrollHours,
  sumPayrollWeekTotals
} from "@/lib/payroll/payroll-hours";
import { buildPayrollTimesheetFileName } from "@/lib/payroll/payroll-file-name";
import type {
  PayrollPeriod,
  PayrollPtoRecord,
  PayrollPunchRecord,
  PayrollTimesheet,
  PayrollTimesheetDayRow
} from "@/lib/payroll/payroll-types";

type EmployeeIdentity = {
  employeeId: string;
  employeeName: string;
};

function selectBoundaryPunchIso(
  punches: PayrollPunchRecord[],
  type: "in" | "out",
  position: "first" | "last"
) {
  const matching = punches
    .filter((row) => row.status === "active" && row.type === type)
    .sort((left, right) => (left.timestamp > right.timestamp ? 1 : -1));
  if (matching.length === 0) return null;
  return position === "first" ? matching[0].timestamp : matching[matching.length - 1].timestamp;
}

function sumPtoHours(ptoEntries: PayrollPtoRecord[]) {
  return roundPayrollHours(
    ptoEntries
      .filter((entry) => entry.status === "approved")
      .reduce((total, entry) => total + Math.max(entry.hours, 0), 0)
  );
}

export function buildPayrollTimesheet(input: {
  employee: EmployeeIdentity;
  payPeriod: PayrollPeriod;
  punches: PayrollPunchRecord[];
  ptoEntries: PayrollPtoRecord[];
}): PayrollTimesheet {
  const punchesByDate = groupPayrollPunchesByDate(
    input.punches
      .filter((row) => row.employeeId === input.employee.employeeId)
      .filter((row) => row.status === "active")
  );
  const ptoByDate = new Map<string, PayrollPtoRecord[]>();

  input.ptoEntries
    .filter((row) => row.employeeId === input.employee.employeeId)
    .forEach((row) => {
      const existing = ptoByDate.get(row.workDate) ?? [];
      existing.push(row);
      ptoByDate.set(row.workDate, existing);
    });

  const baseRows: Array<
    PayrollTimesheetDayRow & {
      dateIndex: number;
    }
  > = [];

  for (let dayOffset = 0; dayOffset < 14; dayOffset += 1) {
    const workDate = addDays(input.payPeriod.startDate, dayOffset);
    const punches = punchesByDate.get(workDate) ?? [];
    const firstInIso = selectBoundaryPunchIso(punches, "in", "first");
    const lastOutIso = selectBoundaryPunchIso(punches, "out", "last");
    const dailyHours = calculatePayrollDailyHours({
      timeInIso: firstInIso,
      timeOutIso: lastOutIso
    });
    baseRows.push({
      dateIndex: dayOffset,
      workDate,
      dayLabel: getPayrollDayLabel(workDate),
      weekIndex: getWeekIndexForPayrollDate(input.payPeriod.startDate, workDate),
      timeInIso: dailyHours.timeInIso,
      timeOutIso: dailyHours.timeOutIso,
      regularHours: 0,
      overtimeHours: 0,
      ptoHours: sumPtoHours(ptoByDate.get(workDate) ?? []),
      workedHours: dailyHours.workedHours,
      rawHours: dailyHours.rawHours,
      lunchDeductionHours: dailyHours.lunchDeductionHours,
      hasIncompletePunch: dailyHours.hasIncompletePunch,
      hasInvalidRange: dailyHours.hasInvalidRange
    });
  }

  const overtimeAllocation = allocateWeeklyPayrollOvertime(input.payPeriod.startDate, baseRows);
  const overtimeByDate = new Map(
    overtimeAllocation.map((row) => [row.workDate, row] as const)
  );

  const rows = baseRows.map<PayrollTimesheetDayRow>((row) => {
    const allocation = overtimeByDate.get(row.workDate);
    return {
      workDate: row.workDate,
      dayLabel: row.dayLabel,
      weekIndex: row.weekIndex,
      timeInIso: row.timeInIso,
      timeOutIso: row.timeOutIso,
      regularHours: allocation?.regularHours ?? 0,
      overtimeHours: allocation?.overtimeHours ?? 0,
      ptoHours: row.ptoHours,
      workedHours: row.workedHours,
      rawHours: row.rawHours,
      lunchDeductionHours: row.lunchDeductionHours,
      hasIncompletePunch: row.hasIncompletePunch,
      hasInvalidRange: row.hasInvalidRange
    };
  });

  const week1Rows = rows.filter((row) => row.weekIndex === 1);
  const week2Rows = rows.filter((row) => row.weekIndex === 2);
  const week1Totals = sumPayrollWeekTotals(week1Rows);
  const week2Totals = sumPayrollWeekTotals(week2Rows);
  const totals = sumPayrollWeekTotals(rows);

  const issues: string[] = [];
  if (rows.some((row) => row.hasIncompletePunch)) {
    issues.push("One or more days are missing a Time In or Time Out punch.");
  }
  if (rows.some((row) => row.hasInvalidRange)) {
    issues.push("One or more days had an invalid punch range and were exported with 0 worked hours.");
  }

  return {
    employeeId: input.employee.employeeId,
    employeeName: input.employee.employeeName,
    payPeriod: input.payPeriod,
    fileName: buildPayrollTimesheetFileName(input.employee.employeeName, input.payPeriod),
    rows,
    week1Totals,
    week2Totals,
    totals,
    issues
  };
}
