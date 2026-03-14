export const ENROLLMENT_WEEKDAY_ORDER = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as const;

const DAY_ALIAS_MAP: Record<string, (typeof ENROLLMENT_WEEKDAY_ORDER)[number]> = {
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

const WEEKDAY_BY_JS_DAY: Record<number, (typeof ENROLLMENT_WEEKDAY_ORDER)[number] | null> = {
  0: null,
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: null
};

function clean(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

export function normalizeEnrollmentDateOnly(value: string | null | undefined, fallback?: string) {
  const normalized = clean(value);
  if (!normalized) {
    if (fallback) return fallback;
    throw new Error("Enrollment date is required.");
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error(`Enrollment date must use YYYY-MM-DD format. Received: ${normalized}`);
  }

  const year = Number(normalized.slice(0, 4));
  const month = Number(normalized.slice(5, 7));
  const day = Number(normalized.slice(8, 10));
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() + 1 !== month ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`Enrollment date is invalid: ${normalized}`);
  }

  return normalized;
}

export function normalizeEnrollmentRequestedDays(days: string[]) {
  const selected = new Set<(typeof ENROLLMENT_WEEKDAY_ORDER)[number]>();
  days.forEach((day) => {
    const normalized = clean(day)?.toLowerCase();
    if (!normalized) return;
    const mapped = DAY_ALIAS_MAP[normalized];
    if (mapped) selected.add(mapped);
  });
  return ENROLLMENT_WEEKDAY_ORDER.filter((day) => selected.has(day));
}

export function countRemainingEnrollmentAttendanceDaysInMonth(input: {
  requestedStartDate: string;
  requestedDays: string[];
}) {
  const requestedStartDate = normalizeEnrollmentDateOnly(input.requestedStartDate);
  const requestedDays = normalizeEnrollmentRequestedDays(input.requestedDays);
  if (requestedDays.length === 0) return 0;

  const [year, month, day] = requestedStartDate.split("-").map((part) => Number(part));
  const startDate = new Date(Date.UTC(year, month - 1, day));
  const endDate = new Date(Date.UTC(year, month, 0));

  const selected = new Set(requestedDays);
  let count = 0;
  const cursor = new Date(startDate.getTime());

  while (cursor.getTime() <= endDate.getTime()) {
    const weekday = WEEKDAY_BY_JS_DAY[cursor.getUTCDay()];
    if (weekday && selected.has(weekday)) {
      count += 1;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return count;
}

export function calculateInitialEnrollmentAmount(input: {
  requestedStartDate: string;
  requestedDays: string[];
  dailyRate: number;
  communityFee?: number;
}) {
  const attendanceDays = countRemainingEnrollmentAttendanceDaysInMonth({
    requestedStartDate: input.requestedStartDate,
    requestedDays: input.requestedDays
  });

  const dailyRate = Number(input.dailyRate);
  if (!Number.isFinite(dailyRate) || dailyRate < 0) {
    throw new Error("Daily rate must be a non-negative number.");
  }

  const communityFee = Number(input.communityFee ?? 0);
  if (!Number.isFinite(communityFee) || communityFee < 0) {
    throw new Error("Community fee must be a non-negative number.");
  }

  return Number((attendanceDays * dailyRate + communityFee).toFixed(2));
}
