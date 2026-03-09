import Link from "next/link";

import { Card, CardTitle } from "@/components/ui/card";
import { requireRoles } from "@/lib/auth";
import { getMembers } from "@/lib/services/documentation";
import { getMemberActivitySnapshot } from "@/lib/services/activity-snapshots";
import { toEasternDate } from "@/lib/timezone";
import { formatDate, formatDateTime } from "@/lib/utils";

type RangePreset = "today" | "last-week" | "last-30-days" | "last-90-days" | "last-year" | "custom";

const RANGE_PRESETS: Array<{ value: RangePreset; label: string }> = [
  { value: "today", label: "Today" },
  { value: "last-week", label: "Last Week" },
  { value: "last-30-days", label: "Last 30 Days" },
  { value: "last-90-days", label: "Last 90 Days" },
  { value: "last-year", label: "Last Year" },
  { value: "custom", label: "Custom Range" }
];

function startOfTodayLocal() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function dateDaysAgo(daysAgo: number) {
  const day = startOfTodayLocal();
  day.setDate(day.getDate() - daysAgo);
  return day;
}

function parseDateInput(raw?: string) {
  if (!raw) return null;
  const parsed = new Date(`${raw}T00:00:00.000`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function resolveMemberSummaryRange(rawPreset?: string, rawFrom?: string, rawTo?: string) {
  const preset = (RANGE_PRESETS.find((item) => item.value === rawPreset)?.value ?? "last-30-days") as RangePreset;

  if (preset === "custom") {
    const parsedFrom = parseDateInput(rawFrom);
    const parsedTo = parseDateInput(rawTo);

    const fallbackTo = startOfTodayLocal();
    const fallbackFrom = dateDaysAgo(29);

    const fromDate = parsedFrom ?? (parsedTo ? new Date(parsedTo.getTime()) : fallbackFrom);
    const toDate = parsedTo ?? (parsedFrom ? new Date(parsedFrom.getTime()) : fallbackTo);
    const safeFrom = fromDate <= toDate ? fromDate : toDate;
    const safeTo = fromDate <= toDate ? toDate : fromDate;

    return {
      preset,
      from: toEasternDate(safeFrom),
      to: toEasternDate(safeTo)
    };
  }

  const toDate = startOfTodayLocal();
  let fromDate = startOfTodayLocal();

  if (preset === "last-week") fromDate = dateDaysAgo(6);
  if (preset === "last-30-days") fromDate = dateDaysAgo(29);
  if (preset === "last-90-days") fromDate = dateDaysAgo(89);
  if (preset === "last-year") fromDate = dateDaysAgo(364);

  return {
    preset,
    from: toEasternDate(fromDate),
    to: toEasternDate(toDate)
  };
}

export default async function MemberSummaryPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRoles(["admin", "manager"]);

  const params = await searchParams;
  const memberId = typeof params.memberId === "string" ? params.memberId : "";
  const rawFrom = typeof params.from === "string" ? params.from : undefined;
  const rawTo = typeof params.to === "string" ? params.to : undefined;
  const rawRange = typeof params.range === "string" ? params.range : rawFrom || rawTo ? "custom" : "last-30-days";

  const resolvedRange = resolveMemberSummaryRange(rawRange, rawFrom, rawTo);
  const isCustomRange = resolvedRange.preset === "custom";

  const members = await getMembers();
  const snapshot = memberId ? await getMemberActivitySnapshot(memberId, resolvedRange.from, resolvedRange.to) : null;
  const timelineItems = snapshot
    ? [...snapshot.activities].sort((a, b) => {
        if (a.when === b.when) return a.type.localeCompare(b.type);
        return a.when < b.when ? 1 : -1;
      })
    : [];

  return (
    <div className="space-y-4">
        <Card>
          <CardTitle>Member Documentation Summary</CardTitle>
        <p className="mt-1 text-sm text-muted">Select a member and date range to review documentation, clinical logs, and ancillary activity.</p>
        <form className="mt-3 grid gap-2 md:grid-cols-6">
          <div className="md:col-span-2">
            <label className="mb-1 block text-xs font-semibold text-muted" htmlFor="memberId">Member</label>
            <select
              id="memberId"
              name="memberId"
              defaultValue={memberId}
              size={Math.min(Math.max(members.length, 2), 10)}
              className="h-auto max-h-56 w-full overflow-y-auto rounded-lg border border-border bg-white px-3 py-2 text-sm text-fg"
            >
              <option value="">Select member</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>{member.display_name}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted">Scroll to browse member options.</p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted" htmlFor="range">Date Range</label>
            <select id="range" name="range" defaultValue={resolvedRange.preset} className="h-10 w-full rounded-lg border border-border bg-white px-3 text-sm text-fg">
              {RANGE_PRESETS.map((preset) => (
                <option key={preset.value} value={preset.value}>{preset.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted" htmlFor="from">From</label>
            <input
              id="from"
              name="from"
              type="date"
              defaultValue={resolvedRange.from}
              readOnly={!isCustomRange}
              className="h-10 w-full rounded-lg border border-border bg-white px-3 text-sm text-fg read-only:bg-slate-50"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted" htmlFor="to">To</label>
            <input
              id="to"
              name="to"
              type="date"
              defaultValue={resolvedRange.to}
              readOnly={!isCustomRange}
              className="h-10 w-full rounded-lg border border-border bg-white px-3 text-sm text-fg read-only:bg-slate-50"
            />
          </div>
          <div className="flex items-end gap-2">
            <button type="submit" className="h-10 rounded-lg bg-brand px-3 text-sm font-semibold text-white">Load Summary</button>
            <Link href="/" className="h-10 rounded-lg border border-border px-3 text-sm font-semibold leading-10">Home</Link>
          </div>
        </form>
        {!isCustomRange ? (
          <p className="mt-2 text-xs text-muted">Selected preset controls From/To. Choose Custom Range to edit dates manually.</p>
        ) : null}
      </Card>

      {!memberId ? (
        <Card><p className="text-sm text-muted">Choose a member to view their summary.</p></Card>
      ) : null}

      {snapshot?.member && snapshot.counts ? (
        <>
          <Card>
            <CardTitle>{snapshot.member.display_name}</CardTitle>
            <p className="mt-1 text-sm text-muted">Date range: {formatDate(snapshot.range.from)} to {formatDate(snapshot.range.to)}</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Total Entries</p><p className="text-xl font-semibold">{snapshot.counts.total}</p></div>
              <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Documentation</p><p className="text-sm">Participation {snapshot.counts.dailyActivity} | Toilet {snapshot.counts.toilet} | Shower {snapshot.counts.shower} | Transport {snapshot.counts.transportation}</p></div>
              <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Clinical</p><p className="text-sm">Blood Sugar {snapshot.counts.bloodSugar} | Assessments {snapshot.counts.assessments}</p></div>
              <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted">Ancillary</p><p className="text-sm">Entries {snapshot.counts.ancillary} | Total ${(snapshot.ancillaryTotalCents / 100).toFixed(2)}</p></div>
            </div>
          </Card>

          <Card>
            <CardTitle>Member Activity Timeline</CardTitle>
            {timelineItems.length === 0 ? (
              <p className="mt-3 text-sm text-muted">No member activity found in this date range.</p>
            ) : (
              <div className="mt-3 max-h-[36rem] space-y-2 overflow-y-auto pr-1">
                {timelineItems.map((activity) => (
                  <div key={activity.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border bg-white px-3 py-2 text-xs">
                    <div>
                      <p className="font-semibold text-fg">{formatDateTime(activity.when)} | {activity.type}</p>
                      <p className="text-muted">{activity.details}</p>
                    </div>
                    <Link className="font-semibold text-brand" href={activity.href}>Open</Link>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}
