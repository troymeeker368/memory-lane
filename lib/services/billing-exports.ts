import "server-only";

import { randomUUID } from "node:crypto";

import { createClient } from "@/lib/supabase/server";
import { buildCsvRows, normalizeInvoiceRow, toDataUrl } from "@/lib/services/billing-core";
import { buildQuickBooksInvoiceCsv } from "@/lib/services/billing-quickbooks-export";
import {
  formatBillingPayorDisplayName,
  listBillingPayorContactsForMembers
} from "@/lib/services/billing-payor-contacts";
import { invokeCreateBillingExportRpc } from "@/lib/services/billing-rpc";
import { isMissingSchemaObjectError } from "@/lib/services/billing-schema-errors";
import { BILLING_EXPORT_TYPES } from "@/lib/services/billing-types";
import { asNumber, startOfMonth, toAmount } from "@/lib/services/billing-utils";
import { buildIdempotencyHash } from "@/lib/services/idempotency";
import { recordImmediateSystemAlert, recordWorkflowEvent } from "@/lib/services/workflow-observability";
import { toEasternISO } from "@/lib/timezone";
import type { Database } from "@/types/supabase-types";

type BillingBatchRow = {
  billing_month: string;
};

type BillingExportInvoiceRow = ReturnType<typeof normalizeInvoiceRow>;
type BillingInvoiceLineRow = Database["public"]["Tables"]["billing_invoice_lines"]["Row"];

function buildBillingExportIdempotencyKey(input: {
  billingBatchId: string;
  exportType: (typeof BILLING_EXPORT_TYPES)[number];
  quickbooksDetailLevel: "Summary" | "Detailed";
}) {
  return buildIdempotencyHash("billing-export:create", {
    billingBatchId: input.billingBatchId,
    exportType: input.exportType,
    quickbooksDetailLevel: input.quickbooksDetailLevel,
    quickbooksTemplateVersion: input.exportType === "QuickBooksCSV" ? "invoice-import-template-v1" : "legacy"
  });
}

function buildMissingSchemaResponse(error: { message: string }, migration: string, objectName: string) {
  if (isMissingSchemaObjectError(error)) {
    return {
      ok: false as const,
      error: `${objectName} schema is not available yet. Apply Supabase migration ${migration} first.`
    };
  }
  throw new Error(error.message);
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
    const idempotencyKey = buildBillingExportIdempotencyKey(input);
    const [{ data: batch, error: batchError }, { data: invoices, error: invoiceError }] = await Promise.all([
      supabase.from("billing_batches").select("*").eq("id", input.billingBatchId).maybeSingle(),
      supabase
        .from("billing_invoices")
        .select("*")
        .eq("billing_batch_id", input.billingBatchId)
        .in("invoice_status", ["Finalized", "Sent", "Paid", "PartiallyPaid", "Void"])
        .order("invoice_number", { ascending: true })
        .order("created_at", { ascending: true })
    ]);
    if (batchError) {
      return buildMissingSchemaResponse(batchError, "0013", "Billing execution");
    }
    if (invoiceError) {
      return buildMissingSchemaResponse(invoiceError, "0013", "Billing execution");
    }
    if (!batch) return { ok: false as const, error: "Billing batch not found." };

    const { data: existingExport, error: existingExportError } = await supabase
      .from("billing_export_jobs")
      .select("id")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existingExportError) {
      return buildMissingSchemaResponse(existingExportError, "0013", "Billing execution");
    }
    if (existingExport?.id) {
      return { ok: true as const, billingExportId: String(existingExport.id), duplicateSafe: true as const };
    }

    const invoiceRows = ((invoices ?? []) as BillingExportInvoiceRow[]).map((row) => normalizeInvoiceRow(row));
    if (invoiceRows.length === 0) {
      return { ok: false as const, error: "No finalized invoices available for export." };
    }

    const memberIds = Array.from(new Set(invoiceRows.map((row) => String(row.member_id)).filter(Boolean)));
    const payorByMember = await listBillingPayorContactsForMembers(memberIds);

    const invoiceIds = invoiceRows.map((row) => String(row.id));
    const { data: lines, error: linesError } = await supabase
      .from("billing_invoice_lines")
      .select("*")
      .in("invoice_id", invoiceIds)
      .order("invoice_id", { ascending: true })
      .order("line_number", { ascending: true });
    if (linesError) {
      return buildMissingSchemaResponse(linesError, "0013", "Billing execution");
    }

    let csv = "";
    if (input.exportType === "InvoiceSummaryCSV") {
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
      const body = ((lines ?? []) as BillingInvoiceLineRow[]).map((line) => [
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
      const payorIds = Array.from(new Set(invoiceRows.map((row) => String(row.payor_id ?? "")).filter(Boolean)));
      const minBasePeriodStart = invoiceRows
        .map((row) => String(row.base_period_start ?? ""))
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right))[0];
      const maxBasePeriodEnd = invoiceRows
        .map((row) => String(row.base_period_end ?? ""))
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right))
        .slice(-1)[0];

      const [{ data: payorRows, error: payorError }, { data: attendanceRows, error: attendanceError }] = await Promise.all([
        payorIds.length > 0
          ? supabase.from("payors").select("id, quickbooks_customer_name").in("id", payorIds)
          : Promise.resolve({ data: [], error: null }),
        memberIds.length > 0 && minBasePeriodStart && maxBasePeriodEnd
          ? supabase
              .from("attendance_records")
              .select("member_id, attendance_date, status")
              .in("member_id", memberIds)
              .eq("status", "present")
              .gte("attendance_date", minBasePeriodStart)
              .lte("attendance_date", maxBasePeriodEnd)
          : Promise.resolve({ data: [], error: null })
      ]);

      if (payorError) {
        return buildMissingSchemaResponse(payorError, "0011", "Payor");
      }
      if (attendanceError) {
        return buildMissingSchemaResponse(attendanceError, "0012", "Attendance");
      }

      const payorById = new Map(
        (((payorRows ?? []) as Array<{ id: string; quickbooks_customer_name: string | null }>)).map((row) => [String(row.id), row] as const)
      );
      const attendanceDatesByMemberId = new Map<string, string[]>();
      (((attendanceRows ?? []) as Array<{ member_id: string; attendance_date: string; status: string }>)).forEach((row) => {
        const memberId = String(row.member_id ?? "");
        const attendanceDate = String(row.attendance_date ?? "");
        if (!memberId || !attendanceDate) return;
        const existing = attendanceDatesByMemberId.get(memberId);
        if (existing) {
          existing.push(attendanceDate);
          return;
        }
        attendanceDatesByMemberId.set(memberId, [attendanceDate]);
      });

      const customerNameByInvoiceId = new Map<string, string>();
      const attendedDatesByInvoiceId = new Map<string, string[]>();
      invoiceRows.forEach((row) => {
        const invoiceId = String(row.id);
        const payorRecord = row.payor_id ? payorById.get(String(row.payor_id)) ?? null : null;
        const payorContact = payorByMember.get(String(row.member_id)) ?? null;
        customerNameByInvoiceId.set(
          invoiceId,
          String(
            payorRecord?.quickbooks_customer_name ??
              row.bill_to_name_snapshot ??
              (payorContact ? formatBillingPayorDisplayName(payorContact) : "No payor contact designated")
          )
        );
        const periodStart = String(row.base_period_start ?? "");
        const periodEnd = String(row.base_period_end ?? "");
        const attendanceDates = (attendanceDatesByMemberId.get(String(row.member_id)) ?? [])
          .filter((attendanceDate) => (!periodStart || attendanceDate >= periodStart) && (!periodEnd || attendanceDate <= periodEnd))
          .sort((left, right) => left.localeCompare(right));
        attendedDatesByInvoiceId.set(invoiceId, attendanceDates);
      });

      csv = buildQuickBooksInvoiceCsv({
        invoices: invoiceRows,
        lines: (lines ?? []) as BillingInvoiceLineRow[],
        detailLevel: input.quickbooksDetailLevel,
        customerNameByInvoiceId,
        attendedDatesByInvoiceId
      });
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
    const idempotencyKey = buildBillingExportIdempotencyKey(input);
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
