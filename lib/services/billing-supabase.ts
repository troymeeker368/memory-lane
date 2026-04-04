import { createClient } from "@/lib/supabase/server";
import {
  BILLING_BATCH_TYPE_OPTIONS,
  type BatchGenerationInput,
  type FinalizeBatchInput,
  type ReopenBatchInput
} from "@/lib/services/billing-types";
import {
  addMonths,
  normalizeDateOnly,
  startOfMonth
} from "@/lib/services/billing-utils";
import { getBillingGenerationPreview } from "@/lib/services/billing-read-supabase";
import {
  buildBillingBatchWritePlan,
  invokeFinalizeBillingBatchRpc,
  invokeFinalizeBillingInvoicesRpc,
  invokeGenerateBillingBatchRpc,
  invokeReopenBillingBatchRpc
} from "@/lib/services/billing-rpc";
import { getActiveCenterBillingSetting, getActiveMemberBillingSetting } from "@/lib/services/billing-configuration";
export {
  resolveActiveEffectiveMemberRowForDate,
  resolveActiveEffectiveRowForDate,
  resolveConfiguredDailyRate,
  resolveEffectiveDailyRate,
  resolveEffectiveExtraDayRate,
  resolveEffectiveBillingMode
} from "@/lib/services/billing-effective";
import { resolveExtraDayRate } from "@/lib/services/billing-preview-helpers";
import { loadExpectedAttendanceSupabaseContext, resolveExpectedAttendanceFromSupabaseContext } from "@/lib/services/expected-attendance-supabase";
import { toEasternDate, toEasternISO } from "@/lib/timezone";
import {
  recordImmediateSystemAlert,
  recordWorkflowEvent
} from "@/lib/services/workflow-observability";
import type { Database } from "@/types/supabase-types";

type Tables = Database["public"]["Tables"];
type BillingInvoiceRow = Tables["billing_invoices"]["Row"];
export type { BillingDashboardSummary } from "@/lib/services/billing-read-supabase";
export { createBillingExport } from "@/lib/services/billing-exports";
export { createCustomInvoice, createEnrollmentProratedInvoice } from "@/lib/services/billing-custom-invoices";

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
    memberSetting,
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
    const now = toEasternISO();
    await invokeFinalizeBillingBatchRpc({
      billingBatchId: input.billingBatchId,
      finalizedBy: input.finalizedBy,
      now,
      today: toEasternDate()
    });
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
    const now = toEasternISO();
    await invokeReopenBillingBatchRpc({
      billingBatchId: input.billingBatchId,
      reopenedBy: input.reopenedBy,
      now
    });
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
    const now = toEasternISO();
    await invokeFinalizeBillingInvoicesRpc({
      invoiceIds: [input.invoiceId],
      finalizedBy: input.finalizedBy,
      now,
      today: toEasternDate()
    });
    return { ok: true as const };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Unable to finalize invoice."
    };
  }
}

export async function finalizeInvoices(input: { invoiceIds: string[]; finalizedBy: string }) {
  try {
    const uniqueInvoiceIds = Array.from(
      new Set(input.invoiceIds.map((value) => String(value ?? "").trim()).filter(Boolean))
    );
    if (uniqueInvoiceIds.length === 0) {
      return { ok: false as const, error: "Select at least one invoice to finalize." };
    }

    const finalizedCount = await invokeFinalizeBillingInvoicesRpc({
      invoiceIds: uniqueInvoiceIds,
      finalizedBy: input.finalizedBy,
      now: toEasternISO(),
      today: toEasternDate()
    });

    return { ok: true as const, finalizedCount };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Unable to finalize invoices."
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


