import { randomUUID } from "node:crypto";

import { createClient } from "@/lib/supabase/server";
import {
  BILLING_BATCH_TYPE_OPTIONS,
  BILLING_EXPORT_TYPES,
  type BatchGenerationInput,
  type BillingSettingRow,
  type CustomInvoiceManualLine,
  type CreateCustomInvoiceInput,
  type FinalizeBatchInput,
  type ReopenBatchInput,
  type ScheduleTemplateRow
} from "@/lib/services/billing-types";
import {
  addDays,
  addMonths,
  asNumber,
  buildCustomInvoiceNumber,
  endOfMonth,
  normalizeDateOnly,
  startOfMonth,
  toAmount,
  toDateRange
} from "@/lib/services/billing-utils";
import {
  buildCsvRows,
  collectBillingEligibleBaseDates,
  mapCoverageTypeForLineType,
  normalizeInvoiceRow,
  toDataUrl
} from "@/lib/services/billing-core";
import { getBillingGenerationPreview } from "@/lib/services/billing-read-supabase";
import {
  buildBillingBatchWritePlan,
  invokeCreateBillingExportRpc,
  invokeGenerateBillingBatchRpc
} from "@/lib/services/billing-rpc";
import {
  formatBillingPayorDisplayName,
  listBillingPayorContactsForMembers
} from "@/lib/services/billing-payor-contacts";
export {
  resolveActiveEffectiveMemberRowForDate,
  resolveActiveEffectiveRowForDate,
  resolveConfiguredDailyRate,
  resolveEffectiveDailyRate,
  resolveEffectiveExtraDayRate,
  resolveEffectiveBillingMode
} from "@/lib/services/billing-effective";
import {
  resolveDailyRate,
  resolveExtraDayRate,
  resolveTransportationBillingStatus
} from "@/lib/services/billing-preview-helpers";
import {
  isMissingSchemaObjectError
} from "@/lib/services/billing-schema-errors";
import {
  getActiveBillingScheduleTemplate,
  getActiveCenterBillingSetting,
  getActiveMemberBillingSetting,
  getNonBillableCenterClosureSet
} from "@/lib/services/billing-configuration";
import {
  loadExpectedAttendanceSupabaseContext,
  resolveExpectedAttendanceFromSupabaseContext
} from "@/lib/services/expected-attendance-supabase";
import { toEasternDate, toEasternISO } from "@/lib/timezone";
import {
  recordImmediateSystemAlert,
  recordWorkflowEvent
} from "@/lib/services/workflow-observability";
import type { Database } from "@/types/supabase";

type Tables = Database["public"]["Tables"];
type AncillaryChargeCategoryRow = Tables["ancillary_charge_categories"]["Row"];
type AncillaryChargeLogRow = Tables["ancillary_charge_logs"]["Row"];
type BillingAdjustmentRow = Tables["billing_adjustments"]["Row"];
type BillingInvoiceLineRow = Tables["billing_invoice_lines"]["Row"];
type BillingInvoiceRow = Tables["billing_invoices"]["Row"];
type TransportationLogRow = Tables["transportation_logs"]["Row"];
type NormalizedBillingInvoiceRow = ReturnType<typeof normalizeInvoiceRow> &
  Pick<BillingInvoiceRow, "id" | "member_id" | "created_at" | "invoice_status">;

export {
  BILLING_ADJUSTMENT_TYPE_OPTIONS,
  BILLING_BATCH_TYPE_OPTIONS,
  BILLING_EXPORT_TYPES,
  CENTER_CLOSURE_TYPE_OPTIONS,
  MONTHLY_BILLING_BASIS_OPTIONS,
  BILLING_MODE_OPTIONS
} from "@/lib/services/billing-types";
export {
  deleteCenterClosure,
  ensureCenterClosuresForCurrentAndNextYear,
  generateClosuresForYear,
  getActiveBillingScheduleTemplate,
  getActiveCenterBillingSetting,
  getActiveMemberBillingSetting,
  getBillingMemberPayorLookups,
  listBillingScheduleTemplates,
  listCenterClosures,
  listClosureRules,
  listMemberBillingSettings,
  listPayors,
  upsertBillingAdjustment,
  upsertBillingScheduleTemplate,
  upsertCenterClosure,
  upsertClosureRule,
  upsertMemberBillingSetting,
  upsertPayor,
  validateCenterBillingSettingOverlap,
  validateMemberBillingSettingOverlap,
  validateScheduleTemplateOverlap
} from "@/lib/services/billing-configuration";
export { getBillingGenerationPreview };
export type { BillingDashboardSummary } from "@/lib/services/billing-read-supabase";

export async function syncAttendanceBillingForDate(input: { memberId: string; attendanceDate: string; actorName: string }) {
  const supabase = await createClient();
  const attendanceDate = normalizeDateOnly(input.attendanceDate);
  const { data: attendance, error: attendanceError } = await supabase
    .from("attendance_records")
    .select("*")
    .eq("member_id", input.memberId)
    .eq("attendance_date", attendanceDate)
    .maybeSingle();
  if (attendanceError) throw new Error(attendanceError.message);
  if (!attendance) return;

  const expectedContext = await loadExpectedAttendanceSupabaseContext({
    memberIds: [input.memberId],
    startDate: attendanceDate,
    endDate: attendanceDate,
    includeAttendanceRecords: false
  });
  const isScheduledDay = resolveExpectedAttendanceFromSupabaseContext({
    context: expectedContext,
    memberId: input.memberId,
    date: attendanceDate
  }).isScheduled;
  const memberSetting = await getActiveMemberBillingSetting(input.memberId, attendanceDate);
  const centerSetting = await getActiveCenterBillingSetting(attendanceDate);
  const extraDayRate = await resolveExtraDayRate({
    memberId: input.memberId,
    memberSetting:
      memberSetting ??
      ({
        id: "",
        member_id: input.memberId,
        payor_id: null,
        use_center_default_billing_mode: true,
        billing_mode: null,
        monthly_billing_basis: "ScheduledMonthBehind",
        use_center_default_rate: true,
        custom_daily_rate: null,
        flat_monthly_rate: null,
        bill_extra_days: true,
        transportation_billing_status: "BillNormally",
        bill_ancillary_arrears: true,
        active: true,
        effective_start_date: attendanceDate,
        effective_end_date: null,
        billing_notes: null,
        created_at: toEasternISO(),
        updated_at: toEasternISO(),
        updated_by_user_id: null,
        updated_by_name: null
      } satisfies BillingSettingRow),
    centerSetting
  });

  const shouldHaveExtraDayAdjustment =
    attendance.status === "present" &&
    !isScheduledDay &&
    (memberSetting?.bill_extra_days ?? true);

  let linkedAdjustmentId = attendance.linked_adjustment_id ? String(attendance.linked_adjustment_id) : null;
  if (shouldHaveExtraDayAdjustment) {
    if (linkedAdjustmentId) {
      const { error } = await supabase
        .from("billing_adjustments")
        .update({
          adjustment_date: attendanceDate,
          adjustment_type: "ExtraDay",
          description: "Unscheduled attendance extra day charge",
          quantity: 1,
          unit_rate: extraDayRate,
          amount: extraDayRate,
          billing_status: "Unbilled",
          created_by_system: true,
          source_table: "attendance_records",
          source_record_id: String(attendance.id),
          updated_at: toEasternISO(),
          created_by_name: input.actorName
        })
        .eq("id", linkedAdjustmentId);
      if (error) throw new Error(error.message);
    } else {
      const { data, error } = await supabase
        .from("billing_adjustments")
        .insert({
          member_id: input.memberId,
          payor_id: null,
          adjustment_date: attendanceDate,
          adjustment_type: "ExtraDay",
          description: "Unscheduled attendance extra day charge",
          quantity: 1,
          unit_rate: extraDayRate,
          amount: extraDayRate,
          billing_status: "Unbilled",
          created_by_system: true,
          source_table: "attendance_records",
          source_record_id: String(attendance.id),
          created_by_name: input.actorName,
          created_at: toEasternISO(),
          updated_at: toEasternISO()
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      linkedAdjustmentId = String(data.id);
    }
  } else if (linkedAdjustmentId) {
    const { error } = await supabase
      .from("billing_adjustments")
      .update({
        billing_status: "Excluded",
        exclusion_reason: "Attendance no longer requires extra-day billing.",
        invoice_id: null,
        updated_at: toEasternISO()
      })
      .eq("id", linkedAdjustmentId);
    if (error) throw new Error(error.message);
    linkedAdjustmentId = null;
  }

  const { error: attendanceUpdateError } = await supabase
    .from("attendance_records")
    .update({
      scheduled_day: isScheduledDay,
      unscheduled_day: !isScheduledDay,
      billable_extra_day: shouldHaveExtraDayAdjustment,
      billing_status: attendance.status === "present" ? "Unbilled" : "Excluded",
      linked_adjustment_id: linkedAdjustmentId,
      updated_at: toEasternISO()
    })
    .eq("id", attendance.id);
  if (attendanceUpdateError) throw new Error(attendanceUpdateError.message);
}
export async function generateBillingBatch(input: BatchGenerationInput) {
  try {
    const batchType =
      input.batchType && BILLING_BATCH_TYPE_OPTIONS.includes(input.batchType) ? input.batchType : "Mixed";
    const preview = await getBillingGenerationPreview({
      billingMonth: input.billingMonth,
      batchType
    });
    if (preview.rows.length === 0) {
      return { ok: false as const, error: "No eligible member invoices found for the selected batch period." };
    }

    const supabase = await createClient();
    const now = toEasternISO();
    const billingMonthStart = startOfMonth(input.billingMonth);
    const runDate = normalizeDateOnly(input.runDate, toEasternDate());

    const { data: existingInvoiceRows, error: existingInvoiceError } = await supabase
      .from("billing_invoices")
      .select("id, invoice_month, invoice_number");
    if (existingInvoiceError) throw new Error(existingInvoiceError.message);
    const existingCountByMonth = new Map<string, number>();
    ((existingInvoiceRows ?? []) as Pick<BillingInvoiceRow, "invoice_month">[]).forEach((row) => {
      const month = startOfMonth(String(row.invoice_month));
      existingCountByMonth.set(month, (existingCountByMonth.get(month) ?? 0) + 1);
    });
    const writePlan = buildBillingBatchWritePlan({
      batchType,
      billingMonthStart,
      runDate,
      runByUser: input.runByUser,
      runByName: input.runByName,
      now,
      previewRows: preview.rows,
      totalAmount: preview.totalAmount,
      existingCountByMonth
    });
    await invokeGenerateBillingBatchRpc(writePlan);
    await recordWorkflowEvent({
      eventType: "billing_batch_created",
      entityType: "billing_batch",
      entityId: writePlan.batchId,
      actorType: "user",
      actorUserId: input.runByUser,
      status: "created",
      severity: "low",
      metadata: {
        billing_month: billingMonthStart,
        batch_type: batchType,
        invoice_count: writePlan.invoicePayloads.length,
        total_amount: preview.totalAmount,
        run_date: runDate,
        generated_by_name: input.runByName
      }
    });

    return { ok: true as const, billingBatchId: writePlan.batchId };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unable to generate billing batch.";
    await recordWorkflowEvent({
      eventType: "billing_batch_failed",
      entityType: "billing_batch",
      actorType: "user",
      actorUserId: input.runByUser,
      status: "failed",
      severity: "high",
      metadata: {
        billing_month: input.billingMonth,
        batch_type: input.batchType ?? "Mixed",
        run_by_name: input.runByName,
        error: reason
      }
    });
    await recordImmediateSystemAlert({
      entityType: "billing_batch",
      actorUserId: input.runByUser,
      severity: "high",
      alertKey: "billing_batch_failed",
      metadata: {
        billing_month: input.billingMonth,
        batch_type: input.batchType ?? "Mixed",
        error: reason
      }
    });
    return {
      ok: false as const,
      error: reason
    };
  }
}

export async function finalizeBillingBatch(input: FinalizeBatchInput) {
  try {
    const supabase = await createClient();
    const now = toEasternISO();
    const { data: batch, error: batchError } = await supabase
      .from("billing_batches")
      .select("*")
      .eq("id", input.billingBatchId)
      .maybeSingle();
    if (batchError) throw new Error(batchError.message);
    if (!batch) return { ok: false as const, error: "Billing batch not found." };
    if (!["Draft", "Reviewed"].includes(String(batch.batch_status))) {
      return { ok: false as const, error: "Only Draft/Reviewed batches can be finalized." };
    }

    const { data: invoices, error: invoiceError } = await supabase
      .from("billing_invoices")
      .select("id")
      .eq("billing_batch_id", input.billingBatchId);
    if (invoiceError) throw new Error(invoiceError.message);
    for (const invoice of (invoices ?? []) as Pick<BillingInvoiceRow, "id">[]) {
      const finalized = await finalizeInvoice({ invoiceId: String(invoice.id), finalizedBy: input.finalizedBy });
      if (!finalized.ok) return finalized;
    }

    const { error: updateError } = await supabase
      .from("billing_batches")
      .update({
        batch_status: "Finalized",
        finalized_by: input.finalizedBy,
        finalized_at: now,
        completion_date: normalizeDateOnly(now),
        next_due_date: addMonths(startOfMonth(String(batch.billing_month)), 1),
        updated_at: now
      })
      .eq("id", input.billingBatchId);
    if (updateError) throw new Error(updateError.message);
    return { ok: true as const };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Unable to finalize billing batch."
    };
  }
}

export async function reopenBillingBatch(input: ReopenBatchInput) {
  try {
    const supabase = await createClient();
    const now = toEasternISO();
    const { data: batch, error: batchError } = await supabase
      .from("billing_batches")
      .select("*")
      .eq("id", input.billingBatchId)
      .maybeSingle();
    if (batchError) throw new Error(batchError.message);
    if (!batch) return { ok: false as const, error: "Billing batch not found." };

    const { data: invoices, error: invoiceError } = await supabase
      .from("billing_invoices")
      .select("id")
      .eq("billing_batch_id", input.billingBatchId);
    if (invoiceError) throw new Error(invoiceError.message);
    const invoiceIds = ((invoices ?? []) as Pick<BillingInvoiceRow, "id">[]).map((row) => String(row.id));

    if (invoiceIds.length > 0) {
      const { data: sourceLines, error: sourceLineError } = await supabase
        .from("billing_invoice_lines")
        .select("id, source_table, source_record_id")
        .in("invoice_id", invoiceIds);
      if (sourceLineError) throw new Error(sourceLineError.message);

      for (const line of (sourceLines ?? []) as Pick<BillingInvoiceLineRow, "source_table" | "source_record_id">[]) {
        const sourceTable = String(line.source_table ?? "");
        const sourceRecordId = String(line.source_record_id ?? "");
        if (!sourceTable || !sourceRecordId) continue;
        if (sourceTable === "transportation_logs") {
          const { error: sourceUpdateError } = await supabase
            .from("transportation_logs")
            .update({ billing_status: "Unbilled", invoice_id: null, updated_at: now })
            .eq("id", sourceRecordId);
          if (sourceUpdateError) throw new Error(sourceUpdateError.message);
        } else if (sourceTable === "ancillary_charge_logs") {
          const { error: sourceUpdateError } = await supabase
            .from("ancillary_charge_logs")
            .update({ billing_status: "Unbilled", invoice_id: null, updated_at: now })
            .eq("id", sourceRecordId);
          if (sourceUpdateError) throw new Error(sourceUpdateError.message);
        } else if (sourceTable === "billing_adjustments") {
          const { error: sourceUpdateError } = await supabase
            .from("billing_adjustments")
            .update({ billing_status: "Unbilled", invoice_id: null, updated_at: now })
            .eq("id", sourceRecordId);
          if (sourceUpdateError) throw new Error(sourceUpdateError.message);
        }
      }

      const { error: coverageDeleteError } = await supabase.from("billing_coverages").delete().in("source_invoice_id", invoiceIds);
      if (coverageDeleteError) throw new Error(coverageDeleteError.message);
      const { error: invoiceLineResetError } = await supabase
        .from("billing_invoice_lines")
        .update({ billing_status: "Unbilled", updated_at: now })
        .in("invoice_id", invoiceIds);
      if (invoiceLineResetError) throw new Error(invoiceLineResetError.message);
      const { error: invoiceResetError } = await supabase
        .from("billing_invoices")
        .update({
          invoice_status: "Draft",
          export_status: "NotExported",
          finalized_by: null,
          finalized_at: null,
          updated_at: now
        })
        .in("id", invoiceIds);
      if (invoiceResetError) throw new Error(invoiceResetError.message);
    }

    const { error: batchUpdateError } = await supabase
      .from("billing_batches")
      .update({
        batch_status: "Reviewed",
        reopened_by: input.reopenedBy,
        reopened_at: now,
        finalized_by: null,
        finalized_at: null,
        completion_date: null,
        updated_at: now
      })
      .eq("id", input.billingBatchId);
    if (batchUpdateError) throw new Error(batchUpdateError.message);
    return { ok: true as const };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Unable to reopen billing batch."
    };
  }
}

export async function finalizeInvoice(input: { invoiceId: string; finalizedBy: string }) {
  try {
    const supabase = await createClient();
    const now = toEasternISO();
    const { data: invoice, error: invoiceError } = await supabase
      .from("billing_invoices")
      .select("*")
      .eq("id", input.invoiceId)
      .maybeSingle();
    if (invoiceError) throw new Error(invoiceError.message);
    if (!invoice) return { ok: false as const, error: "Invoice not found." };
    if (String(invoice.invoice_status) === "Finalized") return { ok: true as const };

    const invoiceDate = normalizeDateOnly(invoice.invoice_date, toEasternDate());
    const dueDate = normalizeDateOnly(invoice.due_date, addDays(invoiceDate, 30));
    const { error: updateError } = await supabase
      .from("billing_invoices")
      .update({
        invoice_status: "Finalized",
        finalized_by: input.finalizedBy,
        finalized_at: now,
        invoice_date: invoiceDate,
        due_date: dueDate,
        updated_at: now
      })
      .eq("id", input.invoiceId);
    if (updateError) throw new Error(updateError.message);
    return { ok: true as const };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Unable to finalize invoice."
    };
  }
}

export async function createCustomInvoice(input: CreateCustomInvoiceInput) {
  try {
    const supabase = await createClient();
    const period = toDateRange(input.periodStart, input.periodEnd);
    const now = toEasternISO();
    const { data: member, error: memberError } = await supabase
      .from("members")
      .select("id, display_name")
      .eq("id", input.memberId)
      .maybeSingle();
    if (memberError) throw new Error(memberError.message);
    if (!member) return { ok: false as const, error: "Member not found." };

    const centerSetting = await getActiveCenterBillingSetting(period.start);
    const memberSetting = await getActiveMemberBillingSetting(input.memberId, period.start);
    const dailyRate = await resolveDailyRate({
      memberId: input.memberId,
      memberSetting:
      memberSetting ??
        ({
          id: "",
          member_id: input.memberId,
          payor_id: null,
          use_center_default_billing_mode: true,
          billing_mode: null,
          monthly_billing_basis: "ScheduledMonthBehind",
          use_center_default_rate: true,
          custom_daily_rate: null,
          flat_monthly_rate: null,
          bill_extra_days: true,
          transportation_billing_status: "BillNormally",
          bill_ancillary_arrears: true,
          active: true,
          effective_start_date: period.start,
          effective_end_date: null,
          billing_notes: null,
          created_at: now,
          updated_at: now,
          updated_by_user_id: null,
          updated_by_name: null
        } satisfies BillingSettingRow),
      centerSetting
    });

    const nonBillableClosures = await getNonBillableCenterClosureSet(period);
    const schedule = input.useScheduleTemplate ? await getActiveBillingScheduleTemplate(input.memberId, period.start) : null;
    const expectedAttendanceContext = await loadExpectedAttendanceSupabaseContext({
      memberIds: [input.memberId],
      startDate: period.start,
      endDate: period.end,
      includeAttendanceRecords: false
    });
    const memberHolds = expectedAttendanceContext.holdsByMember.get(input.memberId) ?? [];
    const memberScheduleChanges = expectedAttendanceContext.scheduleChangesByMember.get(input.memberId) ?? [];
    const manualIncludeDates = (input.manualIncludeDates ?? []).map((value) => normalizeDateOnly(value, "")).filter(Boolean);
    const manualExcludeDates = new Set((input.manualExcludeDates ?? []).map((value) => normalizeDateOnly(value, "")).filter(Boolean));
    const baseDates = collectBillingEligibleBaseDates({
      range: period,
      schedule: schedule as ScheduleTemplateRow | null,
      attendanceSetting: null,
      includeAllWhenNoSchedule: !schedule,
      holds: memberHolds,
      scheduleChanges: memberScheduleChanges,
      nonBillableClosures
    });
    manualIncludeDates.forEach((dateOnly) => {
      if (!nonBillableClosures.has(dateOnly)) baseDates.add(dateOnly);
    });
    manualExcludeDates.forEach((dateOnly) => baseDates.delete(dateOnly));

    const baseLineItems: CustomInvoiceManualLine[] = [];
    if (input.calculationMethod === "ManualLineItems") {
      baseLineItems.push(...(input.manualLineItems ?? []));
    } else if (input.calculationMethod === "FlatAmount") {
      baseLineItems.push({
        description: "Custom flat amount",
        quantity: 1,
        unitRate: asNumber(input.flatAmount),
        amount: asNumber(input.flatAmount),
        lineType: "BaseProgram"
      });
    } else {
      baseLineItems.push({
        description: `Custom program charges (${baseDates.size} day(s))`,
        quantity: baseDates.size,
        unitRate: dailyRate,
        amount: toAmount(baseDates.size * dailyRate),
        lineType: "BaseProgram"
      });
    }

    const transportBillingStatus = await resolveTransportationBillingStatus({
      memberId: input.memberId,
      memberSetting
    });
    const variableRows: Array<{
      line_type: "Transportation" | "Ancillary" | "Adjustment" | "Credit";
      service_date: string | null;
      service_period_start: string;
      service_period_end: string;
      description: string;
      quantity: number;
      unit_rate: number;
      amount: number;
      source_table: "transportation_logs" | "ancillary_charge_logs" | "billing_adjustments";
      source_record_id: string;
    }> = [];

    if (input.includeTransportation) {
      const { data: rows, error } = await supabase
        .from("transportation_logs")
        .select("id, service_date, transport_type, quantity, unit_rate, total_amount, billing_status, billable")
        .eq("member_id", input.memberId)
        .gte("service_date", period.start)
        .lte("service_date", period.end);
      if (error) throw new Error(error.message);
      ((rows ?? []) as TransportationLogRow[])
        .filter((row) => String(row.billing_status ?? "Unbilled") === "Unbilled")
        .filter((row) => row.billable !== false)
        .forEach((row) => {
          const amount = toAmount(
            asNumber(row.total_amount) > 0
              ? asNumber(row.total_amount)
              : asNumber(row.quantity || 1) * asNumber(row.unit_rate)
          );
          const serviceDate = normalizeDateOnly(row.service_date);
          variableRows.push({
            line_type: "Transportation",
            service_date: serviceDate,
            service_period_start: serviceDate,
            service_period_end: serviceDate,
            description: `Transportation (${row.transport_type ?? "Trip"})`,
            quantity: asNumber(row.quantity || 1),
            unit_rate: toAmount(asNumber(row.unit_rate)),
            amount,
            source_table: "transportation_logs",
            source_record_id: String(row.id)
          });
        });
    }

    if (input.includeAncillary) {
      const [{ data: rows, error }, { data: categories, error: categoryError }] = await Promise.all([
        supabase
          .from("ancillary_charge_logs")
          .select("id, category_id, service_date, quantity, unit_rate, amount, billing_status")
          .eq("member_id", input.memberId)
          .gte("service_date", period.start)
          .lte("service_date", period.end),
        supabase.from("ancillary_charge_categories").select("id, name, price_cents")
      ]);
      if (error) throw new Error(error.message);
      if (categoryError) throw new Error(categoryError.message);
      const categoryById = new Map(
        ((categories ?? []) as AncillaryChargeCategoryRow[]).map((row) => [String(row.id), row] as const)
      );
      ((rows ?? []) as AncillaryChargeLogRow[])
        .filter((row) => String(row.billing_status ?? "Unbilled") === "Unbilled")
        .forEach((row) => {
          const category = categoryById.get(String(row.category_id));
          const unitRate = asNumber(row.unit_rate) > 0 ? asNumber(row.unit_rate) : asNumber(category?.price_cents) / 100;
          const quantity = asNumber(row.quantity || 1);
          const amount = toAmount(asNumber(row.amount) > 0 ? asNumber(row.amount) : quantity * unitRate);
          const serviceDate = normalizeDateOnly(row.service_date);
          variableRows.push({
            line_type: "Ancillary",
            service_date: serviceDate,
            service_period_start: serviceDate,
            service_period_end: serviceDate,
            description: String(category?.name ?? "Ancillary Charge"),
            quantity,
            unit_rate: toAmount(unitRate),
            amount,
            source_table: "ancillary_charge_logs",
            source_record_id: String(row.id)
          });
        });
    }

    if (input.includeAdjustments) {
      const { data: rows, error } = await supabase
        .from("billing_adjustments")
        .select("id, adjustment_date, description, quantity, unit_rate, amount, billing_status")
        .eq("member_id", input.memberId)
        .gte("adjustment_date", period.start)
        .lte("adjustment_date", period.end);
      if (error) throw new Error(error.message);
      ((rows ?? []) as BillingAdjustmentRow[])
        .filter((row) => String(row.billing_status ?? "Unbilled") === "Unbilled")
        .forEach((row) => {
          const amount = toAmount(asNumber(row.amount));
          const serviceDate = normalizeDateOnly(row.adjustment_date);
          variableRows.push({
            line_type: amount < 0 ? "Credit" : "Adjustment",
            service_date: serviceDate,
            service_period_start: serviceDate,
            service_period_end: serviceDate,
            description: String(row.description ?? "Adjustment"),
            quantity: asNumber(row.quantity || 1),
            unit_rate: toAmount(asNumber(row.unit_rate)),
            amount,
            source_table: "billing_adjustments",
            source_record_id: String(row.id)
          });
        });
    }

    const baseProgramAmount = toAmount(
      baseLineItems
        .filter((line) => (line.lineType ?? "BaseProgram") === "BaseProgram")
        .reduce((sum, line) => sum + toAmount(line.amount ?? line.quantity * line.unitRate), 0)
    );
    const transportationAmount = toAmount(
      variableRows.filter((line) => line.line_type === "Transportation").reduce((sum, line) => sum + line.amount, 0)
    );
    const ancillaryAmount = toAmount(
      variableRows.filter((line) => line.line_type === "Ancillary").reduce((sum, line) => sum + line.amount, 0)
    );
    const adjustmentAmount = toAmount(
      variableRows
        .filter((line) => line.line_type === "Adjustment" || line.line_type === "Credit")
        .reduce((sum, line) => sum + line.amount, 0)
    );
    const totalAmount = toAmount(baseProgramAmount + transportationAmount + ancillaryAmount + adjustmentAmount);

    const { data: monthInvoiceRows, error: monthInvoiceError } = await supabase
      .from("billing_invoices")
      .select("id")
      .eq("invoice_source", "Custom")
      .eq("invoice_month", startOfMonth(period.start));
    if (monthInvoiceError) throw new Error(monthInvoiceError.message);
    const invoiceNumber = buildCustomInvoiceNumber(period.start, (monthInvoiceRows ?? []).length);

    const { data: invoiceData, error: invoiceError } = await supabase
      .from("billing_invoices")
      .insert({
        billing_batch_id: null,
        member_id: input.memberId,
        payor_id: null,
        invoice_number: invoiceNumber,
        invoice_month: startOfMonth(period.start),
        invoice_source: "Custom",
        invoice_status: "Draft",
        export_status: "NotExported",
        billing_mode_snapshot: "Custom",
        monthly_billing_basis_snapshot: null,
        transportation_billing_status_snapshot:
          variableRows.some((line) => line.line_type === "Transportation") ? "BillNormally" : transportBillingStatus,
        billing_method_snapshot: "InvoiceEmail",
        base_period_start: period.start,
        base_period_end: period.end,
        variable_charge_period_start: period.start,
        variable_charge_period_end: period.end,
        invoice_date: normalizeDateOnly(input.invoiceDate, toEasternDate()),
        due_date: normalizeDateOnly(input.dueDate, addDays(toEasternDate(), 30)),
        base_program_billed_days: baseDates.size,
        member_daily_rate_snapshot: dailyRate,
        base_program_amount: baseProgramAmount,
        transportation_amount: transportationAmount,
        ancillary_amount: ancillaryAmount,
        adjustment_amount: adjustmentAmount,
        total_amount: totalAmount,
        notes: input.notes ?? null,
        created_by_user_id: input.runByUser,
        created_by_name: input.runByName,
        created_at: now,
        updated_at: now
      })
      .select("*")
      .single();
    if (invoiceError) throw new Error(invoiceError.message);
    const invoiceId = String(invoiceData.id);

    const baseLines = baseLineItems.map((line) => {
      const lineType = line.lineType ?? "BaseProgram";
      return {
        invoice_id: invoiceId,
        member_id: input.memberId,
        payor_id: null,
        service_date: null,
        service_period_start: period.start,
        service_period_end: period.end,
        line_type: lineType,
        description: line.description,
        quantity: asNumber(line.quantity || 1),
        unit_rate: toAmount(asNumber(line.unitRate)),
        amount: toAmount(line.amount ?? asNumber(line.quantity || 1) * asNumber(line.unitRate)),
        source_table: "billing_invoices",
        source_record_id: invoiceId,
        billing_status: "Billed",
        created_at: now,
        updated_at: now
      };
    });
    const variableLines = variableRows.map((line) => ({
      invoice_id: invoiceId,
      member_id: input.memberId,
      payor_id: null,
      service_date: line.service_date,
      service_period_start: line.service_period_start,
      service_period_end: line.service_period_end,
      line_type: line.line_type,
      description: line.description,
      quantity: line.quantity,
      unit_rate: line.unit_rate,
      amount: line.amount,
      source_table: line.source_table,
      source_record_id: line.source_record_id,
      billing_status: "Billed",
      created_at: now,
      updated_at: now
    }));
    const { data: insertedLines, error: lineError } = await supabase
      .from("billing_invoice_lines")
      .insert([...baseLines, ...variableLines])
      .select("id, line_type, source_table, source_record_id, service_period_start, service_period_end");
    if (lineError) throw new Error(lineError.message);

    for (const line of variableRows) {
      if (line.source_table === "transportation_logs") {
        await supabase
          .from("transportation_logs")
          .update({ billing_status: "Billed", invoice_id: invoiceId, updated_at: now })
          .eq("id", line.source_record_id);
      } else if (line.source_table === "ancillary_charge_logs") {
        await supabase
          .from("ancillary_charge_logs")
          .update({ billing_status: "Billed", invoice_id: invoiceId, updated_at: now })
          .eq("id", line.source_record_id);
      } else {
        await supabase
          .from("billing_adjustments")
          .update({ billing_status: "Billed", invoice_id: invoiceId, updated_at: now })
          .eq("id", line.source_record_id);
      }
    }

    const coverageRows = ((insertedLines ?? []) as Pick<
      BillingInvoiceLineRow,
      "id" | "line_type" | "source_table" | "source_record_id" | "service_period_start" | "service_period_end"
    >[]).map((line) => ({
      member_id: input.memberId,
      coverage_type: mapCoverageTypeForLineType(line.line_type),
      coverage_start_date: normalizeDateOnly(line.service_period_start, period.start),
      coverage_end_date: normalizeDateOnly(line.service_period_end, period.end),
      source_invoice_id: invoiceId,
      source_invoice_line_id: String(line.id),
      source_table: line.source_table ?? null,
      source_record_id: line.source_record_id ?? null,
      created_at: now
    }));
    if (coverageRows.length > 0) {
      const { error: coverageError } = await supabase.from("billing_coverages").insert(coverageRows);
      if (coverageError) throw new Error(coverageError.message);
    }

    return { ok: true as const, invoiceId };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Unable to create custom invoice."
    };
  }
}

export async function createEnrollmentProratedInvoice(input: {
  memberId: string;
  payorId?: string | null;
  effectiveStartDate: string;
  periodEndDate?: string | null;
  includeTransportation?: boolean;
  includeAncillary?: boolean;
  includeAdjustments?: boolean;
  notes?: string | null;
  runByUser: string;
  runByName: string;
}) {
  const startDate = normalizeDateOnly(input.effectiveStartDate, toEasternDate());
  const endDate = normalizeDateOnly(input.periodEndDate, endOfMonth(startDate));
  return createCustomInvoice({
    memberId: input.memberId,
    payorId: input.payorId ?? null,
    invoiceDate: toEasternDate(),
    dueDate: addDays(toEasternDate(), 30),
    periodStart: startDate,
    periodEnd: endDate,
    calculationMethod: "DailyRateTimesDates",
    useScheduleTemplate: false,
    includeTransportation: Boolean(input.includeTransportation),
    includeAncillary: Boolean(input.includeAncillary),
    includeAdjustments: Boolean(input.includeAdjustments),
    manualIncludeDates: [],
    manualExcludeDates: [],
    notes: input.notes ?? "Enrollment proration invoice",
    runByUser: input.runByUser,
    runByName: input.runByName
  });
}

export async function createBillingExport(input: {
  billingBatchId: string;
  exportType: (typeof BILLING_EXPORT_TYPES)[number];
  quickbooksDetailLevel: "Summary" | "Detailed";
  generatedBy: string;
}) {
  try {
    const supabase = await createClient();
    const now = toEasternISO();
    const [{ data: batch, error: batchError }, { data: invoices, error: invoiceError }] = await Promise.all([
      supabase.from("billing_batches").select("*").eq("id", input.billingBatchId).maybeSingle(),
      supabase
        .from("billing_invoices")
        .select("*")
        .eq("billing_batch_id", input.billingBatchId)
        .in("invoice_status", ["Finalized", "Sent", "Paid", "PartiallyPaid", "Void"])
    ]);
    if (batchError) {
      if (isMissingSchemaObjectError(batchError)) {
        return { ok: false as const, error: "Billing execution schema is not available yet. Apply Supabase migration 0013 first." };
      }
      throw new Error(batchError.message);
    }
    if (invoiceError) {
      if (isMissingSchemaObjectError(invoiceError)) {
        return { ok: false as const, error: "Billing execution schema is not available yet. Apply Supabase migration 0013 first." };
      }
      throw new Error(invoiceError.message);
    }
    if (!batch) return { ok: false as const, error: "Billing batch not found." };
    const invoiceRows = ((invoices ?? []) as BillingInvoiceRow[]).map(
      (row) => normalizeInvoiceRow(row) as NormalizedBillingInvoiceRow
    );
    if (invoiceRows.length === 0) {
      return { ok: false as const, error: "No finalized invoices available for export." };
    }
    const payorByMember = await listBillingPayorContactsForMembers(
      invoiceRows.map((row) => String(row.member_id))
    );

    const invoiceIds = invoiceRows.map((row) => String(row.id));
    const { data: lines, error: linesError } = await supabase
      .from("billing_invoice_lines")
      .select("*")
      .in("invoice_id", invoiceIds);
    if (linesError) {
      if (isMissingSchemaObjectError(linesError)) {
        return { ok: false as const, error: "Billing execution schema is not available yet. Apply Supabase migration 0013 first." };
      }
      throw new Error(linesError.message);
    }

    let csv = "";
    if (input.exportType === "InvoiceSummaryCSV" || input.quickbooksDetailLevel === "Summary") {
      const header = [
        "InvoiceNumber",
        "InvoiceMonth",
        "MemberId",
        "PayorContactId",
        "PayorName",
        "QuickBooksCustomerId",
        "InvoiceStatus",
        "TotalAmount"
      ];
      const body = invoiceRows.map((row) => {
        const payor = payorByMember.get(String(row.member_id)) ?? null;
        return [
          row.invoice_number,
          row.invoice_month,
          row.member_id,
          payor?.contact_id ?? "",
          payor ? formatBillingPayorDisplayName(payor) : "No payor contact designated",
          payor?.quickbooks_customer_id ?? "",
          row.invoice_status,
          toAmount(row.total_amount)
        ];
      });
      csv = buildCsvRows(header, body);
    } else if (input.exportType === "InternalReviewCSV") {
      const header = ["InvoiceNumber", "LineType", "Description", "ServiceDate", "Quantity", "UnitRate", "Amount"];
      const invoiceById = new Map(invoiceRows.map((row) => [String(row.id), row] as const));
      const body = ((lines ?? []) as BillingInvoiceLineRow[]).map((line) => [
          invoiceById.get(String(line.invoice_id))?.invoice_number ?? "",
          line.line_type,
          line.description,
          line.service_date ?? "",
          asNumber(line.quantity),
          toAmount(asNumber(line.unit_rate)),
          toAmount(asNumber(line.amount))
        ]);
      csv = buildCsvRows(header, body);
    } else {
      const header = ["Customer", "CustomerContactId", "QuickBooksCustomerId", "InvoiceNumber", "Date", "DueDate", "Amount"];
      const body = invoiceRows.map((row) => {
        const payor = payorByMember.get(String(row.member_id)) ?? null;
        return [
          payor ? formatBillingPayorDisplayName(payor) : "No payor contact designated",
          payor?.contact_id ?? "",
          payor?.quickbooks_customer_id ?? "",
          row.invoice_number,
          row.invoice_date ?? row.created_at,
          row.due_date ?? "",
          toAmount(row.total_amount)
        ];
      });
      csv = buildCsvRows(header, body);
    }

    const fileName = `${input.exportType}-${startOfMonth(String(batch.billing_month))}-${Date.now()}.csv`;
    const billingExportId = randomUUID();
    await invokeCreateBillingExportRpc({
      exportJobPayload: {
        id: billingExportId,
        billing_batch_id: input.billingBatchId,
        export_type: input.exportType,
        quickbooks_detail_level: input.quickbooksDetailLevel,
        file_name: fileName,
        file_data_url: toDataUrl(fileName, csv),
        generated_at: now,
        generated_by: input.generatedBy,
        status: "Generated",
        notes: null,
        created_at: now,
        updated_at: now
      },
      invoiceIds
    });
    await recordWorkflowEvent({
      eventType: "billing_export_generated",
      entityType: "billing_batch",
      entityId: input.billingBatchId,
      actorType: "user",
      status: "generated",
      severity: "low",
      metadata: {
        billing_export_id: billingExportId,
        export_type: input.exportType,
        quickbooks_detail_level: input.quickbooksDetailLevel,
        generated_by: input.generatedBy,
        invoice_count: invoiceIds.length
      }
    });

    return { ok: true as const, billingExportId };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unable to generate billing export.";
    await recordWorkflowEvent({
      eventType: "billing_export_failed",
      entityType: "billing_batch",
      entityId: input.billingBatchId,
      actorType: "user",
      status: "failed",
      severity: "high",
      metadata: {
        export_type: input.exportType,
        quickbooks_detail_level: input.quickbooksDetailLevel,
        generated_by: input.generatedBy,
        error: reason
      }
    });
    await recordImmediateSystemAlert({
      entityType: "billing_batch",
      entityId: input.billingBatchId,
      severity: "high",
      alertKey: "billing_export_failed",
      metadata: {
        export_type: input.exportType,
        quickbooks_detail_level: input.quickbooksDetailLevel,
        error: reason
      }
    });
    return {
      ok: false as const,
      error: reason
    };
  }
}

export async function setVariableChargeBillingStatus(input: {
  table: "transportationLogs" | "ancillaryLogs" | "billingAdjustments";
  id: string;
  billingStatus: "Unbilled" | "Billed" | "Excluded";
  exclusionReason?: string | null;
}) {
  const supabase = await createClient();
  const now = toEasternISO();
  if (input.table === "transportationLogs") {
    const { data, error } = await supabase
      .from("transportation_logs")
      .update({
        billing_status: input.billingStatus,
        billing_exclusion_reason: input.billingStatus === "Excluded" ? input.exclusionReason ?? null : null,
        updated_at: now
      })
      .eq("id", input.id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }
  if (input.table === "ancillaryLogs") {
    const { data, error } = await supabase
      .from("ancillary_charge_logs")
      .update({
        billing_status: input.billingStatus,
        billing_exclusion_reason: input.billingStatus === "Excluded" ? input.exclusionReason ?? null : null,
        updated_at: now
      })
      .eq("id", input.id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }
  const { data, error } = await supabase
    .from("billing_adjustments")
    .update({
      billing_status: input.billingStatus,
      exclusion_reason: input.billingStatus === "Excluded" ? input.exclusionReason ?? null : null,
      updated_at: now
    })
    .eq("id", input.id)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}


