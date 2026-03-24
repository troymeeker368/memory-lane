import Link from "next/link";

import { createMemberHoldAction, endMemberHoldAction } from "@/app/(portal)/operations/holds/actions";
import { MemberHoldCreateForm } from "@/components/forms/member-hold-create-form";
import { BackArrowButton } from "@/components/ui/back-arrow-button";
import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import {
  normalizeOperationalDateOnly,
  getOperationsTodayDate,
  getFirstDayOfNextMonth
} from "@/lib/services/operations-calendar";
import { isMemberHoldActiveForDate } from "@/lib/services/expected-attendance";
import { listMemberHolds } from "@/lib/services/holds-supabase";
import { listMemberNameLookupSupabase } from "@/lib/services/member-command-center-read";
import { formatDate, formatDateTime, formatOptionalDate } from "@/lib/utils";

function firstString(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function OperationsHoldsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const profile = await requireModuleAccess("operations");
  const canEdit = profile.role === "admin" || profile.role === "manager";
  const params = await searchParams;
  const selectedDate = normalizeOperationalDateOnly(firstString(params.date) ?? getOperationsTodayDate());
  const defaultHoldStartDate = getOperationsTodayDate();
  const defaultHoldEndDate = getFirstDayOfNextMonth(defaultHoldStartDate);

  const [members, holds] = await Promise.all([
    listMemberNameLookupSupabase({ status: "all" }),
    listMemberHolds()
  ]);

  const memberById = new Map(members.map((member) => [member.id, member] as const));
  const activeMembers = members
    .filter((member) => member.status === "active")
    .sort((left, right) => left.display_name.localeCompare(right.display_name, undefined, { sensitivity: "base" }));
  const sortedHolds = [...holds].sort((left, right) => {
    if (left.start_date === right.start_date) return left.member_id.localeCompare(right.member_id, undefined, { sensitivity: "base" });
    return left.start_date < right.start_date ? 1 : -1;
  });

  const activeForDate = sortedHolds.filter((hold) => isMemberHoldActiveForDate(hold, selectedDate));
  const upcoming = sortedHolds.filter((hold) => hold.status === "active" && hold.start_date > selectedDate);
  const ended = sortedHolds.filter((hold) => hold.status === "ended" || (hold.end_date && hold.end_date < selectedDate));

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <BackArrowButton fallbackHref="/operations" forceFallback ariaLabel="Back to operations" />
          <div>
            <CardTitle>Holds</CardTitle>
            <p className="mt-1 text-sm text-muted">
              Date-aware member holds that automatically flow into Attendance/Census and Transportation Station.
            </p>
          </div>
        </div>
      </Card>

      <Card>
        <form method="get" className="grid gap-2 sm:grid-cols-[220px_120px_120px]">
          <label className="space-y-1 text-sm">
            <span className="text-xs font-semibold text-muted">Effective Date</span>
            <input type="date" name="date" defaultValue={selectedDate} className="h-10 w-full rounded-lg border border-border px-3" />
          </label>
          <button type="submit" className="h-10 self-end rounded-lg bg-brand px-3 text-sm font-semibold text-white">
            Apply
          </button>
          <Link
            href="/operations/holds"
            className="h-10 self-end rounded-lg border border-border px-3 text-center text-sm font-semibold leading-10"
          >
            Clear
          </Link>
        </form>
        <p className="mt-2 text-xs text-muted">
          Active on {formatDate(selectedDate)}: {activeForDate.length} | Upcoming: {upcoming.length} | Ended: {ended.length}
        </p>
      </Card>

      {canEdit ? (
        <Card>
          <CardTitle>Add New Hold</CardTitle>
          <MemberHoldCreateForm
            action={createMemberHoldAction}
            activeMembers={activeMembers.map((member) => ({ id: member.id, displayName: member.display_name }))}
            defaultStartDate={defaultHoldStartDate}
            defaultEndDate={defaultHoldEndDate}
          />
        </Card>
      ) : null}

      <Card className="table-wrap">
        <CardTitle>Active Holds ({activeForDate.length})</CardTitle>
        <table className="mt-3">
          <thead>
            <tr>
              <th>Member</th>
              <th>Reason</th>
              <th>Start</th>
              <th>End</th>
              <th>Updated</th>
              {canEdit ? <th>Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {activeForDate.length === 0 ? (
              <tr>
                <td colSpan={canEdit ? 6 : 5} className="text-sm text-muted">
                  No active holds for the selected date.
                </td>
              </tr>
            ) : (
              activeForDate.map((hold) => {
                const member = memberById.get(hold.member_id);
                const reason = hold.reason === "Other" ? `Other: ${hold.reason_other ?? "-"}` : hold.reason;
                return (
                  <tr key={hold.id}>
                    <td>
                      {member ? (
                        <Link href={`/operations/member-command-center/${member.id}`} className="font-semibold text-brand">
                          {member.display_name}
                        </Link>
                      ) : (
                        hold.member_id
                      )}
                    </td>
                    <td>{reason}</td>
                    <td>{formatDate(hold.start_date)}</td>
                    <td>{formatOptionalDate(hold.end_date)}</td>
                    <td>{formatDateTime(hold.updated_at)}</td>
                    {canEdit ? (
                      <td>
                        <form action={endMemberHoldAction}>
                          <input type="hidden" name="holdId" value={hold.id} />
                          <button type="submit" className="rounded-md border border-border px-2 py-1 text-xs font-semibold">
                            End Hold
                          </button>
                        </form>
                      </td>
                    ) : null}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </Card>

      <Card className="table-wrap">
        <CardTitle>Upcoming Holds ({upcoming.length})</CardTitle>
        <table className="mt-3">
          <thead>
            <tr>
              <th>Member</th>
              <th>Reason</th>
              <th>Start</th>
              <th>End</th>
            </tr>
          </thead>
          <tbody>
            {upcoming.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-sm text-muted">
                  No upcoming holds.
                </td>
              </tr>
            ) : (
              upcoming.map((hold) => {
                const member = memberById.get(hold.member_id);
                return (
                  <tr key={`upcoming-${hold.id}`}>
                    <td>{member?.display_name ?? hold.member_id}</td>
                    <td>{hold.reason === "Other" ? hold.reason_other ?? "Other" : hold.reason}</td>
                    <td>{formatDate(hold.start_date)}</td>
                    <td>{formatOptionalDate(hold.end_date)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </Card>

      <Card className="table-wrap">
        <CardTitle>Past Holds ({ended.length})</CardTitle>
        <table className="mt-3">
          <thead>
            <tr>
              <th>Member</th>
              <th>Reason</th>
              <th>Start</th>
              <th>End</th>
              <th>Ended</th>
            </tr>
          </thead>
          <tbody>
            {ended.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-sm text-muted">
                  No past holds.
                </td>
              </tr>
            ) : (
              ended.map((hold) => {
                const member = memberById.get(hold.member_id);
                return (
                  <tr key={`past-${hold.id}`}>
                    <td>{member?.display_name ?? hold.member_id}</td>
                    <td>{hold.reason === "Other" ? hold.reason_other ?? "Other" : hold.reason}</td>
                    <td>{formatDate(hold.start_date)}</td>
                    <td>{formatOptionalDate(hold.end_date)}</td>
                    <td>{formatOptionalDate(hold.ended_at?.slice(0, 10) ?? null)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
