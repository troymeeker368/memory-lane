import { addMockRecord, getMockDb, updateMockRecord } from "@/lib/mock-repo";
import type { MockDb } from "@/lib/mock-repo";
import { getCurrentPayPeriod } from "@/lib/pay-period";
import { normalizeRoleKey } from "@/lib/permissions";
import { isMockMode } from "@/lib/runtime";
import { easternDateTimeLocalToISO, toEasternDate, toEasternISO } from "@/lib/timezone";
import type { AppRole } from "@/types/app";
import { COUNT_PTO_TOWARD_OVERTIME, allocatePayPeriodOvertime, calculateDailyTimecard, type TimecardPunch } from "@/lib/services/timecard-workflow";

export type TimecardStatus = "pending" | "needs_review" | "approved" | "corrected";
type Decision = "approved" | "denied";

function addDays(dateOnly: string, days: number) {
  const d = new Date(`${dateOnly}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toWorkDate(input: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  return toEasternDate(input);
}

function roundHours(value: number) {
  return Number(value.toFixed(2));
}

function csvEscape(value: string | number | null | undefined) {
  const text = String(value ?? "");
  if (!text.includes(",") && !text.includes("\"") && !text.includes("\n")) return text;
  return `"${text.replace(/"/g, "\"\"")}"`;
}

function sortPayPeriods(rows: MockDb["payPeriods"]) {
  return [...rows].sort((left, right) => (left.start_date > right.start_date ? -1 : 1));
}

function isDateInPeriod(dateOnly: string, period: MockDb["payPeriods"][number]) {
  return dateOnly >= period.start_date && dateOnly <= period.end_date;
}

function patchIfChanged<K extends keyof MockDb>(key: K, id: string, patch: Partial<MockDb[K][number]>) {
  const db = getMockDb();
  const row = (db[key] as MockDb[K][number][]).find((entry) => entry.id === id);
  if (!row) return null;
  const changed = Object.entries(patch).some(([field, value]) => (row as unknown as Record<string, unknown>)[field] !== value);
  if (!changed) return row;
  return updateMockRecord(key, id, patch);
}

function ensurePayPeriods() {
  const db = getMockDb();
  if (db.payPeriods.length === 0) {
    const current = getCurrentPayPeriod();
    for (let i = -6; i <= 6; i += 1) {
      const startDate = addDays(current.startDate, i * 14);
      const endDate = addDays(startDate, 13);
      addMockRecord("payPeriods", {
        label: `${startDate} to ${endDate}`,
        start_date: startDate,
        end_date: endDate,
        is_closed: i < -1
      });
    }
  }
}

function resolvePeriod(payPeriodId?: string | null) {
  ensurePayPeriods();
  const db = getMockDb();
  const ordered = sortPayPeriods(db.payPeriods);
  const current = getCurrentPayPeriod();
  return (
    ordered.find((row) => row.id === payPeriodId) ??
    ordered.find((row) => row.start_date === current.startDate && row.end_date === current.endDate) ??
    ordered[0]
  );
}

function periodForDate(workDate: string) {
  ensurePayPeriods();
  const db = getMockDb();
  return sortPayPeriods(db.payPeriods).find((row) => isDateInPeriod(workDate, row)) ?? null;
}

function assertWritableByDate(workDate: string, role: AppRole) {
  const period = periodForDate(workDate);
  if (!period) return;
  if (period.is_closed && normalizeRoleKey(role) !== "admin") {
    throw new Error("Selected pay period is closed. Admin override is required.");
  }
}

function assertWritableByPeriodId(payPeriodId: string, role: AppRole) {
  const db = getMockDb();
  const period = db.payPeriods.find((row) => row.id === payPeriodId);
  if (!period) return;
  if (period.is_closed && normalizeRoleKey(role) !== "admin") {
    throw new Error("Selected pay period is closed. Admin override is required.");
  }
}

function ensurePunchMirror() {
  const db = getMockDb();
  const linked = new Set(db.punches.map((row) => row.linked_time_punch_id).filter((row): row is string => Boolean(row)));
  db.timePunches.forEach((punch) => {
    if (linked.has(punch.id)) return;
    addMockRecord("punches", {
      employee_id: punch.staff_user_id,
      employee_name: punch.staff_name,
      timestamp: punch.punch_at,
      type: punch.punch_type,
      source: "employee",
      status: "active",
      note: punch.note ?? null,
      created_by: punch.staff_name,
      created_at: punch.punch_at,
      updated_at: punch.punch_at,
      linked_time_punch_id: punch.id
    });
    linked.add(punch.id);
  });
}

function recalcPeriod(periodId: string) {
  const db = getMockDb();
  const period = db.payPeriods.find((row) => row.id === periodId);
  if (!period) return;
  ensurePunchMirror();

  const punches = db.punches.filter((row) => isDateInPeriod(toWorkDate(row.timestamp), period));
  const pto = db.ptoEntries.filter((row) => isDateInPeriod(row.work_date, period));
  const existingRows = db.dailyTimecards.filter((row) => row.pay_period_id === period.id);
  const existingByKey = new Map(existingRows.map((row) => [`${row.employee_id}::${row.work_date}`, row] as const));
  const employeeNames = new Map(db.staff.map((row) => [row.id, row.full_name] as const));
  const employeeIds = new Set<string>([
    ...punches.map((row) => row.employee_id),
    ...pto.map((row) => row.employee_id),
    ...existingRows.map((row) => row.employee_id)
  ]);

  employeeIds.forEach((employeeId) => {
    const dates = new Set<string>([
      ...punches.filter((row) => row.employee_id === employeeId).map((row) => toWorkDate(row.timestamp)),
      ...pto.filter((row) => row.employee_id === employeeId).map((row) => row.work_date),
      ...existingRows.filter((row) => row.employee_id === employeeId).map((row) => row.work_date)
    ]);
    const employeeName =
      employeeNames.get(employeeId) ??
      punches.find((row) => row.employee_id === employeeId)?.employee_name ??
      pto.find((row) => row.employee_id === employeeId)?.employee_name ??
      "Unknown Employee";

    dates.forEach((workDate) => {
      const dayPunches = punches.filter((row) => row.employee_id === employeeId && toWorkDate(row.timestamp) === workDate);
      const ptoHours = pto
        .filter((row) => row.employee_id === employeeId && row.work_date === workDate && row.status === "approved")
        .reduce((sum, row) => sum + row.hours, 0);
      const calculation = calculateDailyTimecard({
        punches: dayPunches.map<TimecardPunch>((row) => ({
          id: row.id,
          timestamp: row.timestamp,
          type: row.type,
          source: row.source,
          status: row.status
        })),
        ptoHours
      });
      const existing = existingByKey.get(`${employeeId}::${workDate}`) ?? null;
      let status: TimecardStatus = existing?.status ?? (calculation.hasException ? "needs_review" : "pending");
      if (calculation.hasManualCorrection && status !== "approved") status = "corrected";
      if (existing?.status === "approved" && (calculation.hasException || calculation.hasManualCorrection)) status = "corrected";

      const patch: Partial<MockDb["dailyTimecards"][number]> = {
        employee_id: employeeId,
        employee_name: employeeName,
        work_date: workDate,
        first_in: calculation.firstIn,
        last_out: calculation.lastOut,
        raw_hours: calculation.rawHours,
        meal_deduction_hours: calculation.mealDeductionHours,
        worked_hours: calculation.workedHours,
        pto_hours: roundHours(ptoHours),
        overtime_hours: existing?.overtime_hours ?? 0,
        total_paid_hours: roundHours(calculation.workedHours + ptoHours),
        status,
        director_note: existing?.director_note ?? null,
        approved_by: status === "approved" ? existing?.approved_by ?? null : null,
        approved_at: status === "approved" ? existing?.approved_at ?? null : null,
        pay_period_id: period.id,
        has_exception: calculation.hasException,
        created_at: existing?.created_at ?? toEasternISO(),
        updated_at: toEasternISO()
      };

      if (existing) {
        patchIfChanged("dailyTimecards", existing.id, patch);
      } else {
        addMockRecord("dailyTimecards", patch);
      }
    });
  });

  const refreshed = getMockDb().dailyTimecards.filter((row) => row.pay_period_id === period.id);
  const byEmployee = new Map<string, MockDb["dailyTimecards"]>();
  refreshed.forEach((row) => {
    const rows = byEmployee.get(row.employee_id) ?? [];
    rows.push(row);
    byEmployee.set(row.employee_id, rows);
  });
  byEmployee.forEach((rows) => {
    const overtimeById = allocatePayPeriodOvertime(
      rows.map((row) => ({ id: row.id, workDate: row.work_date, workedHours: row.worked_hours, ptoHours: row.pto_hours })),
      { countPtoTowardOvertime: COUNT_PTO_TOWARD_OVERTIME }
    );
    rows.forEach((row) => {
      patchIfChanged("dailyTimecards", row.id, {
        overtime_hours: overtimeById.get(row.id) ?? 0,
        total_paid_hours: roundHours(row.worked_hours + row.pto_hours),
        updated_at: toEasternISO()
      });
    });
  });
}

function payrollRows(payPeriod: MockDb["payPeriods"][number], employeeId?: string | null) {
  const db = getMockDb();
  return db.dailyTimecards
    .filter((row) => row.pay_period_id === payPeriod.id)
    .filter((row) => (employeeId ? row.employee_id === employeeId : true))
    .sort((left, right) => (left.employee_name === right.employee_name ? (left.work_date > right.work_date ? 1 : -1) : left.employee_name > right.employee_name ? 1 : -1))
    .map((row) => ({
      employee_name: row.employee_name,
      pay_period_label: payPeriod.label,
      work_date: row.work_date,
      first_in: row.first_in,
      last_out: row.last_out,
      raw_hours: row.raw_hours,
      meal_deduction_hours: row.meal_deduction_hours,
      worked_hours: row.worked_hours,
      pto_hours: row.pto_hours,
      overtime_hours: row.overtime_hours,
      total_paid_hours: row.total_paid_hours,
      status: row.status,
      approved_by: row.approved_by,
      approved_at: row.approved_at
    }));
}

function payrollCsv(rows: ReturnType<typeof payrollRows>) {
  const header = ["employee_name", "pay_period_label", "work_date", "first_in", "last_out", "raw_hours", "meal_deduction_hours", "worked_hours", "pto_hours", "overtime_hours", "total_paid_hours", "status", "approved_by", "approved_at"];
  const lines = [header.join(",")];
  rows.forEach((row) => {
    lines.push([
      row.employee_name,
      row.pay_period_label,
      row.work_date,
      row.first_in ?? "",
      row.last_out ?? "",
      row.raw_hours.toFixed(2),
      row.meal_deduction_hours.toFixed(2),
      row.worked_hours.toFixed(2),
      row.pto_hours.toFixed(2),
      row.overtime_hours.toFixed(2),
      row.total_paid_hours.toFixed(2),
      row.status,
      row.approved_by ?? "",
      row.approved_at ?? ""
    ].map(csvEscape).join(","));
  });
  return lines.join("\n");
}

export async function getDirectorTimecardsWorkspace(filters?: { payPeriodId?: string | null; employeeId?: string | null; status?: string | null; exceptionOnly?: boolean }) {
  if (!isMockMode()) throw new Error("Director timecards backend integration pending.");
  const db = getMockDb();
  const selectedPayPeriod = resolvePeriod(filters?.payPeriodId ?? null);
  if (!selectedPayPeriod) throw new Error("No pay periods available.");
  recalcPeriod(selectedPayPeriod.id);

  const statusFilter = filters?.status && filters.status !== "all" ? (filters.status as TimecardStatus) : null;
  const dailyTimecards = db.dailyTimecards
    .filter((row) => row.pay_period_id === selectedPayPeriod.id)
    .filter((row) => (filters?.employeeId ? row.employee_id === filters.employeeId : true))
    .filter((row) => (statusFilter ? row.status === statusFilter : true))
    .filter((row) => (filters?.exceptionOnly ? row.has_exception : true))
    .sort((left, right) => (left.work_date === right.work_date ? (left.employee_name > right.employee_name ? 1 : -1) : left.work_date > right.work_date ? -1 : 1));

  const pendingApprovals = db.dailyTimecards
    .filter((row) => row.pay_period_id === selectedPayPeriod.id && (row.status === "pending" || row.status === "needs_review"))
    .sort((left, right) => (left.work_date === right.work_date ? (left.employee_name > right.employee_name ? 1 : -1) : left.work_date > right.work_date ? -1 : 1));

  const forgottenPunchRequests = db.forgottenPunchRequests
    .filter((row) => isDateInPeriod(row.work_date, selectedPayPeriod))
    .filter((row) => (filters?.employeeId ? row.employee_id === filters.employeeId : true))
    .sort((left, right) => (left.created_at > right.created_at ? -1 : 1));

  const ptoEntries = db.ptoEntries
    .filter((row) => isDateInPeriod(row.work_date, selectedPayPeriod))
    .filter((row) => (filters?.employeeId ? row.employee_id === filters.employeeId : true))
    .sort((left, right) => (left.work_date > right.work_date ? -1 : 1));

  const ptoTotalsByEmployee = Array.from(
    ptoEntries
      .filter((row) => row.status === "approved")
      .reduce((acc, row) => {
        const key = `${row.employee_id}::${row.employee_name}`;
        const previous = acc.get(key) ?? { employee_id: row.employee_id, employee_name: row.employee_name, approved_hours: 0 };
        previous.approved_hours = roundHours(previous.approved_hours + row.hours);
        acc.set(key, previous);
        return acc;
      }, new Map<string, { employee_id: string; employee_name: string; approved_hours: number }>())
      .values()
  ).sort((left, right) => (left.employee_name > right.employee_name ? 1 : -1));

  const payPeriodSummary = Array.from(
    db.dailyTimecards
      .filter((row) => row.pay_period_id === selectedPayPeriod.id)
      .reduce((acc, row) => {
        const current = acc.get(row.employee_id) ?? { employee_name: row.employee_name, regular_hours: 0, overtime_hours: 0, pto_hours: 0, total_paid_hours: 0, exception_count: 0, statuses: new Set<TimecardStatus>() };
        current.regular_hours = roundHours(current.regular_hours + Math.max(row.worked_hours - row.overtime_hours, 0));
        current.overtime_hours = roundHours(current.overtime_hours + row.overtime_hours);
        current.pto_hours = roundHours(current.pto_hours + row.pto_hours);
        current.total_paid_hours = roundHours(current.total_paid_hours + row.total_paid_hours);
        current.exception_count += row.has_exception ? 1 : 0;
        current.statuses.add(row.status);
        acc.set(row.employee_id, current);
        return acc;
      }, new Map<string, { employee_name: string; regular_hours: number; overtime_hours: number; pto_hours: number; total_paid_hours: number; exception_count: number; statuses: Set<TimecardStatus> }>())
      .values()
  ).map((row) => ({
    employee_name: row.employee_name,
    regular_hours: row.regular_hours,
    overtime_hours: row.overtime_hours,
    pto_hours: row.pto_hours,
    total_paid_hours: row.total_paid_hours,
    exception_count: row.exception_count,
    approval_state: row.statuses.has("pending") || row.statuses.has("needs_review") ? "pending" : row.statuses.has("corrected") ? "corrected" : "approved"
  })).sort((left, right) => (left.employee_name > right.employee_name ? 1 : -1));

  const exportRows = payrollRows(selectedPayPeriod, filters?.employeeId ?? null);
  const blocked = exportRows.filter((row) => row.status !== "approved");

  return {
    availableEmployees: db.staff.filter((row) => row.active).map((row) => ({ id: row.id, name: row.full_name })).sort((left, right) => (left.name > right.name ? 1 : -1)),
    payPeriods: sortPayPeriods(db.payPeriods),
    selectedPayPeriod,
    pendingApprovals,
    dailyTimecards,
    forgottenPunchRequests,
    ptoEntries,
    ptoTotalsByEmployee,
    payPeriodSummary,
    payrollExport: {
      ok: blocked.length === 0,
      error: blocked.length === 0 ? null : `${blocked.length} day(s) still need final approval before payroll export.`,
      fileName: `payroll-export-${selectedPayPeriod.start_date}.csv`,
      rows: exportRows,
      csvDataUrl: blocked.length === 0 ? `data:text/csv;charset=utf-8,${encodeURIComponent(payrollCsv(exportRows))}` : null
    }
  };
}

export async function getEmployeeForgottenPunchRequests(employeeId: string) {
  if (!isMockMode()) throw new Error("Forgotten punch backend integration pending.");
  const db = getMockDb();
  return db.forgottenPunchRequests.filter((row) => row.employee_id === employeeId).sort((left, right) => (left.created_at > right.created_at ? -1 : 1));
}

export async function submitForgottenPunchRequest(input: { employeeId: string; employeeName: string; workDate: string; requestType: MockDb["forgottenPunchRequests"][number]["request_type"]; requestedIn?: string | null; requestedOut?: string | null; reason: string; employeeNote?: string | null; }) {
  if (!isMockMode()) throw new Error("Forgotten punch backend integration pending.");
  const needsIn = input.requestType === "missing_in" || input.requestType === "full_shift" || input.requestType === "edit_shift";
  const needsOut = input.requestType === "missing_out" || input.requestType === "full_shift" || input.requestType === "edit_shift";
  if (needsIn && !input.requestedIn) throw new Error("Requested IN time is required.");
  if (needsOut && !input.requestedOut) throw new Error("Requested OUT time is required.");
  return addMockRecord("forgottenPunchRequests", {
    employee_id: input.employeeId,
    employee_name: input.employeeName,
    work_date: input.workDate,
    request_type: input.requestType,
    requested_in: input.requestedIn ?? null,
    requested_out: input.requestedOut ?? null,
    reason: input.reason.trim(),
    employee_note: (input.employeeNote ?? "").trim() || null,
    status: "submitted",
    director_decision_note: null,
    approved_by: null,
    approved_at: null,
    created_at: toEasternISO(),
    updated_at: toEasternISO()
  });
}

export async function approveDailyTimecard(input: { timecardId: string; approverName: string; role: AppRole; note?: string | null }) {
  if (!isMockMode()) throw new Error("Timecard approval backend integration pending.");
  const db = getMockDb();
  const row = db.dailyTimecards.find((entry) => entry.id === input.timecardId);
  if (!row) throw new Error("Daily timecard not found.");
  assertWritableByPeriodId(row.pay_period_id, input.role);
  patchIfChanged("dailyTimecards", row.id, { status: "approved", director_note: (input.note ?? "").trim() || row.director_note, approved_by: input.approverName, approved_at: toEasternISO(), updated_at: toEasternISO() });
}

export async function markDailyTimecardNeedsReview(input: { timecardId: string; role: AppRole; note?: string | null }) {
  if (!isMockMode()) throw new Error("Timecard review backend integration pending.");
  const db = getMockDb();
  const row = db.dailyTimecards.find((entry) => entry.id === input.timecardId);
  if (!row) throw new Error("Daily timecard not found.");
  assertWritableByPeriodId(row.pay_period_id, input.role);
  patchIfChanged("dailyTimecards", row.id, { status: "needs_review", director_note: (input.note ?? "").trim() || row.director_note, approved_by: null, approved_at: null, updated_at: toEasternISO() });
}

export async function addDirectorCorrectionPunch(input: { employeeId: string; employeeName: string; workDate: string; time: string; type: "in" | "out"; note?: string | null; createdBy: string; role: AppRole; }) {
  if (!isMockMode()) throw new Error("Director correction backend integration pending.");
  assertWritableByDate(input.workDate, input.role);
  addMockRecord("punches", {
    employee_id: input.employeeId,
    employee_name: input.employeeName,
    timestamp: easternDateTimeLocalToISO(`${input.workDate}T${input.time}`),
    type: input.type,
    source: "director_correction",
    status: "active",
    note: (input.note ?? "").trim() || `Director correction by ${input.createdBy}`,
    created_by: input.createdBy,
    created_at: toEasternISO(),
    updated_at: toEasternISO(),
    linked_time_punch_id: null
  });
  const period = periodForDate(input.workDate);
  if (period) recalcPeriod(period.id);
}

export async function decideForgottenPunchRequest(input: { requestId: string; decision: Decision; decisionNote?: string | null; approverName: string; role: AppRole; }) {
  if (!isMockMode()) throw new Error("Forgotten punch approval backend integration pending.");
  const db = getMockDb();
  const request = db.forgottenPunchRequests.find((row) => row.id === input.requestId);
  if (!request) throw new Error("Forgotten punch request not found.");
  if (request.status !== "submitted") throw new Error("Only submitted requests can be reviewed.");
  assertWritableByDate(request.work_date, input.role);
  if (input.decision === "denied") {
    patchIfChanged("forgottenPunchRequests", request.id, { status: "denied", director_decision_note: (input.decisionNote ?? "").trim() || "Denied by director review.", approved_by: input.approverName, approved_at: toEasternISO(), updated_at: toEasternISO() });
    return;
  }

  const shouldAddIn = request.request_type === "missing_in" || request.request_type === "full_shift" || request.request_type === "edit_shift";
  const shouldAddOut = request.request_type === "missing_out" || request.request_type === "full_shift" || request.request_type === "edit_shift";
  if (request.request_type === "edit_shift") {
    db.punches
      .filter((row) => row.employee_id === request.employee_id && toWorkDate(row.timestamp) === request.work_date && row.status === "active")
      .forEach((row) => patchIfChanged("punches", row.id, { status: "voided", note: `${row.note ?? ""} [Voided by request ${request.id}]`.trim(), updated_at: toEasternISO() }));
  }

  if (shouldAddIn && request.requested_in) {
    addMockRecord("punches", {
      employee_id: request.employee_id,
      employee_name: request.employee_name,
      timestamp: easternDateTimeLocalToISO(`${request.work_date}T${request.requested_in}`),
      type: "in",
      source: "approved_forgotten_punch",
      status: "active",
      note: `Request ${request.id} approved by ${input.approverName}`,
      created_by: input.approverName,
      created_at: toEasternISO(),
      updated_at: toEasternISO(),
      linked_time_punch_id: null
    });
  }
  if (shouldAddOut && request.requested_out) {
    addMockRecord("punches", {
      employee_id: request.employee_id,
      employee_name: request.employee_name,
      timestamp: easternDateTimeLocalToISO(`${request.work_date}T${request.requested_out}`),
      type: "out",
      source: "approved_forgotten_punch",
      status: "active",
      note: `Request ${request.id} approved by ${input.approverName}`,
      created_by: input.approverName,
      created_at: toEasternISO(),
      updated_at: toEasternISO(),
      linked_time_punch_id: null
    });
  }

  patchIfChanged("forgottenPunchRequests", request.id, { status: "approved", director_decision_note: (input.decisionNote ?? "").trim() || "Approved by director review.", approved_by: input.approverName, approved_at: toEasternISO(), updated_at: toEasternISO() });
  const period = periodForDate(request.work_date);
  if (period) recalcPeriod(period.id);
}

export async function addPtoEntry(input: { employeeId: string; employeeName: string; workDate: string; hours: number; type: "vacation" | "sick" | "holiday" | "personal"; note?: string | null; role: AppRole; }) {
  if (!isMockMode()) throw new Error("PTO backend integration pending.");
  assertWritableByDate(input.workDate, input.role);
  addMockRecord("ptoEntries", {
    employee_id: input.employeeId,
    employee_name: input.employeeName,
    work_date: input.workDate,
    hours: Math.max(0, input.hours),
    type: input.type,
    status: "pending",
    note: (input.note ?? "").trim() || null,
    approved_by: null,
    approved_at: null,
    created_at: toEasternISO(),
    updated_at: toEasternISO()
  });
  const period = periodForDate(input.workDate);
  if (period) recalcPeriod(period.id);
}

export async function updatePendingPtoEntry(input: { entryId: string; hours: number; type: "vacation" | "sick" | "holiday" | "personal"; note?: string | null; role: AppRole; }) {
  if (!isMockMode()) throw new Error("PTO update backend integration pending.");
  const db = getMockDb();
  const row = db.ptoEntries.find((entry) => entry.id === input.entryId);
  if (!row) throw new Error("PTO entry not found.");
  if (row.status !== "pending") throw new Error("Only pending PTO entries can be edited.");
  assertWritableByDate(row.work_date, input.role);
  patchIfChanged("ptoEntries", row.id, { hours: Math.max(0, input.hours), type: input.type, note: (input.note ?? "").trim() || null, updated_at: toEasternISO() });
  const period = periodForDate(row.work_date);
  if (period) recalcPeriod(period.id);
}

export async function decidePtoEntry(input: { entryId: string; decision: Decision; approverName: string; decisionNote?: string | null; role: AppRole; }) {
  if (!isMockMode()) throw new Error("PTO approval backend integration pending.");
  const db = getMockDb();
  const row = db.ptoEntries.find((entry) => entry.id === input.entryId);
  if (!row) throw new Error("PTO entry not found.");
  if (row.status !== "pending") throw new Error("Only pending PTO entries can be reviewed.");
  assertWritableByDate(row.work_date, input.role);
  patchIfChanged("ptoEntries", row.id, { status: input.decision, note: (input.decisionNote ?? "").trim() || row.note, approved_by: input.approverName, approved_at: toEasternISO(), updated_at: toEasternISO() });
  const period = periodForDate(row.work_date);
  if (period) recalcPeriod(period.id);
}

export async function setPayPeriodClosed(input: { payPeriodId: string; isClosed: boolean; role: AppRole }) {
  if (!isMockMode()) throw new Error("Pay period lock backend integration pending.");
  const role = normalizeRoleKey(input.role);
  if (role !== "admin" && role !== "director") {
    throw new Error("Only director/admin can lock or reopen pay periods.");
  }
  const db = getMockDb();
  const row = db.payPeriods.find((period) => period.id === input.payPeriodId);
  if (!row) throw new Error("Pay period not found.");
  patchIfChanged("payPeriods", row.id, { is_closed: input.isClosed });
}
