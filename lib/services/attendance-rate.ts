export function calculateAttendanceRatePercent(input: {
  presentMemberDays: number;
  scheduledMemberDays: number;
  fractionDigits?: number;
}) {
  const scheduledMemberDays = Number(input.scheduledMemberDays);
  if (!Number.isFinite(scheduledMemberDays) || scheduledMemberDays <= 0) {
    return null;
  }

  const presentMemberDays = Number(input.presentMemberDays);
  const rate = (presentMemberDays / scheduledMemberDays) * 100;
  const fractionDigits = Number.isInteger(input.fractionDigits) ? Math.max(0, Number(input.fractionDigits)) : 1;

  if (fractionDigits === 0) {
    return Math.round(rate);
  }

  return Number(rate.toFixed(fractionDigits));
}
