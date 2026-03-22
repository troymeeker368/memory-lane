import { getCurrentPayPeriod } from "@/lib/pay-period";
import { normalizeRoleKey } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { easternDateTimeLocalToISO, toEasternDate, toEasternISO } from "@/lib/timezone";
import type { AppRole } from "@/types/app";
import type { Database } from "@/types/supabase";

export type TimecardStatus = "pending" | "needs_review" | "approved" | "corrected";
type Decision = "approved" | "denied";
type ForgottenPunchRequestType = "missing_in" | "missing_out" | "full_shift" | "edit_shift";

type SupabasePayPeriod = {
  id: string;
  label: string;
  start_date: string;
  end_date: string;
  is_closed: boolean;
};
type DailyTimecardRow = Database["public"]["Tables"]["daily_timecards"]["Row"];
type ForgottenPunchRequestRow = Database["public"]["Tables"]["forgotten_punch_requests"]["Row"];
type PtoEntryRow = Database["public"]["Tables"]["pto_entries"]["Row"];
type ActiveEmployeeRow = Pick<Database["public"]["Tables"]["profiles"]["Row"], "id" | "full_name">;

function addDays(dateOnly: string, days: number) {
  const d = new Date(`${dateOnly}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function roundHours(value: number) {
  return Number(value.toFixed(2));
}

async function getSupabasePeriodById(payPeriodId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("pay_periods")
    .select("id, label, start_date, end_date, is_closed")
    .eq("id", payPeriodId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as SupabasePayPeriod | null) ?? null;
}

async function getSupabasePeriodForDate(workDate: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("pay_periods")
    .select("id, label, start_date, end_date, is_closed")
    .lte("start_date", workDate)
    .gte("end_date", workDate)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as SupabasePayPeriod | null) ?? null;
}

async function assertSupabaseWritableByDate(workDate: string, role: AppRole) {
  const period = await getSupabasePeriodForDate(workDate);
  if (!period) return null;
  if (period.is_closed && normalizeRoleKey(role) !== "admin") {
    throw new Error("Selected pay period is closed. Admin override is required.");
  }
  return period;
}

async function assertSupabaseWritableByPeriodId(payPeriodId: string, role: AppRole) {
  const period = await getSupabasePeriodById(payPeriodId);
  if (!period) return null;
  if (period.is_closed && normalizeRoleKey(role) !== "admin") {
    throw new Error("Selected pay period is closed. Admin override is required.");
  }
  return period;
}

async function ensurePayPeriodsExist() {
  const supabase = await createClient();
  const { data: payPeriodsData, error: payPeriodsError } = await supabase
    .from("pay_periods")
    .select("*")
    .order("start_date", { ascending: false });
  if (payPeriodsError) throw new Error(payPeriodsError.message);

  if ((payPeriodsData ?? []).length > 0) {
    return (payPeriodsData ?? []) as Array<SupabasePayPeriod>;
  }

  throw new Error(
    "No pay periods are configured in public.pay_periods. Configure canonical pay periods (migration/ops bootstrap) before using Director Timecards."
  );
}

export async function getDirectorTimecardsWorkspace(filters?: {
  payPeriodId?: string | null;
  employeeId?: string | null;
  status?: string | null;
  exceptionOnly?: boolean;
}) {
  const supabase = await createClient();
  const payPeriods = await ensurePayPeriodsExist();
  const current = getCurrentPayPeriod();
  const today = toEasternDate();
  const selectedPayPeriod =
    payPeriods.find((row) => row.id === filters?.payPeriodId) ??
    payPeriods.find((row) => row.start_date === current.startDate && row.end_date === current.endDate) ??
    payPeriods.find((row) => row.start_date <= today && row.end_date >= today) ??
    payPeriods[0];

  if (!selectedPayPeriod) throw new Error("No pay periods available.");

  const statusFilter = filters?.status && filters.status !== "all" ? filters.status : null;
  let timecardsQuery = supabase
    .from("daily_timecards")
    .select("*")
    .eq("pay_period_id", selectedPayPeriod.id)
    .order("work_date", { ascending: false });
  if (filters?.employeeId) timecardsQuery = timecardsQuery.eq("employee_id", filters.employeeId);
  if (statusFilter) timecardsQuery = timecardsQuery.eq("status", statusFilter);
  if (filters?.exceptionOnly) timecardsQuery = timecardsQuery.eq("has_exception", true);
  const { data: dailyTimecardsData, error: timecardsError } = await timecardsQuery;
  if (timecardsError) throw new Error(timecardsError.message);
  const dailyTimecards = (dailyTimecardsData ?? []) as DailyTimecardRow[];

  let forgottenQuery = supabase
    .from("forgotten_punch_requests")
    .select("*")
    .gte("work_date", selectedPayPeriod.start_date)
    .lte("work_date", selectedPayPeriod.end_date)
    .order("created_at", { ascending: false });
  if (filters?.employeeId) forgottenQuery = forgottenQuery.eq("employee_id", filters.employeeId);
  const { data: forgottenPunchRequestsData, error: forgottenError } = await forgottenQuery;
  if (forgottenError) throw new Error(forgottenError.message);
  const forgottenPunchRequests = (forgottenPunchRequestsData ?? []) as ForgottenPunchRequestRow[];

  let ptoQuery = supabase
    .from("pto_entries")
    .select("*")
    .gte("work_date", selectedPayPeriod.start_date)
    .lte("work_date", selectedPayPeriod.end_date)
    .order("work_date", { ascending: false });
  if (filters?.employeeId) ptoQuery = ptoQuery.eq("employee_id", filters.employeeId);
  const { data: ptoEntriesData, error: ptoError } = await ptoQuery;
  if (ptoError) throw new Error(ptoError.message);
  const ptoEntries = (ptoEntriesData ?? []) as PtoEntryRow[];

  const { data: employeesData, error: employeesError } = await supabase
    .from("profiles")
    .select("id, full_name, active")
    .eq("active", true)
    .order("full_name", { ascending: true });
  if (employeesError) throw new Error(employeesError.message);

  const pendingApprovals = dailyTimecards.filter((row) => row.status === "pending" || row.status === "needs_review");

  const ptoTotalsMap = new Map<string, { employee_id: string; employee_name: string; approved_hours: number }>();
  ptoEntries
    .filter((row) => row.status === "approved")
    .forEach((row) => {
      const key = `${row.employee_id}::${row.employee_name}`;
      const previous = ptoTotalsMap.get(key) ?? {
        employee_id: String(row.employee_id),
        employee_name: String(row.employee_name),
        approved_hours: 0
      };
      previous.approved_hours = roundHours(previous.approved_hours + Number(row.hours ?? 0));
      ptoTotalsMap.set(key, previous);
    });
  const ptoTotalsByEmployee = [...ptoTotalsMap.values()].sort((left, right) =>
    left.employee_name > right.employee_name ? 1 : -1
  );

  const summaryMap = new Map<
    string,
    {
      employee_name: string;
      regular_hours: number;
      overtime_hours: number;
      pto_hours: number;
      total_paid_hours: number;
      exception_count: number;
      statuses: Set<TimecardStatus>;
    }
  >();
  dailyTimecards.forEach((row) => {
    const employeeId = String(row.employee_id);
    const currentRow = summaryMap.get(employeeId) ?? {
      employee_name: String(row.employee_name),
      regular_hours: 0,
      overtime_hours: 0,
      pto_hours: 0,
      total_paid_hours: 0,
      exception_count: 0,
      statuses: new Set<TimecardStatus>()
    };
    currentRow.regular_hours = roundHours(
      currentRow.regular_hours + Math.max(Number(row.worked_hours ?? 0) - Number(row.overtime_hours ?? 0), 0)
    );
    currentRow.overtime_hours = roundHours(currentRow.overtime_hours + Number(row.overtime_hours ?? 0));
    currentRow.pto_hours = roundHours(currentRow.pto_hours + Number(row.pto_hours ?? 0));
    currentRow.total_paid_hours = roundHours(currentRow.total_paid_hours + Number(row.total_paid_hours ?? 0));
    currentRow.exception_count += row.has_exception ? 1 : 0;
    currentRow.statuses.add(row.status as TimecardStatus);
    summaryMap.set(employeeId, currentRow);
  });
  const payPeriodSummary = [...summaryMap.values()].map((row) => ({
    employee_name: row.employee_name,
    regular_hours: row.regular_hours,
    overtime_hours: row.overtime_hours,
    pto_hours: row.pto_hours,
    total_paid_hours: row.total_paid_hours,
    exception_count: row.exception_count,
    approval_state:
      row.statuses.has("pending") || row.statuses.has("needs_review")
        ? "pending"
        : row.statuses.has("corrected")
          ? "corrected"
          : "approved"
  }));

  return {
    availableEmployees: ((employeesData ?? []) as ActiveEmployeeRow[]).map((row) => ({
      id: row.id,
      name: row.full_name
    })),
    payPeriods,
    selectedPayPeriod,
    pendingApprovals,
    dailyTimecards,
    forgottenPunchRequests,
    ptoEntries,
    ptoTotalsByEmployee,
    payPeriodSummary
  };
}

export async function getEmployeeForgottenPunchRequests(employeeId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("forgotten_punch_requests")
    .select("*")
    .eq("employee_id", employeeId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function submitForgottenPunchRequest(input: {
  employeeId: string;
  employeeName: string;
  workDate: string;
  requestType: ForgottenPunchRequestType;
  requestedIn?: string | null;
  requestedOut?: string | null;
  reason: string;
  employeeNote?: string | null;
}) {
  const needsIn =
    input.requestType === "missing_in" ||
    input.requestType === "full_shift" ||
    input.requestType === "edit_shift";
  const needsOut =
    input.requestType === "missing_out" ||
    input.requestType === "full_shift" ||
    input.requestType === "edit_shift";
  if (needsIn && !input.requestedIn) throw new Error("Requested IN time is required.");
  if (needsOut && !input.requestedOut) throw new Error("Requested OUT time is required.");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("forgotten_punch_requests")
    .insert({
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
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function approveDailyTimecard(input: {
  timecardId: string;
  approverName: string;
  role: AppRole;
  note?: string | null;
}) {
  const supabase = await createClient();
  const { data: row, error: readError } = await supabase
    .from("daily_timecards")
    .select("id, pay_period_id")
    .eq("id", input.timecardId)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!row) throw new Error("Daily timecard not found.");
  await assertSupabaseWritableByPeriodId(String(row.pay_period_id), input.role);

  const { error } = await supabase
    .from("daily_timecards")
    .update({
      status: "approved",
      director_note: (input.note ?? "").trim() || null,
      approved_by: input.approverName,
      approved_at: toEasternISO(),
      updated_at: toEasternISO()
    })
    .eq("id", input.timecardId);
  if (error) throw new Error(error.message);
}

export async function markDailyTimecardNeedsReview(input: {
  timecardId: string;
  role: AppRole;
  note?: string | null;
}) {
  const supabase = await createClient();
  const { data: row, error: readError } = await supabase
    .from("daily_timecards")
    .select("id, pay_period_id")
    .eq("id", input.timecardId)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!row) throw new Error("Daily timecard not found.");
  await assertSupabaseWritableByPeriodId(String(row.pay_period_id), input.role);

  const { error } = await supabase
    .from("daily_timecards")
    .update({
      status: "needs_review",
      director_note: (input.note ?? "").trim() || null,
      approved_by: null,
      approved_at: null,
      updated_at: toEasternISO()
    })
    .eq("id", input.timecardId);
  if (error) throw new Error(error.message);
}

export async function addDirectorCorrectionPunch(input: {
  employeeId: string;
  employeeName: string;
  workDate: string;
  time: string;
  type: "in" | "out";
  note?: string | null;
  createdBy: string;
  role: AppRole;
}) {
  await assertSupabaseWritableByDate(input.workDate, input.role);
  const supabase = await createClient();
  const { error } = await supabase.from("punches").insert({
    employee_id: input.employeeId,
    employee_name: input.employeeName,
    timestamp: easternDateTimeLocalToISO(`${input.workDate}T${input.time}`),
    type: input.type,
    source: "director_correction",
    status: "active",
    note: (input.note ?? "").trim() || `Director correction by ${input.createdBy}`,
    created_by: input.createdBy,
    created_at: toEasternISO(),
    updated_at: toEasternISO()
  });
  if (error) throw new Error(error.message);
}

export async function decideForgottenPunchRequest(input: {
  requestId: string;
  decision: Decision;
  decisionNote?: string | null;
  approverName: string;
  role: AppRole;
}) {
  const supabase = await createClient();
  const { data: request, error: readError } = await supabase
    .from("forgotten_punch_requests")
    .select("*")
    .eq("id", input.requestId)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!request) throw new Error("Forgotten punch request not found.");
  if (request.status !== "submitted") throw new Error("Only submitted requests can be reviewed.");
  await assertSupabaseWritableByDate(String(request.work_date), input.role);

  if (input.decision === "denied") {
    const { error } = await supabase
      .from("forgotten_punch_requests")
      .update({
        status: "denied",
        director_decision_note: (input.decisionNote ?? "").trim() || "Denied by director review.",
        approved_by: input.approverName,
        approved_at: toEasternISO(),
        updated_at: toEasternISO()
      })
      .eq("id", request.id);
    if (error) throw new Error(error.message);
    return;
  }

  const shouldAddIn =
    request.request_type === "missing_in" ||
    request.request_type === "full_shift" ||
    request.request_type === "edit_shift";
  const shouldAddOut =
    request.request_type === "missing_out" ||
    request.request_type === "full_shift" ||
    request.request_type === "edit_shift";

  if (request.request_type === "edit_shift") {
    const rangeStart = `${request.work_date}T00:00:00.000Z`;
    const rangeEnd = `${addDays(String(request.work_date), 1)}T00:00:00.000Z`;
    const { error: voidError } = await supabase
      .from("punches")
      .update({
        status: "voided",
        note: `[Voided by request ${request.id}]`,
        updated_at: toEasternISO()
      })
      .eq("employee_id", request.employee_id)
      .eq("status", "active")
      .gte("timestamp", rangeStart)
      .lt("timestamp", rangeEnd);
    if (voidError) throw new Error(voidError.message);
  }

  if (shouldAddIn && request.requested_in) {
    const { error: inError } = await supabase.from("punches").insert({
      employee_id: request.employee_id,
      employee_name: request.employee_name,
      timestamp: easternDateTimeLocalToISO(`${request.work_date}T${request.requested_in}`),
      type: "in",
      source: "approved_forgotten_punch",
      status: "active",
      note: `Request ${request.id} approved by ${input.approverName}`,
      created_by: input.approverName,
      created_at: toEasternISO(),
      updated_at: toEasternISO()
    });
    if (inError) throw new Error(inError.message);
  }
  if (shouldAddOut && request.requested_out) {
    const { error: outError } = await supabase.from("punches").insert({
      employee_id: request.employee_id,
      employee_name: request.employee_name,
      timestamp: easternDateTimeLocalToISO(`${request.work_date}T${request.requested_out}`),
      type: "out",
      source: "approved_forgotten_punch",
      status: "active",
      note: `Request ${request.id} approved by ${input.approverName}`,
      created_by: input.approverName,
      created_at: toEasternISO(),
      updated_at: toEasternISO()
    });
    if (outError) throw new Error(outError.message);
  }

  const { error } = await supabase
    .from("forgotten_punch_requests")
    .update({
      status: "approved",
      director_decision_note: (input.decisionNote ?? "").trim() || "Approved by director review.",
      approved_by: input.approverName,
      approved_at: toEasternISO(),
      updated_at: toEasternISO()
    })
    .eq("id", request.id);
  if (error) throw new Error(error.message);
}

export async function addPtoEntry(input: {
  employeeId: string;
  employeeName: string;
  workDate: string;
  hours: number;
  type: "vacation" | "sick" | "holiday" | "personal";
  note?: string | null;
  role: AppRole;
}) {
  await assertSupabaseWritableByDate(input.workDate, input.role);
  const supabase = await createClient();
  const { error } = await supabase.from("pto_entries").insert({
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
  if (error) throw new Error(error.message);
}

export async function updatePendingPtoEntry(input: {
  entryId: string;
  hours: number;
  type: "vacation" | "sick" | "holiday" | "personal";
  note?: string | null;
  role: AppRole;
}) {
  const supabase = await createClient();
  const { data: row, error: readError } = await supabase
    .from("pto_entries")
    .select("id, status, work_date")
    .eq("id", input.entryId)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!row) throw new Error("PTO entry not found.");
  if (row.status !== "pending") throw new Error("Only pending PTO entries can be edited.");
  await assertSupabaseWritableByDate(String(row.work_date), input.role);

  const { error } = await supabase
    .from("pto_entries")
    .update({
      hours: Math.max(0, input.hours),
      type: input.type,
      note: (input.note ?? "").trim() || null,
      updated_at: toEasternISO()
    })
    .eq("id", input.entryId);
  if (error) throw new Error(error.message);
}

export async function decidePtoEntry(input: {
  entryId: string;
  decision: Decision;
  approverName: string;
  decisionNote?: string | null;
  role: AppRole;
}) {
  const supabase = await createClient();
  const { data: row, error: readError } = await supabase
    .from("pto_entries")
    .select("id, status, work_date")
    .eq("id", input.entryId)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!row) throw new Error("PTO entry not found.");
  if (row.status !== "pending") throw new Error("Only pending PTO entries can be reviewed.");
  await assertSupabaseWritableByDate(String(row.work_date), input.role);

  const { error } = await supabase
    .from("pto_entries")
    .update({
      status: input.decision,
      note: (input.decisionNote ?? "").trim() || null,
      approved_by: input.approverName,
      approved_at: toEasternISO(),
      updated_at: toEasternISO()
    })
    .eq("id", input.entryId);
  if (error) throw new Error(error.message);
}

export async function setPayPeriodClosed(input: {
  payPeriodId: string;
  isClosed: boolean;
  role: AppRole;
}) {
  const role = normalizeRoleKey(input.role);
  if (role !== "admin" && role !== "director") {
    throw new Error("Only director/admin can lock or reopen pay periods.");
  }

  const period = await getSupabasePeriodById(input.payPeriodId);
  if (!period) throw new Error("Pay period not found.");
  const supabase = await createClient();
  const { error } = await supabase
    .from("pay_periods")
    .update({ is_closed: input.isClosed, updated_at: toEasternISO() })
    .eq("id", input.payPeriodId);
  if (error) throw new Error(error.message);
}
