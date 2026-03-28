import "server-only";

import { createClient } from "@/lib/supabase/server";
import {
  BILLING_ADJUSTMENT_QUEUE_SELECT,
  BILLING_ANCILLARY_CATEGORY_SELECT,
  BILLING_ANCILLARY_CHARGE_LOG_SELECT,
  BILLING_MEMBER_LOOKUP_SELECT,
  BILLING_TRANSPORTATION_LOG_SELECT
} from "@/lib/services/billing-selects";
import { BILLING_BATCH_TYPE_OPTIONS } from "@/lib/services/billing-types";
import { asNumber, addMonths, normalizeDateOnly, previousMonth, startOfMonth, toAmount, toMonthRange } from "@/lib/services/billing-utils";
import { computeDueState, normalizeInvoiceRow } from "@/lib/services/billing-core";
import {
  formatBillingPayorDisplayName,
  listBillingPayorContactsForMembers
} from "@/lib/services/billing-payor-contacts";
import {
  buildMemberContactsSchemaOutOfDateError,
  isMemberContactsPayorColumnMissingError
} from "@/lib/services/member-contact-payor-schema";
import {
  buildMissingSchemaMessage,
  isMissingSchemaObjectError
} from "@/lib/services/billing-schema-errors";
import { getBillingGenerationPreview as getBillingGenerationPreviewFromHelpers } from "@/lib/services/billing-preview-helpers";
import { toEasternDate } from "@/lib/timezone";
import type { Database } from "@/types/supabase-types";
import type {
  listCenterClosures as listCenterClosuresImpl
} from "@/lib/services/billing-configuration";

type Tables = Database["public"]["Tables"];
type AncillaryChargeCategoryRow = Tables["ancillary_charge_categories"]["Row"];
type AncillaryChargeLogRow = Tables["ancillary_charge_logs"]["Row"];
type BillingAdjustmentRow = Tables["billing_adjustments"]["Row"];
type BillingBatchRow = Tables["billing_batches"]["Row"];
type BillingExportJobRow = Tables["billing_export_jobs"]["Row"];
type BillingInvoiceRow = Tables["billing_invoices"]["Row"];
type MemberLookupRow = Pick<Tables["members"]["Row"], "id" | "display_name" | "status">;
type TransportationLogRow = Tables["transportation_logs"]["Row"];

export const CENTER_CLOSURE_TYPE_OPTIONS = ["Holiday", "Weather", "Planned", "Emergency", "Other"] as const;

export async function listPayors() {
  const { listPayors } = await import("@/lib/services/billing-configuration");
  return listPayors();
}

export async function listClosureRules() {
  const { listClosureRules } = await import("@/lib/services/billing-configuration");
  return listClosureRules();
}

type ListCenterClosuresInput = Parameters<typeof listCenterClosuresImpl>[0];

export async function listCenterClosures(input?: ListCenterClosuresInput) {
  const { listCenterClosures } = await import("@/lib/services/billing-configuration");
  return listCenterClosures(input);
}

export async function listMemberBillingSettings() {
  const { listMemberBillingSettings } = await import("@/lib/services/billing-configuration");
  return listMemberBillingSettings();
}

export async function listBillingScheduleTemplates() {
  const { listBillingScheduleTemplates } = await import("@/lib/services/billing-configuration");
  return listBillingScheduleTemplates();
}

export async function getBillingMemberPayorLookups() {
  const { getBillingMemberPayorLookups } = await import("@/lib/services/billing-configuration");
  return getBillingMemberPayorLookups();
}

export async function getBillingGenerationPreview(input: {
  billingMonth: string;
  batchType?: (typeof BILLING_BATCH_TYPE_OPTIONS)[number];
}) {
  return getBillingGenerationPreviewFromHelpers(input);
}

export async function getBillingBatches() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("billing_batches")
    .select("*")
    .order("billing_month", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) {
    if (isMissingSchemaObjectError(error)) {
      throw new Error(
        buildMissingSchemaMessage({
          objectName: "billing_batches",
          migration: "0015_schema_compatibility_backfill.sql"
        })
      );
    }
    throw new Error(error.message);
  }
  return ((data ?? []) as BillingBatchRow[]).map((row) => ({
    ...row,
    invoice_count: asNumber(row.invoice_count),
    total_amount: toAmount(asNumber(row.total_amount)),
    dueState: computeDueState(row.next_due_date ?? null, row.completion_date ?? null)
  }));
}

export async function getDraftInvoices() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("billing_invoices")
    .select("*")
    .eq("invoice_status", "Draft")
    .order("invoice_month", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) {
    if (isMissingSchemaObjectError(error)) {
      throw new Error(
        buildMissingSchemaMessage({
          objectName: "billing_invoices",
          migration: "0015_schema_compatibility_backfill.sql"
        })
      );
    }
    throw new Error(error.message);
  }
  return (data ?? []).map(normalizeInvoiceRow);
}

export async function getFinalizedInvoices() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("billing_invoices")
    .select("*")
    .in("invoice_status", ["Finalized", "Sent", "Paid", "PartiallyPaid", "Void"])
    .order("invoice_month", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) {
    if (isMissingSchemaObjectError(error)) {
      throw new Error(
        buildMissingSchemaMessage({
          objectName: "billing_invoices",
          migration: "0015_schema_compatibility_backfill.sql"
        })
      );
    }
    throw new Error(error.message);
  }
  return (data ?? []).map(normalizeInvoiceRow);
}

export async function getCustomInvoices(input?: { status?: "Draft" | "Finalized" | "All" }) {
  const supabase = await createClient();
  let query = supabase
    .from("billing_invoices")
    .select("*")
    .eq("invoice_source", "Custom")
    .order("invoice_month", { ascending: false })
    .order("created_at", { ascending: false });
  if (input?.status === "Draft") query = query.eq("invoice_status", "Draft");
  if (input?.status === "Finalized") query = query.eq("invoice_status", "Finalized");
  const { data, error } = await query;
  if (error) {
    if (isMissingSchemaObjectError(error)) {
      throw new Error(
        buildMissingSchemaMessage({
          objectName: "billing_invoices",
          migration: "0015_schema_compatibility_backfill.sql"
        })
      );
    }
    throw new Error(error.message);
  }
  return (data ?? []).map(normalizeInvoiceRow);
}

export async function getBillingBatchReviewRows(billingBatchId: string) {
  const supabase = await createClient();
  const [{ data: invoices, error: invoiceError }, { data: members }] = await Promise.all([
    supabase.from("billing_invoices").select("*").eq("billing_batch_id", billingBatchId).order("created_at", { ascending: true }),
    supabase.from("members").select("id, display_name")
  ]);
  if (invoiceError) {
    if (isMissingSchemaObjectError(invoiceError)) {
      throw new Error(
        buildMissingSchemaMessage({
          objectName: "billing_invoices",
          migration: "0015_schema_compatibility_backfill.sql"
        })
      );
    }
    throw new Error(invoiceError.message);
  }
  const memberNameById = new Map(
    ((members ?? []) as Pick<MemberLookupRow, "id" | "display_name">[]).map((row) => [
      String(row.id),
      String(row.display_name)
    ] as const)
  );
  const payorByMember = await listBillingPayorContactsForMembers(
    ((invoices ?? []) as BillingInvoiceRow[]).map((invoice) => String(invoice.member_id))
  );

  return ((invoices ?? []) as BillingInvoiceRow[]).map((invoice) => {
    const payor = payorByMember.get(String(invoice.member_id)) ?? null;
    return {
      invoiceId: String(invoice.id),
      memberName: memberNameById.get(String(invoice.member_id)) ?? "Unknown Member",
      payorName: payor ? formatBillingPayorDisplayName(payor) : "No payor contact designated",
      invoiceSource: invoice.invoice_source,
      billingMode: invoice.billing_mode_snapshot ?? "-",
      baseProgramAmount: toAmount(asNumber(invoice.base_program_amount)),
      baseProgramBilledDays: asNumber(invoice.base_program_billed_days),
      baseProgramDayRate: toAmount(asNumber(invoice.member_daily_rate_snapshot)),
      memberDailyRateSnapshot: toAmount(asNumber(invoice.member_daily_rate_snapshot)),
      transportationBillingStatusSnapshot:
        (invoice.transportation_billing_status_snapshot ?? "BillNormally") as
          | "BillNormally"
          | "Waived"
          | "IncludedInProgramRate",
      transportationAmount: toAmount(asNumber(invoice.transportation_amount)),
      ancillaryAmount: toAmount(asNumber(invoice.ancillary_amount)),
      adjustmentAmount: toAmount(asNumber(invoice.adjustment_amount)),
      basePeriodStart: normalizeDateOnly(invoice.base_period_start),
      basePeriodEnd: normalizeDateOnly(invoice.base_period_end),
      variableChargePeriodStart: normalizeDateOnly(invoice.variable_charge_period_start),
      variableChargePeriodEnd: normalizeDateOnly(invoice.variable_charge_period_end),
      totalAmount: toAmount(asNumber(invoice.total_amount)),
      billingMethod: invoice.billing_method_snapshot ?? "InvoiceEmail",
      invoiceStatus: invoice.invoice_status
    };
  });
}

export async function getVariableChargesQueue(input: { month: string }) {
  const supabase = await createClient();
  const monthRange = toMonthRange(input.month);
  const [
    { data: transportData, error: transportError },
    { data: ancillaryData, error: ancillaryError },
    { data: adjustmentData, error: adjustmentError },
    { data: membersData, error: membersError },
    { data: categoryData, error: categoryError }
  ] = await Promise.all([
    supabase
      .from("transportation_logs")
      .select(BILLING_TRANSPORTATION_LOG_SELECT)
      .gte("service_date", monthRange.start)
      .lte("service_date", monthRange.end),
    supabase
      .from("ancillary_charge_logs")
      .select(BILLING_ANCILLARY_CHARGE_LOG_SELECT)
      .gte("service_date", monthRange.start)
      .lte("service_date", monthRange.end),
    supabase
      .from("billing_adjustments")
      .select(BILLING_ADJUSTMENT_QUEUE_SELECT)
      .gte("adjustment_date", monthRange.start)
      .lte("adjustment_date", monthRange.end),
    supabase.from("members").select(BILLING_MEMBER_LOOKUP_SELECT),
    supabase.from("ancillary_charge_categories").select(BILLING_ANCILLARY_CATEGORY_SELECT)
  ]);
  if (transportError) {
    if (isMissingSchemaObjectError(transportError)) {
      throw new Error(buildMissingSchemaMessage({ objectName: "transportation_logs", migration: "0001_initial_schema.sql" }));
    }
    throw new Error(transportError.message);
  }
  if (ancillaryError) {
    if (isMissingSchemaObjectError(ancillaryError)) {
      throw new Error(buildMissingSchemaMessage({ objectName: "ancillary_charge_logs", migration: "0001_initial_schema.sql" }));
    }
    throw new Error(ancillaryError.message);
  }
  if (adjustmentError) {
    if (isMissingSchemaObjectError(adjustmentError)) {
      throw new Error(buildMissingSchemaMessage({ objectName: "billing_adjustments", migration: "0013_care_plans_and_billing_execution.sql" }));
    }
    throw new Error(adjustmentError.message);
  }
  if (membersError) throw new Error(membersError.message);
  if (categoryError) {
    if (isMissingSchemaObjectError(categoryError)) {
      throw new Error(buildMissingSchemaMessage({ objectName: "ancillary_charge_categories", migration: "0001_initial_schema.sql" }));
    }
    throw new Error(categoryError.message);
  }

  const memberNameById = new Map(
    ((membersData ?? []) as Pick<MemberLookupRow, "id" | "display_name">[]).map((row) => [
      String(row.id),
      String(row.display_name)
    ] as const)
  );
  const categoryById = new Map(
    ((categoryData ?? []) as AncillaryChargeCategoryRow[]).map((row) => [String(row.id), row] as const)
  );
  const rows: Array<{
    type: "Transportation" | "Ancillary" | "Adjustment";
    id: string;
    memberName: string;
    chargeDate: string;
    description: string;
    amount: number;
    billingStatus: "Unbilled" | "Billed" | "Excluded";
    exclusionReason: string | null;
  }> = [];

  ((transportData ?? []) as TransportationLogRow[])
    .filter((row) => String(row.billing_status ?? "Unbilled") !== "Billed")
    .filter((row) => row.billable !== false)
    .forEach((row) => {
      const amount = toAmount(
        asNumber(row.total_amount) > 0
          ? asNumber(row.total_amount)
          : asNumber(row.quantity || 1) * asNumber(row.unit_rate)
      );
      rows.push({
        type: "Transportation",
        id: String(row.id),
        memberName: memberNameById.get(String(row.member_id)) ?? "Unknown Member",
        chargeDate: normalizeDateOnly(row.service_date),
        description: `Transportation (${row.transport_type ?? "Trip"})`,
        amount,
        billingStatus: (row.billing_status ?? "Unbilled") as "Unbilled" | "Billed" | "Excluded",
        exclusionReason: row.billing_exclusion_reason ?? null
      });
    });

  ((ancillaryData ?? []) as AncillaryChargeLogRow[])
    .filter((row) => String(row.billing_status ?? "Unbilled") !== "Billed")
    .forEach((row) => {
      const category = categoryById.get(String(row.category_id));
      const unitRate = asNumber(row.unit_rate) > 0 ? asNumber(row.unit_rate) : asNumber(category?.price_cents) / 100;
      const quantity = asNumber(row.quantity || 1);
      const amount = toAmount(asNumber(row.amount) > 0 ? asNumber(row.amount) : quantity * unitRate);
      rows.push({
        type: "Ancillary",
        id: String(row.id),
        memberName: memberNameById.get(String(row.member_id)) ?? "Unknown Member",
        chargeDate: normalizeDateOnly(row.service_date),
        description: String(category?.name ?? "Ancillary Charge"),
        amount,
        billingStatus: (row.billing_status ?? "Unbilled") as "Unbilled" | "Billed" | "Excluded",
        exclusionReason: row.billing_exclusion_reason ?? null
      });
    });

  ((adjustmentData ?? []) as BillingAdjustmentRow[])
    .filter((row) => String(row.billing_status ?? "Unbilled") !== "Billed")
    .forEach((row) => {
      rows.push({
        type: "Adjustment",
        id: String(row.id),
        memberName: memberNameById.get(String(row.member_id)) ?? "Unknown Member",
        chargeDate: normalizeDateOnly(row.adjustment_date),
        description: String(row.description ?? "Adjustment"),
        amount: toAmount(asNumber(row.amount)),
        billingStatus: (row.billing_status ?? "Unbilled") as "Unbilled" | "Billed" | "Excluded",
        exclusionReason: row.exclusion_reason ?? null
      });
    });

  return rows.sort((left, right) => (left.chargeDate < right.chargeDate ? 1 : -1));
}

export async function getBillingExports() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("billing_export_jobs")
    .select("*")
    .order("generated_at", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) {
    if (isMissingSchemaObjectError(error)) {
      throw new Error(
        buildMissingSchemaMessage({
          objectName: "billing_export_jobs",
          migration: "0015_schema_compatibility_backfill.sql"
        })
      );
    }
    throw new Error(error.message);
  }
  return (data ?? []) as BillingExportJobRow[];
}

export interface BillingDashboardSummary {
  projectedNextMonthBaseRevenue: number;
  priorMonthTransportationWaiting: number;
  priorMonthAncillaryWaiting: number;
  currentDraftBatchTotal: number;
  finalizedBatchTotalsByMonth: Array<{ billingMonth: string; totalAmount: number }>;
}

export async function getBillingDashboardSummary(): Promise<BillingDashboardSummary> {
  const today = toEasternDate();
  const nextMonth = addMonths(startOfMonth(today), 1);
  const previousMonthStart = previousMonth(startOfMonth(today));

  const [preview, queue, batches] = await Promise.all([
    getBillingGenerationPreview({ billingMonth: nextMonth, batchType: "Mixed" }),
    getVariableChargesQueue({ month: previousMonthStart }),
    getBillingBatches()
  ]);
  const projectedNextMonthBaseRevenue = toAmount(
    preview.rows.reduce((sum, row) => sum + row.baseProgramAmount, 0)
  );
  const priorMonthTransportationWaiting = toAmount(
    queue.filter((row) => row.type === "Transportation" && row.billingStatus !== "Billed").reduce((sum, row) => sum + row.amount, 0)
  );
  const priorMonthAncillaryWaiting = toAmount(
    queue.filter((row) => row.type === "Ancillary" && row.billingStatus !== "Billed").reduce((sum, row) => sum + row.amount, 0)
  );
  const currentDraftBatchTotal = toAmount(
    batches
      .filter((row) => row.batch_status === "Draft")
      .reduce((sum, row) => sum + asNumber(row.total_amount), 0)
  );
  const totalsByMonthMap = new Map<string, number>();
  batches
    .filter((row) => ["Finalized", "Exported", "Closed"].includes(String(row.batch_status)))
    .forEach((row) => {
      const month = startOfMonth(String(row.billing_month));
      totalsByMonthMap.set(month, toAmount((totalsByMonthMap.get(month) ?? 0) + asNumber(row.total_amount)));
    });
  const finalizedBatchTotalsByMonth = Array.from(totalsByMonthMap.entries())
    .map(([billingMonth, totalAmount]) => ({ billingMonth, totalAmount }))
    .sort((left, right) => (left.billingMonth < right.billingMonth ? 1 : -1));

  return {
    projectedNextMonthBaseRevenue,
    priorMonthTransportationWaiting,
    priorMonthAncillaryWaiting,
    currentDraftBatchTotal,
    finalizedBatchTotalsByMonth
  };
}

export async function getBillingModuleIndex() {
  const supabase = await createClient();
  const [payorResponse, memberSettingResponse, scheduleTemplateResponse, dashboard, batches] = await Promise.all([
    supabase.from("member_contacts").select("id", { count: "exact", head: true }).eq("is_payor", true),
    supabase.from("member_billing_settings").select("id", { count: "exact", head: true }).eq("active", true),
    supabase.from("billing_schedule_templates").select("id", { count: "exact", head: true }).eq("active", true),
    getBillingDashboardSummary(),
    getBillingBatches()
  ]);

  if (payorResponse.error) {
    throw (isMemberContactsPayorColumnMissingError(payorResponse.error)
      ? buildMemberContactsSchemaOutOfDateError()
      : new Error(payorResponse.error.message));
  }
  if (memberSettingResponse.error) throw new Error(memberSettingResponse.error.message);
  if (scheduleTemplateResponse.error) throw new Error(scheduleTemplateResponse.error.message);
  const payorCount = payorResponse.count ?? 0;
  const memberBillingSettingCount = memberSettingResponse.count ?? 0;
  const scheduleTemplateCount = scheduleTemplateResponse.count ?? 0;

  return {
    payorCount,
    memberBillingSettingCount,
    scheduleTemplateCount,
    dashboard,
    latestBatch: batches[0] ?? null
  };
}
