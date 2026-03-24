import { CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";
import type { getMemberCommandCenterDetailSupabase } from "@/lib/services/member-command-center-read";

export type MemberCommandCenterDetail = NonNullable<Awaited<ReturnType<typeof getMemberCommandCenterDetailSupabase>>>;

export const MCC_PRIMARY_TABS = [
  "overview",
  "attendance",
  "schedule-changes",
  "pricing",
  "additional-charges",
  "holds",
  "locker-assignments"
] as const;

export const MCC_SECONDARY_TABS = [
  "demographics-contacts",
  "transportation",
  "legal",
  "diet-allergies"
] as const;

export const MCC_TABS = [...MCC_PRIMARY_TABS, ...MCC_SECONDARY_TABS] as const;

export type MccTab = (typeof MCC_TABS)[number];

export const TAB_LABELS: Record<MccTab, string> = {
  overview: "Overview",
  attendance: "Attendance",
  "schedule-changes": "Schedule Changes",
  pricing: "Pricing",
  "additional-charges": "Additional Charges",
  holds: "Holds",
  "locker-assignments": "Locker Assignments",
  transportation: "Transportation",
  "demographics-contacts": "Demographics & Contacts",
  legal: "Legal",
  "diet-allergies": "Diet / Allergies"
};

const TAB_ALIASES: Record<string, MccTab> = {
  "member-summary": "overview",
  "attendance-enrollment": "attendance"
};

export function firstString(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0];
  return value;
}

export function resolveTab(raw: string | undefined): MccTab {
  const normalized = raw ? TAB_ALIASES[raw] ?? raw : "";
  if (normalized && MCC_TABS.includes(normalized as MccTab)) return normalized as MccTab;
  return "overview";
}

export function boolLabel(value: boolean | null | undefined) {
  if (value == null) return "-";
  return value ? "Yes" : "No";
}

export function latestTimestamp(values: Array<string | null | undefined>) {
  const valid = values.filter((value): value is string => Boolean(value));
  if (valid.length === 0) return null;
  return valid.reduce((latest, current) => {
    const latestMs = Number.isNaN(Date.parse(latest)) ? 0 : Date.parse(latest);
    const currentMs = Number.isNaN(Date.parse(current)) ? 0 : Date.parse(current);
    return currentMs > latestMs ? current : latest;
  });
}

export function latestUpdatedBy<T>(
  rows: T[],
  getTimestamp: (row: T) => string | null | undefined,
  getBy: (row: T) => string | null | undefined
) {
  let latestAt: string | null = null;
  let latestBy: string | null = null;
  rows.forEach((row) => {
    const currentAt = getTimestamp(row);
    if (!currentAt) return;
    if (!latestAt) {
      latestAt = currentAt;
      latestBy = getBy(row) ?? null;
      return;
    }
    const latestMs = Number.isNaN(Date.parse(latestAt)) ? 0 : Date.parse(latestAt);
    const currentMs = Number.isNaN(Date.parse(currentAt)) ? 0 : Date.parse(currentAt);
    if (currentMs > latestMs) {
      latestAt = currentAt;
      latestBy = getBy(row) ?? null;
    }
  });
  return latestBy;
}

export function SectionHeading({
  title,
  lastUpdatedAt,
  lastUpdatedBy
}: {
  title: string;
  lastUpdatedAt: string | null | undefined;
  lastUpdatedBy: string | null | undefined;
}) {
  return (
    <div className="flex w-full flex-wrap items-baseline justify-start gap-x-3 gap-y-1 text-left">
      <CardTitle className="text-left">{title}</CardTitle>
      <span className="text-left text-xs font-normal text-muted">
        Last updated: {lastUpdatedAt ? formatDateTime(lastUpdatedAt) : "-"} | Last updated by: {lastUpdatedBy ?? "-"}
      </span>
    </div>
  );
}
