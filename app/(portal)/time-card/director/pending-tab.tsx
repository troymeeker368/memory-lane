import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";

import { submitDirectorTimecardAction } from "@/app/(portal)/time-card/director/actions";
import type { DirectorTimecardsWorkspace } from "@/app/(portal)/time-card/director/director-timecards-shared";
import { statusBadge } from "@/app/(portal)/time-card/director/director-timecards-shared";

export function PendingTab({
  workspace,
  pendingHref
}: {
  workspace: DirectorTimecardsWorkspace;
  pendingHref: string;
}) {
  return (
    <Card className="table-wrap">
      <CardTitle>Pending Approvals</CardTitle>
      <table className="mt-3">
        <thead>
          <tr>
            <th>Employee</th>
            <th>Work Date</th>
            <th>Worked</th>
            <th>PTO</th>
            <th>Total Paid</th>
            <th>Status</th>
            <th>Exceptions</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {workspace.pendingApprovals.length === 0 ? (
            <tr>
              <td colSpan={8} className="text-sm text-muted">No pending approvals for this pay period.</td>
            </tr>
          ) : (
            workspace.pendingApprovals.map((row) => (
              <tr key={row.id} className={row.has_exception ? "bg-amber-50" : undefined}>
                <td>{row.employee_name}</td>
                <td>{formatDate(row.work_date)}</td>
                <td>{row.worked_hours.toFixed(2)}</td>
                <td>{row.pto_hours.toFixed(2)}</td>
                <td>{row.total_paid_hours.toFixed(2)}</td>
                <td><span className={statusBadge(row.status)}>{row.status}</span></td>
                <td>{row.has_exception ? "Yes" : "No"}</td>
                <td>
                  <div className="flex flex-wrap gap-2">
                    <form action={submitDirectorTimecardAction}>
                      <input type="hidden" name="intent" value="approveDailyTimecard" />
                      <input type="hidden" name="timecardId" value={row.id} />
                      <input type="hidden" name="returnPath" value={pendingHref} />
                      <Button type="submit" className="h-8 px-3 text-xs">Approve</Button>
                    </form>
                    <form action={submitDirectorTimecardAction}>
                      <input type="hidden" name="intent" value="markNeedsReviewTimecard" />
                      <input type="hidden" name="timecardId" value={row.id} />
                      <input type="hidden" name="returnPath" value={pendingHref} />
                      <Button type="submit" className="h-8 bg-slate-700 px-3 text-xs">Needs Review</Button>
                    </form>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <form action={submitDirectorTimecardAction} className="flex flex-wrap gap-1">
                      <input type="hidden" name="intent" value="addDirectorCorrectionPunch" />
                      <input type="hidden" name="returnPath" value={pendingHref} />
                      <input type="hidden" name="employeeId" value={row.employee_id} />
                      <input type="hidden" name="employeeName" value={row.employee_name} />
                      <input type="hidden" name="workDate" value={row.work_date} />
                      <select name="type" defaultValue="in" className="h-8 rounded border border-border px-2 text-xs">
                        <option value="in">IN</option>
                        <option value="out">OUT</option>
                      </select>
                      <input type="time" name="time" defaultValue="09:00" className="h-8 rounded border border-border px-2 text-xs" />
                      <button type="submit" className="h-8 rounded-lg border border-border px-2 text-xs font-semibold">Add Punch</button>
                    </form>
                    <form action={submitDirectorTimecardAction} className="flex flex-wrap gap-1">
                      <input type="hidden" name="intent" value="addPtoEntry" />
                      <input type="hidden" name="returnPath" value={pendingHref} />
                      <input type="hidden" name="employeeId" value={row.employee_id} />
                      <input type="hidden" name="employeeName" value={row.employee_name} />
                      <input type="hidden" name="workDate" value={row.work_date} />
                      <input type="number" name="hours" step="0.25" min="0" max="24" defaultValue="8" className="h-8 w-16 rounded border border-border px-2 text-xs" />
                      <select name="type" defaultValue="vacation" className="h-8 rounded border border-border px-2 text-xs">
                        <option value="vacation">Vacation</option>
                        <option value="sick">Sick</option>
                        <option value="holiday">Holiday</option>
                        <option value="personal">Personal</option>
                      </select>
                      <button type="submit" className="h-8 rounded-lg border border-border px-2 text-xs font-semibold">Add PTO</button>
                    </form>
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </Card>
  );
}
