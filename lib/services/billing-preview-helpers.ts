import "server-only";

import { createClient } from "@/lib/supabase/server";
import {
  BILLING_ACTIVE_MEMBER_LOOKUP_SELECT,
  BILLING_ADJUSTMENT_PREVIEW_SELECT,
  BILLING_ANCILLARY_CATEGORY_SELECT,
  BILLING_ANCILLARY_CHARGE_LOG_SELECT,
  BILLING_ATTENDANCE_RECORD_STATUS_SELECT,
  BILLING_MEMBER_ATTENDANCE_SCHEDULE_SELECT,
  BILLING_TRANSPORTATION_LOG_SELECT
} from "@/lib/services/billing-selects";
import {
  BILLING_BATCH_TYPE_OPTIONS,
  type AttendanceSettingWeekdays,
  type BillingPreviewRow,
  type BillingSettingRow,
  type CenterBillingSettingRow,
  type ScheduleTemplateRow
} from "@/lib/services/billing-types";
import {
  addMonths,
  asNumber,
  endOfMonth,
  isWithin,
  normalizeDateOnly,
  startOfMonth,
  toAmount
} from "@/lib/services/billing-utils";
import {
  collectBillingEligibleBaseDates,
  getMonthlyBillingBasis,
  resolveMemberInvoicePeriods,
  shouldProcessModeInBatch
} from "@/lib/services/billing-core";
import {
  formatBillingPayorDisplayName,
  listBillingPayorContactsForMembers
} from "@/lib/services/billing-payor-contacts";
import {
  resolveActiveEffectiveMemberRowForDate,
  resolveEffectiveDailyRate,
  resolveEffectiveExtraDayRate,
  resolveEffectiveBillingMode
} from "@/lib/services/billing-effective";
import { buildMissingSchemaMessage, isMissingSchemaObjectError } from "@/lib/services/billing-schema-errors";
import {
  getActiveCenterSettingForDate,
  getMemberAttendanceBillingSetting,
  getNonBillableCenterClosureSet
} from "@/lib/services/billing-configuration";
import { loadExpectedAttendanceSupabaseContext } from "@/lib/services/expected-attendance-supabase";

type BillingPreviewAttendanceScheduleRow = AttendanceSettingWeekdays & { member_id: string };
type BillingPreviewTransportationRow = {
  id: string;
  member_id: string;
  service_date: string;
  transport_type?: string | null;
  quantity?: number | string | null;
  unit_rate?: number | string | null;
  total_amount?: number | string | null;
  billing_status?: string | null;
  billable?: boolean | null;
};
type BillingPreviewAncillaryRow = {
  id: string;
  member_id: string;
  service_date: string;
  category_id?: string | null;
  quantity?: number | string | null;
  unit_rate?: number | string | null;
  amount?: number | string | null;
  billing_status?: string | null;
};
type BillingPreviewAdjustmentRow = {
  id: string;
  member_id: string;
  adjustment_date: string;
  quantity?: number | string | null;
  unit_rate?: number | string | null;
  amount?: number | string | null;
  billing_status?: string | null;
  description?: string | null;
  adjustment_type?: string | null;
};
type BillingPreviewCategoryRow = {
  id: string;
  name?: string | null;
  price_cents?: number | string | null;
};

export async function resolveDailyRate(input: {
  memberId: string;
  memberSetting: BillingSettingRow;
  centerSetting: CenterBillingSettingRow | null;
}) {
  const attendanceSetting = await getMemberAttendanceBillingSetting(input.memberId);
  return toAmount(
    resolveEffectiveDailyRate({
      attendanceSetting,
      memberSetting: input.memberSetting,
      centerSetting: input.centerSetting
    })
  );
}

export async function resolveExtraDayRate(input: {
  memberId: string;
  memberSetting: BillingSettingRow;
  centerSetting: CenterBillingSettingRow | null;
}) {
  const attendanceSetting = await getMemberAttendanceBillingSetting(input.memberId);
  return toAmount(
    resolveEffectiveExtraDayRate({
      attendanceSetting,
      memberSetting: input.memberSetting,
      centerSetting: input.centerSetting
    })
  );
}

export async function resolveTransportationBillingStatus(input: {
  memberId: string;
  memberSetting: BillingSettingRow | null;
}) {
  const attendanceSetting = await getMemberAttendanceBillingSetting(input.memberId);
  if (attendanceSetting?.transportationBillingStatus) return attendanceSetting.transportationBillingStatus;
  return input.memberSetting?.transportation_billing_status ?? "BillNormally";
}

async function getBillingPreviewRows(input: {
  billingMonth: string;
  batchType: (typeof BILLING_BATCH_TYPE_OPTIONS)[number];
}) {
  const supabase = await createClient();
  const invoiceMonthStart = startOfMonth(input.billingMonth);
  const minDate = addMonths(invoiceMonthStart, -2);
  const maxDate = endOfMonth(invoiceMonthStart);

  const [
    { data: membersData, error: membersError },
    { data: memberSettingsData, error: memberSettingsError },
    { data: attendanceSettingsData, error: attendanceSettingsError },
    { data: attendanceData, error: attendanceError },
    { data: scheduleData, error: scheduleError },
    { data: transportData, error: transportError },
    { data: ancillaryData, error: ancillaryError },
    { data: categoryData, error: categoryError },
    { data: adjustmentData, error: adjustmentError }
  ] = await Promise.all([
    supabase.from("members").select(BILLING_ACTIVE_MEMBER_LOOKUP_SELECT).eq("status", "active").order("display_name", { ascending: true }),
    supabase.from("member_billing_settings").select("*"),
    supabase.from("member_attendance_schedules").select(BILLING_MEMBER_ATTENDANCE_SCHEDULE_SELECT),
    supabase.from("attendance_records").select(BILLING_ATTENDANCE_RECORD_STATUS_SELECT).gte("attendance_date", minDate).lte("attendance_date", maxDate),
    supabase.from("billing_schedule_templates").select("*"),
    supabase.from("transportation_logs").select(BILLING_TRANSPORTATION_LOG_SELECT).gte("service_date", minDate).lte("service_date", maxDate),
    supabase.from("ancillary_charge_logs").select(BILLING_ANCILLARY_CHARGE_LOG_SELECT).gte("service_date", minDate).lte("service_date", maxDate),
    supabase.from("ancillary_charge_categories").select(BILLING_ANCILLARY_CATEGORY_SELECT),
    supabase.from("billing_adjustments").select(BILLING_ADJUSTMENT_PREVIEW_SELECT).gte("adjustment_date", minDate).lte("adjustment_date", maxDate)
  ]);
  if (membersError) throw new Error(membersError.message);
  if (memberSettingsError) {
    if (isMissingSchemaObjectError(memberSettingsError)) {
      throw new Error(buildMissingSchemaMessage({ objectName: "member_billing_settings", migration: "0013_care_plans_and_billing_execution.sql" }));
    }
    throw new Error(memberSettingsError.message);
  }
  if (attendanceSettingsError) {
    if (isMissingSchemaObjectError(attendanceSettingsError)) {
      throw new Error(buildMissingSchemaMessage({ objectName: "member_attendance_schedules", migration: "0011_member_command_center_aux_schema.sql" }));
    }
    throw new Error(attendanceSettingsError.message);
  }
  if (attendanceError) {
    if (isMissingSchemaObjectError(attendanceError)) {
      throw new Error(buildMissingSchemaMessage({ objectName: "attendance_records", migration: "0012_legacy_operational_health_alignment.sql" }));
    }
    throw new Error(attendanceError.message);
  }
  if (scheduleError) {
    if (isMissingSchemaObjectError(scheduleError)) {
      throw new Error(buildMissingSchemaMessage({ objectName: "billing_schedule_templates", migration: "0011_member_command_center_aux_schema.sql" }));
    }
    throw new Error(scheduleError.message);
  }
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
  if (categoryError) {
    if (isMissingSchemaObjectError(categoryError)) {
      throw new Error(buildMissingSchemaMessage({ objectName: "ancillary_charge_categories", migration: "0001_initial_schema.sql" }));
    }
    throw new Error(categoryError.message);
  }
  if (adjustmentError) {
    if (isMissingSchemaObjectError(adjustmentError)) {
      throw new Error(buildMissingSchemaMessage({ objectName: "billing_adjustments", migration: "0013_care_plans_and_billing_execution.sql" }));
    }
    throw new Error(adjustmentError.message);
  }

  const activeMembers = (membersData ?? []) as Array<{ id: string; display_name: string }>;
  const memberSettings = (memberSettingsData ?? []) as BillingSettingRow[];
  const attendanceSettingByMemberId = new Map(
    ((attendanceSettingsData ?? []) as BillingPreviewAttendanceScheduleRow[]).map((row) => [String(row.member_id), row] as const)
  );
  const attendanceRows = (attendanceData ?? []) as Array<{ member_id: string; status: string; attendance_date: string }>;
  const scheduleRows = (scheduleData ?? []) as ScheduleTemplateRow[];
  const transportationRows = (transportData ?? []) as BillingPreviewTransportationRow[];
  const ancillaryRows = (ancillaryData ?? []) as BillingPreviewAncillaryRow[];
  const categoryById = new Map(
    ((categoryData ?? []) as BillingPreviewCategoryRow[]).map((row) => [String(row.id), row] as const)
  );
  const adjustmentRows = (adjustmentData ?? []) as BillingPreviewAdjustmentRow[];
  const expectedAttendanceContext = await loadExpectedAttendanceSupabaseContext({
    memberIds: activeMembers.map((member) => member.id),
    startDate: minDate,
    endDate: maxDate,
    includeAttendanceRecords: false
  });
  const centerSetting = await getActiveCenterSettingForDate(invoiceMonthStart);
  const nonBillableClosureSetsByRange = new Map<string, Set<string>>();
  const payorByMember = await listBillingPayorContactsForMembers(activeMembers.map((member) => member.id));

  const previewRows: BillingPreviewRow[] = [];
  for (const member of activeMembers) {
    const memberSetting = resolveActiveEffectiveMemberRowForDate(member.id, invoiceMonthStart, memberSettings);
    if (!memberSetting) continue;

    const mode = resolveEffectiveBillingMode({ memberSetting, centerSetting });
    if (!shouldProcessModeInBatch({ mode, batchType: input.batchType })) continue;

    const periods = resolveMemberInvoicePeriods({
      mode,
      batchType: input.batchType,
      invoiceMonthStart
    });
    const nonBillableClosureRangeKey = `${periods.baseRange.start}:${periods.baseRange.end}`;
    let nonBillableClosures = nonBillableClosureSetsByRange.get(nonBillableClosureRangeKey);
    if (!nonBillableClosures) {
      nonBillableClosures = await getNonBillableCenterClosureSet(periods.baseRange);
      nonBillableClosureSetsByRange.set(nonBillableClosureRangeKey, nonBillableClosures);
    }
    const schedule =
      scheduleRows
        .filter((row) => row.member_id === member.id)
        .filter((row) => row.active)
        .filter((row) => normalizeDateOnly(row.effective_start_date) <= periods.baseRange.end)
        .filter((row) => !row.effective_end_date || normalizeDateOnly(row.effective_end_date) >= periods.baseRange.start)
        .sort((left, right) => (left.effective_start_date < right.effective_start_date ? 1 : -1))[0] ?? null;
    const attendanceSetting = attendanceSettingByMemberId.get(member.id) ?? null;

    let billedDays = 0;
    if (mode === "Monthly" && getMonthlyBillingBasis(memberSetting) === "ActualAttendanceMonthBehind") {
      billedDays = attendanceRows
        .filter((row) => String(row.member_id) === member.id)
        .filter((row) => String(row.status) === "present")
        .filter((row) => isWithin(String(row.attendance_date), periods.baseRange))
        .length;
    } else {
      const memberHolds = expectedAttendanceContext.holdsByMember.get(member.id) ?? [];
      const memberScheduleChanges = expectedAttendanceContext.scheduleChangesByMember.get(member.id) ?? [];
      billedDays = collectBillingEligibleBaseDates({
        range: periods.baseRange,
        schedule,
        attendanceSetting,
        includeAllWhenNoSchedule: false,
        holds: memberHolds,
        scheduleChanges: memberScheduleChanges,
        nonBillableClosures
      }).size;
    }

    const resolvedDailyRate = await resolveDailyRate({
      memberId: member.id,
      memberSetting,
      centerSetting
    });
    const baseProgramAmount =
      mode === "Monthly" && asNumber(memberSetting.flat_monthly_rate) > 0
        ? toAmount(memberSetting.flat_monthly_rate)
        : toAmount(billedDays * resolvedDailyRate);
    const transportBillingStatus = await resolveTransportationBillingStatus({
      memberId: member.id,
      memberSetting
    });

    const transportLines = transportationRows
      .filter((row) => String(row.member_id) === member.id)
      .filter((row) => isWithin(String(row.service_date), periods.variableRange))
      .filter((row) => String(row.billing_status ?? "Unbilled") === "Unbilled")
      .filter((row) => row.billable !== false)
      .map((row) => {
        const amount = toAmount(
          asNumber(row.total_amount) > 0
            ? asNumber(row.total_amount)
            : asNumber(row.quantity || 1) * asNumber(row.unit_rate)
        );
        const serviceDate = normalizeDateOnly(row.service_date);
        return {
          line_type: "Transportation" as const,
          service_date: serviceDate,
          service_period_start: serviceDate,
          service_period_end: serviceDate,
          description: `Transportation (${row.transport_type ?? "Trip"})`,
          quantity: asNumber(row.quantity || 1),
          unit_rate: toAmount(asNumber(row.unit_rate)),
          amount,
          source_table: "transportation_logs" as const,
          source_record_id: String(row.id)
        };
      });
    const ancillaryLines = ancillaryRows
      .filter((row) => String(row.member_id) === member.id)
      .filter((row) => isWithin(String(row.service_date), periods.variableRange))
      .filter((row) => String(row.billing_status ?? "Unbilled") === "Unbilled")
      .map((row) => {
        const category = categoryById.get(String(row.category_id)) as Record<string, unknown> | undefined;
        const unitRate = asNumber(row.unit_rate) > 0 ? asNumber(row.unit_rate) : asNumber(category?.price_cents) / 100;
        const quantity = asNumber(row.quantity || 1);
        const amount = toAmount(asNumber(row.amount) > 0 ? asNumber(row.amount) : quantity * unitRate);
        const serviceDate = normalizeDateOnly(row.service_date);
        return {
          line_type: "Ancillary" as const,
          service_date: serviceDate,
          service_period_start: serviceDate,
          service_period_end: serviceDate,
          description: String(category?.name ?? "Ancillary Charge"),
          quantity,
          unit_rate: toAmount(unitRate),
          amount,
          source_table: "ancillary_charge_logs" as const,
          source_record_id: String(row.id)
        };
      });
    const adjustmentLines = adjustmentRows
      .filter((row) => String(row.member_id) === member.id)
      .filter((row) => isWithin(String(row.adjustment_date), periods.variableRange))
      .filter((row) => String(row.billing_status ?? "Unbilled") === "Unbilled")
      .map((row) => {
        const amount = toAmount(asNumber(row.amount));
        const serviceDate = normalizeDateOnly(row.adjustment_date);
        return {
          line_type: amount < 0 ? ("Credit" as const) : ("Adjustment" as const),
          service_date: serviceDate,
          service_period_start: serviceDate,
          service_period_end: serviceDate,
          description: String(row.description ?? row.adjustment_type ?? "Adjustment"),
          quantity: asNumber(row.quantity || 1),
          unit_rate: toAmount(asNumber(row.unit_rate)),
          amount,
          source_table: "billing_adjustments" as const,
          source_record_id: String(row.id)
        };
      });
    const transportChargeLines = transportLines;
    const transportationAmount = toAmount(transportChargeLines.reduce((sum, row) => sum + row.amount, 0));
    const ancillaryAmount = toAmount(ancillaryLines.reduce((sum, row) => sum + row.amount, 0));
    const adjustmentAmount = toAmount(adjustmentLines.reduce((sum, row) => sum + row.amount, 0));
    const totalAmount = toAmount(baseProgramAmount + transportationAmount + ancillaryAmount + adjustmentAmount);

    const payor = payorByMember.get(member.id);
    previewRows.push({
      memberId: member.id,
      memberName: member.display_name,
      payorName: payor ? formatBillingPayorDisplayName(payor) : "No payor contact designated",
      payorId: null,
      billingMode: mode,
      monthlyBillingBasis: mode === "Monthly" ? getMonthlyBillingBasis(memberSetting) : null,
      invoiceMonth: periods.invoiceMonth,
      basePeriodStart: periods.baseRange.start,
      basePeriodEnd: periods.baseRange.end,
      variableChargePeriodStart: periods.variableRange.start,
      variableChargePeriodEnd: periods.variableRange.end,
      billingMethod: "InvoiceEmail",
      baseProgramAmount,
      transportationAmount,
      ancillaryAmount,
      adjustmentAmount,
      totalAmount,
      baseProgramBilledDays: billedDays,
      memberDailyRateSnapshot: resolvedDailyRate,
      transportationBillingStatusSnapshot: transportChargeLines.length > 0 ? "BillNormally" : transportBillingStatus,
      variableSourceRows: [...transportChargeLines, ...ancillaryLines, ...adjustmentLines]
    });
  }

  return previewRows.sort((left, right) =>
    left.memberName.localeCompare(right.memberName, undefined, { sensitivity: "base" })
  );
}

export async function getBillingGenerationPreview(input: {
  billingMonth: string;
  batchType?: (typeof BILLING_BATCH_TYPE_OPTIONS)[number];
}) {
  const batchType =
    input.batchType && BILLING_BATCH_TYPE_OPTIONS.includes(input.batchType) ? input.batchType : "Mixed";
  const rows = await getBillingPreviewRows({ billingMonth: input.billingMonth, batchType });
  return {
    rows,
    totalAmount: toAmount(rows.reduce((sum, row) => sum + row.baseProgramAmount, 0))
  };
}
