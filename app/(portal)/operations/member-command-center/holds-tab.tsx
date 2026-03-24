import Link from "next/link";

import { createMemberHoldAction, endMemberHoldAction } from "@/app/(portal)/operations/holds/actions";
import { MemberHoldCreateForm } from "@/components/forms/member-hold-create-form";
import { Card } from "@/components/ui/card";
import { SectionHeading } from "@/app/(portal)/operations/member-command-center/member-command-center-detail-shared";
import {
  getFirstDayOfNextMonth,
  getOperationsTodayDate
} from "@/lib/services/operations-calendar";
import { isMemberHoldActiveForDate } from "@/lib/services/expected-attendance";
import { listMemberHolds } from "@/lib/services/holds-supabase";
import { formatDate, formatDateTime, formatOptionalDate } from "@/lib/utils";

export default async function MemberCommandCenterHoldsTab({
  memberId,
  memberName,
  canEdit,
  selectedDate
}: {
  memberId: string;
  memberName: string;
  canEdit: boolean;
  selectedDate: string;
}) {
  const holds = await listMemberHolds({ memberId, canonicalInput: true });
  const sortedHolds = [...holds].sort((left, right) => {
    if (left.start_date === right.start_date) return left.id.localeCompare(right.id);
    return left.start_date < right.start_date ? 1 : -1;
  });

  const activeForDate = sortedHolds.filter((hold) => isMemberHoldActiveForDate(hold, selectedDate));
  const upcoming = sortedHolds.filter((hold) => hold.status === "active" && hold.start_date > selectedDate);
  const ended = sortedHolds.filter((hold) => hold.status === "ended" || (hold.end_date && hold.end_date < selectedDate));

  return (
    <Card id="holds">
      <SectionHeading
        title="Holds"
        lastUpdatedAt={sortedHolds[0]?.updated_at ?? null}
        lastUpdatedBy={sortedHolds[0]?.ended_by_name ?? sortedHolds[0]?.created_by_name ?? null}
      />

      <div className="mt-3 rounded-lg border border-border p-3">
        <form method="get" className="grid gap-2 sm:grid-cols-[220px_120px_120px]">
          <input type="hidden" name="tab" value="holds" />
          <label className="space-y-1 text-sm">
            <span className="text-xs font-semibold text-muted">Effective Date</span>
            <input type="date" name="date" defaultValue={selectedDate} className="h-10 w-full rounded-lg border border-border px-3" />
          </label>
          <button type="submit" className="h-10 self-end rounded-lg bg-brand px-3 text-sm font-semibold text-white">
            Apply
          </button>
          <Link
            href={`/operations/member-command-center/${memberId}?tab=holds`}
            className="h-10 self-end rounded-lg border border-border px-3 text-center text-sm font-semibold leading-10"
          >
            Clear
          </Link>
        </form>
        <p className="mt-2 text-xs text-muted">
          {memberName} on {formatDate(selectedDate)}: {activeForDate.length} active hold(s) | {upcoming.length} upcoming | {ended.length} past
        </p>
      </div>

      {canEdit ? (
        <div className="mt-3 rounded-lg border border-border p-3">
          <p className="text-sm font-semibold text-fg">Add Hold</p>
          <MemberHoldCreateForm
            action={createMemberHoldAction}
            activeMembers={[{ id: memberId, displayName: memberName }]}
            defaultStartDate={getOperationsTodayDate()}
            defaultEndDate={getFirstDayOfNextMonth(getOperationsTodayDate())}
          />
        </div>
      ) : null}

      <div className="mt-3 grid gap-3 xl:grid-cols-3">
        <Card className="table-wrap">
          <SectionHeading title={`Active (${activeForDate.length})`} lastUpdatedAt={null} lastUpdatedBy={null} />
          <table className="mt-3">
            <thead>
              <tr>
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
                  <td colSpan={canEdit ? 5 : 4} className="text-sm text-muted">No active holds for this date.</td>
                </tr>
              ) : (
                activeForDate.map((hold) => (
                  <tr key={hold.id}>
                    <td>{hold.reason === "Other" ? `Other: ${hold.reason_other ?? "-"}` : hold.reason}</td>
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
                ))
              )}
            </tbody>
          </table>
        </Card>

        <Card className="table-wrap">
          <SectionHeading title={`Upcoming (${upcoming.length})`} lastUpdatedAt={null} lastUpdatedBy={null} />
          <table className="mt-3">
            <thead>
              <tr>
                <th>Reason</th>
                <th>Start</th>
                <th>End</th>
              </tr>
            </thead>
            <tbody>
              {upcoming.length === 0 ? (
                <tr>
                  <td colSpan={3} className="text-sm text-muted">No upcoming holds.</td>
                </tr>
              ) : (
                upcoming.map((hold) => (
                  <tr key={`upcoming-${hold.id}`}>
                    <td>{hold.reason === "Other" ? hold.reason_other ?? "Other" : hold.reason}</td>
                    <td>{formatDate(hold.start_date)}</td>
                    <td>{formatOptionalDate(hold.end_date)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>

        <Card className="table-wrap">
          <SectionHeading title={`Past (${ended.length})`} lastUpdatedAt={null} lastUpdatedBy={null} />
          <table className="mt-3">
            <thead>
              <tr>
                <th>Reason</th>
                <th>Start</th>
                <th>End</th>
                <th>Ended</th>
              </tr>
            </thead>
            <tbody>
              {ended.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-sm text-muted">No past holds.</td>
                </tr>
              ) : (
                ended.map((hold) => (
                  <tr key={`ended-${hold.id}`}>
                    <td>{hold.reason === "Other" ? hold.reason_other ?? "Other" : hold.reason}</td>
                    <td>{formatDate(hold.start_date)}</td>
                    <td>{formatOptionalDate(hold.end_date)}</td>
                    <td>{formatOptionalDate(hold.ended_at?.slice(0, 10) ?? null)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>
      </div>
    </Card>
  );
}
