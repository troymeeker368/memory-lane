import { randomUUID } from "node:crypto";

import { createClient } from "@/lib/supabase/server";
import {
  BILLING_ADJUSTMENT_TYPE_OPTIONS,
  BILLING_BATCH_TYPE_OPTIONS,
  BILLING_EXPORT_TYPES,
  CENTER_CLOSURE_TYPE_OPTIONS,
  type AttendanceSettingWeekdays,
  type BatchGenerationInput,
  type BillingExpectedAttendanceCollectionInput,
  type BillingExpectedAttendanceInput,
  type BillingPreviewRow,
  type BillingSettingRow,
  type CenterBillingSettingRow,
  type ClosureRuleRow,
  type CustomInvoiceManualLine,
  type CreateCustomInvoiceInput,
  type DateRange,
  type FinalizeBatchInput,
  type ReopenBatchInput,
  type ScheduleTemplateRow
} from "@/lib/services/billing-types";
import {
  addDays,
  addMonths,
  asNumber,
  attendanceSettingIncludesDate,
  buildCustomInvoiceNumber,
  endOfMonth,
  escapeCsv,
  isWithin,
  normalizeDateOnly,
  previousMonth,
  randomTextId,
  scheduleIncludesDate,
  startOfMonth,
  toAmount,
  toDateRange,
  toMonthRange,
  weekdayKey
} from "@/lib/services/billing-utils";
import {
  buildBillingBatchWritePlan,
  invokeCreateBillingExportRpc,
  invokeGenerateBillingBatchRpc
} from "@/lib/services/billing-rpc";
import {
  formatBillingPayorDisplayName,
  listBillingPayorContactsForMembers
} from "@/lib/services/billing-payor-contacts";
import {
  resolveActiveEffectiveMemberRowForDate,
  resolveActiveEffectiveRowForDate,
  resolveConfiguredDailyRate,
  resolveEffectiveBillingMode
} from "@/lib/services/billing-effective";
import {
  buildMemberContactsSchemaOutOfDateError,
  isMemberContactsPayorColumnMissingError
} from "@/lib/services/member-contact-payor-schema";
import { generateClosureDatesFromRules } from "@/lib/services/closure-rules";
import {
  loadExpectedAttendanceSupabaseContext,
  resolveExpectedAttendanceFromSupabaseContext
} from "@/lib/services/expected-attendance-supabase";
import {
  isMemberHoldActiveForDate,
  resolveExpectedAttendanceForDate
} from "@/lib/services/expected-attendance";
import { toEasternDate, toEasternISO } from "@/lib/timezone";
import {
  recordImmediateSystemAlert,
  recordWorkflowEvent
} from "@/lib/services/workflow-observability";

export {
  BILLING_ADJUSTMENT_TYPE_OPTIONS,
  BILLING_BATCH_TYPE_OPTIONS,
  BILLING_EXPORT_TYPES,
  CENTER_CLOSURE_TYPE_OPTIONS,
  MONTHLY_BILLING_BASIS_OPTIONS,
  BILLING_MODE_OPTIONS
} from "@/lib/services/billing-types";
export type { BillingModuleRole } from "@/lib/services/billing-types";
export {
  resolveActiveEffectiveMemberRowForDate,
  resolveActiveEffectiveRowForDate,
  resolveConfiguredDailyRate,
  resolveEffectiveBillingMode
} from "@/lib/services/billing-effective";

function toWeekdayOnlyBaseSchedule(input: AttendanceSettingWeekdays | ScheduleTemplateRow | null | undefined) {
  if (!input) return null;
  return {
    monday: Boolean(input.monday),
    tuesday: Boolean(input.tuesday),
    wednesday: Boolean(input.wednesday),
    thursday: Boolean(input.thursday),
    friday: Boolean(input.friday)
  };
}

function isCanonicalScheduledForBillingDate(
  input: {
    dateOnly: string;
    includeBySchedule: boolean;
    baseSchedule: AttendanceSettingWeekdays | ScheduleTemplateRow | null | undefined;
    holds: BillingExpectedAttendanceInput["holds"];
    scheduleChanges: BillingExpectedAttendanceInput["scheduleChanges"];
    nonBillableClosures: Set<string>;
  }
) {
  if (!input.includeBySchedule) return false;
  if (input.nonBillableClosures.has(input.dateOnly)) return false;

  const day = weekdayKey(input.dateOnly);
  if (day === "saturday" || day === "sunday") {
    return !input.holds.some((hold) => isMemberHoldActiveForDate(hold, input.dateOnly));
  }

  const resolution = resolveExpectedAttendanceForDate({
    date: input.dateOnly,
    baseSchedule: toWeekdayOnlyBaseSchedule(input.baseSchedule),
    scheduleChanges: input.scheduleChanges,
    holds: input.holds,
    centerClosures: input.nonBillableClosures.has(input.dateOnly) ? [{ closure_date: input.dateOnly }] : []
  });
  return resolution.isScheduled;
}

function collectBillingEligibleBaseDates(
  input: {
    range: DateRange;
    schedule: ScheduleTemplateRow | null;
    attendanceSetting: AttendanceSettingWeekdays | null;
    includeAllWhenNoSchedule: boolean;
    holds: BillingExpectedAttendanceCollectionInput["holds"];
    scheduleChanges: BillingExpectedAttendanceCollectionInput["scheduleChanges"];
    nonBillableClosures: Set<string>;
  }
) {
  const dates = new Set<string>();
  let cursor = input.range.start;
  while (cursor <= input.range.end) {
    const includeBySchedule = input.includeAllWhenNoSchedule
      ? true
      : input.schedule
        ? scheduleIncludesDate(input.schedule, cursor)
        : attendanceSettingIncludesDate(input.attendanceSetting, cursor);
    if (
      isCanonicalScheduledForBillingDate({
        dateOnly: cursor,
        includeBySchedule,
        baseSchedule: input.schedule ?? input.attendanceSetting,
        holds: input.holds,
        scheduleChanges: input.scheduleChanges,
        nonBillableClosures: input.nonBillableClosures
      })
    ) {
      dates.add(cursor);
    }
    cursor = addDays(cursor, 1);
  }
  return dates;
}

function normalizeYear(value: number) {
  if (!Number.isFinite(value)) return Number(toEasternDate().slice(0, 4));
  return Math.max(2000, Math.min(2100, Math.round(value)));
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

async function listCenterBillingSettingsRows() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("center_billing_settings").select("*").order("effective_start_date", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as CenterBillingSettingRow[];
}

async function getMemberSettingsRows() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("member_billing_settings").select("*");
  if (error) throw new Error(error.message);
  return (data ?? []) as BillingSettingRow[];
}

async function getScheduleTemplatesRows() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("billing_schedule_templates").select("*");
  if (error) throw new Error(error.message);
  return (data ?? []) as ScheduleTemplateRow[];
}

async function getActiveCenterSettingForDate(dateOnly: string) {
  const settings = await listCenterBillingSettingsRows();
  return resolveActiveEffectiveRowForDate(dateOnly, settings);
}

async function getActiveMemberSettingForDate(memberId: string, dateOnly: string) {
  const settings = await getMemberSettingsRows();
  return resolveActiveEffectiveMemberRowForDate(memberId, dateOnly, settings);
}

async function getActiveScheduleTemplateForDate(memberId: string, dateOnly: string) {
  const templates = await getScheduleTemplatesRows();
  return resolveActiveEffectiveMemberRowForDate(memberId, dateOnly, templates);
}

async function getNonBillableCenterClosureSet(range: DateRange) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("center_closures")
    .select("closure_date")
    .eq("active", true)
    .eq("billable_override", false)
    .gte("closure_date", range.start)
    .lte("closure_date", range.end);
  if (error) {
    handleNonCriticalMissingSchemaError(error, {
      objectName: "center_closures",
      migration: "0012_legacy_operational_health_alignment.sql"
    });
    throw new Error(error.message);
  }
  return new Set((data ?? []).map((row: any) => normalizeDateOnly(row.closure_date)));
}

export async function listClosureRules() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("closure_rules").select("*").order("name", { ascending: true });
  if (error) {
    handleNonCriticalMissingSchemaError(error, {
      objectName: "closure_rules",
      migration: "0012_legacy_operational_health_alignment.sql"
    });
    throw new Error(error.message);
  }
  return (data ?? []) as Array<any>;
}

export async function generateClosuresForYear(year: number, input?: { generatedByUserId?: string | null; generatedByName?: string | null }) {
  const supabase = await createClient();
  const targetYear = normalizeYear(year);
  const { data: rulesData, error: ruleError } = await supabase
    .from("closure_rules")
    .select("*")
    .eq("active", true);
  if (ruleError) {
    handleNonCriticalMissingSchemaError(ruleError, {
      objectName: "closure_rules",
      migration: "0012_legacy_operational_health_alignment.sql"
    });
    throw new Error(ruleError.message);
  }
  const rules = (rulesData ?? []) as ClosureRuleRow[];
  const generated = generateClosureDatesFromRules({ year: targetYear, rules });

  const { data: existingRows, error: existingError } = await supabase
    .from("center_closures")
    .select("closure_date")
    .gte("closure_date", `${targetYear}-01-01`)
    .lte("closure_date", `${targetYear}-12-31`);
  if (existingError) {
    handleNonCriticalMissingSchemaError(existingError, {
      objectName: "center_closures",
      migration: "0012_legacy_operational_health_alignment.sql"
    });
    throw new Error(existingError.message);
  }

  const existingDates = new Set((existingRows ?? []).map((row: any) => normalizeDateOnly(row.closure_date)));
  let insertedCount = 0;

  for (const row of generated) {
    if (existingDates.has(row.date)) continue;
    existingDates.add(row.date);
    const { error: insertError } = await supabase.from("center_closures").insert({
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
    if (insertError) {
      handleNonCriticalMissingSchemaError(insertError, {
        objectName: "center_closures",
        migration: "0012_legacy_operational_health_alignment.sql"
      });
      throw new Error(insertError.message);
    }
    insertedCount += 1;
  }

  return { year: targetYear, generatedCount: generated.length, insertedCount };
}

export async function ensureCenterClosuresForCurrentAndNextYear(input?: { generatedByUserId?: string | null; generatedByName?: string | null }) {
  const currentYear = Number(toEasternDate().slice(0, 4));
  const years = [currentYear, currentYear + 1];
  const results: Array<{ year: number; generatedCount: number; insertedCount: number }> = [];
  for (const year of years) {
    results.push(await generateClosuresForYear(year, input));
  }
  return results;
}

export async function getActiveCenterBillingSetting(dateOnly: string) {
  return getActiveCenterSettingForDate(dateOnly);
}

export async function getActiveMemberBillingSetting(memberId: string, dateOnly: string) {
  return getActiveMemberSettingForDate(memberId, dateOnly);
}

export async function getActiveBillingScheduleTemplate(memberId: string, dateOnly: string) {
  return getActiveScheduleTemplateForDate(memberId, dateOnly);
}

export async function getMemberAttendanceBillingSetting(memberId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("member_attendance_schedules")
    .select("member_id, daily_rate, custom_daily_rate, default_daily_rate, transportation_billing_status, billing_rate_effective_date, billing_notes")
    .eq("member_id", memberId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const schedule = data as any;
  if (!schedule) return null;

  const dailyRateCandidate = [schedule.daily_rate, schedule.custom_daily_rate, schedule.default_daily_rate]
    .map((value) => (Number.isFinite(value) ? Number(value) : null))
    .find((value): value is number => value != null && value > 0);
  return {
    memberId,
    dailyRate: dailyRateCandidate ?? null,
    transportationBillingStatus: (schedule.transportation_billing_status ?? "BillNormally") as "BillNormally" | "Waived" | "IncludedInProgramRate",
    billingRateEffectiveDate: schedule.billing_rate_effective_date ?? null,
    billingNotes: schedule.billing_notes ?? null
  };
}
export async function validateMemberBillingSettingOverlap(input: {
  memberId: string;
  effectiveStartDate: string;
  effectiveEndDate: string | null;
  active: boolean;
  excludeId?: string;
}) {
  if (!input.active) return { ok: true as const };
  const settings = await getMemberSettingsRows();
  const overlap = settings.find((row) => {
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

export async function validateCenterBillingSettingOverlap(input: {
  effectiveStartDate: string;
  effectiveEndDate: string | null;
  active: boolean;
  excludeId?: string;
}) {
  if (!input.active) return { ok: true as const };
  const settings = await listCenterBillingSettingsRows();
  const overlap = settings.find((row) => {
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

export async function validateScheduleTemplateOverlap(input: {
  memberId: string;
  effectiveStartDate: string;
  effectiveEndDate: string | null;
  active: boolean;
  excludeId?: string;
}) {
  if (!input.active) return { ok: true as const };
  const templates = await getScheduleTemplatesRows();
  const overlap = templates.find((row) => {
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

export async function listPayors() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("payors").select("*").order("payor_name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<any>;
}

export async function listCenterClosures(input?: { includeInactive?: boolean }) {
  await ensureCenterClosuresForCurrentAndNextYear();
  const supabase = await createClient();
  let query = supabase.from("center_closures").select("*").order("closure_date", { ascending: false });
  if (!input?.includeInactive) {
    query = query.eq("active", true);
  }
  const { data, error } = await query;
  if (error) {
    handleNonCriticalMissingSchemaError(error, {
      objectName: "center_closures",
      migration: "0012_legacy_operational_health_alignment.sql"
    });
    throw new Error(error.message);
  }
  return (data ?? []) as Array<any>;
}

export async function listMemberBillingSettings() {
  const supabase = await createClient();
  const [{ data: settingsData, error: settingsError }, { data: membersData }] = await Promise.all([
    supabase.from("member_billing_settings").select("*").order("effective_start_date", { ascending: false }),
    supabase.from("members").select("id, display_name")
  ]);
  if (settingsError) throw new Error(settingsError.message);

  const settingsRows = (settingsData ?? []) as Array<any>;
  const memberNameById = new Map((membersData ?? []).map((row: any) => [String(row.id), String(row.display_name)] as const));
  const payorByMember = await listBillingPayorContactsForMembers(
    settingsRows.map((row) => String(row.member_id))
  );

  return settingsRows.map((row: any) => ({
    ...row,
    member_name: memberNameById.get(String(row.member_id)) ?? "Unknown Member",
    payor_name: formatBillingPayorDisplayName(
      payorByMember.get(String(row.member_id)) ?? {
        status: "missing",
        contact_id: null,
        member_id: String(row.member_id),
        full_name: null,
        relationship_to_member: null,
        email: null,
        cellular_number: null,
        work_number: null,
        home_number: null,
        phone: null,
        address_line_1: null,
        address_line_2: null,
        city: null,
        state: null,
        postal_code: null,
        quickbooks_customer_id: null,
        multiple_contact_ids: []
      }
    )
  }));
}

export async function listBillingScheduleTemplates() {
  const supabase = await createClient();
  const [{ data: templatesData, error: templatesError }, { data: membersData }] = await Promise.all([
    supabase.from("billing_schedule_templates").select("*").order("effective_start_date", { ascending: false }),
    supabase.from("members").select("id, display_name")
  ]);
  if (templatesError) throw new Error(templatesError.message);

  const memberNameById = new Map((membersData ?? []).map((row: any) => [String(row.id), String(row.display_name)] as const));
  return (templatesData ?? []).map((row: any) => ({
    ...row,
    member_name: memberNameById.get(String(row.member_id)) ?? "Unknown Member"
  }));
}

async function getMembersAndPayorsForLookup() {
  const supabase = await createClient();
  const { data: members } = await supabase
    .from("members")
    .select("id, display_name, status")
    .eq("status", "active")
    .order("display_name", { ascending: true });

  const membersList = (members ?? []).map((row: any) => ({ id: String(row.id), displayName: String(row.display_name) }));
  const canonicalPayors = await listBillingPayorContactsForMembers(membersList.map((row) => row.id));
  const payorsList = membersList.reduce<Array<{ id: string; payorName: string }>>((acc, member) => {
    const payor = canonicalPayors.get(member.id);
    if (payor && payor.status === "ok" && payor.contact_id) {
      acc.push({ id: String(payor.contact_id), payorName: formatBillingPayorDisplayName(payor) });
    }
    return acc;
  }, []);
  const memberPayorIdsByMember = membersList.reduce<Record<string, string[]>>((acc, member) => {
    const payor = canonicalPayors.get(member.id);
    acc[member.id] = payor?.status === "ok" && payor.contact_id ? [payor.contact_id] : [];
    return acc;
  }, {});
  const payorByMember = membersList.reduce<
    Record<string, { contactId: string | null; displayName: string; status: "ok" | "missing" | "invalid_multiple" }>
  >((acc, member) => {
    const payor = canonicalPayors.get(member.id);
    if (!payor) {
      acc[member.id] = {
        contactId: null,
        displayName: "No payor contact designated",
        status: "missing"
      };
      return acc;
    }
    acc[member.id] = {
      contactId: payor.contact_id,
      displayName: formatBillingPayorDisplayName(payor),
      status: payor.status
    };
    return acc;
  }, {});

  return {
    members: membersList,
    payors: payorsList,
    memberPayorIdsByMember,
    payorByMember
  };
}

export async function getBillingMemberPayorLookups() {
  return getMembersAndPayorsForLookup();
}

export async function upsertCenterClosure(input: {
  id?: string;
  closure_date: string;
  closure_name: string;
  closure_type: (typeof CENTER_CLOSURE_TYPE_OPTIONS)[number];
  billable_override: boolean;
  notes: string | null;
  active: boolean;
  updated_by_user_id: string;
  updated_by_name: string;
}) {
  const supabase = await createClient();
  if (input.id) {
    const { data, error } = await supabase
      .from("center_closures")
      .update({
        closure_date: input.closure_date,
        closure_name: input.closure_name,
        closure_type: input.closure_type,
        billable_override: input.billable_override,
        notes: input.notes,
        active: input.active,
        updated_at: toEasternISO(),
        updated_by_user_id: input.updated_by_user_id,
        updated_by_name: input.updated_by_name
      })
      .eq("id", input.id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  const { data, error } = await supabase
    .from("center_closures")
    .insert({
      closure_date: input.closure_date,
      closure_name: input.closure_name,
      closure_type: input.closure_type,
      billable_override: input.billable_override,
      notes: input.notes,
      active: input.active,
      auto_generated: false,
      created_at: toEasternISO(),
      updated_at: toEasternISO(),
      updated_by_user_id: input.updated_by_user_id,
      updated_by_name: input.updated_by_name
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteCenterClosure(input: { id: string; actorUserId: string; actorName: string }) {
  const supabase = await createClient();
  const { data: existing, error: existingError } = await supabase
    .from("center_closures")
    .select("*")
    .eq("id", input.id)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (!existing) return false;

  if ((existing as any).auto_generated) {
    const { error } = await supabase
      .from("center_closures")
      .update({
        active: false,
        notes: (existing as any).notes ?? "Auto-generated closure manually removed.",
        updated_at: toEasternISO(),
        updated_by_user_id: input.actorUserId,
        updated_by_name: input.actorName
      })
      .eq("id", input.id);
    if (error) throw new Error(error.message);
    return true;
  }

  const { error } = await supabase.from("center_closures").delete().eq("id", input.id);
  if (error) throw new Error(error.message);
  return true;
}
export async function upsertClosureRule(input: {
  id: string;
  name: string;
  rule_type: "fixed" | "nth_weekday";
  month: number;
  day: number | null;
  weekday: "sunday" | "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | null;
  occurrence: "first" | "second" | "third" | "fourth" | "last" | null;
  observed_when_weekend: "none" | "friday" | "monday" | "nearest_weekday";
  active: boolean;
  updated_by_user_id: string;
  updated_by_name: string;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("closure_rules")
    .update({
      name: input.name,
      rule_type: input.rule_type,
      month: input.month,
      day: input.day,
      weekday: input.weekday,
      occurrence: input.occurrence,
      observed_when_weekend: input.observed_when_weekend,
      active: input.active,
      updated_at: toEasternISO(),
      updated_by_user_id: input.updated_by_user_id,
      updated_by_name: input.updated_by_name
    })
    .eq("id", input.id)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function upsertPayor(input: {
  id?: string;
  payor_name: string;
  payor_type: string;
  billing_contact_name: string | null;
  billing_email: string | null;
  billing_phone: string | null;
  billing_method: "InvoiceEmail" | "ACHDraft" | "CardOnFile" | "Manual" | "External";
  auto_draft_enabled: boolean;
  quickbooks_customer_name: string | null;
  quickbooks_customer_ref: string | null;
  status: "active" | "inactive";
  notes: string | null;
  updated_by_user_id: string;
  updated_by_name: string;
}) {
  const supabase = await createClient();
  if (input.id) {
    const { data, error } = await supabase
      .from("payors")
      .update({
        payor_name: input.payor_name,
        payor_type: input.payor_type,
        billing_contact_name: input.billing_contact_name,
        billing_email: input.billing_email,
        billing_phone: input.billing_phone,
        billing_method: input.billing_method,
        auto_draft_enabled: input.auto_draft_enabled,
        quickbooks_customer_name: input.quickbooks_customer_name,
        quickbooks_customer_ref: input.quickbooks_customer_ref,
        status: input.status,
        notes: input.notes,
        updated_at: toEasternISO(),
        updated_by_user_id: input.updated_by_user_id,
        updated_by_name: input.updated_by_name
      })
      .eq("id", input.id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  const { data, error } = await supabase
    .from("payors")
    .insert({
      id: randomTextId("payor"),
      payor_name: input.payor_name,
      payor_type: input.payor_type,
      billing_contact_name: input.billing_contact_name,
      billing_email: input.billing_email,
      billing_phone: input.billing_phone,
      billing_method: input.billing_method,
      auto_draft_enabled: input.auto_draft_enabled,
      quickbooks_customer_name: input.quickbooks_customer_name,
      quickbooks_customer_ref: input.quickbooks_customer_ref,
      status: input.status,
      notes: input.notes,
      created_at: toEasternISO(),
      updated_at: toEasternISO(),
      updated_by_user_id: input.updated_by_user_id,
      updated_by_name: input.updated_by_name
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function upsertMemberBillingSetting(input: {
  id?: string;
  row: Omit<BillingSettingRow, "id" | "created_at" | "updated_at">;
}) {
  const supabase = await createClient();
  if (input.id) {
    const { data, error } = await supabase
      .from("member_billing_settings")
      .update({ ...input.row, updated_at: toEasternISO() })
      .eq("id", input.id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  const { data, error } = await supabase
    .from("member_billing_settings")
    .insert({
      id: randomTextId("member-billing"),
      ...input.row,
      created_at: toEasternISO(),
      updated_at: toEasternISO()
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function upsertBillingScheduleTemplate(input: {
  id?: string;
  row: Omit<ScheduleTemplateRow, "id" | "created_at" | "updated_at">;
}) {
  const supabase = await createClient();
  if (input.id) {
    const { data, error } = await supabase
      .from("billing_schedule_templates")
      .update({ ...input.row, updated_at: toEasternISO() })
      .eq("id", input.id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  const { data, error } = await supabase
    .from("billing_schedule_templates")
    .insert({
      id: randomTextId("schedule-template"),
      ...input.row,
      created_at: toEasternISO(),
      updated_at: toEasternISO()
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function upsertBillingAdjustment(input: {
  id?: string;
  row: {
    member_id: string;
    payor_id: string | null;
    adjustment_date: string;
    adjustment_type: (typeof BILLING_ADJUSTMENT_TYPE_OPTIONS)[number];
    description: string;
    quantity: number;
    unit_rate: number;
    amount: number;
    billing_status: "Unbilled" | "Billed" | "Excluded";
    invoice_id: string | null;
    created_by_system: boolean;
    source_table: string | null;
    source_record_id: string | null;
    exclusion_reason?: string | null;
    created_by_user_id: string | null;
    created_by_name: string | null;
  };
}) {
  const supabase = await createClient();
  if (input.id) {
    const { data, error } = await supabase
      .from("billing_adjustments")
      .update({ ...input.row, updated_at: toEasternISO() })
      .eq("id", input.id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  const { data, error } = await supabase
    .from("billing_adjustments")
    .insert({ ...input.row, created_at: toEasternISO(), updated_at: toEasternISO() })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

function getMonthlyBillingBasis(setting: BillingSettingRow) {
  return setting.monthly_billing_basis === "ActualAttendanceMonthBehind"
    ? ("ActualAttendanceMonthBehind" as const)
    : ("ScheduledMonthBehind" as const);
}

type MemberInvoicePeriods = {
  invoiceMonth: string;
  baseRange: DateRange;
  variableRange: DateRange;
  billingModeSnapshot: "Membership" | "Monthly" | "Custom";
};

function resolveMemberInvoicePeriods(input: {
  mode: "Membership" | "Monthly" | "Custom";
  batchType: (typeof BILLING_BATCH_TYPE_OPTIONS)[number];
  invoiceMonthStart: string;
}): MemberInvoicePeriods {
  if (input.mode === "Membership") {
    return {
      invoiceMonth: input.invoiceMonthStart,
      baseRange: toMonthRange(input.invoiceMonthStart),
      variableRange: toMonthRange(previousMonth(input.invoiceMonthStart)),
      billingModeSnapshot: "Membership"
    };
  }

  if (input.mode === "Monthly") {
    const invoiceMonth = input.batchType === "Mixed" ? previousMonth(input.invoiceMonthStart) : input.invoiceMonthStart;
    const baseMonth = previousMonth(invoiceMonth);
    const baseRange = toMonthRange(baseMonth);
    return {
      invoiceMonth,
      baseRange,
      variableRange: baseRange,
      billingModeSnapshot: "Monthly"
    };
  }

  return {
    invoiceMonth: input.invoiceMonthStart,
    baseRange: toMonthRange(input.invoiceMonthStart),
    variableRange: toMonthRange(input.invoiceMonthStart),
    billingModeSnapshot: "Custom"
  };
}

function shouldProcessModeInBatch(input: {
  mode: "Membership" | "Monthly" | "Custom";
  batchType: (typeof BILLING_BATCH_TYPE_OPTIONS)[number];
}) {
  if (input.mode === "Custom") return false;
  if (input.batchType === "Mixed") return input.mode === "Membership" || input.mode === "Monthly";
  return input.mode === input.batchType;
}

async function resolveDailyRate(input: {
  memberId: string;
  memberSetting: BillingSettingRow;
  centerSetting: CenterBillingSettingRow | null;
}) {
  const attendanceSetting = await getMemberAttendanceBillingSetting(input.memberId);
  if (attendanceSetting?.dailyRate != null && attendanceSetting.dailyRate > 0) {
    return toAmount(attendanceSetting.dailyRate);
  }
  if (!input.memberSetting.use_center_default_rate && input.memberSetting.custom_daily_rate != null) {
    return toAmount(input.memberSetting.custom_daily_rate);
  }
  return toAmount(input.centerSetting?.default_daily_rate ?? 0);
}

async function resolveExtraDayRate(input: {
  memberId: string;
  memberSetting: BillingSettingRow;
  centerSetting: CenterBillingSettingRow | null;
}) {
  const attendanceSetting = await getMemberAttendanceBillingSetting(input.memberId);
  if (attendanceSetting?.dailyRate != null && attendanceSetting.dailyRate > 0) return toAmount(attendanceSetting.dailyRate);
  if (!input.memberSetting.use_center_default_rate && input.memberSetting.custom_daily_rate != null) {
    return toAmount(input.memberSetting.custom_daily_rate);
  }
  return toAmount(input.centerSetting?.default_extra_day_rate ?? input.centerSetting?.default_daily_rate ?? 0);
}

async function resolveTransportationBillingStatus(input: {
  memberId: string;
  memberSetting: BillingSettingRow | null;
}) {
  const attendanceSetting = await getMemberAttendanceBillingSetting(input.memberId);
  if (attendanceSetting?.transportationBillingStatus) return attendanceSetting.transportationBillingStatus;
  return input.memberSetting?.transportation_billing_status ?? "BillNormally";
}

function mapCoverageTypeForLineType(
  lineType: "BaseProgram" | "Transportation" | "Ancillary" | "Adjustment" | "Credit" | "PriorBalance"
): "BaseProgram" | "Transportation" | "Ancillary" | "Adjustment" {
  if (lineType === "BaseProgram") return "BaseProgram";
  if (lineType === "Transportation") return "Transportation";
  if (lineType === "Ancillary") return "Ancillary";
  return "Adjustment";
}

function computeDueState(nextDueDate: string | null, completionDate: string | null) {
  if (completionDate) return "Completed";
  if (!nextDueDate) return "Pending";
  const today = toEasternDate();
  if (nextDueDate < today) return "Overdue";
  if (nextDueDate === today) return "Due Today";
  return "Open";
}

function toDataUrl(fileName: string, csv: string) {
  void fileName;
  return `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
}

function normalizeInvoiceRow(row: any) {
  return {
    ...row,
    base_program_billed_days: asNumber(row.base_program_billed_days),
    member_daily_rate_snapshot: asNumber(row.member_daily_rate_snapshot),
    base_program_amount: asNumber(row.base_program_amount),
    transportation_amount: asNumber(row.transportation_amount),
    ancillary_amount: asNumber(row.ancillary_amount),
    adjustment_amount: asNumber(row.adjustment_amount),
    total_amount: asNumber(row.total_amount)
  };
}

function isMissingSchemaObjectError(error: any) {
  const code = String(error?.code ?? error?.cause?.code ?? "").toUpperCase();
  const message = [
    error?.message,
    error?.details,
    error?.hint,
    error?.error_description,
    error?.cause?.message,
    error?.cause?.details,
    error?.cause?.hint
  ]
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase();

  return (
    code === "PGRST205" ||
    code === "PGRST116" ||
    code === "42P01" ||
    code === "42703" ||
    message.includes("could not find the table") ||
    message.includes("schema cache") ||
    message.includes("relation") && message.includes("does not exist") ||
    message.includes("column") && message.includes("does not exist") ||
    message.includes("does not exist")
  );
}

function buildMissingSchemaMessage(input: { objectName: string; migration: string }) {
  return `Missing Supabase schema object public.${input.objectName}. Apply migration ${input.migration} (and any earlier unapplied migrations), then restart Supabase/PostgREST to refresh schema cache.`;
}

function handleNonCriticalMissingSchemaError(
  error: any,
  input: { objectName: string; migration: string }
) {
  if (!isMissingSchemaObjectError(error)) return;
  const original = String(error?.message ?? "Unknown schema error");
  throw new Error(`${buildMissingSchemaMessage(input)} Original error: ${original}`);
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
    supabase.from("members").select("id, display_name, status").eq("status", "active").order("display_name", { ascending: true }),
    supabase.from("member_billing_settings").select("*"),
    supabase.from("member_attendance_schedules").select("member_id, daily_rate, custom_daily_rate, default_daily_rate, transportation_billing_status, monday, tuesday, wednesday, thursday, friday"),
    supabase.from("attendance_records").select("member_id, attendance_date, status").gte("attendance_date", minDate).lte("attendance_date", maxDate),
    supabase.from("billing_schedule_templates").select("*"),
    supabase
      .from("transportation_logs")
      .select("id, member_id, service_date, transport_type, quantity, unit_rate, total_amount, billing_status, billing_exclusion_reason, billable")
      .gte("service_date", minDate)
      .lte("service_date", maxDate),
    supabase
      .from("ancillary_charge_logs")
      .select("id, member_id, category_id, service_date, quantity, unit_rate, amount, billing_status, billing_exclusion_reason")
      .gte("service_date", minDate)
      .lte("service_date", maxDate),
    supabase.from("ancillary_charge_categories").select("id, name, price_cents"),
    supabase
      .from("billing_adjustments")
      .select("id, member_id, adjustment_date, description, quantity, unit_rate, amount, billing_status, adjustment_type")
      .gte("adjustment_date", minDate)
      .lte("adjustment_date", maxDate)
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

  const activeMembers = (membersData ?? []) as Array<{ id: string; display_name: string; status: string }>;
  const memberSettings = (memberSettingsData ?? []) as BillingSettingRow[];
  const attendanceSettingByMemberId = new Map(((attendanceSettingsData ?? []) as Array<any>).map((row: any) => [String(row.member_id), row] as const));
  const attendanceRows = (attendanceData ?? []) as Array<any>;
  const scheduleRows = (scheduleData ?? []) as ScheduleTemplateRow[];
  const transportationRows = (transportData ?? []) as Array<any>;
  const ancillaryRows = (ancillaryData ?? []) as Array<any>;
  const categoryById = new Map(((categoryData ?? []) as Array<any>).map((row: any) => [String(row.id), row] as const));
  const adjustmentRows = (adjustmentData ?? []) as Array<any>;
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
        const category = categoryById.get(String(row.category_id));
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

  let linkedAdjustmentId = (attendance as any).linked_adjustment_id ? String((attendance as any).linked_adjustment_id) : null;
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

export async function getBillingGenerationPreview(input: {
  billingMonth: string;
  batchType?: (typeof BILLING_BATCH_TYPE_OPTIONS)[number];
}) {
  const batchType =
    input.batchType && BILLING_BATCH_TYPE_OPTIONS.includes(input.batchType) ? input.batchType : "Mixed";
  const rows = await getBillingPreviewRows({ billingMonth: input.billingMonth, batchType });
  return {
    rows,
    totalAmount: toAmount(rows.reduce((sum, row) => sum + row.totalAmount, 0))
  };
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
    (existingInvoiceRows ?? []).forEach((row: any) => {
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
    if (!["Draft", "Reviewed"].includes(String((batch as any).batch_status))) {
      return { ok: false as const, error: "Only Draft/Reviewed batches can be finalized." };
    }

    const { data: invoices, error: invoiceError } = await supabase
      .from("billing_invoices")
      .select("id")
      .eq("billing_batch_id", input.billingBatchId);
    if (invoiceError) throw new Error(invoiceError.message);
    for (const invoice of invoices ?? []) {
      const finalized = await finalizeInvoice({ invoiceId: String((invoice as any).id), finalizedBy: input.finalizedBy });
      if (!finalized.ok) return finalized;
    }

    const { error: updateError } = await supabase
      .from("billing_batches")
      .update({
        batch_status: "Finalized",
        finalized_by: input.finalizedBy,
        finalized_at: now,
        completion_date: normalizeDateOnly(now),
        next_due_date: addMonths(startOfMonth(String((batch as any).billing_month)), 1),
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
    const invoiceIds = (invoices ?? []).map((row: any) => String(row.id));

    if (invoiceIds.length > 0) {
      const { data: sourceLines, error: sourceLineError } = await supabase
        .from("billing_invoice_lines")
        .select("id, source_table, source_record_id")
        .in("invoice_id", invoiceIds);
      if (sourceLineError) throw new Error(sourceLineError.message);

      for (const line of sourceLines ?? []) {
        const sourceTable = String((line as any).source_table ?? "");
        const sourceRecordId = String((line as any).source_record_id ?? "");
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
    if (String((invoice as any).invoice_status) === "Finalized") return { ok: true as const };

    const invoiceDate = normalizeDateOnly((invoice as any).invoice_date, toEasternDate());
    const dueDate = normalizeDateOnly((invoice as any).due_date, addDays(invoiceDate, 30));
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
      (rows ?? [])
        .filter((row: any) => String(row.billing_status ?? "Unbilled") === "Unbilled")
        .filter((row: any) => row.billable !== false)
        .forEach((row: any) => {
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
      const categoryById = new Map((categories ?? []).map((row: any) => [String(row.id), row] as const));
      (rows ?? [])
        .filter((row: any) => String(row.billing_status ?? "Unbilled") === "Unbilled")
        .forEach((row: any) => {
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
      (rows ?? [])
        .filter((row: any) => String(row.billing_status ?? "Unbilled") === "Unbilled")
        .forEach((row: any) => {
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

    const coverageRows = (insertedLines ?? []).map((line: any) => ({
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
  return (data ?? []).map((row: any) => ({
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
  const memberNameById = new Map((members ?? []).map((row: any) => [String(row.id), String(row.display_name)] as const));
  const payorByMember = await listBillingPayorContactsForMembers(
    (invoices ?? []).map((invoice: any) => String(invoice.member_id))
  );

  return (invoices ?? []).map((invoice: any) => {
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
      .select("id, member_id, service_date, transport_type, quantity, unit_rate, total_amount, billing_status, billing_exclusion_reason, billable")
      .gte("service_date", monthRange.start)
      .lte("service_date", monthRange.end),
    supabase
      .from("ancillary_charge_logs")
      .select("id, member_id, category_id, service_date, quantity, unit_rate, amount, billing_status, billing_exclusion_reason")
      .gte("service_date", monthRange.start)
      .lte("service_date", monthRange.end),
    supabase
      .from("billing_adjustments")
      .select("id, member_id, adjustment_date, description, quantity, unit_rate, amount, billing_status, exclusion_reason")
      .gte("adjustment_date", monthRange.start)
      .lte("adjustment_date", monthRange.end),
    supabase.from("members").select("id, display_name"),
    supabase.from("ancillary_charge_categories").select("id, name, price_cents")
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

  const memberNameById = new Map((membersData ?? []).map((row: any) => [String(row.id), String(row.display_name)] as const));
  const categoryById = new Map(((categoryData ?? []) as Array<any>).map((row: any) => [String(row.id), row] as const));
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

  (transportData ?? [])
    .filter((row: any) => String(row.billing_status ?? "Unbilled") !== "Billed")
    .filter((row: any) => row.billable !== false)
    .forEach((row: any) => {
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

  (ancillaryData ?? [])
    .filter((row: any) => String(row.billing_status ?? "Unbilled") !== "Billed")
    .forEach((row: any) => {
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

  (adjustmentData ?? [])
    .filter((row: any) => String(row.billing_status ?? "Unbilled") !== "Billed")
    .forEach((row: any) => {
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
    const invoiceRows = (invoices ?? []).map(normalizeInvoiceRow);
    if (invoiceRows.length === 0) {
      return { ok: false as const, error: "No finalized invoices available for export." };
    }
    const payorByMember = await listBillingPayorContactsForMembers(
      invoiceRows.map((row: any) => String(row.member_id))
    );

    const invoiceIds = invoiceRows.map((row: any) => String(row.id));
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
      const body = invoiceRows.map((row: any) => {
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
        ]
          .map(escapeCsv)
          .join(",");
      });
      csv = [header.join(","), ...body].join("\n");
    } else if (input.exportType === "InternalReviewCSV") {
      const header = ["InvoiceNumber", "LineType", "Description", "ServiceDate", "Quantity", "UnitRate", "Amount"];
      const invoiceById = new Map(invoiceRows.map((row: any) => [String(row.id), row] as const));
      const body = (lines ?? []).map((line: any) =>
        [
          invoiceById.get(String(line.invoice_id))?.invoice_number ?? "",
          line.line_type,
          line.description,
          line.service_date ?? "",
          asNumber(line.quantity),
          toAmount(asNumber(line.unit_rate)),
          toAmount(asNumber(line.amount))
        ]
          .map(escapeCsv)
          .join(",")
      );
      csv = [header.join(","), ...body].join("\n");
    } else {
      const header = ["Customer", "CustomerContactId", "QuickBooksCustomerId", "InvoiceNumber", "Date", "DueDate", "Amount"];
      const body = invoiceRows.map((row: any) => {
        const payor = payorByMember.get(String(row.member_id)) ?? null;
        return [
          payor ? formatBillingPayorDisplayName(payor) : "No payor contact designated",
          payor?.contact_id ?? "",
          payor?.quickbooks_customer_id ?? "",
          row.invoice_number,
          row.invoice_date ?? row.created_at,
          row.due_date ?? "",
          toAmount(row.total_amount)
        ]
          .map(escapeCsv)
          .join(",");
      });
      csv = [header.join(","), ...body].join("\n");
    }

    const fileName = `${input.exportType}-${startOfMonth(String((batch as any).billing_month))}-${Date.now()}.csv`;
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
  return (data ?? []) as Array<any>;
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

