import { addMockRecord, getMockDb, removeMockRecord, updateMockRecord } from "@/lib/mock-repo";
import { generateClosureDatesFromRules, type ClosureRuleLike } from "@/lib/services/closure-rules";
import { toEasternDate, toEasternISO } from "@/lib/timezone";

export type BillingModuleRole = "admin" | "manager" | "director" | "coordinator";

export const BILLING_STATUS_OPTIONS = ["Unbilled", "Billed", "Excluded"] as const;
export const TRANSPORTATION_BILLING_STATUS_OPTIONS = ["BillNormally", "Waived", "IncludedInProgramRate"] as const;
export const BILLING_ADJUSTMENT_TYPE_OPTIONS = [
  "ExtraDay",
  "Credit",
  "Discount",
  "Refund",
  "ManualCharge",
  "ManualCredit",
  "PriorBalance",
  "Other"
] as const;
export const BILLING_BATCH_STATUS_OPTIONS = ["Draft", "Reviewed", "Finalized", "Exported", "Closed"] as const;
export const BILLING_INVOICE_STATUS_OPTIONS = ["Draft", "Finalized", "Sent", "Paid", "PartiallyPaid", "Void"] as const;
export const BILLING_EXPORT_TYPES = ["QuickBooksCSV", "InternalReviewCSV", "InvoiceSummaryCSV"] as const;
export const CENTER_CLOSURE_TYPE_OPTIONS = ["Holiday", "Weather", "Planned", "Emergency", "Other"] as const;
export const BILLING_MODE_OPTIONS = ["Membership", "Monthly", "Custom"] as const;
export const MONTHLY_BILLING_BASIS_OPTIONS = ["ScheduledMonthBehind", "ActualAttendanceMonthBehind"] as const;
export const BILLING_BATCH_TYPE_OPTIONS = ["Membership", "Monthly", "Mixed", "Custom"] as const;
export const BILLING_INVOICE_SOURCE_OPTIONS = ["BatchGenerated", "Custom"] as const;

interface DateRange {
  start: string;
  end: string;
}

function normalizeDateOnly(value: string | null | undefined, fallback: string = toEasternDate()) {
  const dateOnly = String(value ?? "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(dateOnly) ? dateOnly : fallback;
}

function startOfMonth(value: string | null | undefined) {
  const dateOnly = normalizeDateOnly(value);
  return `${dateOnly.slice(0, 7)}-01`;
}

function addDays(dateOnly: string, days: number) {
  const parsed = new Date(`${normalizeDateOnly(dateOnly)}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function addMonths(dateOnly: string, months: number) {
  const parsed = new Date(`${normalizeDateOnly(dateOnly)}T00:00:00.000Z`);
  parsed.setUTCMonth(parsed.getUTCMonth() + months, 1);
  return parsed.toISOString().slice(0, 10);
}

function addYears(dateOnly: string, years: number) {
  const parsed = new Date(`${normalizeDateOnly(dateOnly)}T00:00:00.000Z`);
  parsed.setUTCFullYear(parsed.getUTCFullYear() + years);
  return parsed.toISOString().slice(0, 10);
}

function endOfMonth(value: string | null | undefined) {
  const parsed = new Date(`${startOfMonth(value)}T00:00:00.000Z`);
  parsed.setUTCMonth(parsed.getUTCMonth() + 1, 0);
  return parsed.toISOString().slice(0, 10);
}

function previousMonth(monthStart: string) {
  return addMonths(startOfMonth(monthStart), -1);
}

function toMonthRange(monthStartValue: string): DateRange {
  const start = startOfMonth(monthStartValue);
  return {
    start,
    end: endOfMonth(start)
  };
}

function isWithin(dateOnly: string | null | undefined, range: DateRange) {
  const normalized = normalizeDateOnly(dateOnly, "");
  if (!normalized) return false;
  return normalized >= range.start && normalized <= range.end;
}

function normalizeYear(value: number) {
  if (!Number.isFinite(value)) return Number(toEasternDate().slice(0, 4));
  return Math.max(2000, Math.min(2100, Math.round(value)));
}

export function listClosureRules() {
  const db = getMockDb();
  return [...db.closureRules].sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
}

export function generateClosuresForYear(year: number, input?: { generatedByUserId?: string | null; generatedByName?: string | null }) {
  const db = getMockDb();
  const targetYear = normalizeYear(year);
  const rules = db.closureRules.filter((rule) => rule.active) as ClosureRuleLike[];
  const generated = generateClosureDatesFromRules({
    year: targetYear,
    rules
  });
  const existingDates = new Set(db.centerClosures.map((row) => normalizeDateOnly(row.closure_date)));
  let insertedCount = 0;

  generated.forEach((row) => {
    if (existingDates.has(row.date)) return;
    existingDates.add(row.date);
    addMockRecord("centerClosures", {
      closure_date: row.date,
      closure_name: row.reason,
      closure_type: "Holiday",
      auto_generated: true,
      closure_rule_id: row.ruleId,
      billable_override: false,
      notes: row.observed ? "Observed closure generated from holiday rule." : null,
      active: true,
      created_at: toEasternISO(),
      updated_at: toEasternISO(),
      updated_by_user_id: input?.generatedByUserId ?? null,
      updated_by_name: input?.generatedByName ?? "System"
    });
    insertedCount += 1;
  });

  return {
    year: targetYear,
    generatedCount: generated.length,
    insertedCount
  };
}

export function ensureCenterClosuresForCurrentAndNextYear(input?: { generatedByUserId?: string | null; generatedByName?: string | null }) {
  const currentYear = Number(toEasternDate().slice(0, 4));
  const years = [currentYear, currentYear + 1];
  return years.map((year) => generateClosuresForYear(year, input));
}

function ensureCenterClosuresForRange(range: DateRange) {
  const startYear = Number(range.start.slice(0, 4));
  const endYear = Number(range.end.slice(0, 4));
  for (let year = startYear; year <= endYear; year += 1) {
    generateClosuresForYear(year);
  }
}

function toAmount(value: number | null | undefined) {
  if (!Number.isFinite(value)) return 0;
  return Number(Number(value).toFixed(2));
}

function dateRangesOverlap(input: {
  leftStart: string;
  leftEnd: string | null;
  rightStart: string;
  rightEnd: string | null;
}) {
  const leftStart = normalizeDateOnly(input.leftStart);
  const rightStart = normalizeDateOnly(input.rightStart);
  const leftEnd = input.leftEnd ? normalizeDateOnly(input.leftEnd) : "9999-12-31";
  const rightEnd = input.rightEnd ? normalizeDateOnly(input.rightEnd) : "9999-12-31";
  return leftStart <= rightEnd && rightStart <= leftEnd;
}

function weekdayKey(dateOnly: string) {
  const day = new Date(`${dateOnly}T00:00:00.000Z`).getUTCDay();
  if (day === 0) return "sunday" as const;
  if (day === 1) return "monday" as const;
  if (day === 2) return "tuesday" as const;
  if (day === 3) return "wednesday" as const;
  if (day === 4) return "thursday" as const;
  if (day === 5) return "friday" as const;
  return "saturday" as const;
}

function scheduleIncludesDate(
  schedule: ReturnType<typeof getMockDb>["billingScheduleTemplates"][number] | null,
  dateOnly: string
) {
  if (!schedule) return false;
  const day = weekdayKey(dateOnly);
  if (day === "monday") return schedule.monday;
  if (day === "tuesday") return schedule.tuesday;
  if (day === "wednesday") return schedule.wednesday;
  if (day === "thursday") return schedule.thursday;
  if (day === "friday") return schedule.friday;
  if (day === "saturday") return schedule.saturday;
  return schedule.sunday;
}

function getNonBillableCenterClosuresByDate(range: DateRange) {
  ensureCenterClosuresForRange(range);
  const db = getMockDb();
  const map = new Map<string, ReturnType<typeof getMockDb>["centerClosures"][number]>();
  db.centerClosures
    .filter((row) => row.active)
    .filter((row) => !row.billable_override)
    .filter((row) => isWithin(row.closure_date, range))
    .forEach((row) => {
      map.set(normalizeDateOnly(row.closure_date), row);
    });
  return map;
}

function isDateCoveredForType(
  memberId: string,
  dateOnly: string,
  coverageType: ReturnType<typeof getMockDb>["billingCoverages"][number]["coverage_type"]
) {
  const db = getMockDb();
  return db.billingCoverages.some((row) => {
    if (row.member_id !== memberId) return false;
    if (row.coverage_type !== coverageType) return false;
    const start = normalizeDateOnly(row.coverage_start_date);
    const end = normalizeDateOnly(row.coverage_end_date);
    return dateOnly >= start && dateOnly <= end;
  });
}

function getScheduledBillingDaySnapshotForRange(input: {
  schedule: ReturnType<typeof getMockDb>["billingScheduleTemplates"][number];
  range: DateRange;
  memberId: string;
}) {
  const nonBillableClosuresByDate = getNonBillableCenterClosuresByDate(input.range);
  let totalScheduledCount = 0;
  let closureExcludedCount = 0;
  let coverageExcludedCount = 0;
  let billableScheduledCount = 0;
  let cursor = input.range.start;

  while (cursor <= input.range.end) {
    if (scheduleIncludesDate(input.schedule, cursor)) {
      totalScheduledCount += 1;
      if (nonBillableClosuresByDate.has(cursor)) {
        closureExcludedCount += 1;
      } else if (isDateCoveredForType(input.memberId, cursor, "BaseProgram")) {
        coverageExcludedCount += 1;
      } else {
        billableScheduledCount += 1;
      }
    }
    cursor = addDays(cursor, 1);
  }

  return {
    totalScheduledCount,
    closureExcludedCount,
    coverageExcludedCount,
    billableScheduledCount
  };
}

function getEffectiveBillingMode(input: {
  memberSetting: ReturnType<typeof getMockDb>["memberBillingSettings"][number];
  centerSetting: ReturnType<typeof getMockDb>["centerBillingSettings"][number] | null;
}) {
  if (!input.memberSetting.use_center_default_billing_mode && input.memberSetting.billing_mode) {
    return input.memberSetting.billing_mode;
  }
  return input.centerSetting?.default_billing_mode ?? "Membership";
}

function getMonthlyBillingBasis(setting: ReturnType<typeof getMockDb>["memberBillingSettings"][number]) {
  return setting.monthly_billing_basis === "ActualAttendanceMonthBehind"
    ? "ActualAttendanceMonthBehind"
    : "ScheduledMonthBehind";
}

function fullNameByMemberId() {
  const db = getMockDb();
  return new Map(db.members.map((row) => [row.id, row.display_name] as const));
}

function payorNameById() {
  const db = getMockDb();
  return new Map(db.payors.map((row) => [row.id, row.payor_name] as const));
}

function payorById() {
  const db = getMockDb();
  return new Map(db.payors.map((row) => [row.id, row] as const));
}

function ancillaryChargeDate(row: ReturnType<typeof getMockDb>["ancillaryLogs"][number]) {
  return normalizeDateOnly(row.charge_date ?? row.service_date);
}

function ancillaryChargeType(row: ReturnType<typeof getMockDb>["ancillaryLogs"][number]) {
  const normalized = String(row.charge_type ?? row.category_name ?? "").trim();
  return normalized.length > 0 ? normalized : "Ancillary Charge";
}

function ancillaryStatus(row: ReturnType<typeof getMockDb>["ancillaryLogs"][number]) {
  return row.billing_status ?? "Unbilled";
}

function ancillaryIsUnbilled(row: ReturnType<typeof getMockDb>["ancillaryLogs"][number]) {
  return ancillaryStatus(row) === "Unbilled";
}

function ancillaryTotalAmount(row: ReturnType<typeof getMockDb>["ancillaryLogs"][number]) {
  const amountCents = Number.isFinite(row.amount_cents) ? Number(row.amount_cents) : null;
  const totalAmountRaw = Number.isFinite(row.total_amount) ? Number(row.total_amount) : null;
  if (totalAmountRaw != null && amountCents != null && Math.abs(totalAmountRaw - amountCents) < 0.01) {
    return toAmount(amountCents / 100);
  }
  if (totalAmountRaw != null) {
    return toAmount(totalAmountRaw);
  }
  if (amountCents != null) {
    return toAmount(amountCents / 100);
  }
  return 0;
}

function ancillaryUnitRateAmount(row: ReturnType<typeof getMockDb>["ancillaryLogs"][number]) {
  const quantity = Number.isFinite(row.quantity) && Number(row.quantity) > 0 ? Number(row.quantity) : 1;
  const amount = ancillaryTotalAmount(row);
  const amountCents = Number.isFinite(row.amount_cents) ? Number(row.amount_cents) : null;
  const unitRateRaw = Number.isFinite(row.unit_rate) ? Number(row.unit_rate) : null;
  if (unitRateRaw != null && amountCents != null && Math.abs(unitRateRaw * quantity - amountCents) < 0.01) {
    return toAmount(unitRateRaw / 100);
  }
  if (unitRateRaw != null) {
    return toAmount(unitRateRaw);
  }
  return quantity > 0 ? toAmount(amount / quantity) : amount;
}

export function getActiveCenterBillingSetting(dateOnly: string) {
  const db = getMockDb();
  const target = normalizeDateOnly(dateOnly);
  return (
    db.centerBillingSettings
      .filter((row) => row.active)
      .filter((row) => normalizeDateOnly(row.effective_start_date) <= target)
      .filter((row) => !row.effective_end_date || normalizeDateOnly(row.effective_end_date) >= target)
      .sort((left, right) => (left.effective_start_date < right.effective_start_date ? 1 : -1))[0] ?? null
  );
}

function getCenterBillingSettingForGeneration(dateOnly: string) {
  const activeForDate = getActiveCenterBillingSetting(dateOnly);
  if (activeForDate) return activeForDate;

  const db = getMockDb();
  return (
    db.centerBillingSettings
      .filter((row) => row.active)
      .sort((left, right) => (left.effective_start_date < right.effective_start_date ? 1 : -1))[0] ?? null
  );
}

export function getActiveMemberBillingSetting(memberId: string, dateOnly: string) {
  const db = getMockDb();
  const target = normalizeDateOnly(dateOnly);
  return (
    db.memberBillingSettings
      .filter((row) => row.member_id === memberId)
      .filter((row) => row.active)
      .filter((row) => normalizeDateOnly(row.effective_start_date) <= target)
      .filter((row) => !row.effective_end_date || normalizeDateOnly(row.effective_end_date) >= target)
      .sort((left, right) => (left.effective_start_date < right.effective_start_date ? 1 : -1))[0] ?? null
  );
}

export function getActiveBillingScheduleTemplate(memberId: string, dateOnly: string) {
  const db = getMockDb();
  const target = normalizeDateOnly(dateOnly);
  return (
    db.billingScheduleTemplates
      .filter((row) => row.member_id === memberId)
      .filter((row) => row.active)
      .filter((row) => normalizeDateOnly(row.effective_start_date) <= target)
      .filter((row) => !row.effective_end_date || normalizeDateOnly(row.effective_end_date) >= target)
      .sort((left, right) => (left.effective_start_date < right.effective_start_date ? 1 : -1))[0] ?? null
  );
}

export function getMemberAttendanceBillingSetting(memberId: string) {
  const db = getMockDb();
  const schedule = db.memberAttendanceSchedules.find((row) => row.member_id === memberId) ?? null;
  if (!schedule) return null;
  const dailyRateCandidate = [schedule.daily_rate, schedule.custom_daily_rate, schedule.default_daily_rate]
    .map((value) => (Number.isFinite(value) ? Number(value) : null))
    .find((value): value is number => value != null && value > 0);
  return {
    memberId,
    dailyRate: dailyRateCandidate ?? null,
    transportationBillingStatus: schedule.transportation_billing_status ?? "BillNormally",
    billingRateEffectiveDate: schedule.billing_rate_effective_date ?? null,
    billingNotes: schedule.billing_notes ?? null
  };
}

export function validateMemberBillingSettingOverlap(input: {
  memberId: string;
  effectiveStartDate: string;
  effectiveEndDate: string | null;
  active: boolean;
  excludeId?: string;
}) {
  if (!input.active) {
    return { ok: true as const };
  }
  const db = getMockDb();
  const overlap = db.memberBillingSettings.find((row) => {
    if (row.member_id !== input.memberId) return false;
    if (!row.active) return false;
    if (input.excludeId && row.id === input.excludeId) return false;
    return dateRangesOverlap({
      leftStart: row.effective_start_date,
      leftEnd: row.effective_end_date,
      rightStart: input.effectiveStartDate,
      rightEnd: input.effectiveEndDate
    });
  });
  return overlap
    ? { ok: false as const, error: "Another active member billing setting overlaps this date range." }
    : { ok: true as const };
}

export function validateCenterBillingSettingOverlap(input: {
  effectiveStartDate: string;
  effectiveEndDate: string | null;
  active: boolean;
  excludeId?: string;
}) {
  if (!input.active) {
    return { ok: true as const };
  }
  const db = getMockDb();
  const overlap = db.centerBillingSettings.find((row) => {
    if (!row.active) return false;
    if (input.excludeId && row.id === input.excludeId) return false;
    return dateRangesOverlap({
      leftStart: row.effective_start_date,
      leftEnd: row.effective_end_date,
      rightStart: input.effectiveStartDate,
      rightEnd: input.effectiveEndDate
    });
  });
  return overlap
    ? { ok: false as const, error: "Another active center billing setting overlaps this date range." }
    : { ok: true as const };
}

export function validateScheduleTemplateOverlap(input: {
  memberId: string;
  effectiveStartDate: string;
  effectiveEndDate: string | null;
  active: boolean;
  excludeId?: string;
}) {
  if (!input.active) {
    return { ok: true as const };
  }
  const db = getMockDb();
  const overlap = db.billingScheduleTemplates.find((row) => {
    if (row.member_id !== input.memberId) return false;
    if (!row.active) return false;
    if (input.excludeId && row.id === input.excludeId) return false;
    return dateRangesOverlap({
      leftStart: row.effective_start_date,
      leftEnd: row.effective_end_date,
      rightStart: input.effectiveStartDate,
      rightEnd: input.effectiveEndDate
    });
  });
  return overlap
    ? { ok: false as const, error: "Another active schedule template overlaps this date range." }
    : { ok: true as const };
}

function resolveDailyRate(input: {
  memberId: string;
  memberSetting: ReturnType<typeof getMockDb>["memberBillingSettings"][number];
  centerSetting: ReturnType<typeof getMockDb>["centerBillingSettings"][number] | null;
}) {
  // Source-of-truth order:
  // 1) MCC Attendance DailyRate
  // 2) active member billing override
  // 3) active center default
  // This keeps coordinator-maintained member Attendance rates as the practical default input.
  const attendanceSetting = getMemberAttendanceBillingSetting(input.memberId);
  if (attendanceSetting?.dailyRate != null && attendanceSetting.dailyRate > 0) {
    return toAmount(attendanceSetting.dailyRate);
  }
  if (!input.memberSetting.use_center_default_rate && input.memberSetting.custom_daily_rate != null) {
    return toAmount(input.memberSetting.custom_daily_rate);
  }
  return toAmount(input.centerSetting?.default_daily_rate ?? 0);
}

function resolveExtraDayRate(input: {
  memberId: string;
  memberSetting: ReturnType<typeof getMockDb>["memberBillingSettings"][number];
  centerSetting: ReturnType<typeof getMockDb>["centerBillingSettings"][number] | null;
}) {
  const attendanceSetting = getMemberAttendanceBillingSetting(input.memberId);
  if (attendanceSetting?.dailyRate != null && attendanceSetting.dailyRate > 0) {
    return toAmount(attendanceSetting.dailyRate);
  }
  if (!input.memberSetting.use_center_default_rate && input.memberSetting.custom_daily_rate != null) {
    return toAmount(input.memberSetting.custom_daily_rate);
  }
  return toAmount(input.centerSetting?.default_extra_day_rate ?? input.centerSetting?.default_daily_rate ?? 0);
}

function resolveTransportationBillingStatus(input: {
  memberId: string;
  memberSetting: ReturnType<typeof getMockDb>["memberBillingSettings"][number] | null;
}) {
  // Match rate precedence: MCC Attendance status is authoritative, member setting is fallback.
  const attendanceSetting = getMemberAttendanceBillingSetting(input.memberId);
  if (attendanceSetting?.transportationBillingStatus) {
    return attendanceSetting.transportationBillingStatus;
  }
  return input.memberSetting?.transportation_billing_status ?? "BillNormally";
}

export function listPayors() {
  const db = getMockDb();
  return [...db.payors].sort((left, right) => left.payor_name.localeCompare(right.payor_name, undefined, { sensitivity: "base" }));
}

export function listCenterClosures(input?: { includeInactive?: boolean }) {
  ensureCenterClosuresForCurrentAndNextYear();
  const db = getMockDb();
  const includeInactive = input?.includeInactive ?? false;
  return [...db.centerClosures]
    .filter((row) => (includeInactive ? true : row.active))
    .sort((left, right) => (left.closure_date > right.closure_date ? 1 : -1));
}

export function listMemberBillingSettings() {
  const db = getMockDb();
  const memberNameMap = fullNameByMemberId();
  const payorNameMap = payorNameById();
  return db.memberBillingSettings
    .map((row) => ({
      ...row,
      member_name: memberNameMap.get(row.member_id) ?? "Unknown Member",
      payor_name: row.payor_id ? payorNameMap.get(row.payor_id) ?? "-" : "-"
    }))
    .sort((left, right) => left.member_name.localeCompare(right.member_name, undefined, { sensitivity: "base" }));
}

export function listBillingScheduleTemplates() {
  const db = getMockDb();
  const memberNameMap = fullNameByMemberId();
  return db.billingScheduleTemplates
    .map((row) => ({
      ...row,
      member_name: memberNameMap.get(row.member_id) ?? "Unknown Member"
    }))
    .sort((left, right) => left.member_name.localeCompare(right.member_name, undefined, { sensitivity: "base" }));
}

export const BILLING_SOURCE_OF_TRUTH = {
  // Billing ownership rules:
  // - Center default rates live in centerBillingSettings and are coordinator-managed.
  // - Member-level DailyRate / TransportationBillingStatus live in memberAttendanceSchedules (MCC Attendance).
  // - Recurring holiday/weekend-observed logic lives in closureRules and auto-generates centerClosures by year.
  // - Center closures live in centerClosures and define non-billable schedule exclusions by date.
  // - MemberBillingSettings/ScheduleTemplates hold billing mode/payor exceptions and contracted attendance pattern.
  // - Operational attendance/transport/existing ancillary log rows remain source for actual services.
  // - billingCoverages prevents duplicate billing across custom and batch invoices.
  // - Finalized invoices + invoice lines are immutable export source-of-truth snapshots.
  billing: {
    centerDefaults: "centerBillingSettings",
    memberAttendanceBilling: "memberAttendanceSchedules",
    centerClosures: "centerClosures",
    memberOverrides: "memberBillingSettings",
    contractedSchedule: "billingScheduleTemplates",
    coverage: "billingCoverages",
    operationalSourceRows: ["attendanceRecords", "transportationLogs", "ancillaryLogs", "billingAdjustments"],
    finalizedExportSource: ["billingInvoices", "billingInvoiceLines"]
  }
} as const;

function excludeUnbilledExtraDayAdjustmentForAttendance(
  attendanceId: string,
  actorName: string,
  reason: string
) {
  const db = getMockDb();
  const adjustment =
    db.billingAdjustments.find(
      (row) =>
        row.source_table === "attendanceRecords" &&
        row.source_record_id === attendanceId &&
        row.billing_status === "Unbilled"
    ) ?? null;
  if (!adjustment) {
    return;
  }
  updateMockRecord("billingAdjustments", adjustment.id, {
    billing_status: "Excluded",
    invoice_id: null,
    description: adjustment.description?.includes("Excluded:")
      ? adjustment.description
      : `${adjustment.description} (Excluded: ${reason})`,
    updated_at: toEasternISO(),
    created_by_name: actorName
  });
}

function ensureExtraDayAdjustmentsForPriorMonth(input: {
  monthStart: string;
  centerSetting: ReturnType<typeof getMockDb>["centerBillingSettings"][number] | null;
  actorName: string;
}) {
  const db = getMockDb();
  const range = toMonthRange(input.monthStart);

  db.attendanceRecords
    .filter((row) => row.status === "present")
    .filter((row) => isWithin(row.attendance_date, range))
    .forEach((attendanceRow) => {
      const memberSetting = getActiveMemberBillingSetting(attendanceRow.member_id, attendanceRow.attendance_date);
      const schedule = getActiveBillingScheduleTemplate(attendanceRow.member_id, attendanceRow.attendance_date);
      const scheduledDay = scheduleIncludesDate(schedule, attendanceRow.attendance_date);
      const unscheduledDay = !scheduledDay;
      const billExtraDays = memberSetting?.bill_extra_days ?? true;
      const billableExtraDay = unscheduledDay && billExtraDays;

      updateMockRecord("attendanceRecords", attendanceRow.id, {
        scheduled_day: scheduledDay,
        unscheduled_day: unscheduledDay,
        billable_extra_day: billableExtraDay,
        billing_status: attendanceRow.billing_status ?? "Unbilled"
      });

      if (!billableExtraDay) {
        excludeUnbilledExtraDayAdjustmentForAttendance(
          attendanceRow.id,
          input.actorName,
          "Day is no longer billable as an extra day."
        );
        if (attendanceRow.linked_adjustment_id) {
          updateMockRecord("attendanceRecords", attendanceRow.id, { linked_adjustment_id: null });
        }
        return;
      }

      const existingAdjustment = db.billingAdjustments.find(
        (adjustment) =>
          adjustment.source_table === "attendanceRecords" &&
          adjustment.source_record_id === attendanceRow.id &&
          adjustment.billing_status !== "Excluded"
      );

      if (existingAdjustment) {
        if (!attendanceRow.linked_adjustment_id || attendanceRow.linked_adjustment_id !== existingAdjustment.id) {
          updateMockRecord("attendanceRecords", attendanceRow.id, { linked_adjustment_id: existingAdjustment.id });
        }
        return;
      }

      const fallbackMemberSetting = {
        id: "",
        member_id: attendanceRow.member_id,
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
        effective_start_date: attendanceRow.attendance_date,
        effective_end_date: null,
        billing_notes: null,
        created_at: toEasternISO(),
        updated_at: toEasternISO(),
        updated_by_user_id: null,
        updated_by_name: null
      } satisfies ReturnType<typeof getMockDb>["memberBillingSettings"][number];

      const rate = resolveExtraDayRate({
        memberId: attendanceRow.member_id,
        memberSetting: memberSetting ?? fallbackMemberSetting,
        centerSetting: input.centerSetting
      });

      const created = addMockRecord("billingAdjustments", {
        member_id: attendanceRow.member_id,
        payor_id: memberSetting?.payor_id ?? null,
        adjustment_date: attendanceRow.attendance_date,
        adjustment_type: "ExtraDay",
        description: `Extra Attendance Day - ${attendanceRow.attendance_date}`,
        quantity: 1,
        unit_rate: rate,
        amount: rate,
        billing_status: "Unbilled",
        invoice_id: null,
        created_by_system: true,
        source_table: "attendanceRecords",
        source_record_id: attendanceRow.id,
        created_at: toEasternISO(),
        updated_at: toEasternISO(),
        created_by_user_id: null,
        created_by_name: input.actorName
      });

      updateMockRecord("attendanceRecords", attendanceRow.id, {
        linked_adjustment_id: created.id
      });
    });
}

export function syncAttendanceBillingForDate(input: { memberId: string; attendanceDate: string; actorName: string }) {
  const db = getMockDb();
  const attendance = db.attendanceRecords.find(
    (row) => row.member_id === input.memberId && row.attendance_date === normalizeDateOnly(input.attendanceDate)
  );
  if (!attendance) return null;

  const memberSetting = getActiveMemberBillingSetting(input.memberId, attendance.attendance_date);
  const schedule = getActiveBillingScheduleTemplate(input.memberId, attendance.attendance_date);
  const centerSetting = getActiveCenterBillingSetting(attendance.attendance_date);
  const scheduledDay = scheduleIncludesDate(schedule, attendance.attendance_date);
  const unscheduledDay = !scheduledDay;
  const billableExtraDay = attendance.status === "present" && unscheduledDay && (memberSetting?.bill_extra_days ?? true);

  const updatedAttendance = updateMockRecord("attendanceRecords", attendance.id, {
    scheduled_day: scheduledDay,
    unscheduled_day: unscheduledDay,
    billable_extra_day: billableExtraDay,
    billing_status: attendance.billing_status ?? "Unbilled"
  });

  if (!updatedAttendance) return null;

  if (!billableExtraDay) {
    excludeUnbilledExtraDayAdjustmentForAttendance(
      attendance.id,
      input.actorName,
      "Attendance is no longer an extra billable day."
    );
    if (attendance.linked_adjustment_id) {
      updateMockRecord("attendanceRecords", attendance.id, { linked_adjustment_id: null });
    }
    return updatedAttendance;
  }

  const existingAdjustment = db.billingAdjustments.find(
    (adjustment) =>
      adjustment.source_table === "attendanceRecords" &&
      adjustment.source_record_id === attendance.id &&
      adjustment.billing_status !== "Excluded"
  );
  if (existingAdjustment) {
    if (attendance.linked_adjustment_id !== existingAdjustment.id) {
      updateMockRecord("attendanceRecords", attendance.id, { linked_adjustment_id: existingAdjustment.id });
    }
    return updatedAttendance;
  }

  const fallbackMemberSetting = {
    id: "",
    member_id: attendance.member_id,
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
    effective_start_date: attendance.attendance_date,
    effective_end_date: null,
    billing_notes: null,
    created_at: toEasternISO(),
    updated_at: toEasternISO(),
    updated_by_user_id: null,
    updated_by_name: null
  } satisfies ReturnType<typeof getMockDb>["memberBillingSettings"][number];

  const rate = resolveExtraDayRate({
    memberId: attendance.member_id,
    memberSetting: memberSetting ?? fallbackMemberSetting,
    centerSetting
  });

  const created = addMockRecord("billingAdjustments", {
    member_id: attendance.member_id,
    payor_id: memberSetting?.payor_id ?? null,
    adjustment_date: attendance.attendance_date,
    adjustment_type: "ExtraDay",
    description: `Extra Attendance Day - ${attendance.attendance_date}`,
    quantity: 1,
    unit_rate: rate,
    amount: rate,
    billing_status: "Unbilled",
    invoice_id: null,
    created_by_system: true,
    source_table: "attendanceRecords",
    source_record_id: attendance.id,
    created_at: toEasternISO(),
    updated_at: toEasternISO(),
    created_by_user_id: null,
    created_by_name: input.actorName
  });

  updateMockRecord("attendanceRecords", attendance.id, {
    linked_adjustment_id: created.id
  });
  return updatedAttendance;
}

function buildInvoiceNumber(monthStartDate: string, memberIndex: number) {
  const yyyymm = monthStartDate.slice(0, 7).replace("-", "");
  return `INV-${yyyymm}-${String(memberIndex + 1).padStart(4, "0")}`;
}

function removeDraftInvoiceForMemberMonth(memberId: string, monthStartDate: string) {
  const db = getMockDb();
  const existing = db.billingInvoices.find(
    (row) => row.member_id === memberId && row.invoice_month === monthStartDate && row.invoice_status === "Draft"
  );
  if (!existing) return;
  db.billingInvoiceLines
    .filter((line) => line.invoice_id === existing.id)
    .forEach((line) => {
      removeMockRecord("billingInvoiceLines", line.id);
    });
  removeMockRecord("billingInvoices", existing.id);
}

function hasLockedInvoiceForMonth(memberId: string, monthStartDate: string) {
  const db = getMockDb();
  return db.billingInvoices.some((invoice) => {
    if (invoice.member_id !== memberId || invoice.invoice_month !== monthStartDate) return false;
    return invoice.invoice_status !== "Draft";
  });
}

interface BillingPreviewRow {
  memberId: string;
  memberName: string;
  payorName: string;
  payorId: string | null;
  billingMode: (typeof BILLING_MODE_OPTIONS)[number];
  monthlyBillingBasis: (typeof MONTHLY_BILLING_BASIS_OPTIONS)[number] | null;
  invoiceMonth: string;
  basePeriodStart: string;
  basePeriodEnd: string;
  variableChargePeriodStart: string;
  variableChargePeriodEnd: string;
  billingMethod: string;
  baseProgramAmount: number;
  transportationAmount: number;
  ancillaryAmount: number;
  adjustmentAmount: number;
  totalAmount: number;
}

interface MemberInvoicePeriods {
  invoiceMonth: string;
  baseRange: DateRange;
  variableRange: DateRange;
  billingModeSnapshot: "Membership" | "Monthly" | "Custom";
}

function resolveMemberInvoicePeriods(input: {
  mode: "Membership" | "Monthly" | "Custom";
  batchType: (typeof BILLING_BATCH_TYPE_OPTIONS)[number];
  invoiceMonthStart: string;
}) {
  if (input.mode === "Membership") {
    return {
      invoiceMonth: input.invoiceMonthStart,
      baseRange: toMonthRange(input.invoiceMonthStart),
      variableRange: toMonthRange(previousMonth(input.invoiceMonthStart)),
      billingModeSnapshot: "Membership" as const
    } satisfies MemberInvoicePeriods;
  }

  if (input.mode === "Monthly") {
    const invoiceMonth =
      input.batchType === "Mixed" ? previousMonth(input.invoiceMonthStart) : input.invoiceMonthStart;
    const baseMonth = previousMonth(invoiceMonth);
    const baseRange = toMonthRange(baseMonth);
    return {
      invoiceMonth,
      baseRange,
      variableRange: baseRange,
      billingModeSnapshot: "Monthly" as const
    } satisfies MemberInvoicePeriods;
  }

  return {
    invoiceMonth: input.invoiceMonthStart,
    baseRange: toMonthRange(input.invoiceMonthStart),
    variableRange: toMonthRange(input.invoiceMonthStart),
    billingModeSnapshot: "Custom" as const
  } satisfies MemberInvoicePeriods;
}

function shouldProcessModeInBatch(input: {
  mode: "Membership" | "Monthly" | "Custom";
  batchType: (typeof BILLING_BATCH_TYPE_OPTIONS)[number];
}) {
  if (input.mode === "Custom") return false;
  if (input.batchType === "Mixed") return input.mode === "Membership" || input.mode === "Monthly";
  return input.mode === input.batchType;
}

function countActualAttendanceBillableDays(input: {
  memberId: string;
  schedule: ReturnType<typeof getMockDb>["billingScheduleTemplates"][number];
  range: DateRange;
}) {
  const db = getMockDb();
  const nonBillableClosures = getNonBillableCenterClosuresByDate(input.range);
  let totalPresent = 0;
  let closureExcluded = 0;
  let coverageExcluded = 0;
  let billableCount = 0;

  db.attendanceRecords
    .filter((row) => row.member_id === input.memberId)
    .filter((row) => row.status === "present")
    .filter((row) => isWithin(row.attendance_date, input.range))
    .forEach((row) => {
      totalPresent += 1;
      const dateOnly = normalizeDateOnly(row.attendance_date);
      if (!scheduleIncludesDate(input.schedule, dateOnly)) return;
      if (nonBillableClosures.has(dateOnly)) {
        closureExcluded += 1;
        return;
      }
      if (isDateCoveredForType(input.memberId, dateOnly, "BaseProgram")) {
        coverageExcluded += 1;
        return;
      }
      billableCount += 1;
    });

  return {
    totalPresent,
    closureExcluded,
    coverageExcluded,
    billableCount
  };
}

function collectVariableLines(input: {
  memberId: string;
  memberSetting: ReturnType<typeof getMockDb>["memberBillingSettings"][number];
  range: DateRange;
  includeTransportation?: boolean;
  includeAncillary?: boolean;
  includeAdjustments?: boolean;
}) {
  const db = getMockDb();
  const includeTransportation = input.includeTransportation ?? true;
  const includeAncillary = input.includeAncillary ?? true;
  const includeAdjustments = input.includeAdjustments ?? true;
  const transportBillingStatus = resolveTransportationBillingStatus({
    memberId: input.memberId,
    memberSetting: input.memberSetting
  });
  const lines: Array<{
    line_type: ReturnType<typeof getMockDb>["billingInvoiceLines"][number]["line_type"];
    service_period_start: string | null;
    service_period_end: string | null;
    service_date: string | null;
    description: string;
    quantity: number;
    unit_rate: number;
    amount: number;
    source_table: string | null;
    source_record_id: string | null;
  }> = [];

  if (includeTransportation) {
    db.transportationLogs
      .filter((row) => row.member_id === input.memberId)
      .filter((row) => isWithin(row.service_date, input.range))
      .filter((row) => row.billing_status === "Unbilled")
      .filter((row) => row.billable !== false)
      .filter(() => transportBillingStatus === "BillNormally")
      .filter((row) => !isDateCoveredForType(input.memberId, normalizeDateOnly(row.service_date), "Transportation"))
      .forEach((row) => {
        lines.push({
          line_type: "Transportation",
          service_period_start: input.range.start,
          service_period_end: input.range.end,
          service_date: row.service_date,
          description: `Transportation - ${row.service_date} (${row.trip_type ?? "OneWay"})`,
          quantity: row.quantity ?? 1,
          unit_rate: toAmount(row.unit_rate ?? row.total_amount ?? 0),
          amount: toAmount(row.total_amount ?? 0),
          source_table: "transportationLogs",
          source_record_id: row.id
        });
      });
  }

  if (includeAncillary) {
    db.ancillaryLogs
      .filter((row) => row.member_id === input.memberId)
      .filter((row) => isWithin(ancillaryChargeDate(row), input.range))
      .filter((row) => ancillaryIsUnbilled(row))
      .filter((row) => row.billable !== false)
      .filter(() => input.memberSetting.bill_ancillary_arrears)
      .filter((row) => !isDateCoveredForType(input.memberId, ancillaryChargeDate(row), "Ancillary"))
      .forEach((row) => {
        const chargeDate = ancillaryChargeDate(row);
        const quantity = Number.isFinite(row.quantity) && Number(row.quantity) > 0 ? Number(row.quantity) : 1;
        lines.push({
          line_type: "Ancillary",
          service_period_start: input.range.start,
          service_period_end: input.range.end,
          service_date: chargeDate,
          description: `${ancillaryChargeType(row)} - ${chargeDate}`,
          quantity,
          unit_rate: ancillaryUnitRateAmount(row),
          amount: ancillaryTotalAmount(row),
          source_table: "ancillaryLogs",
          source_record_id: row.id
        });
      });
  }

  if (includeAdjustments) {
    db.billingAdjustments
      .filter((row) => row.member_id === input.memberId)
      .filter((row) => isWithin(row.adjustment_date, input.range))
      .filter((row) => row.billing_status === "Unbilled")
      .filter((row) => !isDateCoveredForType(input.memberId, normalizeDateOnly(row.adjustment_date), "Adjustment"))
      .forEach((row) => {
        lines.push({
          line_type: row.amount < 0 ? "Credit" : "Adjustment",
          service_period_start: input.range.start,
          service_period_end: input.range.end,
          service_date: row.adjustment_date,
          description: row.description,
          quantity: row.quantity,
          unit_rate: row.unit_rate,
          amount: toAmount(row.amount),
          source_table: "billingAdjustments",
          source_record_id: row.id
        });
      });
  }

  return lines;
}

function buildPreviewRowsForMonth(input: { billingMonth: string; batchType: (typeof BILLING_BATCH_TYPE_OPTIONS)[number] }) {
  const db = getMockDb();
  const invoiceMonthStart = startOfMonth(input.billingMonth);
  const centerSetting = getCenterBillingSettingForGeneration(invoiceMonthStart);

  const members = db.members.filter((member) => member.status === "active");
  const payorMap = payorById();
  const rows: BillingPreviewRow[] = [];

  members.forEach((member) => {
    const modeSetting = getActiveMemberBillingSetting(member.id, invoiceMonthStart);
    if (!modeSetting || !modeSetting.active) return;
    const mode = getEffectiveBillingMode({ memberSetting: modeSetting, centerSetting });
    if (!shouldProcessModeInBatch({ mode, batchType: input.batchType })) return;
    const periods = resolveMemberInvoicePeriods({
      mode,
      batchType: input.batchType,
      invoiceMonthStart
    });
    const effectiveDate = periods.baseRange.start;
    const memberSetting = getActiveMemberBillingSetting(member.id, effectiveDate) ?? modeSetting;
    const schedule = getActiveBillingScheduleTemplate(member.id, effectiveDate);
    if (!memberSetting || !memberSetting.active || !schedule || !schedule.active) return;

    const payor = memberSetting.payor_id ? payorMap.get(memberSetting.payor_id) ?? null : null;
    if (!payor || payor.status !== "active") return;

    const monthlyBasis = mode === "Monthly" ? getMonthlyBillingBasis(memberSetting) : null;

    const dailyRate = resolveDailyRate({ memberId: member.id, memberSetting, centerSetting });
    const scheduledSnapshot = getScheduledBillingDaySnapshotForRange({
      schedule,
      range: periods.baseRange,
      memberId: member.id
    });
    const actualSnapshot =
      monthlyBasis === "ActualAttendanceMonthBehind"
        ? countActualAttendanceBillableDays({
            memberId: member.id,
            schedule,
            range: periods.baseRange
          })
        : null;
    const billedDays =
      memberSetting.flat_monthly_rate != null
        ? 1
        : actualSnapshot
          ? actualSnapshot.billableCount
          : scheduledSnapshot.billableScheduledCount;
    const baseProgramAmount =
      memberSetting.flat_monthly_rate != null
        ? toAmount(memberSetting.flat_monthly_rate)
        : toAmount(billedDays * dailyRate);
    const variableLines = collectVariableLines({
      memberId: member.id,
      memberSetting,
      range: periods.variableRange
    });
    const transportationAmount = toAmount(
      variableLines.filter((line) => line.line_type === "Transportation").reduce((sum, line) => sum + line.amount, 0)
    );
    const ancillaryAmount = toAmount(
      variableLines.filter((line) => line.line_type === "Ancillary").reduce((sum, line) => sum + line.amount, 0)
    );
    const adjustmentAmount = toAmount(
      variableLines
        .filter((line) => line.line_type === "Adjustment" || line.line_type === "Credit")
        .reduce((sum, line) => sum + line.amount, 0)
    );

    rows.push({
      memberId: member.id,
      memberName: member.display_name,
      payorName: payor.payor_name,
      payorId: payor.id,
      billingMode: mode,
      monthlyBillingBasis: monthlyBasis,
      invoiceMonth: periods.invoiceMonth,
      basePeriodStart: periods.baseRange.start,
      basePeriodEnd: periods.baseRange.end,
      variableChargePeriodStart: periods.variableRange.start,
      variableChargePeriodEnd: periods.variableRange.end,
      billingMethod: payor.billing_method,
      baseProgramAmount,
      transportationAmount,
      ancillaryAmount,
      adjustmentAmount,
      totalAmount: toAmount(baseProgramAmount + transportationAmount + ancillaryAmount + adjustmentAmount)
    });
  });

  return rows;
}

export function getBillingGenerationPreview(input: { billingMonth: string; batchType?: (typeof BILLING_BATCH_TYPE_OPTIONS)[number] }) {
  const invoiceMonthStart = startOfMonth(input.billingMonth);
  const rows = buildPreviewRowsForMonth({
    billingMonth: invoiceMonthStart,
    batchType: input.batchType ?? "Mixed"
  });
  return {
    invoiceMonth: invoiceMonthStart,
    rows,
    totalAmount: toAmount(rows.reduce((sum, row) => sum + row.totalAmount, 0))
  };
}

interface BatchGenerationInput {
  billingMonth: string;
  batchType?: (typeof BILLING_BATCH_TYPE_OPTIONS)[number];
  runDate?: string;
  runByUser: string;
  runByName: string;
}

interface FinalizeBatchInput {
  billingBatchId: string;
  finalizedBy: string;
}

interface ReopenBatchInput {
  billingBatchId: string;
  reopenedBy: string;
}

export function generateBillingBatch(input: BatchGenerationInput) {
  const db = getMockDb();
  const invoiceMonthStart = startOfMonth(input.billingMonth);
  const batchType = input.batchType ?? "Mixed";
  const runDate = normalizeDateOnly(input.runDate, toEasternDate());

  const centerSetting = getCenterBillingSettingForGeneration(invoiceMonthStart);
  if (!centerSetting) {
    return { ok: false as const, error: "No active center billing setting found for invoice month." };
  }

  const adjustmentMonthsToEnsure = new Set<string>();
  adjustmentMonthsToEnsure.add(previousMonth(invoiceMonthStart));
  if (batchType === "Mixed" || batchType === "Monthly") {
    adjustmentMonthsToEnsure.add(previousMonth(previousMonth(invoiceMonthStart)));
  }
  adjustmentMonthsToEnsure.forEach((monthStart) => {
    ensureExtraDayAdjustmentsForPriorMonth({
      monthStart,
      centerSetting,
      actorName: input.runByName
    });
  });

  const members = db.members
    .filter((member) => member.status === "active")
    .sort((left, right) => left.display_name.localeCompare(right.display_name, undefined, { sensitivity: "base" }));

  const batch = addMockRecord("billingBatches", {
    batch_type: batchType,
    billing_month: invoiceMonthStart,
    run_date: runDate,
    run_by_user: input.runByUser,
    batch_status: "Draft",
    invoice_count: 0,
    total_amount: 0,
    exported_at: null,
    completion_date: null,
    next_due_date: null,
    notes: null,
    created_at: toEasternISO(),
    updated_at: toEasternISO()
  });

  let invoiceCount = 0;
  let batchTotal = 0;
  let invoiceSequence = 0;

  members.forEach((member) => {
    const modeSetting = getActiveMemberBillingSetting(member.id, invoiceMonthStart);
    if (!modeSetting || !modeSetting.active) return;
    const mode = getEffectiveBillingMode({ memberSetting: modeSetting, centerSetting });
    if (!shouldProcessModeInBatch({ mode, batchType })) return;
    const periods = resolveMemberInvoicePeriods({
      mode,
      batchType,
      invoiceMonthStart
    });
    const effectiveDate = periods.baseRange.start;
    const memberSetting = getActiveMemberBillingSetting(member.id, effectiveDate) ?? modeSetting;
    const schedule = getActiveBillingScheduleTemplate(member.id, effectiveDate);
    if (!memberSetting || !memberSetting.active || !schedule || !schedule.active) return;

    const payor = memberSetting.payor_id ? db.payors.find((row) => row.id === memberSetting.payor_id) ?? null : null;
    if (!payor || payor.status !== "active") return;

    const monthlyBasis = mode === "Monthly" ? getMonthlyBillingBasis(memberSetting) : null;
    if (hasLockedInvoiceForMonth(member.id, periods.invoiceMonth)) return;
    removeDraftInvoiceForMemberMonth(member.id, periods.invoiceMonth);

    const dailyRate = resolveDailyRate({ memberId: member.id, memberSetting, centerSetting });
    const transportationBillingStatusSnapshot = resolveTransportationBillingStatus({
      memberId: member.id,
      memberSetting
    });
    const scheduledSnapshot = getScheduledBillingDaySnapshotForRange({
      schedule,
      range: periods.baseRange,
      memberId: member.id
    });
    const actualSnapshot =
      monthlyBasis === "ActualAttendanceMonthBehind"
        ? countActualAttendanceBillableDays({
            memberId: member.id,
            schedule,
            range: periods.baseRange
          })
        : null;
    const billedDayCount =
      memberSetting.flat_monthly_rate != null
        ? 1
        : actualSnapshot
          ? actualSnapshot.billableCount
          : scheduledSnapshot.billableScheduledCount;
    const lines: Array<{
      line_type: ReturnType<typeof getMockDb>["billingInvoiceLines"][number]["line_type"];
      service_period_start: string | null;
      service_period_end: string | null;
      service_date: string | null;
      description: string;
      quantity: number;
      unit_rate: number;
      amount: number;
      source_table: string | null;
      source_record_id: string | null;
    }> = [];

    const baseProgramAmount =
      memberSetting.flat_monthly_rate != null
        ? toAmount(memberSetting.flat_monthly_rate)
        : toAmount(billedDayCount * dailyRate);

    lines.push({
      line_type: "BaseProgram",
      service_period_start: periods.baseRange.start,
      service_period_end: periods.baseRange.end,
      service_date: null,
      description:
        memberSetting.flat_monthly_rate != null
          ? `Adult Day Services - ${periods.baseRange.start.slice(0, 7)} flat monthly rate`
          : mode === "Monthly" && monthlyBasis === "ActualAttendanceMonthBehind"
            ? `Adult Day Services - ${periods.baseRange.start.slice(0, 7)} - ${billedDayCount} actual attendance day(s)`
            : `Adult Day Services - ${periods.baseRange.start.slice(0, 7)} - ${billedDayCount} scheduled day(s)`,
      quantity: memberSetting.flat_monthly_rate != null ? 1 : billedDayCount,
      unit_rate: memberSetting.flat_monthly_rate != null ? baseProgramAmount : dailyRate,
      amount: baseProgramAmount,
      source_table: null,
      source_record_id: null
    });

    collectVariableLines({
      memberId: member.id,
      memberSetting,
      range: periods.variableRange
    }).forEach((line) => {
      lines.push(line);
    });

    const subtotal = toAmount(lines.reduce((sum, line) => sum + line.amount, 0));
    const transportationAmount = toAmount(
      lines.filter((line) => line.line_type === "Transportation").reduce((sum, line) => sum + line.amount, 0)
    );
    const ancillaryAmount = toAmount(lines.filter((line) => line.line_type === "Ancillary").reduce((sum, line) => sum + line.amount, 0));
    const adjustmentAmount = toAmount(
      lines
        .filter((line) => line.line_type === "Adjustment" || line.line_type === "Credit")
        .reduce((sum, line) => sum + line.amount, 0)
    );

    invoiceSequence += 1;
    const invoice = addMockRecord("billingInvoices", {
      billing_batch_id: batch.id,
      member_id: member.id,
      payor_id: payor.id,
      invoice_number: buildInvoiceNumber(periods.invoiceMonth, invoiceSequence - 1),
      invoice_date: runDate,
      due_date: addDays(runDate, 10),
      invoice_month: periods.invoiceMonth,
      invoice_source: "BatchGenerated",
      billing_mode_snapshot: periods.billingModeSnapshot,
      monthly_billing_basis_snapshot: monthlyBasis,
      base_period_start: periods.baseRange.start,
      base_period_end: periods.baseRange.end,
      variable_charge_period_start: periods.variableRange.start,
      variable_charge_period_end: periods.variableRange.end,
      base_program_billed_days: billedDayCount,
      base_program_day_rate: memberSetting.flat_monthly_rate != null ? null : dailyRate,
      member_daily_rate_snapshot: dailyRate,
      transportation_billing_status_snapshot: transportationBillingStatusSnapshot,
      base_program_closure_excluded_days: actualSnapshot ? actualSnapshot.closureExcluded : scheduledSnapshot.closureExcludedCount,
      base_program_amount: baseProgramAmount,
      transportation_amount: transportationAmount,
      ancillary_amount: ancillaryAmount,
      adjustment_amount: adjustmentAmount,
      prior_balance_amount: 0,
      discount_amount: 0,
      total_amount: subtotal,
      invoice_status: "Draft",
      export_status: "NotExported",
      exported_at: null,
      billing_summary_text: `${member.display_name}: ${periods.billingModeSnapshot} billing, base ${baseProgramAmount.toFixed(2)} (${billedDayCount} day(s)), transport ${transportationAmount.toFixed(2)}, ancillary ${ancillaryAmount.toFixed(2)}, adjustments ${adjustmentAmount.toFixed(2)}.`,
      snapshot_member_billing_id: memberSetting.id,
      snapshot_schedule_template_id: schedule.id,
      snapshot_center_billing_setting_id: centerSetting.id,
      frozen_at: null,
      created_at: toEasternISO(),
      updated_at: toEasternISO()
    });

    lines.forEach((line, lineIndex) => {
      addMockRecord("billingInvoiceLines", {
        invoice_id: invoice.id,
        line_order: lineIndex + 1,
        line_type: line.line_type,
        service_period_start: line.service_period_start,
        service_period_end: line.service_period_end,
        service_date: line.service_date,
        description: line.description,
        quantity: line.quantity,
        unit_rate: toAmount(line.unit_rate),
        amount: toAmount(line.amount),
        source_table: line.source_table,
        source_record_id: line.source_record_id,
        created_at: toEasternISO()
      });
    });

    const lineTotal = toAmount(
      getMockDb()
        .billingInvoiceLines
        .filter((line) => line.invoice_id === invoice.id)
        .reduce((sum, line) => sum + line.amount, 0)
    );
    if (lineTotal !== invoice.total_amount) {
      updateMockRecord("billingInvoices", invoice.id, { total_amount: lineTotal });
    }

    invoiceCount += 1;
    batchTotal = toAmount(batchTotal + lineTotal);
  });

  updateMockRecord("billingBatches", batch.id, {
    invoice_count: invoiceCount,
    total_amount: batchTotal,
    updated_at: toEasternISO()
  });

  if (invoiceCount === 0) {
    removeMockRecord("billingBatches", batch.id);
    return {
      ok: false as const,
      error:
        "No eligible members were found for this run. Confirm active payor assignment, member billing settings, and schedule templates."
    };
  }

  return {
    ok: true as const,
    billingBatchId: batch.id,
    invoiceCount,
    totalAmount: batchTotal
  };
}

function resolveInvoiceSourceRows(invoiceId: string) {
  const db = getMockDb();
  return db.billingInvoiceLines
    .filter((line) => line.invoice_id === invoiceId)
    .filter((line) => Boolean(line.source_table && line.source_record_id));
}

function ensureInvoiceCoverageRecords(invoiceId: string) {
  const db = getMockDb();
  const invoice = db.billingInvoices.find((row) => row.id === invoiceId) ?? null;
  if (!invoice || invoice.invoice_source !== "Custom") return;
  if (invoice.base_program_amount <= 0) return;
  db.billingCoverages
    .filter((row) => row.source_invoice_id === invoice.id && row.coverage_type === "BaseProgram")
    .forEach((row) => {
      removeMockRecord("billingCoverages", row.id);
    });

  const baseDayLines = db.billingInvoiceLines
    .filter((line) => line.invoice_id === invoice.id)
    .filter((line) => line.line_type === "BaseProgram")
    .filter((line) => Boolean(line.service_date));

  if (baseDayLines.length > 0) {
    baseDayLines.forEach((line) => {
      const dateOnly = normalizeDateOnly(line.service_date ?? invoice.base_period_start);
      addMockRecord("billingCoverages", {
        member_id: invoice.member_id,
        coverage_start_date: dateOnly,
        coverage_end_date: dateOnly,
        coverage_type: "BaseProgram",
        source_invoice_id: invoice.id,
        notes: "Custom invoice base program coverage (date-level)",
        created_at: toEasternISO(),
        updated_at: toEasternISO()
      });
    });
    return;
  }

  addMockRecord("billingCoverages", {
    member_id: invoice.member_id,
    coverage_start_date: invoice.base_period_start,
    coverage_end_date: invoice.base_period_end,
    coverage_type: "BaseProgram",
    source_invoice_id: invoice.id,
    notes: "Custom invoice base program coverage",
    created_at: toEasternISO(),
    updated_at: toEasternISO()
  });
}

export function finalizeBillingBatch(input: FinalizeBatchInput) {
  const db = getMockDb();
  const batch = db.billingBatches.find((row) => row.id === input.billingBatchId) ?? null;
  if (!batch) return { ok: false as const, error: "Billing batch not found." };
  if (batch.batch_status === "Closed") return { ok: false as const, error: "Closed batches cannot be finalized." };

  const nowIso = toEasternISO();
  const completionDate = toEasternDate();
  const nextDueDate = addYears(completionDate, 2);

  db.billingInvoices
    .filter((row) => row.billing_batch_id === batch.id)
    .forEach((invoice) => {
      const lineTotal = toAmount(
        db.billingInvoiceLines
          .filter((line) => line.invoice_id === invoice.id)
          .reduce((sum, line) => sum + line.amount, 0)
      );

      updateMockRecord("billingInvoices", invoice.id, {
        total_amount: lineTotal,
        invoice_status: "Finalized",
        frozen_at: nowIso,
        updated_at: nowIso
      });

      resolveInvoiceSourceRows(invoice.id).forEach((line) => {
        if (!line.source_table || !line.source_record_id) return;
        if (line.source_table === "transportationLogs") {
          updateMockRecord("transportationLogs", line.source_record_id, { billing_status: "Billed", invoice_id: invoice.id });
        }
        if (line.source_table === "ancillaryLogs") {
          updateMockRecord("ancillaryLogs", line.source_record_id, { billing_status: "Billed", invoice_id: invoice.id });
        }
        if (line.source_table === "billingAdjustments") {
          updateMockRecord("billingAdjustments", line.source_record_id, { billing_status: "Billed", invoice_id: invoice.id });
        }
      });

      ensureInvoiceCoverageRecords(invoice.id);
    });

  const refreshedInvoices = getMockDb().billingInvoices.filter((row) => row.billing_batch_id === batch.id);
  const batchTotal = toAmount(refreshedInvoices.reduce((sum, row) => sum + row.total_amount, 0));

  updateMockRecord("billingBatches", batch.id, {
    batch_status: "Finalized",
    invoice_count: refreshedInvoices.length,
    total_amount: batchTotal,
    completion_date: completionDate,
    next_due_date: nextDueDate,
    updated_at: nowIso,
    notes: batch.notes
      ? `${batch.notes}\nFinalized by ${input.finalizedBy} on ${completionDate}`
      : `Finalized by ${input.finalizedBy} on ${completionDate}`
  });

  return {
    ok: true as const,
    billingBatchId: batch.id,
    totalAmount: batchTotal,
    invoiceCount: refreshedInvoices.length
  };
}

export function reopenBillingBatch(input: ReopenBatchInput) {
  const db = getMockDb();
  const batch = db.billingBatches.find((row) => row.id === input.billingBatchId) ?? null;
  if (!batch) return { ok: false as const, error: "Billing batch not found." };
  if (batch.batch_status === "Draft") {
    return { ok: false as const, error: "Batch is already in Draft status." };
  }

  const invoices = db.billingInvoices.filter((row) => row.billing_batch_id === batch.id);
  if (invoices.length === 0) {
    return { ok: false as const, error: "No invoices found for billing batch." };
  }

  const nowIso = toEasternISO();
  const today = toEasternDate();

  invoices.forEach((invoice) => {
    resolveInvoiceSourceRows(invoice.id).forEach((line) => {
      if (!line.source_table || !line.source_record_id) return;
      if (line.source_table === "transportationLogs") {
        updateMockRecord("transportationLogs", line.source_record_id, { billing_status: "Unbilled", invoice_id: null });
      }
      if (line.source_table === "ancillaryLogs") {
        updateMockRecord("ancillaryLogs", line.source_record_id, { billing_status: "Unbilled", invoice_id: null });
      }
      if (line.source_table === "billingAdjustments") {
        updateMockRecord("billingAdjustments", line.source_record_id, { billing_status: "Unbilled", invoice_id: null });
      }
    });

    updateMockRecord("billingInvoices", invoice.id, {
      invoice_status: "Draft",
      export_status: "NotExported",
      exported_at: null,
      frozen_at: null,
      updated_at: nowIso
    });
  });

  const refreshedInvoices = getMockDb().billingInvoices.filter((row) => row.billing_batch_id === batch.id);
  const batchTotal = toAmount(refreshedInvoices.reduce((sum, row) => sum + row.total_amount, 0));
  updateMockRecord("billingBatches", batch.id, {
    batch_status: "Draft",
    invoice_count: refreshedInvoices.length,
    total_amount: batchTotal,
    exported_at: null,
    completion_date: null,
    next_due_date: null,
    updated_at: nowIso,
    notes: batch.notes
      ? `${batch.notes}\nReopened by ${input.reopenedBy} on ${today}`
      : `Reopened by ${input.reopenedBy} on ${today}`
  });

  return {
    ok: true as const,
    billingBatchId: batch.id,
    invoiceCount: refreshedInvoices.length,
    totalAmount: batchTotal
  };
}

export function finalizeInvoice(input: { invoiceId: string; finalizedBy: string }) {
  const db = getMockDb();
  const invoice = db.billingInvoices.find((row) => row.id === input.invoiceId) ?? null;
  if (!invoice) return { ok: false as const, error: "Invoice not found." };
  if (invoice.invoice_status !== "Draft") return { ok: false as const, error: "Only draft invoices can be finalized." };

  const nowIso = toEasternISO();
  const lineTotal = toAmount(
    db.billingInvoiceLines
      .filter((line) => line.invoice_id === invoice.id)
      .reduce((sum, line) => sum + line.amount, 0)
  );

  updateMockRecord("billingInvoices", invoice.id, {
    total_amount: lineTotal,
    invoice_status: "Finalized",
    frozen_at: nowIso,
    updated_at: nowIso,
    billing_summary_text: invoice.billing_summary_text
      ? `${invoice.billing_summary_text}\nFinalized by ${input.finalizedBy} on ${toEasternDate()}`
      : `Finalized by ${input.finalizedBy} on ${toEasternDate()}`
  });

  resolveInvoiceSourceRows(invoice.id).forEach((line) => {
    if (!line.source_table || !line.source_record_id) return;
    if (line.source_table === "transportationLogs") {
      updateMockRecord("transportationLogs", line.source_record_id, { billing_status: "Billed", invoice_id: invoice.id });
    }
    if (line.source_table === "ancillaryLogs") {
      updateMockRecord("ancillaryLogs", line.source_record_id, { billing_status: "Billed", invoice_id: invoice.id });
    }
    if (line.source_table === "billingAdjustments") {
      updateMockRecord("billingAdjustments", line.source_record_id, { billing_status: "Billed", invoice_id: invoice.id });
    }
  });

  ensureInvoiceCoverageRecords(invoice.id);

  const batch = db.billingBatches.find((row) => row.id === invoice.billing_batch_id) ?? null;
  if (batch) {
    const batchInvoices = db.billingInvoices.filter((row) => row.billing_batch_id === batch.id);
    const allFinalized = batchInvoices.length > 0 && batchInvoices.every((row) => row.invoice_status !== "Draft");
    updateMockRecord("billingBatches", batch.id, {
      batch_status: allFinalized ? "Finalized" : batch.batch_status,
      invoice_count: batchInvoices.length,
      total_amount: toAmount(batchInvoices.reduce((sum, row) => sum + row.total_amount, 0)),
      updated_at: toEasternISO()
    });
  }

  return { ok: true as const, invoiceId: invoice.id };
}

interface CustomInvoiceManualLine {
  description: string;
  quantity: number;
  unitRate: number;
  amount?: number;
  lineType?: ReturnType<typeof getMockDb>["billingInvoiceLines"][number]["line_type"];
}

interface CreateCustomInvoiceInput {
  memberId: string;
  payorId?: string | null;
  invoiceDate?: string | null;
  dueDate?: string | null;
  periodStart: string;
  periodEnd: string;
  calculationMethod: "DailyRateTimesDates" | "FlatAmount" | "ManualLineItems";
  flatAmount?: number | null;
  useScheduleTemplate?: boolean;
  includeTransportation?: boolean;
  includeAncillary?: boolean;
  includeAdjustments?: boolean;
  manualIncludeDates?: string[];
  manualExcludeDates?: string[];
  manualLineItems?: CustomInvoiceManualLine[];
  notes?: string | null;
  runByUser: string;
  runByName: string;
}

function toDateRange(start: string, end: string): DateRange {
  const normalizedStart = normalizeDateOnly(start);
  const normalizedEnd = normalizeDateOnly(end, normalizedStart);
  return normalizedStart <= normalizedEnd
    ? { start: normalizedStart, end: normalizedEnd }
    : { start: normalizedEnd, end: normalizedStart };
}

function buildCustomInvoiceNumber(periodStart: string, sequence: number) {
  const yyyymm = startOfMonth(periodStart).slice(0, 7).replace("-", "");
  return `CINV-${yyyymm}-${String(sequence).padStart(4, "0")}`;
}

function ensureCustomDraftBatch(input: { billingMonth: string; runDate: string; runByUser: string }) {
  const db = getMockDb();
  const existing = db.billingBatches.find(
    (row) => row.batch_type === "Custom" && row.billing_month === input.billingMonth && row.batch_status === "Draft"
  );
  if (existing) return existing;
  return addMockRecord("billingBatches", {
    batch_type: "Custom",
    billing_month: input.billingMonth,
    run_date: input.runDate,
    run_by_user: input.runByUser,
    batch_status: "Draft",
    invoice_count: 0,
    total_amount: 0,
    exported_at: null,
    completion_date: null,
    next_due_date: null,
    notes: "Custom invoice batch",
    created_at: toEasternISO(),
    updated_at: toEasternISO()
  });
}

function collectDatesForCustomBase(input: {
  memberId: string;
  schedule: ReturnType<typeof getMockDb>["billingScheduleTemplates"][number] | null;
  range: DateRange;
  useScheduleTemplate: boolean;
  manualIncludeDates: string[];
  manualExcludeDates: string[];
}) {
  const includeSet = new Set(input.manualIncludeDates.map((date) => normalizeDateOnly(date)));
  const excludeSet = new Set(input.manualExcludeDates.map((date) => normalizeDateOnly(date)));
  const nonBillableClosures = getNonBillableCenterClosuresByDate(input.range);
  const billableDates = new Set<string>();

  let cursor = input.range.start;
  while (cursor <= input.range.end) {
    const scheduled = input.useScheduleTemplate ? scheduleIncludesDate(input.schedule, cursor) : false;
    if (scheduled || includeSet.has(cursor)) {
      if (!nonBillableClosures.has(cursor) && !excludeSet.has(cursor) && !isDateCoveredForType(input.memberId, cursor, "BaseProgram")) {
        billableDates.add(cursor);
      }
    }
    cursor = addDays(cursor, 1);
  }

  includeSet.forEach((date) => {
    if (date < input.range.start || date > input.range.end) return;
    if (nonBillableClosures.has(date)) return;
    if (excludeSet.has(date)) return;
    if (isDateCoveredForType(input.memberId, date, "BaseProgram")) return;
    billableDates.add(date);
  });

  return [...billableDates].sort((left, right) => (left > right ? 1 : -1));
}

export function createCustomInvoice(input: CreateCustomInvoiceInput) {
  const db = getMockDb();
  const nowDate = normalizeDateOnly(input.invoiceDate, toEasternDate());
  const period = toDateRange(input.periodStart, input.periodEnd);
  const member = db.members.find((row) => row.id === input.memberId) ?? null;
  if (!member) return { ok: false as const, error: "Member not found." };

  const centerSetting = getActiveCenterBillingSetting(period.start);
  if (!centerSetting) return { ok: false as const, error: "No active center billing setting for selected period." };
  const memberSetting = getActiveMemberBillingSetting(input.memberId, period.start);
  const schedule = getActiveBillingScheduleTemplate(input.memberId, period.start);
  if (!memberSetting || !memberSetting.active) return { ok: false as const, error: "Active member billing setting required." };

  const payorId = input.payorId ?? memberSetting.payor_id ?? null;
  if (!payorId) return { ok: false as const, error: "Payor is required for custom invoice." };
  const payor = db.payors.find((row) => row.id === payorId) ?? null;
  if (!payor || payor.status !== "active") return { ok: false as const, error: "Active payor is required for custom invoice." };

  const invoiceMonth = startOfMonth(period.start);
  const batch = ensureCustomDraftBatch({
    billingMonth: invoiceMonth,
    runDate: nowDate,
    runByUser: input.runByUser
  });

  const dailyRate = resolveDailyRate({ memberId: input.memberId, memberSetting, centerSetting });
  const transportationBillingStatusSnapshot = resolveTransportationBillingStatus({
    memberId: input.memberId,
    memberSetting
  });
  const includeTransportation = input.includeTransportation ?? false;
  const includeAncillary = input.includeAncillary ?? false;
  const includeAdjustments = input.includeAdjustments ?? false;
  const useScheduleTemplate = input.useScheduleTemplate ?? true;
  const manualIncludeDates = input.manualIncludeDates ?? [];
  const manualExcludeDates = input.manualExcludeDates ?? [];
  const eligibleDates = collectDatesForCustomBase({
    memberId: input.memberId,
    schedule,
    range: period,
    useScheduleTemplate,
    manualIncludeDates,
    manualExcludeDates
  });

  const lines: Array<{
    line_type: ReturnType<typeof getMockDb>["billingInvoiceLines"][number]["line_type"];
    service_period_start: string | null;
    service_period_end: string | null;
    service_date: string | null;
    description: string;
    quantity: number;
    unit_rate: number;
    amount: number;
    source_table: string | null;
    source_record_id: string | null;
  }> = [];

  if (input.calculationMethod === "DailyRateTimesDates") {
    eligibleDates.forEach((dateOnly) => {
      lines.push({
        line_type: "BaseProgram",
        service_period_start: period.start,
        service_period_end: period.end,
        service_date: dateOnly,
        description: `Custom base program day - ${dateOnly}`,
        quantity: 1,
        unit_rate: dailyRate,
        amount: toAmount(dailyRate),
        source_table: null,
        source_record_id: null
      });
    });
  }

  if (input.calculationMethod === "FlatAmount") {
    const flatAmount = toAmount(input.flatAmount ?? 0);
    lines.push({
      line_type: "BaseProgram",
      service_period_start: period.start,
      service_period_end: period.end,
      service_date: null,
      description: "Custom flat amount",
      quantity: 1,
      unit_rate: flatAmount,
      amount: flatAmount,
      source_table: null,
      source_record_id: null
    });
  }

  if (input.calculationMethod === "ManualLineItems") {
    (input.manualLineItems ?? []).forEach((manualLine) => {
      const quantity = Number.isFinite(manualLine.quantity) ? Math.max(1, Number(manualLine.quantity)) : 1;
      const unitRate = Number.isFinite(manualLine.unitRate) ? Number(manualLine.unitRate) : 0;
      const amount = toAmount(
        manualLine.amount != null && Number.isFinite(manualLine.amount)
          ? Number(manualLine.amount)
          : quantity * unitRate
      );
      lines.push({
        line_type: manualLine.lineType ?? (amount < 0 ? "Credit" : "Adjustment"),
        service_period_start: period.start,
        service_period_end: period.end,
        service_date: null,
        description: manualLine.description || "Manual line item",
        quantity,
        unit_rate: unitRate,
        amount,
        source_table: null,
        source_record_id: null
      });
    });
  }

  collectVariableLines({
    memberId: input.memberId,
    memberSetting,
    range: period,
    includeTransportation,
    includeAncillary,
    includeAdjustments
  }).forEach((line) => {
    lines.push(line);
  });

  const subtotal = toAmount(lines.reduce((sum, line) => sum + line.amount, 0));
  const transportationAmount = toAmount(
    lines.filter((line) => line.line_type === "Transportation").reduce((sum, line) => sum + line.amount, 0)
  );
  const ancillaryAmount = toAmount(
    lines.filter((line) => line.line_type === "Ancillary").reduce((sum, line) => sum + line.amount, 0)
  );
  const adjustmentAmount = toAmount(
    lines
      .filter((line) => line.line_type === "Adjustment" || line.line_type === "Credit")
      .reduce((sum, line) => sum + line.amount, 0)
  );

  const customInvoiceCount = db.billingInvoices.filter((row) => row.invoice_source === "Custom").length + 1;
  const baseLineTotal = toAmount(
    lines
      .filter((line) => line.line_type === "BaseProgram")
      .reduce((sum, line) => sum + line.amount, 0)
  );
  const baseProgramBilledDays =
    input.calculationMethod === "DailyRateTimesDates" ? eligibleDates.length : baseLineTotal > 0 ? 1 : 0;
  const invoice = addMockRecord("billingInvoices", {
    billing_batch_id: batch.id,
    member_id: input.memberId,
    payor_id: payor.id,
    invoice_number: buildCustomInvoiceNumber(period.start, customInvoiceCount),
    invoice_date: nowDate,
    due_date: normalizeDateOnly(input.dueDate, addDays(nowDate, 10)),
    invoice_month: invoiceMonth,
    invoice_source: "Custom",
    billing_mode_snapshot: "Custom",
    monthly_billing_basis_snapshot: null,
    base_period_start: period.start,
    base_period_end: period.end,
    variable_charge_period_start: period.start,
    variable_charge_period_end: period.end,
    base_program_billed_days: baseProgramBilledDays,
    base_program_day_rate: input.calculationMethod === "DailyRateTimesDates" ? dailyRate : null,
    member_daily_rate_snapshot: dailyRate,
    transportation_billing_status_snapshot: transportationBillingStatusSnapshot,
    base_program_closure_excluded_days: 0,
    base_program_amount: baseLineTotal,
    transportation_amount: transportationAmount,
    ancillary_amount: ancillaryAmount,
    adjustment_amount: adjustmentAmount,
    prior_balance_amount: 0,
    discount_amount: 0,
    total_amount: subtotal,
    invoice_status: "Draft",
    export_status: "NotExported",
    exported_at: null,
    billing_summary_text:
      input.notes?.trim()
        ? input.notes.trim()
        : `Custom invoice for ${member.display_name} (${period.start} to ${period.end}).`,
    snapshot_member_billing_id: memberSetting.id,
    snapshot_schedule_template_id: schedule?.id ?? null,
    snapshot_center_billing_setting_id: centerSetting.id,
    frozen_at: null,
    created_at: toEasternISO(),
    updated_at: toEasternISO()
  });

  lines.forEach((line, index) => {
    addMockRecord("billingInvoiceLines", {
      invoice_id: invoice.id,
      line_order: index + 1,
      line_type: line.line_type,
      service_period_start: line.service_period_start,
      service_period_end: line.service_period_end,
      service_date: line.service_date,
      description: line.description,
      quantity: line.quantity,
      unit_rate: toAmount(line.unit_rate),
      amount: toAmount(line.amount),
      source_table: line.source_table,
      source_record_id: line.source_record_id,
      created_at: toEasternISO()
    });
  });

  const refreshedBatchInvoices = db.billingInvoices.filter((row) => row.billing_batch_id === batch.id);
  updateMockRecord("billingBatches", batch.id, {
    invoice_count: refreshedBatchInvoices.length,
    total_amount: toAmount(refreshedBatchInvoices.reduce((sum, row) => sum + row.total_amount, 0)),
    updated_at: toEasternISO()
  });

  return {
    ok: true as const,
    invoiceId: invoice.id,
    eligibleDates
  };
}

export function createEnrollmentProratedInvoice(input: {
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
  const periodStart = normalizeDateOnly(input.effectiveStartDate);
  const periodEnd = normalizeDateOnly(input.periodEndDate, endOfMonth(periodStart));
  return createCustomInvoice({
    memberId: input.memberId,
    payorId: input.payorId ?? null,
    invoiceDate: toEasternDate(),
    dueDate: addDays(toEasternDate(), 10),
    periodStart,
    periodEnd,
    calculationMethod: "DailyRateTimesDates",
    useScheduleTemplate: true,
    includeTransportation: input.includeTransportation ?? false,
    includeAncillary: input.includeAncillary ?? false,
    includeAdjustments: input.includeAdjustments ?? false,
    notes: input.notes ?? "Enrollment prorated custom invoice.",
    runByUser: input.runByUser,
    runByName: input.runByName
  });
}

export function getBillingBatches() {
  const db = getMockDb();
  const today = toEasternDate();
  return db.billingBatches
    .map((row) => {
      const daysUntilDue = row.next_due_date
        ? Math.round(
            (new Date(`${row.next_due_date}T00:00:00.000Z`).getTime() - new Date(`${today}T00:00:00.000Z`).getTime()) /
              (24 * 60 * 60 * 1000)
          )
        : null;
      const dueState =
        daysUntilDue == null
          ? "No due date"
          : daysUntilDue < 0
            ? "Renewal overdue"
            : daysUntilDue <= 30
              ? "Renewal due soon"
              : "On track";
      return {
        ...row,
        daysUntilDue,
        dueState
      };
    })
    .sort((left, right) => (left.run_date < right.run_date ? 1 : -1));
}

export function getDraftInvoices() {
  const db = getMockDb();
  return db.billingInvoices.filter((row) => row.invoice_status === "Draft");
}

export function getFinalizedInvoices() {
  const db = getMockDb();
  return db.billingInvoices.filter((row) => row.invoice_status !== "Draft");
}

export function getCustomInvoices(input?: { status?: "Draft" | "Finalized" | "All" }) {
  const db = getMockDb();
  const status = input?.status ?? "All";
  return db.billingInvoices
    .filter((row) => row.invoice_source === "Custom")
    .filter((row) => {
      if (status === "Draft") return row.invoice_status === "Draft";
      if (status === "Finalized") return row.invoice_status !== "Draft";
      return true;
    })
    .sort((left, right) => (left.invoice_date < right.invoice_date ? 1 : -1));
}

export function getBillingBatchReviewRows(billingBatchId: string) {
  const db = getMockDb();
  const memberNames = fullNameByMemberId();
  const payorNames = payorNameById();
  const payors = payorById();

  return db.billingInvoices
    .filter((invoice) => invoice.billing_batch_id === billingBatchId)
    .map((invoice) => ({
      invoiceId: invoice.id,
      memberName: memberNames.get(invoice.member_id) ?? "Unknown Member",
      payorName: invoice.payor_id ? payorNames.get(invoice.payor_id) ?? "Unknown Payor" : "-",
      baseProgramAmount: invoice.base_program_amount,
      transportationAmount: invoice.transportation_amount,
      ancillaryAmount: invoice.ancillary_amount,
      adjustmentAmount: invoice.adjustment_amount,
      totalAmount: invoice.total_amount,
      invoiceSource: invoice.invoice_source,
      billingMode: invoice.billing_mode_snapshot,
      baseProgramBilledDays: invoice.base_program_billed_days ?? 0,
      baseProgramDayRate: invoice.base_program_day_rate,
      memberDailyRateSnapshot: invoice.member_daily_rate_snapshot,
      transportationBillingStatusSnapshot: invoice.transportation_billing_status_snapshot,
      basePeriodStart: invoice.base_period_start,
      basePeriodEnd: invoice.base_period_end,
      variableChargePeriodStart: invoice.variable_charge_period_start,
      variableChargePeriodEnd: invoice.variable_charge_period_end,
      billingMethod: invoice.payor_id ? payors.get(invoice.payor_id)?.billing_method ?? "-" : "-",
      invoiceStatus: invoice.invoice_status
    }))
    .sort((left, right) => left.memberName.localeCompare(right.memberName, undefined, { sensitivity: "base" }));
}

export function getVariableChargesQueue(input: { month: string }) {
  const db = getMockDb();
  const range = toMonthRange(input.month);

  const transport = db.transportationLogs
    .filter((row) => isWithin(row.service_date, range))
    .map((row) => {
      const serviceDate = normalizeDateOnly(row.service_date, range.start);
      const memberSetting = getActiveMemberBillingSetting(row.member_id, serviceDate);
      const transportStatus = resolveTransportationBillingStatus({
        memberId: row.member_id,
        memberSetting: memberSetting ?? null
      });
      const autoExcluded = transportStatus !== "BillNormally";
      const billable = row.billable !== false && !autoExcluded;
      return {
        type: "Transportation" as const,
        id: row.id,
        memberId: row.member_id,
        memberName: db.members.find((member) => member.id === row.member_id)?.display_name ?? "Unknown Member",
        chargeDate: row.service_date,
        description: `Transportation ${row.trip_type ?? "OneWay"}`,
        amount: toAmount(row.total_amount ?? 0),
        billingStatus: row.billing_status ?? "Unbilled",
        billable,
        exclusionReason:
          autoExcluded
            ? transportStatus === "Waived"
              ? "Waived in MCC attendance billing"
              : "Included in program rate (MCC attendance billing)"
            : row.billing_exclusion_reason
      };
    });

  const ancillary = db.ancillaryLogs
    .filter((row) => isWithin(ancillaryChargeDate(row), range))
    .map((row) => {
      const chargeDate = ancillaryChargeDate(row);
      const memberSetting = getActiveMemberBillingSetting(row.member_id, chargeDate);
      const autoExcluded = memberSetting?.bill_ancillary_arrears === false;
      const billable = row.billable !== false && !autoExcluded;
      return {
        type: "Ancillary" as const,
        id: row.id,
        memberId: row.member_id,
        memberName: db.members.find((member) => member.id === row.member_id)?.display_name ?? "Unknown Member",
        chargeDate,
        description: ancillaryChargeType(row),
        amount: ancillaryTotalAmount(row),
        billingStatus: ancillaryStatus(row),
        billable,
        exclusionReason: autoExcluded ? "Ancillary arrears disabled for member" : row.billing_exclusion_reason
      };
    });

  const adjustments = db.billingAdjustments
    .filter((row) => isWithin(row.adjustment_date, range))
    .map((row) => ({
      type: "Adjustment" as const,
      id: row.id,
      memberId: row.member_id,
      memberName: db.members.find((member) => member.id === row.member_id)?.display_name ?? "Unknown Member",
      chargeDate: row.adjustment_date,
      description: row.description,
      amount: toAmount(row.amount),
      billingStatus: row.billing_status,
      billable: row.billing_status !== "Excluded",
      exclusionReason: row.billing_status === "Excluded" ? "Manually excluded" : null
    }));

  return [...transport, ...ancillary, ...adjustments].sort((left, right) => {
    if (left.chargeDate === right.chargeDate) {
      return left.memberName.localeCompare(right.memberName, undefined, { sensitivity: "base" });
    }
    return left.chargeDate > right.chargeDate ? 1 : -1;
  });
}

function escapeCsv(value: string | number | null | undefined) {
  const stringValue = String(value ?? "");
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function buildQuickBooksCsv(batchId: string) {
  const db = getMockDb();
  const payors = payorById();
  const memberNames = fullNameByMemberId();
  const invoices = db.billingInvoices.filter((row) => row.billing_batch_id === batchId);
  const lines = [
    [
      "InvoiceNumber",
      "InvoiceDate",
      "DueDate",
      "CustomerName",
      "MemberName",
      "LineType",
      "Description",
      "Quantity",
      "UnitRate",
      "Amount",
      "ServicePeriodStart",
      "ServicePeriodEnd",
      "InvoiceSource",
      "BillingModeSnapshot",
      "BasePeriodStart",
      "BasePeriodEnd",
      "VariableChargePeriodStart",
      "VariableChargePeriodEnd"
    ].join(",")
  ];
  invoices.forEach((invoice) => {
    db.billingInvoiceLines
      .filter((line) => line.invoice_id === invoice.id)
      .forEach((line) => {
        lines.push(
          [
            escapeCsv(invoice.invoice_number),
            escapeCsv(invoice.invoice_date),
            escapeCsv(invoice.due_date),
            escapeCsv(invoice.payor_id ? payors.get(invoice.payor_id)?.payor_name ?? "" : ""),
            escapeCsv(memberNames.get(invoice.member_id) ?? ""),
            escapeCsv(line.line_type),
            escapeCsv(line.description),
            escapeCsv(line.quantity),
            escapeCsv(line.unit_rate.toFixed(2)),
            escapeCsv(line.amount.toFixed(2)),
            escapeCsv(line.service_period_start),
            escapeCsv(line.service_period_end),
            escapeCsv(invoice.invoice_source),
            escapeCsv(invoice.billing_mode_snapshot),
            escapeCsv(invoice.base_period_start),
            escapeCsv(invoice.base_period_end),
            escapeCsv(invoice.variable_charge_period_start),
            escapeCsv(invoice.variable_charge_period_end)
          ].join(",")
        );
      });
  });
  return lines.join("\n");
}

function buildInternalReviewCsv(batchId: string) {
  const db = getMockDb();
  const memberNames = fullNameByMemberId();
  const payors = payorById();
  const lines = [
    [
      "InvoiceNumber",
      "InvoiceMonth",
      "MemberName",
      "PayorName",
      "BaseProgramAmount",
      "TransportationAmount",
      "AncillaryAmount",
      "AdjustmentAmount",
      "DiscountAmount",
      "TotalAmount",
      "BillingMethod",
      "InvoiceStatus",
      "InvoiceSource",
      "BillingModeSnapshot",
      "BasePeriodStart",
      "BasePeriodEnd",
      "VariableChargePeriodStart",
      "VariableChargePeriodEnd"
    ].join(",")
  ];
  db.billingInvoices
    .filter((row) => row.billing_batch_id === batchId)
    .forEach((invoice) => {
      const payor = invoice.payor_id ? payors.get(invoice.payor_id) ?? null : null;
      lines.push(
        [
          escapeCsv(invoice.invoice_number),
          escapeCsv(invoice.invoice_month),
          escapeCsv(memberNames.get(invoice.member_id) ?? ""),
          escapeCsv(payor?.payor_name ?? ""),
          escapeCsv(invoice.base_program_amount.toFixed(2)),
          escapeCsv(invoice.transportation_amount.toFixed(2)),
          escapeCsv(invoice.ancillary_amount.toFixed(2)),
          escapeCsv(invoice.adjustment_amount.toFixed(2)),
          escapeCsv(invoice.discount_amount.toFixed(2)),
          escapeCsv(invoice.total_amount.toFixed(2)),
          escapeCsv(payor?.billing_method ?? ""),
          escapeCsv(invoice.invoice_status),
          escapeCsv(invoice.invoice_source),
          escapeCsv(invoice.billing_mode_snapshot),
          escapeCsv(invoice.base_period_start),
          escapeCsv(invoice.base_period_end),
          escapeCsv(invoice.variable_charge_period_start),
          escapeCsv(invoice.variable_charge_period_end)
        ].join(",")
      );
    });
  return lines.join("\n");
}

function buildInvoiceSummaryCsv(batchId: string) {
  const db = getMockDb();
  const memberNames = fullNameByMemberId();
  const payors = payorById();
  const lines = [
    [
      "InvoiceNumber",
      "PayorName",
      "BillingEmail",
      "MemberName",
      "InvoiceDate",
      "DueDate",
      "BillingSummaryText",
      "TotalAmount",
      "InvoiceSource",
      "BillingModeSnapshot",
      "BasePeriodStart",
      "BasePeriodEnd",
      "VariableChargePeriodStart",
      "VariableChargePeriodEnd"
    ].join(",")
  ];
  db.billingInvoices
    .filter((row) => row.billing_batch_id === batchId)
    .forEach((invoice) => {
      const payor = invoice.payor_id ? payors.get(invoice.payor_id) ?? null : null;
      lines.push(
        [
          escapeCsv(invoice.invoice_number),
          escapeCsv(payor?.payor_name ?? ""),
          escapeCsv(payor?.billing_email ?? ""),
          escapeCsv(memberNames.get(invoice.member_id) ?? ""),
          escapeCsv(invoice.invoice_date),
          escapeCsv(invoice.due_date),
          escapeCsv(invoice.billing_summary_text),
          escapeCsv(invoice.total_amount.toFixed(2)),
          escapeCsv(invoice.invoice_source),
          escapeCsv(invoice.billing_mode_snapshot),
          escapeCsv(invoice.base_period_start),
          escapeCsv(invoice.base_period_end),
          escapeCsv(invoice.variable_charge_period_start),
          escapeCsv(invoice.variable_charge_period_end)
        ].join(",")
      );
    });
  return lines.join("\n");
}

export function createBillingExport(input: {
  billingBatchId: string;
  exportType: (typeof BILLING_EXPORT_TYPES)[number];
  generatedBy: string;
}) {
  const db = getMockDb();
  const batch = db.billingBatches.find((row) => row.id === input.billingBatchId) ?? null;
  if (!batch) return { ok: false as const, error: "Billing batch not found." };
  if (batch.batch_status === "Draft" || batch.batch_status === "Reviewed") {
    return { ok: false as const, error: "Only finalized/exported batches can be exported." };
  }

  const csv =
    input.exportType === "QuickBooksCSV"
      ? buildQuickBooksCsv(input.billingBatchId)
      : input.exportType === "InternalReviewCSV"
        ? buildInternalReviewCsv(input.billingBatchId)
        : buildInvoiceSummaryCsv(input.billingBatchId);
  const prefix =
    input.exportType === "QuickBooksCSV"
      ? "quickbooks-friendly"
      : input.exportType === "InternalReviewCSV"
        ? "internal-review"
        : "invoice-summary";
  const fileName = `${prefix}-${batch.billing_month}.csv`;
  const fileDataUrl = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;

  const job = addMockRecord("billingExportJobs", {
    billing_batch_id: input.billingBatchId,
    export_type: input.exportType,
    generated_at: toEasternISO(),
    generated_by: input.generatedBy,
    file_name: fileName,
    status: "Success",
    notes: `Export generated for ${batch.billing_month}.`,
    file_data_url: fileDataUrl
  });

  updateMockRecord("billingBatches", batch.id, {
    batch_status: batch.batch_status === "Finalized" ? "Exported" : batch.batch_status,
    exported_at: toEasternISO(),
    updated_at: toEasternISO()
  });

  db.billingInvoices
    .filter((row) => row.billing_batch_id === batch.id)
    .forEach((invoice) => {
      updateMockRecord("billingInvoices", invoice.id, {
        export_status: "Exported",
        exported_at: toEasternISO(),
        updated_at: toEasternISO()
      });
    });

  return {
    ok: true as const,
    exportJobId: job.id,
    fileName,
    fileDataUrl
  };
}

export function getBillingExports() {
  const db = getMockDb();
  return [...db.billingExportJobs].sort((left, right) => (left.generated_at < right.generated_at ? 1 : -1));
}

export interface BillingDashboardSummary {
  projectedNextMonthBaseRevenue: number;
  priorMonthTransportationWaiting: number;
  priorMonthAncillaryWaiting: number;
  currentDraftBatchTotal: number;
  finalizedBatchTotalsByMonth: Array<{ billingMonth: string; totalAmount: number }>;
}

function getProjectedBaseRevenueForMonth(monthStartInput: string) {
  const db = getMockDb();
  const invoiceMonthStart = startOfMonth(monthStartInput);
  const centerSetting = getActiveCenterBillingSetting(invoiceMonthStart);
  if (!centerSetting) return 0;

  let total = 0;
  db.members
    .filter((member) => member.status === "active")
    .forEach((member) => {
      const memberSetting = getActiveMemberBillingSetting(member.id, invoiceMonthStart);
      const schedule = getActiveBillingScheduleTemplate(member.id, invoiceMonthStart);
      if (!memberSetting || !memberSetting.active || !schedule || !schedule.active) return;

      const payor =
        memberSetting.payor_id != null ? db.payors.find((row) => row.id === memberSetting.payor_id) ?? null : null;
      if (!payor || payor.status !== "active") return;

      const mode = getEffectiveBillingMode({ memberSetting, centerSetting });
      if (mode !== "Membership") return;

      const period = resolveMemberInvoicePeriods({
        mode,
        batchType: "Membership",
        invoiceMonthStart
      });
      const billedDays =
        memberSetting.flat_monthly_rate != null
          ? 1
          : getScheduledBillingDaySnapshotForRange({
              schedule,
              range: period.baseRange,
              memberId: member.id
            }).billableScheduledCount;
      const amount =
        memberSetting.flat_monthly_rate != null
          ? toAmount(memberSetting.flat_monthly_rate)
          : toAmount(billedDays * resolveDailyRate({ memberId: member.id, memberSetting, centerSetting }));
      total = toAmount(total + amount);
    });

  return toAmount(total);
}

export function getBillingDashboardSummary(): BillingDashboardSummary {
  const db = getMockDb();
  const nextMonth = addMonths(startOfMonth(toEasternDate()), 1);
  const priorMonth = previousMonth(startOfMonth(toEasternDate()));
  const priorRange = toMonthRange(priorMonth);

  const projectedNextMonthBaseRevenue = getProjectedBaseRevenueForMonth(nextMonth);
  const priorMonthTransportationWaiting = db.transportationLogs
    .filter((row) => isWithin(row.service_date, priorRange))
    .filter((row) => row.billing_status === "Unbilled")
    .filter((row) => row.billable !== false)
    .reduce((sum, row) => sum + toAmount(row.total_amount ?? 0), 0);
  const priorMonthAncillaryWaiting = db.ancillaryLogs
    .filter((row) => isWithin(ancillaryChargeDate(row), priorRange))
    .filter((row) => ancillaryIsUnbilled(row))
    .filter((row) => row.billable !== false)
    .reduce((sum, row) => sum + ancillaryTotalAmount(row), 0);
  const currentDraftBatchTotal = db.billingBatches
    .filter((row) => row.batch_status === "Draft")
    .reduce((sum, row) => sum + toAmount(row.total_amount), 0);
  const finalizedBatchTotalsByMonth = db.billingBatches
    .filter((row) => row.batch_status === "Finalized" || row.batch_status === "Exported" || row.batch_status === "Closed")
    .sort((left, right) => (left.billing_month < right.billing_month ? 1 : -1))
    .map((row) => ({
      billingMonth: row.billing_month,
      totalAmount: toAmount(row.total_amount)
    }));
  return {
    projectedNextMonthBaseRevenue: toAmount(projectedNextMonthBaseRevenue),
    priorMonthTransportationWaiting: toAmount(priorMonthTransportationWaiting),
    priorMonthAncillaryWaiting: toAmount(priorMonthAncillaryWaiting),
    currentDraftBatchTotal: toAmount(currentDraftBatchTotal),
    finalizedBatchTotalsByMonth
  };
}

export function getBillingModuleIndex() {
  const db = getMockDb();
  const batches = getBillingBatches();
  return {
    payorCount: db.payors.filter((row) => row.status === "active").length,
    memberBillingSettingCount: db.memberBillingSettings.filter((row) => row.active).length,
    scheduleTemplateCount: db.billingScheduleTemplates.filter((row) => row.active).length,
    latestBatch: batches[0] ?? null,
    dashboard: getBillingDashboardSummary()
  };
}

export function setVariableChargeBillingStatus(input: {
  table: "transportationLogs" | "ancillaryLogs" | "billingAdjustments";
  id: string;
  billingStatus: "Unbilled" | "Billed" | "Excluded";
  exclusionReason?: string | null;
}) {
  if (input.table === "transportationLogs") {
    return updateMockRecord("transportationLogs", input.id, {
      billing_status: input.billingStatus,
      billing_exclusion_reason: input.billingStatus === "Excluded" ? input.exclusionReason ?? "Excluded during review" : null
    });
  }
  if (input.table === "ancillaryLogs") {
    return updateMockRecord("ancillaryLogs", input.id, {
      billing_status: input.billingStatus,
      billing_exclusion_reason: input.billingStatus === "Excluded" ? input.exclusionReason ?? "Excluded during review" : null
    });
  }
  return updateMockRecord("billingAdjustments", input.id, {
    billing_status: input.billingStatus
  });
}
