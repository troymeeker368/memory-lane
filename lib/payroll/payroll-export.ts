import "server-only";

import ExcelJS from "exceljs";
import JSZip from "jszip";

import { getCurrentProfile } from "@/lib/auth";
import { buildPayrollBatchFileName } from "@/lib/payroll/payroll-file-name";
import { listPayrollPeriods, resolvePayrollPeriod, getPayrollPeriodIsoBounds } from "@/lib/payroll/payroll-period";
import { buildPayrollTimesheet } from "@/lib/payroll/payroll-timesheet-builder";
import type {
  PayrollBatchExport,
  PayrollPeriod,
  PayrollPtoRecord,
  PayrollPunchRecord,
  PayrollTimesheet
} from "@/lib/payroll/payroll-types";
import { normalizeRoleKey } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { toEasternDateTimeLocal } from "@/lib/timezone";

type ProfileRow = {
  id: string;
  full_name: string | null;
  active: boolean | null;
};

function requirePayrollExportRole(role: string) {
  const normalizedRole = normalizeRoleKey(role);
  if (normalizedRole !== "admin" && normalizedRole !== "director" && normalizedRole !== "manager") {
    throw new Error("Payroll export requires manager/director/admin access.");
  }
}

function sortTimesheets(timesheets: PayrollTimesheet[]) {
  return [...timesheets].sort((left, right) =>
    left.employeeName === right.employeeName
      ? left.employeeId.localeCompare(right.employeeId)
      : left.employeeName.localeCompare(right.employeeName)
  );
}

function formatTimeCell(value: string | null) {
  if (!value) return "";
  return toEasternDateTimeLocal(value).split("T")[1] ?? "";
}

function formatHours(value: number) {
  return value === 0 ? "" : value.toFixed(2);
}

function applyCellStyle(cell: ExcelJS.Cell, style: Partial<ExcelJS.Style>) {
  cell.style = {
    ...cell.style,
    ...style,
    alignment: {
      ...cell.alignment,
      ...style.alignment
    },
    font: {
      ...cell.font,
      ...style.font
    },
    border: {
      ...cell.border,
      ...style.border
    }
  };
}

async function buildTimesheetWorkbookBuffer(timesheet: PayrollTimesheet) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Memory Lane";
  workbook.created = new Date();
  workbook.modified = new Date();

  const worksheet = workbook.addWorksheet("Timesheet", {
    views: [{ state: "frozen", ySplit: 5 }]
  });

  worksheet.columns = [
    { key: "date", width: 14 },
    { key: "day", width: 12 },
    { key: "timeIn", width: 13 },
    { key: "timeOut", width: 13 },
    { key: "regular", width: 16 },
    { key: "overtime", width: 16 },
    { key: "pto", width: 14 }
  ];

  worksheet.mergeCells("A1:G1");
  worksheet.getCell("A1").value = "Town Square Fort Mill";
  applyCellStyle(worksheet.getCell("A1"), {
    font: { bold: true, size: 16 },
    alignment: { horizontal: "center" }
  });

  worksheet.mergeCells("A2:G2");
  worksheet.getCell("A2").value = "368 Fort Mill Parkway, Suite 106, Fort Mill, SC 29715";
  applyCellStyle(worksheet.getCell("A2"), {
    alignment: { horizontal: "center" }
  });

  worksheet.mergeCells("A3:D3");
  worksheet.getCell("A3").value = `Employee: ${timesheet.employeeName}`;
  worksheet.mergeCells("E3:G3");
  worksheet.getCell("E3").value = `Pay Period: ${timesheet.payPeriod.startDate} to ${timesheet.payPeriod.endDate}`;

  const headerRow = worksheet.getRow(5);
  headerRow.values = [
    "Date",
    "Day",
    "Time In",
    "Time Out",
    "Regular Hours",
    "Overtime Hours",
    "Paid Time Off (PTO)"
  ];
  headerRow.font = { bold: true };
  headerRow.alignment = { horizontal: "center" };
  headerRow.height = 22;

  let currentRowIndex = 6;
  timesheet.rows.forEach((row, index) => {
    const worksheetRow = worksheet.getRow(currentRowIndex);
    worksheetRow.values = [
      row.workDate,
      row.dayLabel,
      formatTimeCell(row.timeInIso),
      formatTimeCell(row.timeOutIso),
      formatHours(row.regularHours),
      formatHours(row.overtimeHours),
      formatHours(row.ptoHours)
    ];

    currentRowIndex += 1;

    if (index === 6) {
      const subtotalRow = worksheet.getRow(currentRowIndex);
      subtotalRow.values = [
        "Week 1 Subtotal",
        "",
        "",
        "",
        timesheet.week1Totals.regularHours.toFixed(2),
        timesheet.week1Totals.overtimeHours.toFixed(2),
        timesheet.week1Totals.ptoHours.toFixed(2)
      ];
      subtotalRow.font = { bold: true };
      currentRowIndex += 1;
    }
  });

  const week2SubtotalRow = worksheet.getRow(currentRowIndex);
  week2SubtotalRow.values = [
    "Week 2 Subtotal",
    "",
    "",
    "",
    timesheet.week2Totals.regularHours.toFixed(2),
    timesheet.week2Totals.overtimeHours.toFixed(2),
    timesheet.week2Totals.ptoHours.toFixed(2)
  ];
  week2SubtotalRow.font = { bold: true };
  currentRowIndex += 2;

  const totalRow = worksheet.getRow(currentRowIndex);
  totalRow.values = [
    "Pay Period Total",
    "",
    "",
    "",
    timesheet.totals.regularHours.toFixed(2),
    timesheet.totals.overtimeHours.toFixed(2),
    timesheet.totals.ptoHours.toFixed(2)
  ];
  totalRow.font = { bold: true };
  currentRowIndex += 2;

  worksheet.mergeCells(`A${currentRowIndex}:G${currentRowIndex}`);
  worksheet.getCell(`A${currentRowIndex}`).value =
    "I certify that the hours shown above are true and accurate, including all regular hours, overtime hours, and paid time off reported for this pay period.";
  applyCellStyle(worksheet.getCell(`A${currentRowIndex}`), {
    alignment: {
      wrapText: true,
      vertical: "top",
      horizontal: "left"
    }
  });
  worksheet.getRow(currentRowIndex).height = 54;
  currentRowIndex += 2;

  worksheet.mergeCells(`A${currentRowIndex}:C${currentRowIndex}`);
  worksheet.getCell(`A${currentRowIndex}`).value = "Employee Signature: ______________________________";
  worksheet.mergeCells(`E${currentRowIndex}:G${currentRowIndex}`);
  worksheet.getCell(`E${currentRowIndex}`).value = "Date: __________________";
  currentRowIndex += 2;

  worksheet.mergeCells(`A${currentRowIndex}:C${currentRowIndex}`);
  worksheet.getCell(`A${currentRowIndex}`).value = "Supervisor Signature: _____________________________";
  worksheet.mergeCells(`E${currentRowIndex}:G${currentRowIndex}`);
  worksheet.getCell(`E${currentRowIndex}`).value = "Date: __________________";

  worksheet.eachRow((row) => {
    row.eachCell((cell) => {
      const columnIndex = typeof cell.col === "number" ? cell.col : Number(cell.col);
      applyCellStyle(cell, {
        border: {
          top: { style: "thin", color: { argb: "FFDADADA" } },
          left: { style: "thin", color: { argb: "FFDADADA" } },
          bottom: { style: "thin", color: { argb: "FFDADADA" } },
          right: { style: "thin", color: { argb: "FFDADADA" } }
        },
        alignment: {
          vertical: "middle",
          horizontal: Number.isFinite(columnIndex) && columnIndex >= 5 ? "right" : "left"
        }
      });
    });
  });

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function buildTimesheetArchive(timesheets: PayrollTimesheet[], payPeriod: PayrollPeriod) {
  const zip = new JSZip();
  for (const timesheet of timesheets) {
    const bytes = await buildTimesheetWorkbookBuffer(timesheet);
    zip.file(timesheet.fileName, bytes);
  }
  const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return {
    bytes,
    fileName: buildPayrollBatchFileName(payPeriod),
    contentType: "application/zip"
  };
}

async function loadPayrollProfiles(employeeId?: string | null) {
  const supabase = await createClient();
  let query = supabase.from("profiles").select("id, full_name, active").order("full_name", {
    ascending: true
  });
  if (employeeId) {
    query = query.eq("id", employeeId);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as ProfileRow[];
}

async function loadPayrollPunches(payPeriod: PayrollPeriod, employeeId?: string | null) {
  const supabase = await createClient();
  const { startAtIso, endExclusiveIso } = getPayrollPeriodIsoBounds(payPeriod);
  let query = supabase
    .from("punches")
    .select("employee_id, employee_name, timestamp, type, status")
    .eq("status", "active")
    .gte("timestamp", startAtIso)
    .lt("timestamp", endExclusiveIso)
    .order("employee_name", { ascending: true })
    .order("timestamp", { ascending: true });
  if (employeeId) {
    query = query.eq("employee_id", employeeId);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{
    employee_id: string;
    employee_name: string;
    timestamp: string;
    type: "in" | "out";
    status: "active" | "voided";
  }>).map<PayrollPunchRecord>((row) => ({
    employeeId: row.employee_id,
    employeeName: row.employee_name,
    timestamp: row.timestamp,
    type: row.type,
    status: row.status
  }));
}

async function loadPayrollPtoEntries(payPeriod: PayrollPeriod, employeeId?: string | null) {
  const supabase = await createClient();
  let query = supabase
    .from("pto_entries")
    .select("employee_id, employee_name, work_date, hours, status")
    .gte("work_date", payPeriod.startDate)
    .lte("work_date", payPeriod.endDate)
    .order("employee_name", { ascending: true })
    .order("work_date", { ascending: true });
  if (employeeId) {
    query = query.eq("employee_id", employeeId);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{
    employee_id: string;
    employee_name: string;
    work_date: string;
    hours: number;
    status: "pending" | "approved" | "denied";
  }>).map<PayrollPtoRecord>((row) => ({
    employeeId: row.employee_id,
    employeeName: row.employee_name,
    workDate: row.work_date,
    hours: Number(row.hours ?? 0),
    status: row.status
  }));
}

export async function getDirectorPayrollExportWorkspace(input?: {
  employeeId?: string | null;
  overridePayPeriodStart?: string | null;
  referenceDate?: string | number | Date;
}) {
  const payPeriod = resolvePayrollPeriod({
    referenceDate: input?.referenceDate,
    overridePayPeriodStart: input?.overridePayPeriodStart ?? null
  });
  const [profiles, punches, ptoEntries] = await Promise.all([
    loadPayrollProfiles(input?.employeeId ?? null),
    loadPayrollPunches(payPeriod, input?.employeeId ?? null),
    loadPayrollPtoEntries(payPeriod, input?.employeeId ?? null)
  ]);

  const employeeMap = new Map<string, { employeeId: string; employeeName: string }>();
  profiles.forEach((profile) => {
    if (profile.active === false) return;
    if (!profile.full_name) return;
    employeeMap.set(profile.id, {
      employeeId: profile.id,
      employeeName: profile.full_name
    });
  });
  punches.forEach((row) => {
    employeeMap.set(row.employeeId, {
      employeeId: row.employeeId,
      employeeName: row.employeeName
    });
  });
  ptoEntries.forEach((row) => {
    employeeMap.set(row.employeeId, {
      employeeId: row.employeeId,
      employeeName: row.employeeName
    });
  });

  const activeEmployeeIds = new Set<string>();
  punches.forEach((row) => activeEmployeeIds.add(row.employeeId));
  ptoEntries
    .filter((row) => row.status === "approved")
    .forEach((row) => activeEmployeeIds.add(row.employeeId));

  if (input?.employeeId && employeeMap.has(input.employeeId)) {
    activeEmployeeIds.add(input.employeeId);
  }

  const employees = [...activeEmployeeIds.values()]
    .map((employeeId) => employeeMap.get(employeeId))
    .filter((value): value is { employeeId: string; employeeName: string } => Boolean(value));

  if (employees.length === 0) {
    console.info(
      `[PayrollExport] No employees found for pay period ${payPeriod.startDate} to ${payPeriod.endDate}.`
    );
  }

  const timesheets = sortTimesheets(
    employees.map((employee) =>
      buildPayrollTimesheet({
        employee,
        payPeriod,
        punches,
        ptoEntries
      })
    )
  );

  return {
    payPeriod,
    availablePayrollPeriods: listPayrollPeriods({ referenceDate: input?.referenceDate }),
    timesheets,
    employeeCount: timesheets.length,
    warnings:
      timesheets.length === 0
        ? ["No employees had punches or approved PTO for the selected pay period."]
        : []
  };
}

export async function buildDirectorPayrollExportDownload(input?: {
  employeeId?: string | null;
  overridePayPeriodStart?: string | null;
  referenceDate?: string | number | Date;
}): Promise<
  | { bytes: Buffer; fileName: string; contentType: string; batch: PayrollBatchExport }
  | { bytes: null; fileName: string | null; contentType: null; batch: PayrollBatchExport }
> {
  const profile = await getCurrentProfile();
  requirePayrollExportRole(profile.role);

  const workspace = await getDirectorPayrollExportWorkspace(input);
  const batch: PayrollBatchExport = {
    payPeriod: workspace.payPeriod,
    timesheets: workspace.timesheets,
    batchFileName: buildPayrollBatchFileName(workspace.payPeriod),
    warnings: workspace.warnings
  };

  if (workspace.timesheets.length === 0) {
    return {
      bytes: null,
      fileName: null,
      contentType: null,
      batch
    };
  }

  if (workspace.timesheets.length === 1) {
    const timesheet = workspace.timesheets[0];
    const bytes = await buildTimesheetWorkbookBuffer(timesheet);
    return {
      bytes,
      fileName: timesheet.fileName,
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      batch
    };
  }

  const archive = await buildTimesheetArchive(workspace.timesheets, workspace.payPeriod);
  return {
    bytes: archive.bytes,
    fileName: archive.fileName,
    contentType: archive.contentType,
    batch
  };
}
