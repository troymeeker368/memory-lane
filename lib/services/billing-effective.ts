import { toEasternDate } from "@/lib/timezone";

type ActiveEffectiveDatedRow = {
  active: boolean;
  effective_start_date: string;
  effective_end_date: string | null;
};

type MemberScopedActiveEffectiveDatedRow = ActiveEffectiveDatedRow & {
  member_id: string;
};

type BillingRateMemberSetting = {
  use_center_default_rate: boolean;
  custom_daily_rate: number | null;
};

type BillingRateCenterSetting = {
  default_daily_rate: number;
  default_extra_day_rate?: number | null;
};

type AttendanceBillingRateSetting = {
  dailyRate?: number | null;
  daily_rate?: number | null;
  custom_daily_rate?: number | null;
  default_daily_rate?: number | null;
};

function normalizeDateOnly(value: string | null | undefined, fallback = toEasternDate()) {
  const dateOnly = String(value ?? "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(dateOnly) ? dateOnly : fallback;
}

export function resolveActiveEffectiveRowForDate<T extends ActiveEffectiveDatedRow>(dateOnly: string, rows: readonly T[]) {
  const target = normalizeDateOnly(dateOnly);
  return (
    [...rows]
      .filter((row) => row.active)
      .filter((row) => normalizeDateOnly(row.effective_start_date) <= target)
      .filter((row) => !row.effective_end_date || normalizeDateOnly(row.effective_end_date) >= target)
      .sort((left, right) => (left.effective_start_date < right.effective_start_date ? 1 : -1))[0] ?? null
  );
}

export function resolveActiveEffectiveMemberRowForDate<T extends MemberScopedActiveEffectiveDatedRow>(
  memberId: string,
  dateOnly: string,
  rows: readonly T[]
) {
  return resolveActiveEffectiveRowForDate(
    dateOnly,
    rows.filter((row) => row.member_id === memberId)
  );
}

export function resolveEffectiveBillingMode(input: {
  memberSetting:
    | {
        use_center_default_billing_mode: boolean;
        billing_mode: "Membership" | "Monthly" | "Custom" | null;
      }
    | null;
  centerSetting: { default_billing_mode: "Membership" | "Monthly" } | null;
}) {
  if (input.memberSetting && !input.memberSetting.use_center_default_billing_mode && input.memberSetting.billing_mode) {
    return input.memberSetting.billing_mode;
  }
  return input.centerSetting?.default_billing_mode ?? "Membership";
}

export function resolveConfiguredDailyRate(input: {
  memberSetting:
    | {
        use_center_default_rate: boolean;
        custom_daily_rate: number | null;
      }
    | null;
  centerSetting: { default_daily_rate: number } | null;
}) {
  if (input.memberSetting && !input.memberSetting.use_center_default_rate && Number(input.memberSetting.custom_daily_rate ?? 0) > 0) {
    return Number(input.memberSetting.custom_daily_rate ?? 0);
  }
  return Number(input.centerSetting?.default_daily_rate ?? 0);
}

function resolveAttendanceScheduleDailyRate(attendanceSetting: AttendanceBillingRateSetting | null | undefined) {
  if (!attendanceSetting) return null;
  const candidates = [
    attendanceSetting.dailyRate,
    attendanceSetting.daily_rate,
    attendanceSetting.custom_daily_rate,
    attendanceSetting.default_daily_rate
  ]
    .map((value) => (typeof value === "number" && Number.isFinite(value) ? value : null))
    .filter((value): value is number => value != null && value > 0);
  return candidates[0] ?? null;
}

export function resolveEffectiveDailyRate(input: {
  attendanceSetting?: AttendanceBillingRateSetting | null;
  memberSetting: BillingRateMemberSetting | null;
  centerSetting: BillingRateCenterSetting | null;
}) {
  const attendanceRate = resolveAttendanceScheduleDailyRate(input.attendanceSetting);
  if (attendanceRate != null) return attendanceRate;
  return resolveConfiguredDailyRate({
    memberSetting: input.memberSetting,
    centerSetting: input.centerSetting
  });
}

export function resolveEffectiveExtraDayRate(input: {
  attendanceSetting?: AttendanceBillingRateSetting | null;
  memberSetting: BillingRateMemberSetting | null;
  centerSetting: BillingRateCenterSetting | null;
}) {
  const attendanceRate = resolveAttendanceScheduleDailyRate(input.attendanceSetting);
  if (attendanceRate != null) return attendanceRate;
  if (input.memberSetting && !input.memberSetting.use_center_default_rate && input.memberSetting.custom_daily_rate != null) {
    return Number(input.memberSetting.custom_daily_rate);
  }
  return Number(input.centerSetting?.default_extra_day_rate ?? input.centerSetting?.default_daily_rate ?? 0);
}
