import { clearLockerAction, assignLockerAction } from "@/app/(portal)/operations/locker-assignments/actions";
import { Card } from "@/components/ui/card";
import { SectionHeading } from "@/app/(portal)/operations/member-command-center/member-command-center-detail-shared";
import { listLockerAssignmentHistorySupabase } from "@/lib/services/locker-assignments-supabase";
import { formatDateTime } from "@/lib/utils";

function formatHistoryDateTime(value: string | null) {
  return value ? formatDateTime(value) : "-";
}

export default async function MemberCommandCenterLockerAssignmentsTab({
  memberId,
  memberName,
  lockerNumber,
  lockerOptions,
  canEdit
}: {
  memberId: string;
  memberName: string;
  lockerNumber: string | null;
  lockerOptions: string[];
  canEdit: boolean;
}) {
  const historyRows = await listLockerAssignmentHistorySupabase({ memberId, limit: 10, canonicalInput: true });
  const returnTo = `/operations/member-command-center/${memberId}?tab=locker-assignments`;

  return (
    <Card id="locker-assignments">
      <SectionHeading
        title="Locker Assignments"
        lastUpdatedAt={historyRows[0]?.updated_at ?? null}
        lastUpdatedBy={historyRows[0]?.previous_member_assigned ?? null}
      />

      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs text-muted">Current Locker</p>
          <p className="font-semibold">{lockerNumber ?? "Unassigned"}</p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs text-muted">Member</p>
          <p className="font-semibold">{memberName}</p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs text-muted">Available Options</p>
          <p className="font-semibold">{lockerOptions.length}</p>
        </div>
      </div>

      {canEdit ? (
        <div className="mt-3 rounded-lg border border-border p-3">
          <p className="text-sm font-semibold text-fg">Assign or Reassign Locker</p>
          <form action={assignLockerAction} className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
            <input type="hidden" name="memberId" value={memberId} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <label className="space-y-1 text-sm">
              <span className="text-xs font-semibold text-muted">Locker #</span>
              <select
                name="lockerNumber"
                defaultValue={lockerNumber ?? ""}
                required
                className="h-10 w-full rounded-lg border border-border px-3"
              >
                <option value="">Select locker</option>
                {lockerOptions.map((locker) => (
                  <option key={locker} value={locker}>
                    {locker}
                  </option>
                ))}
              </select>
            </label>
            <div className="self-end">
              <button type="submit" className="h-10 rounded-lg bg-brand px-3 text-sm font-semibold text-white">
                Save Locker
              </button>
            </div>
          </form>
          {lockerNumber ? (
            <form action={clearLockerAction} className="mt-3">
              <input type="hidden" name="memberId" value={memberId} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <button type="submit" className="rounded-lg border border-danger px-3 py-2 text-sm font-semibold text-danger">
                Clear Locker
              </button>
            </form>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 rounded-lg border border-border p-3 table-wrap">
        <p className="text-sm font-semibold text-fg">Locker History</p>
        <table className="mt-3">
          <thead>
            <tr>
              <th>Locker #</th>
              <th>Previous Assignment Recorded</th>
              <th>History Updated</th>
            </tr>
          </thead>
          <tbody>
            {historyRows.length === 0 ? (
              <tr>
                <td colSpan={3} className="text-sm text-muted">No locker history recorded for this member yet.</td>
              </tr>
            ) : (
              historyRows.map((row) => (
                <tr key={`${row.locker_number}-${row.updated_at}`}>
                  <td>{row.locker_number ?? "-"}</td>
                  <td>{formatHistoryDateTime(row.previous_assigned_at ?? row.updated_at ?? null)}</td>
                  <td>{formatHistoryDateTime(row.updated_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
