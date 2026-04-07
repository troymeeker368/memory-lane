import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import {
  BILLING_ADJUSTMENT_SELECT,
  BILLING_CENTER_SETTING_SELECT,
  BILLING_CENTER_CLOSURE_SELECT,
  BILLING_CLOSURE_RULE_SELECT,
  BILLING_MEMBER_LOOKUP_SELECT,
  BILLING_MEMBER_RATE_SCHEDULE_SELECT,
  BILLING_MEMBER_SETTING_SELECT,
  BILLING_PAYOR_SELECT,
  BILLING_SCHEDULE_TEMPLATE_SELECT
} from "@/lib/services/billing-selects";
import {
  BILLING_ADJUSTMENT_TYPE_OPTIONS,
  CENTER_CLOSURE_TYPE_OPTIONS,
  type BillingSettingRow,
  type CenterBillingSettingRow,
  type ClosureRuleRow,
  type DateRange,
  type ScheduleTemplateRow
} from "@/lib/services/billing-types";
import {
  formatBillingPayorDisplayName,
  listBillingPayorContactsForMembers
} from "@/lib/services/billing-payor-contacts";
import {
  resolveEffectiveDailyRate,
  resolveEffectiveTransportationBillingStatus,
  resolveActiveEffectiveMemberRowForDate,
  resolveActiveEffectiveRowForDate
} from "@/lib/services/billing-effective";
import { randomTextId, normalizeDateOnly } from "@/lib/services/billing-utils";
import { generateClosureDatesFromRules } from "@/lib/services/closure-rules";
import { handleNonCriticalMissingSchemaError } from "@/lib/services/billing-schema-errors";
import { toEasternDate, toEasternISO } from "@/lib/timezone";
import type { Database } from "@/types/supabase-types";

type CenterClosureRow = Database["public"]["Tables"]["center_closures"]["Row"];
type PayorRow = Database["public"]["Tables"]["payors"]["Row"];
type MemberLookupRow = Pick<Database["public"]["Tables"]["members"]["Row"], "id" | "display_name">;
type MemberAttendanceBillingRow = Pick<
  Database["public"]["Tables"]["member_attendance_schedules"]["Row"],
  | "member_id"
  | "daily_rate"
  | "custom_daily_rate"
  | "default_daily_rate"
  | "transportation_billing_status"
  | "billing_rate_effective_date"
  | "billing_notes"
>;

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

const listCenterBillingSettingsRows = cache(async function listCenterBillingSettingsRows() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("center_billing_settings")
    .select(BILLING_CENTER_SETTING_SELECT)
    .order("effective_start_date", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as CenterBillingSettingRow[];
});

const getMemberSettingsRows = cache(async function getMemberSettingsRows() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("member_billing_settings").select(BILLING_MEMBER_SETTING_SELECT);
  if (error) throw new Error(error.message);
  return (data ?? []) as BillingSettingRow[];
});

const getScheduleTemplatesRows = cache(async function getScheduleTemplatesRows() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("billing_schedule_templates").select(BILLING_SCHEDULE_TEMPLATE_SELECT);
  if (error) throw new Error(error.message);
  return (data ?? []) as ScheduleTemplateRow[];
});

export async function getActiveCenterSettingForDate(dateOnly: string) {
  const normalizedDate = normalizeDateOnly(dateOnly);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("center_billing_settings")
    .select(BILLING_CENTER_SETTING_SELECT)
    .eq("active", true)
    .lte("effective_start_date", normalizedDate)
    .or(`effective_end_date.is.null,effective_end_date.gte.${normalizedDate}`)
    .order("effective_start_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as CenterBillingSettingRow | null) ?? null;
}

export async function getActiveMemberSettingForDate(memberId: string, dateOnly: string) {
  const normalizedDate = normalizeDateOnly(dateOnly);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("member_billing_settings")
    .select(BILLING_MEMBER_SETTING_SELECT)
    .eq("member_id", memberId)
    .eq("active", true)
    .lte("effective_start_date", normalizedDate)
    .or(`effective_end_date.is.null,effective_end_date.gte.${normalizedDate}`)
    .order("effective_start_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as BillingSettingRow | null) ?? null;
}

export async function getActiveScheduleTemplateForDate(memberId: string, dateOnly: string) {
  const normalizedDate = normalizeDateOnly(dateOnly);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("billing_schedule_templates")
    .select(BILLING_SCHEDULE_TEMPLATE_SELECT)
    .eq("member_id", memberId)
    .eq("active", true)
    .lte("effective_start_date", normalizedDate)
    .or(`effective_end_date.is.null,effective_end_date.gte.${normalizedDate}`)
    .order("effective_start_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ScheduleTemplateRow | null) ?? null;
}

export async function getNonBillableCenterClosureSet(range: DateRange) {
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
  return new Set((data ?? []).map((row) => normalizeDateOnly(row.closure_date)));
}

export async function listClosureRules() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("closure_rules")
    .select(BILLING_CLOSURE_RULE_SELECT)
    .order("name", { ascending: true });
  if (error) {
    handleNonCriticalMissingSchemaError(error, {
      objectName: "closure_rules",
      migration: "0012_legacy_operational_health_alignment.sql"
    });
    throw new Error(error.message);
  }
  return (data ?? []) as ClosureRuleRow[];
}

export async function generateClosuresForYear(year: number, input?: { generatedByUserId?: string | null; generatedByName?: string | null }) {
  const supabase = await createClient();
  const targetYear = normalizeYear(year);
  const { data: rulesData, error: ruleError } = await supabase
    .from("closure_rules")
    .select(BILLING_CLOSURE_RULE_SELECT)
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

  const existingDates = new Set((existingRows ?? []).map((row) => normalizeDateOnly(row.closure_date)));
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
    .select(BILLING_MEMBER_RATE_SCHEDULE_SELECT)
    .eq("member_id", memberId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const schedule = data as MemberAttendanceBillingRow | null;
  if (!schedule) return null;

  const resolvedDailyRate = resolveEffectiveDailyRate({
    attendanceSetting: schedule,
    memberSetting: null,
    centerSetting: null
  });
  return {
    memberId,
    dailyRate: Number.isFinite(resolvedDailyRate) && resolvedDailyRate > 0 ? resolvedDailyRate : null,
    transportationBillingStatus: resolveEffectiveTransportationBillingStatus({
      attendanceSetting: schedule
    }),
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
  const { data, error } = await supabase
    .from("payors")
    .select(BILLING_PAYOR_SELECT)
    .order("payor_name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as PayorRow[];
}

export async function listCenterClosures(input?: { includeInactive?: boolean }) {
  const supabase = await createClient();
  let query = supabase
    .from("center_closures")
    .select(BILLING_CENTER_CLOSURE_SELECT)
    .order("closure_date", { ascending: false });
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
  return (data ?? []) as CenterClosureRow[];
}

export async function listMemberBillingSettings() {
  const supabase = await createClient();
  const { data: settingsData, error: settingsError } = await supabase
    .from("member_billing_settings")
    .select(BILLING_MEMBER_SETTING_SELECT)
    .order("effective_start_date", { ascending: false });
  if (settingsError) throw new Error(settingsError.message);

  const settingsRows = (settingsData ?? []) as BillingSettingRow[];
  const memberIds = Array.from(new Set(settingsRows.map((row) => String(row.member_id)).filter(Boolean)));
  const { data: membersData, error: membersError } =
    memberIds.length > 0
      ? await supabase.from("members").select(BILLING_MEMBER_LOOKUP_SELECT).in("id", memberIds)
      : { data: [], error: null };
  if (membersError) throw new Error(membersError.message);
  const memberNameById = new Map(
    ((membersData ?? []) as MemberLookupRow[]).map((row) => [String(row.id), String(row.display_name)] as const)
  );
  const payorByMember = await listBillingPayorContactsForMembers(
    settingsRows.map((row) => String(row.member_id))
  );

  return settingsRows.map((row) => ({
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
  const { data: templatesData, error: templatesError } = await supabase
    .from("billing_schedule_templates")
    .select(BILLING_SCHEDULE_TEMPLATE_SELECT)
    .order("effective_start_date", { ascending: false });
  if (templatesError) throw new Error(templatesError.message);

  const templateRows = (templatesData ?? []) as ScheduleTemplateRow[];
  const memberIds = Array.from(new Set(templateRows.map((row) => String(row.member_id)).filter(Boolean)));
  const { data: membersData, error: membersError } =
    memberIds.length > 0
      ? await supabase.from("members").select(BILLING_MEMBER_LOOKUP_SELECT).in("id", memberIds)
      : { data: [], error: null };
  if (membersError) throw new Error(membersError.message);
  const memberNameById = new Map(
    ((membersData ?? []) as MemberLookupRow[]).map((row) => [String(row.id), String(row.display_name)] as const)
  );
  return templateRows.map((row) => ({
    ...row,
    member_name: memberNameById.get(String(row.member_id)) ?? "Unknown Member"
  }));
}

async function getMembersAndPayorsForLookup() {
  const supabase = await createClient();
  const { data: members, error: membersError } = await supabase
    .from("members")
    .select("id, display_name")
    .eq("status", "active")
    .order("display_name", { ascending: true });
  if (membersError) throw new Error(membersError.message);

  const membersList = ((members ?? []) as MemberLookupRow[]).map((row) => ({
    id: String(row.id),
    displayName: String(row.display_name)
  }));
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
      .select(BILLING_CENTER_CLOSURE_SELECT)
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
    .select(BILLING_CENTER_CLOSURE_SELECT)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteCenterClosure(input: { id: string; actorUserId: string; actorName: string }) {
  const supabase = await createClient();
  const { data: existing, error: existingError } = await supabase
    .from("center_closures")
    .select(BILLING_CENTER_CLOSURE_SELECT)
    .eq("id", input.id)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (!existing) return false;

  const existingClosure = existing as CenterClosureRow;

  if (existingClosure.auto_generated) {
    const { error } = await supabase
      .from("center_closures")
      .update({
        active: false,
        notes: existingClosure.notes ?? "Auto-generated closure manually removed.",
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
    .select(BILLING_CLOSURE_RULE_SELECT)
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
      .select(BILLING_PAYOR_SELECT)
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
    .select(BILLING_PAYOR_SELECT)
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
      .select(BILLING_MEMBER_SETTING_SELECT)
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
    .select(BILLING_MEMBER_SETTING_SELECT)
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
      .select(BILLING_SCHEDULE_TEMPLATE_SELECT)
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
    .select(BILLING_SCHEDULE_TEMPLATE_SELECT)
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
      .select(BILLING_ADJUSTMENT_SELECT)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  const { data, error } = await supabase
    .from("billing_adjustments")
    .insert({ ...input.row, created_at: toEasternISO(), updated_at: toEasternISO() })
    .select(BILLING_ADJUSTMENT_SELECT)
    .single();
  if (error) throw new Error(error.message);
  return data;
}
