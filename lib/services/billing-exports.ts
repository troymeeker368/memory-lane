import "server-only";

import { randomUUID } from "node:crypto";

import { createClient } from "@/lib/supabase/server";
import { BILLING_EXPORT_TYPES } from "@/lib/services/billing-types";
import { asNumber, startOfMonth, toAmount } from "@/lib/services/billing-utils";
import { buildCsvRows, normalizeInvoiceRow, toDataUrl } from "@/lib/services/billing-core";
import { invokeCreateBillingExportRpc } from "@/lib/services/billing-rpc";
import { buildIdempotencyHash } from "@/lib/services/idempotency";
import { formatBillingPayorDisplayName, listBillingPayorContactsForMembers } from "@/lib/services/billing-payor-contacts";
import { isMissingSchemaObjectError } from "@/lib/services/billing-schema-errors";
import { recordImmediateSystemAlert, recordWorkflowEvent } from "@/lib/services/workflow-observability";
import { toEasternISO } from "@/lib/timezone";

type BillingBatchRow = {
  billing_month: string;
};

type BillingExportInvoiceRow = ReturnType<typeof normalizeInvoiceRow>;

export async function createBillingExport(input: {
  billingBatchId: string;
  exportType: (typeof BILLING_EXPORT_TYPES)[number];
  quickbooksDetailLevel: "Summary" | "Detailed";
  generatedBy: string;
}) {
  try {
    const supabase = await createClient();
    const now = toEasternISO();
    const idempotencyKey = buildIdempotencyHash("billing-export:create", {
      billingBatchId: input.billingBatchId,
      exportType: input.exportType,
      quickbooksDetailLevel: input.quickbooksDetailLevel
    });
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

    const { data: existingExport, error: existingExportError } = await supabase
      .from("billing_export_jobs")
      .select("id")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existingExportError) {
      if (isMissingSchemaObjectError(existingExportError)) {
        return { ok: false as const, error: "Billing execution schema is not available yet. Apply Supabase migration 0013 first." };
      }
      throw new Error(existingExportError.message);
    }
    if (existingExport?.id) {
      return { ok: true as const, billingExportId: String(existingExport.id), duplicateSafe: true as const };
    }

    const invoiceRows = ((invoices ?? []) as BillingExportInvoiceRow[]).map((row) => normalizeInvoiceRow(row));
    if (invoiceRows.length === 0) {
      return { ok: false as const, error: "No finalized invoices available for export." };
    }
    const payorByMember = await listBillingPayorContactsForMembers(invoiceRows.map((row) => String(row.member_id)));

    const invoiceIds = invoiceRows.map((row) => String(row.id));
    const { data: lines, error: linesError } = await supabase.from("billing_invoice_lines").select("*").in("invoice_id", invoiceIds);
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
      const header = ["InvoiceNumber", "LineNumber", "ProductOrService", "LineType", "Description", "ServiceDate", "Quantity", "UnitRate", "Amount"];
      const invoiceById = new Map(invoiceRows.map((row) => [String(row.id), row] as const));
      const body = ((lines ?? []) as Array<{ invoice_id: string; line_number?: number | null; product_or_service?: string | null; line_type: string; description: string; service_date: string | null; quantity: number; unit_rate: number; amount: number }>).map((line) => [
        invoiceById.get(String(line.invoice_id))?.invoice_number ?? "",
        asNumber(line.line_number ?? 0),
        line.product_or_service ?? "",
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

    const fileName = `${input.exportType}-${startOfMonth(String((batch as BillingBatchRow).billing_month))}-${input.quickbooksDetailLevel.toLowerCase()}-${idempotencyKey.slice(0, 8)}.csv`;
    const requestedBillingExportId = randomUUID();
    const billingExportId = await invokeCreateBillingExportRpc({
      exportJobPayload: {
        id: requestedBillingExportId,
        billing_batch_id: input.billingBatchId,
        idempotency_key: idempotencyKey,
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
      dedupeKey: `billing-export-generated:${idempotencyKey}`,
      metadata: {
        billing_export_id: billingExportId,
        export_type: input.exportType,
        quickbooks_detail_level: input.quickbooksDetailLevel,
        generated_by: input.generatedBy,
        invoice_count: invoiceIds.length
      }
    });

    return { ok: true as const, billingExportId, duplicateSafe: false as const };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unable to generate billing export.";
    const idempotencyKey = buildIdempotencyHash("billing-export:create", {
      billingBatchId: input.billingBatchId,
      exportType: input.exportType,
      quickbooksDetailLevel: input.quickbooksDetailLevel
    });
    await recordWorkflowEvent({
      eventType: "billing_export_failed",
      entityType: "billing_batch",
      entityId: input.billingBatchId,
      actorType: "user",
      status: "failed",
      severity: "high",
      dedupeKey: `billing-export-failed:${idempotencyKey}`,
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
