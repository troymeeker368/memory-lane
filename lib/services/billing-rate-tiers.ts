export const ATTENDANCE_RATE_TIERS = {
  oneDayPerWeek: 205,
  twoToThreeDaysPerWeek: 180,
  fourToFiveDaysPerWeek: 170
} as const;

function clampAttendanceDays(daysPerWeek: number | null | undefined) {
  if (!Number.isFinite(daysPerWeek)) return 0;
  return Math.max(0, Math.min(7, Math.round(Number(daysPerWeek))));
}

export function getStandardDailyRateForAttendanceDays(daysPerWeek: number | null | undefined) {
  const normalized = clampAttendanceDays(daysPerWeek);
  if (normalized <= 1) return ATTENDANCE_RATE_TIERS.oneDayPerWeek;
  if (normalized <= 3) return ATTENDANCE_RATE_TIERS.twoToThreeDaysPerWeek;
  return ATTENDANCE_RATE_TIERS.fourToFiveDaysPerWeek;
}

export function getAttendanceRateSourceLabel(input: { useCustomDailyRate: boolean; customDailyRate: number | null | undefined }) {
  if (input.useCustomDailyRate && Number.isFinite(input.customDailyRate)) {
    return "Custom Rate";
  }
  return "Standard Rate";
}
