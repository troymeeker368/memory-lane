import Link from "next/link";

import { ProgressNoteStatusBadge } from "@/components/progress-notes/progress-note-status-badge";
import { Card, CardTitle } from "@/components/ui/card";
import { requireProgressNoteAuthorizedUser } from "@/lib/services/progress-note-authorization";
import { getProgressNoteTracker } from "@/lib/services/notes-read";
import { formatOptionalDate } from "@/lib/utils";

const FILTER_OPTIONS = ["All", "Overdue", "Due Today", "Due Soon", "Completed/Upcoming"] as const;

function firstString(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function parsePage(value: string | string[] | undefined) {
  const raw = firstString(value);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.floor(parsed);
}

export default async function ProgressNotesPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireProgressNoteAuthorizedUser();
  const params = await searchParams;
  const status = FILTER_OPTIONS.includes((firstString(params.status) ?? "All") as (typeof FILTER_OPTIONS)[number])
    ? ((firstString(params.status) ?? "All") as (typeof FILTER_OPTIONS)[number])
    : "All";
  const memberId = firstString(params.memberId) ?? "";
  const page = parsePage(params.page);

  const result = await getProgressNoteTracker({
    status,
    memberId: memberId || undefined,
    page,
    pageSize: 25
  });

  const pageHref = (targetPage: number) => {
    const search = new URLSearchParams();
    if (status !== "All") search.set("status", status);
    if (memberId) search.set("memberId", memberId);
    if (targetPage > 1) search.set("page", String(targetPage));
    const value = search.toString();
    return value ? `/health/progress-notes?${value}` : "/health/progress-notes";
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Progress Notes Tracker</CardTitle>
            <p className="mt-1 text-sm text-muted">
              Progress notes are due every 90 days from enrollment until the first signed note, then every 90 days from the most recent signed note.
            </p>
          </div>
          <Link href="/health/progress-notes/new" className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white">
            New Progress Note
          </Link>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted">Overdue</p>
            <p className="text-base font-semibold">{result.summary.overdue}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted">Due Today</p>
            <p className="text-base font-semibold">{result.summary.dueToday}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted">Due Soon</p>
            <p className="text-base font-semibold">{result.summary.dueSoon}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted">Data Issues</p>
            <p className="text-base font-semibold">{result.summary.dataIssues}</p>
          </div>
        </div>
        <form className="mt-3 grid gap-2 md:grid-cols-4">
          <select name="status" defaultValue={status} className="h-10 rounded-lg border border-border px-3 text-sm">
            {FILTER_OPTIONS.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
          {memberId ? <input type="hidden" name="memberId" value={memberId} /> : null}
          <button type="submit" className="h-10 rounded-lg bg-brand px-3 text-sm font-semibold text-white">
            Apply
          </button>
          <Link href="/health/progress-notes" className="h-10 rounded-lg border border-border px-3 text-sm font-semibold leading-10 text-center text-brand">
            Clear Filters
          </Link>
        </form>
        {result.summary.dataIssues > 0 ? (
          <p className="mt-3 text-sm text-orange-800">
            One or more members are missing enrollment dates and are still being surfaced as data issues instead of being silently dropped.
          </p>
        ) : null}
      </Card>

      <Card className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Member</th>
              <th>Enrollment Date</th>
              <th>Last Signed Note</th>
              <th>Next Due Date</th>
              <th>Status</th>
              <th>Draft</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-sm text-muted">
                  No members match this progress note filter.
                </td>
              </tr>
            ) : (
              result.rows.map((row) => (
                <tr key={row.memberId}>
                  <td>
                    <Link href={`/health/member-health-profiles/${row.memberId}`} className="font-semibold text-brand">
                      {row.memberName}
                    </Link>
                  </td>
                  <td>{formatOptionalDate(row.enrollmentDate)}</td>
                  <td>{formatOptionalDate(row.lastSignedProgressNoteDate)}</td>
                  <td>
                    <div>
                      <p>{formatOptionalDate(row.nextProgressNoteDueDate)}</p>
                      {row.dataIssue ? <p className="text-xs text-orange-800">{row.dataIssue}</p> : null}
                    </div>
                  </td>
                  <td>
                    <ProgressNoteStatusBadge status={row.complianceStatus} />
                  </td>
                  <td>{row.hasDraftInProgress ? <span className="text-xs font-semibold text-brand">Draft In Progress</span> : "-"}</td>
                  <td>
                    <div className="flex flex-wrap gap-2 text-sm">
                      <Link href={`/health/progress-notes/new?memberId=${row.memberId}`} className="font-semibold text-brand">
                        New Progress Note
                      </Link>
                      {row.latestDraftId ? (
                        <Link href={`/health/progress-notes/${row.latestDraftId}`} className="font-semibold text-brand">
                          Resume Draft
                        </Link>
                      ) : null}
                      {row.latestSignedNoteId ? (
                        <Link href={`/health/progress-notes/${row.latestSignedNoteId}`} className="font-semibold text-brand">
                          View Last Signed
                        </Link>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link
            href={result.page > 1 ? pageHref(result.page - 1) : "#"}
            className={`rounded border px-3 py-1 font-semibold ${result.page > 1 ? "border-border text-brand" : "cursor-not-allowed border-border text-muted"}`}
          >
            Previous
          </Link>
          {Array.from({ length: result.totalPages }, (_, index) => index + 1).map((pageNumber) => (
            <Link
              key={pageNumber}
              href={pageHref(pageNumber)}
              className={`rounded border px-3 py-1 ${pageNumber === result.page ? "border-brand bg-brand text-white" : "border-border text-brand"}`}
            >
              {pageNumber}
            </Link>
          ))}
          <Link
            href={result.page < result.totalPages ? pageHref(result.page + 1) : "#"}
            className={`rounded border px-3 py-1 font-semibold ${result.page < result.totalPages ? "border-border text-brand" : "cursor-not-allowed border-border text-muted"}`}
          >
            Next
          </Link>
        </div>
      </Card>
    </div>
  );
}
