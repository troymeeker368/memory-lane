import { MEMBER_BUS_NUMBER_OPTIONS } from "@/lib/canonical";
import { createClient } from "@/lib/supabase/server";

export interface OperationalSettings {
  busNumbers: string[];
  makeupPolicy: "rolling_30_day_expiration" | "running_total";
  latePickupRules: {
    graceStartTime: string;
    firstWindowMinutes: number;
    firstWindowFeeCents: number;
    additionalPerMinuteCents: number;
    additionalMinutesCap: number;
  };
}

const DEFAULT_OPERATIONAL_SETTINGS: OperationalSettings = {
  busNumbers: [...MEMBER_BUS_NUMBER_OPTIONS],
  makeupPolicy: "rolling_30_day_expiration",
  latePickupRules: {
    graceStartTime: "17:00",
    firstWindowMinutes: 15,
    firstWindowFeeCents: 2500,
    additionalPerMinuteCents: 200,
    additionalMinutesCap: 15
  }
};

const OPERATIONAL_SETTINGS_MISSING_TABLE_ERROR =
  "Missing Supabase table public.operations_settings. Required columns: id text primary key, bus_numbers text[] not null, makeup_policy text not null, late_pickup_grace_start_time text not null, late_pickup_first_window_minutes integer not null, late_pickup_first_window_fee_cents integer not null, late_pickup_additional_per_minute_cents integer not null, late_pickup_additional_minutes_cap integer not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now().";

const OPERATIONAL_SETTINGS_SELECT_COLUMNS =
  "id, bus_numbers, makeup_policy, late_pickup_grace_start_time, late_pickup_first_window_minutes, late_pickup_first_window_fee_cents, late_pickup_additional_per_minute_cents, late_pickup_additional_minutes_cap";

function defaultOperationalSettingsRow() {
  return {
    id: "default",
    bus_numbers: [...DEFAULT_OPERATIONAL_SETTINGS.busNumbers],
    makeup_policy: DEFAULT_OPERATIONAL_SETTINGS.makeupPolicy,
    late_pickup_grace_start_time: DEFAULT_OPERATIONAL_SETTINGS.latePickupRules.graceStartTime,
    late_pickup_first_window_minutes: DEFAULT_OPERATIONAL_SETTINGS.latePickupRules.firstWindowMinutes,
    late_pickup_first_window_fee_cents: DEFAULT_OPERATIONAL_SETTINGS.latePickupRules.firstWindowFeeCents,
    late_pickup_additional_per_minute_cents: DEFAULT_OPERATIONAL_SETTINGS.latePickupRules.additionalPerMinuteCents,
    late_pickup_additional_minutes_cap: DEFAULT_OPERATIONAL_SETTINGS.latePickupRules.additionalMinutesCap
  };
}

function throwOperationalSettingsError(error: { code?: string; message: string }): never {
  if (error.code === "42P01") {
    throw new Error(OPERATIONAL_SETTINGS_MISSING_TABLE_ERROR);
  }
  throw new Error(error.message);
}

function normalizeBusNumbers(values: string[]) {
  const normalized = Array.from(
    new Set(
      values
        .map((value) => String(value ?? "").trim())
        .filter((value) => /^\d+$/.test(value) && Number(value) > 0)
    )
  ).sort((left, right) => Number(left) - Number(right));
  return normalized.length > 0 ? normalized : [...MEMBER_BUS_NUMBER_OPTIONS];
}

function normalizeMakeupPolicy(value: string | null | undefined): OperationalSettings["makeupPolicy"] {
  return value === "running_total" ? "running_total" : "rolling_30_day_expiration";
}

function normalizeSettingsRow(row: any): OperationalSettings {
  const busNumbers = Array.isArray(row?.bus_numbers)
    ? normalizeBusNumbers(row.bus_numbers.map((value: unknown) => String(value)))
    : [...DEFAULT_OPERATIONAL_SETTINGS.busNumbers];

  return {
    busNumbers,
    makeupPolicy: normalizeMakeupPolicy(row?.makeup_policy),
    latePickupRules: {
      graceStartTime: String(row?.late_pickup_grace_start_time ?? DEFAULT_OPERATIONAL_SETTINGS.latePickupRules.graceStartTime),
      firstWindowMinutes: Number(row?.late_pickup_first_window_minutes ?? DEFAULT_OPERATIONAL_SETTINGS.latePickupRules.firstWindowMinutes),
      firstWindowFeeCents: Number(row?.late_pickup_first_window_fee_cents ?? DEFAULT_OPERATIONAL_SETTINGS.latePickupRules.firstWindowFeeCents),
      additionalPerMinuteCents: Number(row?.late_pickup_additional_per_minute_cents ?? DEFAULT_OPERATIONAL_SETTINGS.latePickupRules.additionalPerMinuteCents),
      additionalMinutesCap: Number(row?.late_pickup_additional_minutes_cap ?? DEFAULT_OPERATIONAL_SETTINGS.latePickupRules.additionalMinutesCap)
    }
  };
}

export function parseBusNumbersInput(raw: string) {
  const segments = raw
    .split(/[,\s]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  return normalizeBusNumbers(segments);
}

export async function getOperationalSettings(): Promise<OperationalSettings> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("operations_settings")
    .select(OPERATIONAL_SETTINGS_SELECT_COLUMNS)
    .eq("id", "default")
    .maybeSingle();

  if (error) {
    throwOperationalSettingsError(error as { code?: string; message: string });
  }

  if (!data) {
    const { data: created, error: createError } = await supabase
      .from("operations_settings")
      .upsert(defaultOperationalSettingsRow(), { onConflict: "id" })
      .select(OPERATIONAL_SETTINGS_SELECT_COLUMNS)
      .single();
    if (createError) {
      throwOperationalSettingsError(createError as { code?: string; message: string });
    }
    return normalizeSettingsRow(created);
  }

  return normalizeSettingsRow(data);
}

export async function getConfiguredBusNumbers() {
  const settings = await getOperationalSettings();
  return normalizeBusNumbers(settings.busNumbers);
}

export async function updateOperationalSettings(input: {
  busNumbers?: string[];
  makeupPolicy?: "rolling_30_day_expiration" | "running_total";
  latePickupRules?: Partial<OperationalSettings["latePickupRules"]>;
}) {
  const current = await getOperationalSettings();
  const next: OperationalSettings = {
    busNumbers: input.busNumbers ? normalizeBusNumbers(input.busNumbers) : current.busNumbers,
    makeupPolicy: input.makeupPolicy ?? current.makeupPolicy,
    latePickupRules: {
      graceStartTime: input.latePickupRules?.graceStartTime ?? current.latePickupRules.graceStartTime,
      firstWindowMinutes: input.latePickupRules?.firstWindowMinutes ?? current.latePickupRules.firstWindowMinutes,
      firstWindowFeeCents: input.latePickupRules?.firstWindowFeeCents ?? current.latePickupRules.firstWindowFeeCents,
      additionalPerMinuteCents:
        input.latePickupRules?.additionalPerMinuteCents ?? current.latePickupRules.additionalPerMinuteCents,
      additionalMinutesCap: input.latePickupRules?.additionalMinutesCap ?? current.latePickupRules.additionalMinutesCap
    }
  };

  const supabase = await createClient();
  const { error } = await supabase.from("operations_settings").upsert(
    {
      id: "default",
      bus_numbers: next.busNumbers,
      makeup_policy: next.makeupPolicy,
      late_pickup_grace_start_time: next.latePickupRules.graceStartTime,
      late_pickup_first_window_minutes: next.latePickupRules.firstWindowMinutes,
      late_pickup_first_window_fee_cents: next.latePickupRules.firstWindowFeeCents,
      late_pickup_additional_per_minute_cents: next.latePickupRules.additionalPerMinuteCents,
      late_pickup_additional_minutes_cap: next.latePickupRules.additionalMinutesCap
    },
    { onConflict: "id" }
  );

  if (error) {
    throwOperationalSettingsError(error as { code?: string; message: string });
  }

  return next;
}

function parseTimeToMinutes(raw: string | null | undefined) {
  const value = String(raw ?? "").trim();
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return hour * 60 + minute;
}

export function calculateLatePickupFee(input: {
  latePickupTime: string;
  rules?: OperationalSettings["latePickupRules"];
}) {
  const rules = input.rules ?? DEFAULT_OPERATIONAL_SETTINGS.latePickupRules;
  const pickupMinutes = parseTimeToMinutes(input.latePickupTime);
  const graceStartMinutes = parseTimeToMinutes(rules.graceStartTime);
  if (pickupMinutes == null || graceStartMinutes == null) return null;

  const minutesLate = Math.max(0, pickupMinutes - graceStartMinutes);
  if (minutesLate === 0) {
    return {
      minutesLate,
      amountCents: 0
    };
  }

  const firstWindowCharge = rules.firstWindowFeeCents;
  const extraMinutes = Math.max(0, minutesLate - rules.firstWindowMinutes);
  const cappedExtraMinutes = Math.min(extraMinutes, rules.additionalMinutesCap);
  const amountCents = firstWindowCharge + cappedExtraMinutes * rules.additionalPerMinuteCents;

  return {
    minutesLate,
    amountCents
  };
}
