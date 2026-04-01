import { Buffer } from "node:buffer";

import type {
  AttendanceSettingWeekdays,
  BillingSettingRow,
  DateRange,
  ScheduleTemplateRow
} from "@/lib/services/billing-types";
import type { Database } from "@/types/supabase-types";
import {
  addDays,
  attendanceSettingIncludesDate,
  escapeCsv,
  previousMonth,
  scheduleIncludesDate,
  toMonthRange,
  weekdayKey
} from "@/lib/services/billing-utils";
import {
  isMemberHoldActiveForDate,
  resolveExpectedAttendanceForDate
} from "@/lib/services/expected-attendance";
import type {
  BillingExpectedAttendanceCollectionInput,
  BillingExpectedAttendanceInput
} from "@/lib/services/billing-types";

function toWeekdayOnlyBaseSchedule(input: AttendanceSettingWeekdays | ScheduleTemplateRow | null | undefined) {
  if (!input) return null;
  return {
    monday: Boolean(input.monday),
    tuesday: Boolean(input.tuesday),
    wednesday: Boolean(input.wednesday),
    thursday: Boolean(input.thursday),
    friday: Boolean(input.friday)
  };
}

function isCanonicalScheduledForBillingDate(
  input: {
    dateOnly: string;
    includeBySchedule: boolean;
    baseSchedule: AttendanceSettingWeekdays | ScheduleTemplateRow | null | undefined;
    holds: BillingExpectedAttendanceInput["holds"];
    scheduleChanges: BillingExpectedAttendanceInput["scheduleChanges"];
    nonBillableClosures: Set<string>;
  }
) {
  if (!input.includeBySchedule) return false;
  if (input.nonBillableClosures.has(input.dateOnly)) return false;

  const day = weekdayKey(input.dateOnly);
  if (day === "saturday" || day === "sunday") {
    return !input.holds.some((hold) => isMemberHoldActiveForDate(hold, input.dateOnly));
  }

  const resolution = resolveExpectedAttendanceForDate({
    date: input.dateOnly,
    baseSchedule: toWeekdayOnlyBaseSchedule(input.baseSchedule),
    scheduleChanges: input.scheduleChanges,
    holds: input.holds,
    centerClosures: input.nonBillableClosures.has(input.dateOnly) ? [{ closure_date: input.dateOnly }] : []
  });
  return resolution.isScheduled;
}

export function collectBillingEligibleBaseDates(
  input: {
    range: DateRange;
    schedule: ScheduleTemplateRow | null;
    attendanceSetting: AttendanceSettingWeekdays | null;
    includeAllWhenNoSchedule: boolean;
    holds: BillingExpectedAttendanceCollectionInput["holds"];
    scheduleChanges: BillingExpectedAttendanceCollectionInput["scheduleChanges"];
    nonBillableClosures: Set<string>;
  }
) {
  const dates = new Set<string>();
  let cursor = input.range.start;
  while (cursor <= input.range.end) {
    const includeBySchedule = input.includeAllWhenNoSchedule
      ? true
      : input.schedule
        ? scheduleIncludesDate(input.schedule, cursor)
        : attendanceSettingIncludesDate(input.attendanceSetting, cursor);
    if (
      isCanonicalScheduledForBillingDate({
        dateOnly: cursor,
        includeBySchedule,
        baseSchedule: input.schedule ?? input.attendanceSetting,
        holds: input.holds,
        scheduleChanges: input.scheduleChanges,
        nonBillableClosures: input.nonBillableClosures
      })
    ) {
      dates.add(cursor);
    }
    cursor = addDays(cursor, 1);
  }
  return dates;
}

export function getMonthlyBillingBasis(setting: BillingSettingRow) {
  return setting.monthly_billing_basis === "ActualAttendanceMonthBehind"
    ? ("ActualAttendanceMonthBehind" as const)
    : ("ScheduledMonthBehind" as const);
}

type MemberInvoicePeriods = {
  invoiceMonth: string;
  baseRange: DateRange;
  variableRange: DateRange;
  billingModeSnapshot: "Membership" | "Monthly" | "Custom";
};

export function resolveMemberInvoicePeriods(input: {
  mode: "Membership" | "Monthly" | "Custom";
  batchType: "Membership" | "Monthly" | "Custom" | "Mixed";
  invoiceMonthStart: string;
}): MemberInvoicePeriods {
  if (input.mode === "Membership") {
    return {
      invoiceMonth: input.invoiceMonthStart,
      baseRange: toMonthRange(input.invoiceMonthStart),
      variableRange: toMonthRange(previousMonth(input.invoiceMonthStart)),
      billingModeSnapshot: "Membership"
    };
  }

  if (input.mode === "Monthly") {
    const invoiceMonth = input.batchType === "Mixed" ? previousMonth(input.invoiceMonthStart) : input.invoiceMonthStart;
    const baseMonth = previousMonth(invoiceMonth);
    const baseRange = toMonthRange(baseMonth);
    return {
      invoiceMonth,
      baseRange,
      variableRange: baseRange,
      billingModeSnapshot: "Monthly"
    };
  }

  const customRange = toMonthRange(input.invoiceMonthStart);
  return {
    invoiceMonth: input.invoiceMonthStart,
    baseRange: customRange,
    variableRange: customRange,
    billingModeSnapshot: "Custom"
  };
}

export function shouldProcessModeInBatch(input: {
  mode: "Membership" | "Monthly" | "Custom";
  batchType: "Membership" | "Monthly" | "Custom" | "Mixed";
}) {
  if (input.mode === "Custom") return false;
  if (input.batchType === "Mixed") return input.mode === "Membership" || input.mode === "Monthly";
  return input.mode === input.batchType;
}

export function mapCoverageTypeForLineType(lineType: string) {
  if (lineType === "BaseProgram") return "base_program";
  if (lineType === "Transportation") return "transportation";
  if (lineType === "Ancillary") return "ancillary";
  if (lineType === "Adjustment" || lineType === "Credit") return "adjustment";
  return "other";
}

export function computeDueState(nextDueDate: string | null, completionDate: string | null) {
  if (!nextDueDate) return completionDate ? "Completed" : "Unknown";
  if (completionDate) return "Completed";
  const today = new Date().toISOString().slice(0, 10);
  if (nextDueDate < today) return "Overdue";
  if (nextDueDate === today) return "Due";
  return "Upcoming";
}

export function toDataUrl(fileName: string, csv: string) {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]+/g, "-");
  const bytes = Buffer.from(csv, "utf8").toString("base64");
  return `data:text/csv;name=${encodeURIComponent(safeName)};base64,${bytes}`;
}

type BillingInvoiceLike = Database["public"]["Tables"]["billing_invoices"]["Row"] &
  Partial<{
    balance_due: number | null;
    balance_due_amount: number | null;
    completion_date: string | null;
    next_due_date: string | null;
    payments_amount: number | null;
    status: string | null;
  }>;

export type NormalizedInvoiceRow = BillingInvoiceLike & {
  invoice_number: string;
  member_id: string;
  billing_batch_id: string | null;
  invoice_month: string;
  invoice_date: string | null;
  due_date: string | null;
  total_amount: number;
  balance_due: number;
  completion_date: string | null;
  next_due_date: string | null;
  status: string;
  due_state: string;
};

export function normalizeInvoiceRow(row: BillingInvoiceLike): NormalizedInvoiceRow {
  const nextDueDate = row.next_due_date ? String(row.next_due_date) : null;
  const completionDate = row.completion_date ? String(row.completion_date) : null;
  return {
    ...row,
    invoice_number: String(row.invoice_number ?? ""),
    member_id: String(row.member_id ?? ""),
    billing_batch_id: row.billing_batch_id ? String(row.billing_batch_id) : null,
    invoice_month: String(row.invoice_month ?? ""),
    invoice_date: row.invoice_date ? String(row.invoice_date) : null,
    due_date: row.due_date ? String(row.due_date) : null,
    total_amount: Number(row.total_amount ?? 0),
    balance_due: Number(row.balance_due_amount ?? row.balance_due ?? row.total_amount ?? 0),
    completion_date: completionDate,
    next_due_date: nextDueDate,
    status: String(row.status ?? ""),
    due_state: computeDueState(nextDueDate, completionDate)
  };
}

export function buildCsvRows(header: string[], body: Array<Array<string | number | null | undefined>>) {
  return [header, ...body]
    .map((row) => row.map((value) => escapeCsv(value == null ? "" : String(value))).join(","))
    .join("\n");
}
