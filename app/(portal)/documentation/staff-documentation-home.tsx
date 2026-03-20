import Link from "next/link";

import { Card, CardTitle } from "@/components/ui/card";
import { MobileList } from "@/components/ui/mobile-list";
import { getStaffActivitySnapshot, staffNameToSlug } from "@/lib/services/activity-snapshots";
import { toEasternDate } from "@/lib/timezone";
import { formatDate, formatDateTime } from "@/lib/utils";

const STAFF_LOG_OVERVIEW = [
  { type: "Participation Log", label: "Participation Log", countKey: "dailyActivity" },
  { type: "Toilet Log", label: "Toilet Log", countKey: "toilet" },
  { type: "Shower Log", label: "Shower Log", countKey: "shower" },
  { type: "Transportation", label: "Transportation", countKey: "transportation" },
  { type: "Blood Sugar", label: "Blood Sugar", countKey: "bloodSugar" },
  { type: "Photo Upload", label: "Photo Upload", countKey: "photoUpload" },
  { type: "Assessment", label: "Assessment", countKey: "assessments" }
] as const;

type StaffLogType = (typeof STAFF_LOG_OVERVIEW)[number]["type"];

const STAFF_LOG_TYPES = new Set(STAFF_LOG_OVERVIEW.map((item) => item.type));

function isStaffLogType(value: string): value is StaffLogType {
  return STAFF_LOG_TYPES.has(value as StaffLogType);
}

type StaffDocumentationHomeProps = {
  profileFullName: string;
  searchParams: Record<string, string | string[] | undefined>;
};

export async function StaffDocumentationHome({
  profileFullName,
  searchParams
}: StaffDocumentationHomeProps) {
  const from = typeof searchParams.from === "string" ? searchParams.from : undefined;
  const to = typeof searchParams.to === "string" ? searchParams.to : undefined;
  const selectedTypeParam = typeof searchParams.type === "string" ? searchParams.type : "";
  const selectedType = isStaffLogType(selectedTypeParam) ? selectedTypeParam : "";
  const today = toEasternDate();

  const snapshot = await getStaffActivitySnapshot(staffNameToSlug(profileFullName), from, to);

  const overviewRows = STAFF_LOG_OVERVIEW.map((item) => ({
    type: item.type,
    label: item.label,
    count: snapshot.counts[item.countKey]
  }));

  const entries = snapshot.activities
    .filter((activity) => isStaffLogType(activity.type))
    .sort((a, b) => {
      const byType = a.type.localeCompare(b.type);
      if (byType !== 0) return byType;
      if (a.when === b.when) return 0;
      return a.when < b.when ? 1 : -1;
    });
  const filteredEntries = selectedType ? entries.filter((entry) => entry.type === selectedType) : entries;

  const buildTypeHref = (type: StaffLogType) => {
    const query = new URLSearchParams({
      from: snapshot.range.from,
      to: snapshot.range.to,
      type
    });
    return `/documentation?${query.toString()}`;
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>My Documentation Snapshot</CardTitle>
        <p className="mt-1 text-sm text-muted">
          {profileFullName} | {formatDate(snapshot.range.from)} to {formatDate(snapshot.range.to)}
        </p>

        <form className="mt-3 grid gap-2 md:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted" htmlFor="from">
              From
            </label>
            <input
              id="from"
              name="from"
              type="date"
              defaultValue={snapshot.range.from}
              className="h-10 w-full rounded-lg border border-border px-3 text-sm"
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
              defaultValue={snapshot.range.to}
              className="h-10 w-full rounded-lg border border-border px-3 text-sm"
            />
          </div>
          <div className="md:col-span-2 flex items-end gap-2">
            <button type="submit" className="h-10 rounded-lg bg-brand px-3 text-sm font-semibold text-white">
              Apply
            </button>
            <Link
              href={`/documentation?from=${today}&to=${today}`}
              className="h-10 rounded-lg border border-border px-3 text-sm font-semibold leading-10"
            >
              Today
            </Link>
            <Link href="/documentation" className="h-10 rounded-lg border border-border px-3 text-sm font-semibold leading-10">
              Reset
            </Link>
          </div>
        </form>
      </Card>

      <Card className="table-wrap">
        <CardTitle>Overview Count Table</CardTitle>
        <div className="mt-1 text-xs text-muted">
          {selectedType ? (
            <>
              Viewing <span className="font-semibold text-foreground">{selectedType}</span> entries only.{" "}
              <Link href={`/documentation?from=${snapshot.range.from}&to=${snapshot.range.to}`} className="font-semibold text-brand">
                Show all
              </Link>
            </>
          ) : (
            "Click a log type to open only that log's entries for this date range."
          )}
        </div>
        <table>
          <thead>
            <tr>
              <th>Log Type</th>
              <th>Count</th>
            </tr>
          </thead>
          <tbody>
            {overviewRows.map((row) => (
              <tr key={row.type}>
                <td>
                  <Link href={buildTypeHref(row.type)} className="font-semibold text-brand underline-offset-2 hover:underline">
                    {row.label}
                  </Link>
                </td>
                <td>{row.count}</td>
              </tr>
            ))}
            <tr>
              <td className="font-semibold">Total</td>
              <td className="font-semibold">{overviewRows.reduce((sum, row) => sum + row.count, 0)}</td>
            </tr>
          </tbody>
        </table>
      </Card>

      <MobileList
        items={filteredEntries.map((entry) => ({
          id: entry.id,
          title: entry.type,
          fields: [
            { label: "When", value: formatDateTime(entry.when) },
            { label: "Member", value: entry.memberName },
            { label: "Details", value: entry.details }
          ]
        }))}
      />

      <Card className="table-wrap hidden md:block">
        <CardTitle>My Entries (Sorted by Log)</CardTitle>
        <table>
          <thead>
            <tr>
              <th>Log Type</th>
              <th>Date/Time</th>
              <th>Member</th>
              <th>Details</th>
              <th>Open</th>
            </tr>
          </thead>
          <tbody>
            {filteredEntries.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center text-sm text-muted">
                  No entries found in this date range.
                </td>
              </tr>
            ) : (
              filteredEntries.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.type}</td>
                  <td>{formatDateTime(entry.when)}</td>
                  <td>{entry.memberName}</td>
                  <td>{entry.details}</td>
                  <td>
                    <Link className="font-semibold text-brand" href={entry.href}>
                      Open
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
