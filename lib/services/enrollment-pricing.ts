import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { buildMissingSchemaMessage, isMissingSchemaObjectError } from "@/lib/supabase/schema-errors";
import { toEasternDate, toEasternISO } from "@/lib/timezone";

const PRICING_SCHEMA_MIGRATION = "0026_enrollment_pricing_module.sql";

const REQUESTED_DAY_ALIASES: Record<string, string> = {
  mon: "Monday",
  monday: "Monday",
  tue: "Tuesday",
  tues: "Tuesday",
  tuesday: "Tuesday",
  wed: "Wednesday",
  weds: "Wednesday",
  wednesday: "Wednesday",
  thu: "Thursday",
  thur: "Thursday",
  thurs: "Thursday",
  thursday: "Thursday",
  fri: "Friday",
  friday: "Friday"
};

const REQUESTED_DAY_ORDER = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as const;

type PricingCommunityFeeRow = {
  id: string;
  amount: number;
  effective_start_date: string;
  effective_end_date: string | null;
  is_active: boolean;
  notes: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

type PricingDailyRateRow = {
  id: string;
  label: string;
  min_days_per_week: number;
  max_days_per_week: number;
  daily_rate: number;
  effective_start_date: string;
  effective_end_date: string | null;
  is_active: boolean;
  display_order: number;
  notes: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type EnrollmentPricingCommunityFee = {
  id: string;
  amount: number;
  effectiveStartDate: string;
  effectiveEndDate: string | null;
  isActive: boolean;
  notes: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EnrollmentPricingDailyRate = {
  id: string;
  label: string;
  minDaysPerWeek: number;
  maxDaysPerWeek: number;
  dailyRate: number;
  effectiveStartDate: string;
  effectiveEndDate: string | null;
  isActive: boolean;
  displayOrder: number;
  notes: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EnrollmentPricingSnapshot = {
  resolvedAt: string;
  effectiveDate: string;
  requestedDays: string[];
  daysPerWeek: number;
  communityFee: {
    id: string;
    amount: number;
    effectiveStartDate: string;
    effectiveEndDate: string | null;
    notes: string | null;
    isActive: boolean;
  };
  dailyRate: {
    id: string;
    label: string;
    minDaysPerWeek: number;
    maxDaysPerWeek: number;
    amount: number;
    effectiveStartDate: string;
    effectiveEndDate: string | null;
    displayOrder: number;
    notes: string | null;
    isActive: boolean;
  };
};

export type ResolvedEnrollmentPricing = {
  effectiveDate: string;
  requestedDays: string[];
  daysPerWeek: number;
  communityFeeId: string;
  dailyRateId: string;
  communityFeeAmount: number;
  dailyRateAmount: number;
  snapshot: EnrollmentPricingSnapshot;
};

function clean(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function asAmount(value: number | null | undefined) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Number(parsed.toFixed(2));
}

function asDateOnly(value: string | null | undefined, fallback = toEasternDate()) {
  const normalized = clean(value);
  if (!normalized) return fallback;
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date value: ${value ?? ""}`);
  }
  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function mapCommunityFee(row: PricingCommunityFeeRow): EnrollmentPricingCommunityFee {
  return {
    id: row.id,
    amount: asAmount(row.amount),
    effectiveStartDate: row.effective_start_date,
    effectiveEndDate: row.effective_end_date,
    isActive: Boolean(row.is_active),
    notes: clean(row.notes),
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapDailyRate(row: PricingDailyRateRow): EnrollmentPricingDailyRate {
  return {
    id: row.id,
    label: String(row.label ?? ""),
    minDaysPerWeek: Number(row.min_days_per_week ?? 0),
    maxDaysPerWeek: Number(row.max_days_per_week ?? 0),
    dailyRate: asAmount(row.daily_rate),
    effectiveStartDate: row.effective_start_date,
    effectiveEndDate: row.effective_end_date,
    isActive: Boolean(row.is_active),
    displayOrder: Number(row.display_order ?? 100),
    notes: clean(row.notes),
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function normalizeRequestedDays(inputDays: string[]): string[] {
  const canonical = new Set<string>();
  inputDays.forEach((day) => {
    const key = String(day ?? "").trim().toLowerCase();
    const mapped = REQUESTED_DAY_ALIASES[key];
    if (mapped) canonical.add(mapped);
  });
  return REQUESTED_DAY_ORDER.filter((day) => canonical.has(day));
}

export function countRequestedDaysPerWeek(inputDays: string[]): number {
  return normalizeRequestedDays(inputDays).length;
}

function validateDateWindow(startDate: string, endDate: string | null) {
  if (!endDate) return;
  if (endDate < startDate) {
    throw new Error("Effective end date cannot be earlier than effective start date.");
  }
}

async function listActiveCommunityFeesForDate(effectiveDate: string) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("enrollment_pricing_community_fees")
    .select(
      "id, amount, effective_start_date, effective_end_date, is_active, notes, created_by, updated_by, created_at, updated_at"
    )
    .eq("is_active", true)
    .lte("effective_start_date", effectiveDate)
    .or(`effective_end_date.is.null,effective_end_date.gte.${effectiveDate}`)
    .order("effective_start_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) {
    if (isMissingSchemaObjectError(error)) {
      throw new Error(
        buildMissingSchemaMessage({
          objectName: "enrollment_pricing_community_fees",
          migration: PRICING_SCHEMA_MIGRATION
        })
      );
    }
    throw new Error(error.message);
  }
  return (data ?? []) as PricingCommunityFeeRow[];
}

async function listActiveDailyRatesForDate(effectiveDate: string) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("enrollment_pricing_daily_rates")
    .select(
      "id, label, min_days_per_week, max_days_per_week, daily_rate, effective_start_date, effective_end_date, is_active, display_order, notes, created_by, updated_by, created_at, updated_at"
    )
    .eq("is_active", true)
    .lte("effective_start_date", effectiveDate)
    .or(`effective_end_date.is.null,effective_end_date.gte.${effectiveDate}`)
    .order("display_order", { ascending: true })
    .order("min_days_per_week", { ascending: true })
    .order("created_at", { ascending: false });
  if (error) {
    if (isMissingSchemaObjectError(error)) {
      throw new Error(
        buildMissingSchemaMessage({
          objectName: "enrollment_pricing_daily_rates",
          migration: PRICING_SCHEMA_MIGRATION
        })
      );
    }
    throw new Error(error.message);
  }
  return (data ?? []) as PricingDailyRateRow[];
}

export async function listEnrollmentPricingCommunityFees() {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("enrollment_pricing_community_fees")
    .select(
      "id, amount, effective_start_date, effective_end_date, is_active, notes, created_by, updated_by, created_at, updated_at"
    )
    .order("is_active", { ascending: false })
    .order("effective_start_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) {
    if (isMissingSchemaObjectError(error)) {
      throw new Error(
        buildMissingSchemaMessage({
          objectName: "enrollment_pricing_community_fees",
          migration: PRICING_SCHEMA_MIGRATION
        })
      );
    }
    throw new Error(error.message);
  }
  return ((data ?? []) as PricingCommunityFeeRow[]).map(mapCommunityFee);
}

export async function listEnrollmentPricingDailyRates() {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("enrollment_pricing_daily_rates")
    .select(
      "id, label, min_days_per_week, max_days_per_week, daily_rate, effective_start_date, effective_end_date, is_active, display_order, notes, created_by, updated_by, created_at, updated_at"
    )
    .order("display_order", { ascending: true })
    .order("min_days_per_week", { ascending: true })
    .order("effective_start_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) {
    if (isMissingSchemaObjectError(error)) {
      throw new Error(
        buildMissingSchemaMessage({
          objectName: "enrollment_pricing_daily_rates",
          migration: PRICING_SCHEMA_MIGRATION
        })
      );
    }
    throw new Error(error.message);
  }
  return ((data ?? []) as PricingDailyRateRow[]).map(mapDailyRate);
}

export async function getEnrollmentPricingOverview(effectiveDateInput?: string | null) {
  const effectiveDate = asDateOnly(effectiveDateInput ?? toEasternDate());
  const [activeCommunityFeeRows, activeDailyRateRows, communityFees, dailyRates] = await Promise.all([
    listActiveCommunityFeesForDate(effectiveDate),
    listActiveDailyRatesForDate(effectiveDate),
    listEnrollmentPricingCommunityFees(),
    listEnrollmentPricingDailyRates()
  ]);

  const issues: string[] = [];
  if (activeCommunityFeeRows.length === 0) {
    issues.push(`No active community fee is configured for ${effectiveDate}.`);
  }
  if (activeCommunityFeeRows.length > 1) {
    issues.push(
      `Multiple active community fee records overlap on ${effectiveDate}. Resolve overlapping pricing records before sending packets.`
    );
  }
  if (activeDailyRateRows.length === 0) {
    issues.push(`No active daily rate tiers are configured for ${effectiveDate}.`);
  }

  return {
    effectiveDate,
    activeCommunityFee:
      activeCommunityFeeRows.length === 1 ? mapCommunityFee(activeCommunityFeeRows[0]) : null,
    activeDailyRates: activeDailyRateRows.map(mapDailyRate),
    communityFees,
    dailyRates,
    issues
  };
}

export async function resolveActiveEnrollmentCommunityFee(effectiveDateInput?: string | null) {
  const effectiveDate = asDateOnly(effectiveDateInput ?? toEasternDate());
  const rows = await listActiveCommunityFeesForDate(effectiveDate);
  if (rows.length === 0) {
    throw new Error(`No active enrollment community fee is configured for ${effectiveDate}.`);
  }
  if (rows.length > 1) {
    throw new Error(
      `Multiple active enrollment community fee records overlap for ${effectiveDate}. Resolve configuration ambiguity in Operations > Pricing.`
    );
  }
  return mapCommunityFee(rows[0]);
}

export async function resolveActiveEnrollmentDailyRate(input: {
  daysPerWeek: number;
  effectiveDate?: string | null;
}) {
  const daysPerWeek = Number(input.daysPerWeek);
  if (!Number.isFinite(daysPerWeek) || daysPerWeek < 1 || daysPerWeek > 7) {
    throw new Error("Requested days per week must be between 1 and 7.");
  }

  const effectiveDate = asDateOnly(input.effectiveDate ?? toEasternDate());
  const rows = await listActiveDailyRatesForDate(effectiveDate);
  if (rows.length === 0) {
    throw new Error(`No active enrollment daily rates are configured for ${effectiveDate}.`);
  }

  const matchingRows = rows.filter(
    (row) => Number(row.min_days_per_week) <= daysPerWeek && Number(row.max_days_per_week) >= daysPerWeek
  );
  if (matchingRows.length === 0) {
    throw new Error(
      `No active enrollment daily rate tier matches ${daysPerWeek} day(s)/week for ${effectiveDate}.`
    );
  }
  if (matchingRows.length > 1) {
    throw new Error(
      `Multiple active enrollment daily rate tiers match ${daysPerWeek} day(s)/week for ${effectiveDate}. Resolve overlapping tiers in Operations > Pricing.`
    );
  }

  return mapDailyRate(matchingRows[0]);
}

export async function resolveEnrollmentPricingForRequestedDays(input: {
  requestedDays: string[];
  effectiveDate?: string | null;
}) {
  const requestedDays = normalizeRequestedDays(input.requestedDays);
  const daysPerWeek = requestedDays.length;
  if (daysPerWeek < 1) {
    throw new Error("At least one valid requested weekday is required to resolve enrollment pricing.");
  }

  const effectiveDate = asDateOnly(input.effectiveDate ?? toEasternDate());
  const [communityFee, dailyRate] = await Promise.all([
    resolveActiveEnrollmentCommunityFee(effectiveDate),
    resolveActiveEnrollmentDailyRate({ daysPerWeek, effectiveDate })
  ]);

  const snapshot: EnrollmentPricingSnapshot = {
    resolvedAt: toEasternISO(),
    effectiveDate,
    requestedDays,
    daysPerWeek,
    communityFee: {
      id: communityFee.id,
      amount: communityFee.amount,
      effectiveStartDate: communityFee.effectiveStartDate,
      effectiveEndDate: communityFee.effectiveEndDate,
      notes: communityFee.notes,
      isActive: communityFee.isActive
    },
    dailyRate: {
      id: dailyRate.id,
      label: dailyRate.label,
      minDaysPerWeek: dailyRate.minDaysPerWeek,
      maxDaysPerWeek: dailyRate.maxDaysPerWeek,
      amount: dailyRate.dailyRate,
      effectiveStartDate: dailyRate.effectiveStartDate,
      effectiveEndDate: dailyRate.effectiveEndDate,
      displayOrder: dailyRate.displayOrder,
      notes: dailyRate.notes,
      isActive: dailyRate.isActive
    }
  };

  return {
    effectiveDate,
    requestedDays,
    daysPerWeek,
    communityFeeId: communityFee.id,
    dailyRateId: dailyRate.id,
    communityFeeAmount: communityFee.amount,
    dailyRateAmount: dailyRate.dailyRate,
    snapshot
  } satisfies ResolvedEnrollmentPricing;
}

export async function createEnrollmentPricingCommunityFee(input: {
  amount: number;
  effectiveStartDate: string;
  effectiveEndDate?: string | null;
  isActive: boolean;
  notes?: string | null;
  actorUserId: string;
}) {
  const effectiveStartDate = asDateOnly(input.effectiveStartDate);
  const effectiveEndDate = clean(input.effectiveEndDate) ? asDateOnly(input.effectiveEndDate ?? null) : null;
  validateDateWindow(effectiveStartDate, effectiveEndDate);

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("enrollment_pricing_community_fees")
    .insert({
      amount: asAmount(input.amount),
      effective_start_date: effectiveStartDate,
      effective_end_date: effectiveEndDate,
      is_active: Boolean(input.isActive),
      notes: clean(input.notes),
      created_by: input.actorUserId,
      updated_by: input.actorUserId
    })
    .select(
      "id, amount, effective_start_date, effective_end_date, is_active, notes, created_by, updated_by, created_at, updated_at"
    )
    .single();

  if (error) {
    if (isMissingSchemaObjectError(error)) {
      throw new Error(
        buildMissingSchemaMessage({
          objectName: "enrollment_pricing_community_fees",
          migration: PRICING_SCHEMA_MIGRATION
        })
      );
    }
    throw new Error(error.message);
  }

  if (input.isActive) {
    const { error: deactivateError } = await admin
      .from("enrollment_pricing_community_fees")
      .update({
        is_active: false,
        updated_by: input.actorUserId,
        updated_at: toEasternISO()
      })
      .neq("id", (data as PricingCommunityFeeRow).id)
      .eq("is_active", true);
    if (deactivateError) throw new Error(deactivateError.message);
  }

  return mapCommunityFee(data as PricingCommunityFeeRow);
}

export async function updateEnrollmentPricingCommunityFee(input: {
  id: string;
  amount: number;
  effectiveStartDate: string;
  effectiveEndDate?: string | null;
  isActive: boolean;
  notes?: string | null;
  actorUserId: string;
}) {
  const effectiveStartDate = asDateOnly(input.effectiveStartDate);
  const effectiveEndDate = clean(input.effectiveEndDate) ? asDateOnly(input.effectiveEndDate ?? null) : null;
  validateDateWindow(effectiveStartDate, effectiveEndDate);

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("enrollment_pricing_community_fees")
    .update({
      amount: asAmount(input.amount),
      effective_start_date: effectiveStartDate,
      effective_end_date: effectiveEndDate,
      is_active: Boolean(input.isActive),
      notes: clean(input.notes),
      updated_by: input.actorUserId,
      updated_at: toEasternISO()
    })
    .eq("id", input.id)
    .select(
      "id, amount, effective_start_date, effective_end_date, is_active, notes, created_by, updated_by, created_at, updated_at"
    )
    .maybeSingle();

  if (error) {
    if (isMissingSchemaObjectError(error)) {
      throw new Error(
        buildMissingSchemaMessage({
          objectName: "enrollment_pricing_community_fees",
          migration: PRICING_SCHEMA_MIGRATION
        })
      );
    }
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error("Community fee record was not found.");
  }

  if (input.isActive) {
    const { error: deactivateError } = await admin
      .from("enrollment_pricing_community_fees")
      .update({
        is_active: false,
        updated_by: input.actorUserId,
        updated_at: toEasternISO()
      })
      .neq("id", input.id)
      .eq("is_active", true);
    if (deactivateError) throw new Error(deactivateError.message);
  }

  return mapCommunityFee(data as PricingCommunityFeeRow);
}

export async function setEnrollmentPricingCommunityFeeActive(input: {
  id: string;
  isActive: boolean;
  actorUserId: string;
}) {
  const admin = createSupabaseAdminClient();
  const { data: current, error: currentError } = await admin
    .from("enrollment_pricing_community_fees")
    .select(
      "id, amount, effective_start_date, effective_end_date, is_active, notes, created_by, updated_by, created_at, updated_at"
    )
    .eq("id", input.id)
    .maybeSingle();
  if (currentError) throw new Error(currentError.message);
  if (!current) throw new Error("Community fee record was not found.");

  const { data, error } = await admin
    .from("enrollment_pricing_community_fees")
    .update({
      is_active: Boolean(input.isActive),
      updated_by: input.actorUserId,
      updated_at: toEasternISO()
    })
    .eq("id", input.id)
    .select(
      "id, amount, effective_start_date, effective_end_date, is_active, notes, created_by, updated_by, created_at, updated_at"
    )
    .single();
  if (error) throw new Error(error.message);

  if (input.isActive) {
    const { error: deactivateError } = await admin
      .from("enrollment_pricing_community_fees")
      .update({
        is_active: false,
        updated_by: input.actorUserId,
        updated_at: toEasternISO()
      })
      .neq("id", input.id)
      .eq("is_active", true);
    if (deactivateError) throw new Error(deactivateError.message);
  }

  return mapCommunityFee(data as PricingCommunityFeeRow);
}

export async function createEnrollmentPricingDailyRate(input: {
  label: string;
  minDaysPerWeek: number;
  maxDaysPerWeek: number;
  dailyRate: number;
  effectiveStartDate: string;
  effectiveEndDate?: string | null;
  isActive: boolean;
  displayOrder: number;
  notes?: string | null;
  actorUserId: string;
}) {
  const effectiveStartDate = asDateOnly(input.effectiveStartDate);
  const effectiveEndDate = clean(input.effectiveEndDate) ? asDateOnly(input.effectiveEndDate ?? null) : null;
  validateDateWindow(effectiveStartDate, effectiveEndDate);

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("enrollment_pricing_daily_rates")
    .insert({
      label: String(input.label ?? "").trim(),
      min_days_per_week: Number(input.minDaysPerWeek),
      max_days_per_week: Number(input.maxDaysPerWeek),
      daily_rate: asAmount(input.dailyRate),
      effective_start_date: effectiveStartDate,
      effective_end_date: effectiveEndDate,
      is_active: Boolean(input.isActive),
      display_order: Number(input.displayOrder),
      notes: clean(input.notes),
      created_by: input.actorUserId,
      updated_by: input.actorUserId
    })
    .select(
      "id, label, min_days_per_week, max_days_per_week, daily_rate, effective_start_date, effective_end_date, is_active, display_order, notes, created_by, updated_by, created_at, updated_at"
    )
    .single();

  if (error) {
    if (isMissingSchemaObjectError(error)) {
      throw new Error(
        buildMissingSchemaMessage({
          objectName: "enrollment_pricing_daily_rates",
          migration: PRICING_SCHEMA_MIGRATION
        })
      );
    }
    throw new Error(error.message);
  }

  return mapDailyRate(data as PricingDailyRateRow);
}

export async function updateEnrollmentPricingDailyRate(input: {
  id: string;
  label: string;
  minDaysPerWeek: number;
  maxDaysPerWeek: number;
  dailyRate: number;
  effectiveStartDate: string;
  effectiveEndDate?: string | null;
  isActive: boolean;
  displayOrder: number;
  notes?: string | null;
  actorUserId: string;
}) {
  const effectiveStartDate = asDateOnly(input.effectiveStartDate);
  const effectiveEndDate = clean(input.effectiveEndDate) ? asDateOnly(input.effectiveEndDate ?? null) : null;
  validateDateWindow(effectiveStartDate, effectiveEndDate);

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("enrollment_pricing_daily_rates")
    .update({
      label: String(input.label ?? "").trim(),
      min_days_per_week: Number(input.minDaysPerWeek),
      max_days_per_week: Number(input.maxDaysPerWeek),
      daily_rate: asAmount(input.dailyRate),
      effective_start_date: effectiveStartDate,
      effective_end_date: effectiveEndDate,
      is_active: Boolean(input.isActive),
      display_order: Number(input.displayOrder),
      notes: clean(input.notes),
      updated_by: input.actorUserId,
      updated_at: toEasternISO()
    })
    .eq("id", input.id)
    .select(
      "id, label, min_days_per_week, max_days_per_week, daily_rate, effective_start_date, effective_end_date, is_active, display_order, notes, created_by, updated_by, created_at, updated_at"
    )
    .maybeSingle();

  if (error) {
    if (isMissingSchemaObjectError(error)) {
      throw new Error(
        buildMissingSchemaMessage({
          objectName: "enrollment_pricing_daily_rates",
          migration: PRICING_SCHEMA_MIGRATION
        })
      );
    }
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error("Daily rate record was not found.");
  }

  return mapDailyRate(data as PricingDailyRateRow);
}

export async function setEnrollmentPricingDailyRateActive(input: {
  id: string;
  isActive: boolean;
  actorUserId: string;
}) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("enrollment_pricing_daily_rates")
    .update({
      is_active: Boolean(input.isActive),
      updated_by: input.actorUserId,
      updated_at: toEasternISO()
    })
    .eq("id", input.id)
    .select(
      "id, label, min_days_per_week, max_days_per_week, daily_rate, effective_start_date, effective_end_date, is_active, display_order, notes, created_by, updated_by, created_at, updated_at"
    )
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Daily rate record was not found.");
  return mapDailyRate(data as PricingDailyRateRow);
}
