"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

type RangePreset = "today" | "last-week" | "last-30-days" | "last-90-days" | "last-year" | "custom";

const RANGE_PRESETS: Array<{ value: RangePreset; label: string }> = [
  { value: "today", label: "Today" },
  { value: "last-week", label: "Last Week" },
  { value: "last-30-days", label: "Last 30 Days" },
  { value: "last-90-days", label: "Last 90 Days" },
  { value: "last-year", label: "Last Year" },
  { value: "custom", label: "Custom Range" }
];

function formatDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function dateDaysAgo(daysAgo: number) {
  const day = startOfToday();
  day.setDate(day.getDate() - daysAgo);
  return day;
}

function getPresetRange(preset: Exclude<RangePreset, "custom">) {
  const today = startOfToday();
  if (preset === "today") {
    return { from: formatDateInput(today), to: formatDateInput(today) };
  }
  if (preset === "last-week") {
    return { from: formatDateInput(dateDaysAgo(6)), to: formatDateInput(today) };
  }
  if (preset === "last-90-days") {
    return { from: formatDateInput(dateDaysAgo(89)), to: formatDateInput(today) };
  }
  if (preset === "last-year") {
    return { from: formatDateInput(dateDaysAgo(364)), to: formatDateInput(today) };
  }
  return { from: formatDateInput(dateDaysAgo(29)), to: formatDateInput(today) };
}

export function MemberDocumentationSummaryFilters({
  members,
  initialMemberId,
  initialRange,
  initialFrom,
  initialTo
}: {
  members: Array<{ id: string; display_name: string }>;
  initialMemberId: string;
  initialRange: RangePreset;
  initialFrom: string;
  initialTo: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [memberId, setMemberId] = useState(initialMemberId);
  const [range, setRange] = useState<RangePreset>(initialRange);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);

  const displayFromTo = useMemo(() => {
    if (range === "custom") {
      return { from, to };
    }
    return getPresetRange(range);
  }, [range, from, to]);

  const pushQuery = (next: { memberId: string; range: RangePreset; from: string; to: string }) => {
    const params = new URLSearchParams();
    if (next.memberId) {
      params.set("memberId", next.memberId);
    }
    params.set("range", next.range);
    if (next.range === "custom") {
      if (next.from) params.set("from", next.from);
      if (next.to) params.set("to", next.to);
    }
    const href = params.toString().length > 0 ? `${pathname}?${params.toString()}` : pathname;
    startTransition(() => {
      router.replace(href, { scroll: false });
      router.refresh();
    });
  };

  return (
    <form className="mt-3 grid gap-2 md:grid-cols-6">
      <div className="md:col-span-2">
        <label className="mb-1 block text-xs font-semibold text-muted" htmlFor="memberId">
          Member
        </label>
        <select
          id="memberId"
          name="memberId"
          value={memberId}
          size={Math.min(Math.max(members.length, 2), 10)}
          disabled={isPending}
          onChange={(event) => {
            const nextMemberId = event.target.value;
            setMemberId(nextMemberId);
            pushQuery({ memberId: nextMemberId, range, from, to });
          }}
          className="h-auto max-h-56 w-full overflow-y-auto rounded-lg border border-border bg-white px-3 py-2 text-sm text-fg"
        >
          <option value="">Select member</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.display_name}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-muted">Scroll to browse member options.</p>
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold text-muted" htmlFor="range">
          Date Range
        </label>
        <select
          id="range"
          name="range"
          value={range}
          disabled={isPending}
          onChange={(event) => {
            const nextRange = event.target.value as RangePreset;
            setRange(nextRange);
            if (nextRange === "custom") {
              const nextFrom = from || getPresetRange("last-30-days").from;
              const nextTo = to || getPresetRange("last-30-days").to;
              setFrom(nextFrom);
              setTo(nextTo);
              pushQuery({ memberId, range: nextRange, from: nextFrom, to: nextTo });
              return;
            }
            pushQuery({ memberId, range: nextRange, from: "", to: "" });
          }}
          className="h-10 w-full rounded-lg border border-border bg-white px-3 text-sm text-fg"
        >
          {RANGE_PRESETS.map((preset) => (
            <option key={preset.value} value={preset.value}>
              {preset.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold text-muted" htmlFor="from">
          From
        </label>
        <input
          id="from"
          name="from"
          type="date"
          value={displayFromTo.from}
          readOnly={range !== "custom"}
          disabled={isPending}
          onChange={(event) => {
            const nextFrom = event.target.value;
            setRange("custom");
            setFrom(nextFrom);
            pushQuery({ memberId, range: "custom", from: nextFrom, to });
          }}
          className="h-10 w-full rounded-lg border border-border bg-white px-3 text-sm text-fg read-only:bg-slate-50"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold text-muted" htmlFor="to">
          To
        </label>
        <input
          id="to"
          name="to"
          type="date"
          value={displayFromTo.to}
          readOnly={range !== "custom"}
          disabled={isPending}
          onChange={(event) => {
            const nextTo = event.target.value;
            setRange("custom");
            setTo(nextTo);
            pushQuery({ memberId, range: "custom", from, to: nextTo });
          }}
          className="h-10 w-full rounded-lg border border-border bg-white px-3 text-sm text-fg read-only:bg-slate-50"
        />
      </div>

      <div className="flex items-end gap-2">
        <Link href="/reports/member-summary" className="h-10 rounded-lg border border-border px-3 text-sm font-semibold leading-10">
          Clear
        </Link>
        <Link href="/" className="h-10 rounded-lg border border-border px-3 text-sm font-semibold leading-10">
          Home
        </Link>
      </div>
    </form>
  );
}
