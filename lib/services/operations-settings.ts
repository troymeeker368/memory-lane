import { MEMBER_BUS_NUMBER_OPTIONS } from "@/lib/canonical";
import { getOperationalConfig, updateOperationalConfig } from "@/lib/mock-repo";
import { isMockMode } from "@/lib/runtime";

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

export function parseBusNumbersInput(raw: string) {
  const segments = raw
    .split(/[,\s]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  return normalizeBusNumbers(segments);
}

export function getOperationalSettings(): OperationalSettings {
  if (isMockMode()) {
    return getOperationalConfig();
  }
  // TODO(backend): Load operations settings from persistent store.
  return {
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
}

export function getConfiguredBusNumbers() {
  return normalizeBusNumbers(getOperationalSettings().busNumbers);
}

export function updateOperationalSettings(input: {
  busNumbers?: string[];
  makeupPolicy?: "rolling_30_day_expiration" | "running_total";
  latePickupRules?: Partial<OperationalSettings["latePickupRules"]>;
}) {
  if (!isMockMode()) {
    // TODO(backend): Persist operations settings in production data store.
    return getOperationalSettings();
  }
  return updateOperationalConfig({
    busNumbers: input.busNumbers ? normalizeBusNumbers(input.busNumbers) : undefined,
    makeupPolicy: input.makeupPolicy,
    latePickupRules: input.latePickupRules
  });
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
  const rules = input.rules ?? getOperationalSettings().latePickupRules;
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
