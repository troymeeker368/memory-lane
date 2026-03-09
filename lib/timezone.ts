const EASTERN_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23"
});

export const EASTERN_TIME_ZONE = "America/New_York";

interface ZonedParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function parseToDate(input: string | number | Date): Date {
  return input instanceof Date ? input : new Date(input);
}

function getEasternParts(date: Date): ZonedParts {
  const parts = EASTERN_FORMATTER.formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    year: lookup.year,
    month: lookup.month,
    day: lookup.day,
    hour: lookup.hour,
    minute: lookup.minute,
    second: lookup.second
  };
}

function getEasternOffsetMinutes(date: Date): number {
  const parts = getEasternParts(date);
  const asUtcMs = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );

  return Math.round((asUtcMs - date.getTime()) / 60000);
}

function formatOffset(minutes: number): string {
  const sign = minutes >= 0 ? "+" : "-";
  const abs = Math.abs(minutes);
  const hours = Math.floor(abs / 60);
  const mins = abs % 60;
  return `${sign}${pad2(hours)}:${pad2(mins)}`;
}

export function toEasternDate(input: string | number | Date = new Date()): string {
  const parts = getEasternParts(parseToDate(input));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function toEasternDateTimeLocal(input: string | number | Date = new Date()): string {
  const parts = getEasternParts(parseToDate(input));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function toEasternISO(input: string | number | Date = new Date()): string {
  const date = parseToDate(input);
  const parts = getEasternParts(date);
  const offset = getEasternOffsetMinutes(date);

  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${formatOffset(offset)}`;
}

export function easternDateTimeLocalToISO(localValue: string): string {
  const [datePart = "", timePart = ""] = localValue.split("T");
  const [yearRaw, monthRaw, dayRaw] = datePart.split("-");
  const [hourRaw, minuteRaw] = timePart.split(":");

  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);

  if (!year || !month || !day || Number.isNaN(hour) || Number.isNaN(minute)) {
    return toEasternISO(new Date());
  }

  const naiveUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0);
  let offsetMinutes = getEasternOffsetMinutes(new Date(naiveUtcMs));
  let utcMs = naiveUtcMs - offsetMinutes * 60000;

  const offsetCheck = getEasternOffsetMinutes(new Date(utcMs));
  if (offsetCheck !== offsetMinutes) {
    offsetMinutes = offsetCheck;
    utcMs = naiveUtcMs - offsetMinutes * 60000;
  }

  const isoDate = `${yearRaw}-${monthRaw}-${dayRaw}`;
  const isoTime = `${pad2(hour)}:${pad2(minute)}:00`;
  return `${isoDate}T${isoTime}${formatOffset(offsetMinutes)}`;
}
