import "server-only";

import { createClient } from "@/lib/supabase/server";
import { type BillingSettingRow, type CustomInvoiceManualLine, type CreateCustomInvoiceInput, type ScheduleTemplateRow } from "@/lib/services/billing-types";
import { addDays, asNumber, buildCustomInvoiceNumber, endOfMonth, normalizeDateOnly, startOfMonth, toAmount, toDateRange } from "@/lib/services/billing-utils";
import { collectBillingEligibleBaseDates } from "@/lib/services/billing-core";
import { getActiveBillingScheduleTemplate, getActiveCenterBillingSetting, getActiveMemberBillingSetting, getNonBillableCenterClosureSet } from "@/lib/services/billing-configuration";
import { loadExpectedAttendanceSupabaseContext } from "@/lib/services/expected-attendance-supabase";
import { resolveDailyRate, resolveTransportationBillingStatus } from "@/lib/services/billing-preview-helpers";
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
      ((rows ?? []) as Array<Record<string, unknown>>)
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
        ((categories ?? []) as Array<{ id: string; name: string | null; price_cents: number | null }>).map((row) => [String(row.id), row] as const)
      );
      ((rows ?? []) as Array<Record<string, unknown>>)
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
    }

    if (input.includeAdjustments) {
      const { data: rows, error } = await supabase
        .from("billing_adjustments")
        .select("id, adjustment_date, description, quantity, unit_rate, amount, billing_status")
        .eq("member_id", input.memberId)
        .gte("adjustment_date", period.start)
        .lte("adjustment_date", period.end);
      if (error) throw new Error(error.message);
      ((rows ?? []) as Array<Record<string, unknown>>)
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

    const coverageRows = ((insertedLines ?? []) as Array<{
      id: string;
      line_type: string;
      source_table: string | null;
      source_record_id: string | null;
      service_period_start: string;
      service_period_end: string;
    }>).map((line) => ({
      member_id: input.memberId,
      coverage_type: line.line_type === "Transportation" ? "Transportation" : line.line_type === "Ancillary" ? "Ancillary" : "BaseProgram",
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
