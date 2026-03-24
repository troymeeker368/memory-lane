import "server-only";

import { randomUUID } from "node:crypto";

import { invokeCreateCustomInvoiceRpc } from "@/lib/services/billing-rpc";
import { createClient } from "@/lib/supabase/server";
import type {
  BillingBatchCoverageRpcPayload,
  BillingBatchInvoiceLineRpcPayload,
  BillingBatchInvoiceRpcPayload,
  BillingBatchSourceUpdateRpcPayload,
  CustomInvoiceManualLine,
  CreateCustomInvoiceInput,
  ScheduleTemplateRow
} from "@/lib/services/billing-types";
import { addDays, asNumber, buildCustomInvoiceNumber, endOfMonth, normalizeDateOnly, startOfMonth, toAmount, toDateRange } from "@/lib/services/billing-utils";
import { collectBillingEligibleBaseDates } from "@/lib/services/billing-core";
import {
  getActiveBillingScheduleTemplate,
  getActiveCenterBillingSetting,
  getMemberAttendanceBillingSetting,
  getActiveMemberBillingSetting,
  getNonBillableCenterClosureSet
} from "@/lib/services/billing-configuration";
import { loadExpectedAttendanceSupabaseContext } from "@/lib/services/expected-attendance-supabase";
import { resolveEffectiveDailyRate, resolveEffectiveTransportationBillingStatus } from "@/lib/services/billing-effective";
import { toEasternDate, toEasternISO } from "@/lib/timezone";

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

    const [centerSetting, memberSetting, attendanceSetting] = await Promise.all([
      getActiveCenterBillingSetting(period.start),
      getActiveMemberBillingSetting(input.memberId, period.start),
      getMemberAttendanceBillingSetting(input.memberId)
    ]);
    const dailyRate = toAmount(
      resolveEffectiveDailyRate({
        attendanceSetting,
        memberSetting,
        centerSetting
      })
    );

    const [nonBillableClosures, schedule, expectedAttendanceContext] = await Promise.all([
      getNonBillableCenterClosureSet(period),
      input.useScheduleTemplate ? getActiveBillingScheduleTemplate(input.memberId, period.start) : Promise.resolve(null),
      loadExpectedAttendanceSupabaseContext({
        memberIds: [input.memberId],
        startDate: period.start,
        endDate: period.end,
        includeAttendanceRecords: false
      })
    ]);
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

    const transportBillingStatus = resolveEffectiveTransportationBillingStatus({
      attendanceSetting,
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

    const [
      transportationResult,
      ancillaryRowsResult,
      ancillaryCategoriesResult,
      adjustmentsResult
    ] = await Promise.all([
      input.includeTransportation
        ? supabase
            .from("transportation_logs")
            .select("id, service_date, transport_type, quantity, unit_rate, total_amount, billing_status, billable")
            .eq("member_id", input.memberId)
            .gte("service_date", period.start)
            .lte("service_date", period.end)
        : Promise.resolve({ data: [], error: null }),
      input.includeAncillary
        ? supabase
            .from("ancillary_charge_logs")
            .select("id, category_id, service_date, quantity, unit_rate, amount, billing_status")
            .eq("member_id", input.memberId)
            .gte("service_date", period.start)
            .lte("service_date", period.end)
        : Promise.resolve({ data: [], error: null }),
      input.includeAncillary
        ? supabase.from("ancillary_charge_categories").select("id, name, price_cents")
        : Promise.resolve({ data: [], error: null }),
      input.includeAdjustments
        ? supabase
            .from("billing_adjustments")
            .select("id, adjustment_date, description, quantity, unit_rate, amount, billing_status")
            .eq("member_id", input.memberId)
            .gte("adjustment_date", period.start)
            .lte("adjustment_date", period.end)
        : Promise.resolve({ data: [], error: null })
    ]);

    if (transportationResult.error) throw new Error(transportationResult.error.message);
    if (ancillaryRowsResult.error) throw new Error(ancillaryRowsResult.error.message);
    if (ancillaryCategoriesResult.error) throw new Error(ancillaryCategoriesResult.error.message);
    if (adjustmentsResult.error) throw new Error(adjustmentsResult.error.message);

    ((transportationResult.data ?? []) as Array<Record<string, unknown>>)
        .filter((row) => String(row.billing_status ?? "Unbilled") === "Unbilled")
        .filter((row) => row.billable !== false)
        .forEach((row) => {
          const amount = toAmount(
            asNumber(row.total_amount) > 0
              ? asNumber(row.total_amount)
              : asNumber(row.quantity || 1) * asNumber(row.unit_rate)
          );
          const serviceDate = normalizeDateOnly(String(row.service_date ?? ""));
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
    const categoryById = new Map(
      (((ancillaryCategoriesResult.data ?? []) as Array<{ id: string; name: string | null; price_cents: number | null }>)).map((row) => [
        String(row.id),
        row
      ] as const)
    );
    ((ancillaryRowsResult.data ?? []) as Array<Record<string, unknown>>)
      .filter((row) => String(row.billing_status ?? "Unbilled") === "Unbilled")
      .forEach((row) => {
        const category = categoryById.get(String(row.category_id));
        const unitRate = asNumber(row.unit_rate) > 0 ? asNumber(row.unit_rate) : asNumber(category?.price_cents) / 100;
        const quantity = asNumber(row.quantity || 1);
        const amount = toAmount(asNumber(row.amount) > 0 ? asNumber(row.amount) : quantity * unitRate);
        const serviceDate = normalizeDateOnly(String(row.service_date ?? ""));
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

    ((adjustmentsResult.data ?? []) as Array<Record<string, unknown>>)
      .filter((row) => String(row.billing_status ?? "Unbilled") === "Unbilled")
      .forEach((row) => {
        const amount = toAmount(asNumber(row.amount));
        const serviceDate = normalizeDateOnly(String(row.adjustment_date ?? ""));
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

    const { count: monthInvoiceCount, error: monthInvoiceError } = await supabase
      .from("billing_invoices")
      .select("id", { count: "exact", head: true })
      .eq("invoice_source", "Custom")
      .eq("invoice_month", startOfMonth(period.start));
    if (monthInvoiceError) throw new Error(monthInvoiceError.message);
    const invoiceId = randomUUID();
    const invoiceNumber = buildCustomInvoiceNumber(period.start, Number(monthInvoiceCount ?? 0));
    const invoicePayload: BillingBatchInvoiceRpcPayload = {
      id: invoiceId,
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
    };

    const baseLines: BillingBatchInvoiceLineRpcPayload[] = baseLineItems.map((line) => {
      const lineType = line.lineType ?? "BaseProgram";
      return {
        id: randomUUID(),
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
        source_table: null,
        source_record_id: null,
        billing_status: "Billed",
        created_at: now,
        updated_at: now
      };
    });
    const variableLines: BillingBatchInvoiceLineRpcPayload[] = variableRows.map((line) => ({
      id: randomUUID(),
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
    const invoiceLinePayloads = [...baseLines, ...variableLines];
    const coveragePayloads: BillingBatchCoverageRpcPayload[] = invoiceLinePayloads.map((line) => ({
      member_id: input.memberId,
      coverage_type: line.line_type === "Transportation" ? "Transportation" : line.line_type === "Ancillary" ? "Ancillary" : "BaseProgram",
      coverage_start_date: normalizeDateOnly(line.service_period_start, period.start),
      coverage_end_date: normalizeDateOnly(line.service_period_end, period.end),
      source_invoice_id: invoiceId,
      source_invoice_line_id: line.id,
      source_table: line.source_table ?? null,
      source_record_id: line.source_record_id ?? null,
      created_at: now
    }));
    const sourceUpdates: BillingBatchSourceUpdateRpcPayload[] = variableRows.map((line) => ({
      source_table: line.source_table,
      source_record_id: line.source_record_id,
      invoice_id: invoiceId,
      updated_at: now
    }));

    await invokeCreateCustomInvoiceRpc({
      invoicePayload,
      invoiceLinePayloads,
      coveragePayloads,
      sourceUpdates
    });

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
