import "server-only";

import { randomUUID } from "node:crypto";

import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";
import { createClient } from "@/lib/supabase/server";
import type {
  BillingBatchCoverageRpcPayload,
  BillingBatchInvoiceLineRpcPayload,
  BillingBatchInvoiceRpcPayload,
  BillingBatchSourceUpdateRpcPayload,
  BillingBatchWritePlan,
  BillingExportRpcPayload,
  BillingPreviewRow
} from "@/lib/services/billing-types";
import { BILLING_BATCH_TYPE_OPTIONS } from "@/lib/services/billing-types";
import { addMonths, buildInvoiceNumber, normalizeDateOnly, startOfMonth } from "@/lib/services/billing-utils";

const BILLING_ATOMIC_WORKFLOW_MIGRATION = "0044_atomic_billing_and_completion_finalization.sql";
const CUSTOM_INVOICE_ATOMIC_WORKFLOW_MIGRATION = "0126_custom_invoice_atomic_rpc.sql";
const RPC_GENERATE_BILLING_BATCH = "rpc_generate_billing_batch";
const RPC_CREATE_BILLING_EXPORT = "rpc_create_billing_export";
const RPC_CREATE_CUSTOM_INVOICE = "rpc_create_custom_invoice";

function mapCoverageTypeForLineType(
  lineType: "BaseProgram" | "Transportation" | "Ancillary" | "Adjustment" | "Credit" | "PriorBalance"
): "BaseProgram" | "Transportation" | "Ancillary" | "Adjustment" {
  if (lineType === "BaseProgram") return "BaseProgram";
  if (lineType === "Transportation") return "Transportation";
  if (lineType === "Ancillary") return "Ancillary";
  return "Adjustment";
}

export function buildMissingBillingAtomicWorkflowMessage(functionName: string) {
  return `Billing atomic workflow RPC ${functionName} is not available in the connected Supabase API. Apply Supabase migration ${BILLING_ATOMIC_WORKFLOW_MIGRATION} and refresh the PostgREST schema cache.`;
}

export function buildMissingCustomInvoiceAtomicWorkflowMessage(functionName: string) {
  return `Billing custom invoice RPC ${functionName} is not available in the connected Supabase API. Apply Supabase migration ${CUSTOM_INVOICE_ATOMIC_WORKFLOW_MIGRATION} and refresh the PostgREST schema cache.`;
}

export function isMissingRpcFunctionError(error: unknown, functionName: string) {
  const candidate =
    error && typeof error === "object"
      ? (error as {
          code?: unknown;
          message?: unknown;
          details?: unknown;
          hint?: unknown;
          cause?: { code?: unknown; message?: unknown; details?: unknown; hint?: unknown } | null;
        })
      : null;
  const code = String(candidate?.code ?? candidate?.cause?.code ?? "").toUpperCase();
  const message = [
    candidate?.message,
    candidate?.details,
    candidate?.hint,
    candidate?.cause?.message,
    candidate?.cause?.details,
    candidate?.cause?.hint
  ]
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase();
  const normalizedName = functionName.toLowerCase();

  return (
    code === "PGRST202" ||
    message.includes(`function ${normalizedName}`) ||
    (message.includes(normalizedName) && message.includes("could not find")) ||
    (message.includes(normalizedName) && message.includes("does not exist"))
  );
}

export function buildBillingBatchWritePlan(input: {
  batchType: (typeof BILLING_BATCH_TYPE_OPTIONS)[number];
  billingMonthStart: string;
  runDate: string;
  runByUser: string;
  runByName: string;
  now: string;
  previewRows: BillingPreviewRow[];
  totalAmount: number;
  existingCountByMonth: Map<string, number>;
}): BillingBatchWritePlan {
  const batchId = randomUUID();
  const invoicePayloads: BillingBatchInvoiceRpcPayload[] = [];
  const invoiceLinePayloads: BillingBatchInvoiceLineRpcPayload[] = [];
  const coveragePayloads: BillingBatchCoverageRpcPayload[] = [];
  const sourceUpdates: BillingBatchSourceUpdateRpcPayload[] = [];

  for (const row of input.previewRows) {
    const monthKey = startOfMonth(row.invoiceMonth);
    const sequence = input.existingCountByMonth.get(monthKey) ?? 0;
    input.existingCountByMonth.set(monthKey, sequence + 1);

    const invoiceId = randomUUID();
    const invoiceNumber = buildInvoiceNumber(monthKey, sequence);
    invoicePayloads.push({
      id: invoiceId,
      member_id: row.memberId,
      payor_id: row.payorId,
      invoice_number: invoiceNumber,
      invoice_month: monthKey,
      invoice_source: "BatchGenerated",
      invoice_status: "Draft",
      export_status: "NotExported",
      billing_mode_snapshot: row.billingMode,
      monthly_billing_basis_snapshot: row.monthlyBillingBasis,
      transportation_billing_status_snapshot: row.transportationBillingStatusSnapshot,
      billing_method_snapshot: row.billingMethod,
      base_period_start: row.basePeriodStart,
      base_period_end: row.basePeriodEnd,
      variable_charge_period_start: row.variableChargePeriodStart,
      variable_charge_period_end: row.variableChargePeriodEnd,
      invoice_date: null,
      due_date: null,
      base_program_billed_days: row.baseProgramBilledDays,
      member_daily_rate_snapshot: row.memberDailyRateSnapshot,
      base_program_amount: row.baseProgramAmount,
      transportation_amount: row.transportationAmount,
      ancillary_amount: row.ancillaryAmount,
      adjustment_amount: row.adjustmentAmount,
      total_amount: row.totalAmount,
      notes: null,
      created_by_user_id: input.runByUser,
      created_by_name: input.runByName,
      created_at: input.now,
      updated_at: input.now
    });

    const invoiceLines: BillingBatchInvoiceLineRpcPayload[] = [
      {
        id: randomUUID(),
        invoice_id: invoiceId,
        member_id: row.memberId,
        payor_id: row.payorId,
        service_date: null,
        service_period_start: row.basePeriodStart,
        service_period_end: row.basePeriodEnd,
        line_type: "BaseProgram",
        description: `Base program charges (${row.baseProgramBilledDays} day(s))`,
        quantity: row.baseProgramBilledDays,
        unit_rate: row.memberDailyRateSnapshot,
        amount: row.baseProgramAmount,
        source_table: "attendance_records",
        source_record_id: null,
        billing_status: "Billed",
        created_at: input.now,
        updated_at: input.now
      },
      ...row.variableSourceRows.map((sourceLine) => ({
        id: randomUUID(),
        invoice_id: invoiceId,
        member_id: row.memberId,
        payor_id: row.payorId,
        service_date: sourceLine.service_date,
        service_period_start: sourceLine.service_period_start,
        service_period_end: sourceLine.service_period_end,
        line_type: sourceLine.line_type,
        description: sourceLine.description,
        quantity: sourceLine.quantity,
        unit_rate: sourceLine.unit_rate,
        amount: sourceLine.amount,
        source_table: sourceLine.source_table,
        source_record_id: sourceLine.source_record_id,
        billing_status: "Billed" as const,
        created_at: input.now,
        updated_at: input.now
      }))
    ];
    invoiceLinePayloads.push(...invoiceLines);

    coveragePayloads.push(
      ...invoiceLines.map((line) => ({
        member_id: row.memberId,
        coverage_type: mapCoverageTypeForLineType(line.line_type),
        coverage_start_date: normalizeDateOnly(line.service_period_start, row.basePeriodStart),
        coverage_end_date: normalizeDateOnly(line.service_period_end, row.basePeriodEnd),
        source_invoice_id: invoiceId,
        source_invoice_line_id: line.id,
        source_table: line.source_table,
        source_record_id: line.source_record_id,
        created_at: input.now
      }))
    );

    sourceUpdates.push(
      ...row.variableSourceRows.map((sourceLine) => ({
        source_table: sourceLine.source_table,
        source_record_id: sourceLine.source_record_id,
        invoice_id: invoiceId,
        updated_at: input.now
      }))
    );
  }

  return {
    batchId,
    batchPayload: {
      id: batchId,
      batch_type: input.batchType,
      billing_month: input.billingMonthStart,
      run_date: input.runDate,
      batch_status: "Draft",
      invoice_count: input.previewRows.length,
      total_amount: input.totalAmount,
      completion_date: null,
      next_due_date: addMonths(input.billingMonthStart, 1),
      generated_by_user_id: input.runByUser,
      generated_by_name: input.runByName,
      created_at: input.now,
      updated_at: input.now
    },
    invoicePayloads,
    invoiceLinePayloads,
    coveragePayloads,
    sourceUpdates
  };
}

export async function invokeGenerateBillingBatchRpc(plan: BillingBatchWritePlan) {
  const supabase = await createClient({ serviceRole: true });
  try {
    await invokeSupabaseRpcOrThrow<unknown>(supabase, RPC_GENERATE_BILLING_BATCH, {
      p_batch: plan.batchPayload,
      p_invoices: plan.invoicePayloads,
      p_invoice_lines: plan.invoiceLinePayloads,
      p_coverages: plan.coveragePayloads,
      p_source_updates: plan.sourceUpdates
    });
  } catch (error) {
    if (isMissingRpcFunctionError(error, RPC_GENERATE_BILLING_BATCH)) {
      throw new Error(buildMissingBillingAtomicWorkflowMessage(RPC_GENERATE_BILLING_BATCH));
    }
    throw error;
  }
}

export async function invokeCreateBillingExportRpc(input: {
  exportJobPayload: BillingExportRpcPayload;
  invoiceIds: string[];
}) {
  const supabase = await createClient({ serviceRole: true });
  try {
    await invokeSupabaseRpcOrThrow<unknown>(supabase, RPC_CREATE_BILLING_EXPORT, {
      p_export_job: input.exportJobPayload,
      p_invoice_ids: input.invoiceIds
    });
  } catch (error) {
    if (isMissingRpcFunctionError(error, RPC_CREATE_BILLING_EXPORT)) {
      throw new Error(buildMissingBillingAtomicWorkflowMessage(RPC_CREATE_BILLING_EXPORT));
    }
    throw error;
  }
}

export async function invokeCreateCustomInvoiceRpc(input: {
  invoicePayload: BillingBatchInvoiceRpcPayload;
  invoiceLinePayloads: BillingBatchInvoiceLineRpcPayload[];
  coveragePayloads: BillingBatchCoverageRpcPayload[];
  sourceUpdates: BillingBatchSourceUpdateRpcPayload[];
}) {
  const supabase = await createClient({ serviceRole: true });
  try {
    const result = await invokeSupabaseRpcOrThrow<unknown>(supabase, RPC_CREATE_CUSTOM_INVOICE, {
      p_invoice: input.invoicePayload,
      p_invoice_lines: input.invoiceLinePayloads,
      p_coverages: input.coveragePayloads,
      p_source_updates: input.sourceUpdates
    });
    return Array.isArray(result) ? String(result[0] ?? input.invoicePayload.id) : String(result ?? input.invoicePayload.id);
  } catch (error) {
    if (isMissingRpcFunctionError(error, RPC_CREATE_CUSTOM_INVOICE)) {
      throw new Error(buildMissingCustomInvoiceAtomicWorkflowMessage(RPC_CREATE_CUSTOM_INVOICE));
    }
    throw error;
  }
}
