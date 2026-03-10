export const COUNT_PTO_TOWARD_OVERTIME = false;
export const OVERTIME_THRESHOLD_HOURS = 40;
export const MEAL_DEDUCTION_HOURS = 0.5;
export const MEAL_DEDUCTION_THRESHOLD_HOURS = 8;
export const MAX_PLAUSIBLE_SHIFT_HOURS = 16;

export interface TimecardPunch {
  id?: string;
  timestamp: string;
  type: "in" | "out";
  source: "employee" | "director_correction" | "approved_forgotten_punch";
  status: "active" | "voided";
}

export interface DailyTimecardCalculationInput {
  punches: TimecardPunch[];
  ptoHours: number;
}

export interface DailyTimecardCalculationResult {
  firstIn: string | null;
  lastOut: string | null;
  rawHours: number;
  mealDeductionHours: number;
  workedHours: number;
  totalPaidHours: number;
  hasException: boolean;
  exceptionReasons: string[];
  hasManualCorrection: boolean;
  hasDirectorEntry: boolean;
}

export interface OvertimeAllocationInputRow {
  id: string;
  workDate: string;
  workedHours: number;
  ptoHours: number;
}

function toMs(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundHours(value: number) {
  return Number(value.toFixed(2));
}

export function calculateDailyTimecard(input: DailyTimecardCalculationInput): DailyTimecardCalculationResult {
  const activePunches = input.punches
    .filter((row) => row.status === "active")
    .sort((left, right) => (left.timestamp > right.timestamp ? 1 : -1));
  const firstIn = activePunches.find((row) => row.type === "in")?.timestamp ?? null;
  const lastOut = [...activePunches].reverse().find((row) => row.type === "out")?.timestamp ?? null;

  const exceptionReasons = new Set<string>();

  if (!firstIn || !lastOut) {
    exceptionReasons.add("missing_in_or_out");
  }

  if (activePunches[0]?.type === "out") {
    exceptionReasons.add("odd_punch_sequence");
  }

  for (let i = 1; i < activePunches.length; i += 1) {
    const previous = activePunches[i - 1];
    const current = activePunches[i];
    if (previous.type === current.type) {
      exceptionReasons.add("odd_punch_sequence");
      const previousMs = toMs(previous.timestamp);
      const currentMs = toMs(current.timestamp);
      if (previousMs != null && currentMs != null && Math.abs(currentMs - previousMs) <= 3 * 60 * 1000) {
        exceptionReasons.add("duplicate_punch_issue");
      }
      if (previous.timestamp === current.timestamp) {
        exceptionReasons.add("duplicate_punch_issue");
      }
    }
  }

  const hasManualCorrection = activePunches.some((row) => row.source !== "employee");
  const hasDirectorEntry = activePunches.some((row) => row.source === "director_correction");
  if (hasManualCorrection) {
    exceptionReasons.add("manually_corrected_punch");
  }
  if (hasDirectorEntry) {
    exceptionReasons.add("director_entered_hours");
  }

  let rawHours = 0;
  if (firstIn && lastOut) {
    const firstInMs = toMs(firstIn);
    const lastOutMs = toMs(lastOut);
    if (firstInMs != null && lastOutMs != null) {
      rawHours = (lastOutMs - firstInMs) / 3600000;
    }
  }

  if (rawHours < 0 || rawHours > MAX_PLAUSIBLE_SHIFT_HOURS) {
    exceptionReasons.add("negative_or_implausible_hours");
  }

  const clampedRawHours = rawHours > 0 ? rawHours : 0;
  const mealDeductionHours = clampedRawHours > MEAL_DEDUCTION_THRESHOLD_HOURS ? MEAL_DEDUCTION_HOURS : 0;
  const workedHours = Math.max(clampedRawHours - mealDeductionHours, 0);
  const totalPaidHours = workedHours + Math.max(input.ptoHours, 0);

  return {
    firstIn,
    lastOut,
    rawHours: roundHours(clampedRawHours),
    mealDeductionHours: roundHours(mealDeductionHours),
    workedHours: roundHours(workedHours),
    totalPaidHours: roundHours(totalPaidHours),
    hasException: exceptionReasons.size > 0,
    exceptionReasons: Array.from(exceptionReasons.values()),
    hasManualCorrection,
    hasDirectorEntry
  };
}

export function allocatePayPeriodOvertime(
  rows: OvertimeAllocationInputRow[],
  options?: { countPtoTowardOvertime?: boolean; thresholdHours?: number }
) {
  const threshold = options?.thresholdHours ?? OVERTIME_THRESHOLD_HOURS;
  const countPto = options?.countPtoTowardOvertime ?? COUNT_PTO_TOWARD_OVERTIME;
  const orderedRows = [...rows].sort((left, right) => (left.workDate === right.workDate ? (left.id > right.id ? 1 : -1) : left.workDate > right.workDate ? 1 : -1));
  const byId = new Map<string, number>();
  let runningEligibleHours = 0;

  orderedRows.forEach((row) => {
    const eligibleHours = row.workedHours + (countPto ? row.ptoHours : 0);
    const regularRemaining = Math.max(0, threshold - runningEligibleHours);
    const overtimeEligible = Math.max(0, eligibleHours - regularRemaining);
    const overtimeHours = countPto ? Math.max(0, Math.min(overtimeEligible, row.workedHours)) : overtimeEligible;
    byId.set(row.id, roundHours(overtimeHours));
    runningEligibleHours += eligibleHours;
  });

  return byId;
}
