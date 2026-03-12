import { toEasternDate } from "@/lib/timezone";

export interface ReportDateRange {
  from: string;
  to: string;
}

function isoDay(date: Date) {
  return toEasternDate(date);
}

export function resolveDateRange(rawFrom?: string, rawTo?: string, fallbackDays = 30): ReportDateRange {
  const today = new Date();
  const end = rawTo ? new Date(rawTo) : today;
  if (Number.isNaN(end.getTime())) {
    return resolveDateRange(undefined, undefined, fallbackDays);
  }

  const start = rawFrom ? new Date(rawFrom) : new Date(end.getTime() - fallbackDays * 24 * 60 * 60 * 1000);
  if (Number.isNaN(start.getTime())) {
    return resolveDateRange(undefined, rawTo, fallbackDays);
  }

  return {
    from: isoDay(start),
    to: isoDay(end)
  };
}
