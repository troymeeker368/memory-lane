import test from "node:test";
import assert from "node:assert/strict";

import { buildPayrollTimesheetFileName } from "@/lib/payroll/payroll-file-name";
import { calculatePayrollDailyHours } from "@/lib/payroll/payroll-hours";
import { resolvePayrollPeriod } from "@/lib/payroll/payroll-period";
import { buildPayrollTimesheet } from "@/lib/payroll/payroll-timesheet-builder";
import { easternDateTimeLocalToISO } from "@/lib/timezone";

function makePunch(
  employeeId: string,
  employeeName: string,
  workDate: string,
  time: string,
  type: "in" | "out"
) {
  return {
    employeeId,
    employeeName,
    timestamp: easternDateTimeLocalToISO(`${workDate}T${time}`),
    type,
    status: "active" as const
  };
}

test("resolves the anchored current pay period from 2026-03-08", () => {
  const firstPeriod = resolvePayrollPeriod({ referenceDate: "2026-03-08" });
  assert.equal(firstPeriod.startDate, "2026-03-08");
  assert.equal(firstPeriod.endDate, "2026-03-21");

  const samePeriod = resolvePayrollPeriod({ referenceDate: "2026-03-21" });
  assert.equal(samePeriod.startDate, "2026-03-08");
  assert.equal(samePeriod.endDate, "2026-03-21");

  const nextPeriod = resolvePayrollPeriod({ referenceDate: "2026-03-22" });
  assert.equal(nextPeriod.startDate, "2026-03-22");
  assert.equal(nextPeriod.endDate, "2026-04-04");
});

test("supports explicit override pay period start and rejects off-cycle overrides", () => {
  const override = resolvePayrollPeriod({
    overridePayPeriodStart: "2026-04-05"
  });
  assert.equal(override.startDate, "2026-04-05");
  assert.equal(override.endDate, "2026-04-18");

  assert.throws(
    () =>
      resolvePayrollPeriod({
        overridePayPeriodStart: "2026-04-06"
      }),
    /align to the payroll anchor/i
  );
});

test("deducts a 0.5 hour lunch only when the raw shift exceeds 8 hours", () => {
  const longShift = calculatePayrollDailyHours({
    timeInIso: easternDateTimeLocalToISO("2026-03-09T08:00"),
    timeOutIso: easternDateTimeLocalToISO("2026-03-09T17:00")
  });
  assert.equal(longShift.rawHours, 9);
  assert.equal(longShift.lunchDeductionHours, 0.5);
  assert.equal(longShift.workedHours, 8.5);

  const shortShift = calculatePayrollDailyHours({
    timeInIso: easternDateTimeLocalToISO("2026-03-09T08:00"),
    timeOutIso: easternDateTimeLocalToISO("2026-03-09T16:00")
  });
  assert.equal(shortShift.rawHours, 8);
  assert.equal(shortShift.lunchDeductionHours, 0);
  assert.equal(shortShift.workedHours, 8);
});

test("splits week 1 and week 2 into fixed 7-day payroll blocks", () => {
  const payPeriod = resolvePayrollPeriod({ overridePayPeriodStart: "2026-03-08" });
  const employeeId = "employee-1";
  const employeeName = "Jane Doe";

  const punches = [
    makePunch(employeeId, employeeName, "2026-03-08", "08:00", "in"),
    makePunch(employeeId, employeeName, "2026-03-08", "17:00", "out"),
    makePunch(employeeId, employeeName, "2026-03-15", "08:00", "in"),
    makePunch(employeeId, employeeName, "2026-03-15", "17:00", "out")
  ];

  const timesheet = buildPayrollTimesheet({
    employee: { employeeId, employeeName },
    payPeriod,
    punches,
    ptoEntries: []
  });

  assert.equal(timesheet.rows[0].weekIndex, 1);
  assert.equal(timesheet.rows[6].weekIndex, 1);
  assert.equal(timesheet.rows[7].weekIndex, 2);
  assert.equal(timesheet.rows[13].weekIndex, 2);
  assert.equal(timesheet.week1Totals.regularHours, 8.5);
  assert.equal(timesheet.week2Totals.regularHours, 8.5);
});

test("reclassifies overtime out of regular hours for week 1 without stacking", () => {
  const payPeriod = resolvePayrollPeriod({ overridePayPeriodStart: "2026-03-08" });
  const employeeId = "employee-2";
  const employeeName = "John Smith";
  const punches = [
    "2026-03-08",
    "2026-03-09",
    "2026-03-10",
    "2026-03-11",
    "2026-03-12"
  ].flatMap((workDate) => [
    makePunch(employeeId, employeeName, workDate, "08:00", "in"),
    makePunch(employeeId, employeeName, workDate, "18:00", "out")
  ]);

  const timesheet = buildPayrollTimesheet({
    employee: { employeeId, employeeName },
    payPeriod,
    punches,
    ptoEntries: []
  });

  assert.equal(timesheet.week1Totals.regularHours, 40);
  assert.equal(timesheet.week1Totals.overtimeHours, 7.5);
  assert.equal(timesheet.totals.regularHours, 40);
  assert.equal(timesheet.totals.overtimeHours, 7.5);
  assert.equal(timesheet.rows[4].regularHours, 2);
  assert.equal(timesheet.rows[4].overtimeHours, 7.5);
});

test("keeps week 2 overtime independent from week 1 totals", () => {
  const payPeriod = resolvePayrollPeriod({ overridePayPeriodStart: "2026-03-08" });
  const employeeId = "employee-3";
  const employeeName = "Alex Rivera";
  const punches = [
    "2026-03-08",
    "2026-03-09"
  ].flatMap((workDate) => [
    makePunch(employeeId, employeeName, workDate, "08:00", "in"),
    makePunch(employeeId, employeeName, workDate, "18:00", "out")
  ]).concat(
    [
      "2026-03-15",
      "2026-03-16",
      "2026-03-17",
      "2026-03-18",
      "2026-03-19"
    ].flatMap((workDate) => [
      makePunch(employeeId, employeeName, workDate, "08:00", "in"),
      makePunch(employeeId, employeeName, workDate, "18:00", "out")
    ])
  );

  const timesheet = buildPayrollTimesheet({
    employee: { employeeId, employeeName },
    payPeriod,
    punches,
    ptoEntries: []
  });

  assert.equal(timesheet.week1Totals.regularHours, 19);
  assert.equal(timesheet.week1Totals.overtimeHours, 0);
  assert.equal(timesheet.week2Totals.regularHours, 40);
  assert.equal(timesheet.week2Totals.overtimeHours, 7.5);
});

test("builds employee-specific payroll file names with the pay period range", () => {
  const payPeriod = resolvePayrollPeriod({ overridePayPeriodStart: "2026-03-08" });
  assert.equal(
    buildPayrollTimesheetFileName("Jane Doe", payPeriod),
    "jane-doe_2026-03-08_to_2026-03-21.xlsx"
  );
});
