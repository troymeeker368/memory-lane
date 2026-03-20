import { Card, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";

import { submitDirectorTimecardAction } from "@/app/(portal)/time-card/director/actions";
import type { DirectorTimecardsWorkspace } from "@/app/(portal)/time-card/director/director-timecards-shared";
import { statusBadge } from "@/app/(portal)/time-card/director/director-timecards-shared";

export function ForgottenTab({
  workspace,
  forgottenHref
}: {
  workspace: DirectorTimecardsWorkspace;
  forgottenHref: string;
}) {
  return (
    <Card className="table-wrap">
      <CardTitle>Forgotten Punch Requests</CardTitle>
      <table className="mt-3">
        <thead>
          <tr>
            <th>Employee</th>
            <th>Work Date</th>
            <th>Type</th>
            <th>Requested In</th>
            <th>Requested Out</th>
            <th>Reason</th>
            <th>Status</th>
            <th>Decision</th>
          </tr>
        </thead>
        <tbody>
          {workspace.forgottenPunchRequests.length === 0 ? (
            <tr>
              <td colSpan={8} className="text-sm text-muted">No forgotten punch requests in this pay period.</td>
            </tr>
          ) : (
            workspace.forgottenPunchRequests.map((request) => (
              <tr key={request.id}>
                <td>{request.employee_name}</td>
                <td>{formatDate(request.work_date)}</td>
                <td>{request.request_type}</td>
                <td>{request.requested_in ?? "-"}</td>
                <td>{request.requested_out ?? "-"}</td>
                <td>{request.reason}</td>
                <td><span className={statusBadge(request.status === "submitted" ? "pending" : request.status)}>{request.status}</span></td>
                <td>
                  {request.status === "submitted" ? (
                    <form action={submitDirectorTimecardAction} className="flex flex-wrap gap-2">
                      <input type="hidden" name="intent" value="decideForgottenPunchRequest" />
                      <input type="hidden" name="returnPath" value={forgottenHref} />
                      <input type="hidden" name="requestId" value={request.id} />
                      <input name="decisionNote" placeholder="Decision note" className="h-8 rounded border border-border px-2 text-xs" />
                      <button type="submit" name="decision" value="approved" className="h-8 rounded-lg bg-brand px-2 text-xs font-semibold text-white">Approve</button>
                      <button type="submit" name="decision" value="denied" className="h-8 rounded-lg bg-slate-700 px-2 text-xs font-semibold text-white">Deny</button>
                    </form>
                  ) : (
                    request.director_decision_note ?? "-"
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </Card>
  );
}
