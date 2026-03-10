export const CLOSURE_RULE_TYPE_OPTIONS = ["fixed", "nth_weekday"] as const;
export const CLOSURE_RULE_WEEKDAY_OPTIONS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday"
] as const;
export const CLOSURE_RULE_OCCURRENCE_OPTIONS = ["first", "second", "third", "fourth", "last"] as const;
export const CLOSURE_RULE_OBSERVED_WEEKEND_OPTIONS = ["none", "friday", "monday", "nearest_weekday"] as const;

export type ClosureRuleType = (typeof CLOSURE_RULE_TYPE_OPTIONS)[number];
export type ClosureRuleWeekday = (typeof CLOSURE_RULE_WEEKDAY_OPTIONS)[number];
export type ClosureRuleOccurrence = (typeof CLOSURE_RULE_OCCURRENCE_OPTIONS)[number];
export type ClosureRuleObservedWeekend = (typeof CLOSURE_RULE_OBSERVED_WEEKEND_OPTIONS)[number];

export interface ClosureRuleLike {
  id: string;
  name: string;
  rule_type: ClosureRuleType;
  month: number;
  day: number | null;
  weekday: ClosureRuleWeekday | null;
  occurrence: ClosureRuleOccurrence | null;
  active: boolean;
  observed_when_weekend?: ClosureRuleObservedWeekend | null;
}

export interface GeneratedClosureDate {
  date: string;
  reason: string;
  ruleId: string;
  observed: boolean;
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function formatDateOnly(year: number, month: number, day: number) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function dateFromParts(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day));
}

function weekdayValue(key: ClosureRuleWeekday) {
  if (key === "sunday") return 0;
  if (key === "monday") return 1;
  if (key === "tuesday") return 2;
  if (key === "wednesday") return 3;
  if (key === "thursday") return 4;
  if (key === "friday") return 5;
  return 6;
}

function nthWeekdayDate(input: {
  year: number;
  month: number;
  weekday: ClosureRuleWeekday;
  occurrence: ClosureRuleOccurrence;
}) {
  const target = weekdayValue(input.weekday);
  if (input.occurrence === "last") {
    const end = new Date(Date.UTC(input.year, input.month, 0));
    while (end.getUTCDay() !== target) {
      end.setUTCDate(end.getUTCDate() - 1);
    }
    return formatDateOnly(input.year, input.month, end.getUTCDate());
  }

  const indexByOccurrence: Record<Exclude<ClosureRuleOccurrence, "last">, number> = {
    first: 1,
    second: 2,
    third: 3,
    fourth: 4
  };
  const nth = indexByOccurrence[input.occurrence];
  const cursor = new Date(Date.UTC(input.year, input.month - 1, 1));
  let count = 0;
  while (cursor.getUTCMonth() === input.month - 1) {
    if (cursor.getUTCDay() === target) {
      count += 1;
      if (count === nth) {
        return formatDateOnly(input.year, input.month, cursor.getUTCDate());
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return null;
}

function observedDate(dateOnly: string, mode: ClosureRuleObservedWeekend) {
  if (mode === "none") return null;
  const parsed = new Date(`${dateOnly}T00:00:00.000Z`);
  const weekday = parsed.getUTCDay();
  if (weekday !== 0 && weekday !== 6) return null;
  if (mode === "nearest_weekday") {
    const delta = weekday === 6 ? -1 : 1;
    parsed.setUTCDate(parsed.getUTCDate() + delta);
    return parsed.toISOString().slice(0, 10);
  }
  if (mode === "friday") {
    parsed.setUTCDate(parsed.getUTCDate() - (weekday === 0 ? 2 : 1));
    return parsed.toISOString().slice(0, 10);
  }
  parsed.setUTCDate(parsed.getUTCDate() + (weekday === 0 ? 1 : 2));
  return parsed.toISOString().slice(0, 10);
}

export function resolveClosureRuleDate(rule: ClosureRuleLike, year: number) {
  const month = Math.max(1, Math.min(12, Math.trunc(Number(rule.month) || 1)));
  if (rule.rule_type === "fixed") {
    const day = Math.max(1, Math.min(31, Math.trunc(Number(rule.day) || 1)));
    const parsed = dateFromParts(year, month, day);
    if (parsed.getUTCMonth() !== month - 1) return null;
    return parsed.toISOString().slice(0, 10);
  }

  if (!rule.weekday || !rule.occurrence) return null;
  return nthWeekdayDate({
    year,
    month,
    weekday: rule.weekday,
    occurrence: rule.occurrence
  });
}

export function generateClosureDatesFromRules(input: {
  year: number;
  rules: ClosureRuleLike[];
}) {
  const byDate = new Map<string, GeneratedClosureDate>();
  input.rules
    .filter((rule) => rule.active)
    .forEach((rule) => {
      const primaryDate = resolveClosureRuleDate(rule, input.year);
      if (!primaryDate) return;
      if (!byDate.has(primaryDate)) {
        byDate.set(primaryDate, {
          date: primaryDate,
          reason: rule.name,
          ruleId: rule.id,
          observed: false
        });
      }
      const observed = observedDate(primaryDate, rule.observed_when_weekend ?? "none");
      if (!observed || observed === primaryDate || byDate.has(observed)) return;
      byDate.set(observed, {
        date: observed,
        reason: `${rule.name} (Observed)`,
        ruleId: rule.id,
        observed: true
      });
    });
  return Array.from(byDate.values()).sort((left, right) => (left.date < right.date ? -1 : 1));
}
