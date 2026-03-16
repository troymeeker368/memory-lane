import { Card, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";

import { addPtoEntryAction, decidePtoEntryAction, updatePendingPtoEntryAction } from "@/app/(portal)/time-card/director/actions";
import type { DirectorTimecardsWorkspace } from "@/app/(portal)/time-card/director/director-timecards-shared";
import { statusBadge } from "@/app/(portal)/time-card/director/director-timecards-shared";

export function PtoTab({
  workspace,
  ptoHref,
  employeeId
}: {
  workspace: DirectorTimecardsWorkspace;
  ptoHref: string;
  employeeId: string | null;
}) {
  return (
    <>
      <Card>
        <CardTitle>Add PTO Entry</CardTitle>
        <form action={addPtoEntryAction} className="mt-3 grid gap-2 md:grid-cols-5">
          <input type="hidden" name="returnPath" value={ptoHref} />
          <select name="employeeId" defaultValue={employeeId ?? ""} className="h-10 rounded-lg border border-border px-3 text-sm" required>
            <option value="">Employee</option>
            {workspace.availableEmployees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.name}
              </option>
            ))}
          </select>
          <input type="date" name="workDate" className="h-10 rounded-lg border border-border px-3 text-sm" required />
          <input type="number" step="0.25" min="0" max="24" name="hours" defaultValue="8" className="h-10 rounded-lg border border-border px-3 text-sm" required />
          <select name="type" defaultValue="vacation" className="h-10 rounded-lg border border-border px-3 text-sm">
            <option value="vacation">Vacation</option>
            <option value="sick">Sick</option>
            <option value="holiday">Holiday</option>
            <option value="personal">Personal</option>
          </select>
          <button type="submit" className="h-10 rounded-lg bg-brand px-3 text-sm font-semibold text-white">Add PTO</button>
        </form>
      </Card>
      <Card className="table-wrap">
        <CardTitle>PTO Entries</CardTitle>
        <table className="mt-3">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Work Date</th>
              <th>Hours</th>
              <th>Type</th>
              <th>Status</th>
              <th>Note</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {workspace.ptoEntries.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-sm text-muted">No PTO entries for selected filters.</td>
              </tr>
            ) : (
              workspace.ptoEntries.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.employee_name}</td>
                  <td>{formatDate(entry.work_date)}</td>
                  <td>{entry.hours.toFixed(2)}</td>
                  <td>{entry.type}</td>
                  <td><span className={statusBadge(entry.status)}>{entry.status}</span></td>
                  <td>{entry.note ?? "-"}</td>
                  <td>
                    {entry.status === "pending" ? (
                      <div className="space-y-2">
                        <form action={updatePendingPtoEntryAction} className="flex flex-wrap gap-1">
                          <input type="hidden" name="returnPath" value={ptoHref} />
                          <input type="hidden" name="entryId" value={entry.id} />
                          <input type="number" step="0.25" min="0" max="24" name="hours" defaultValue={entry.hours} className="h-8 w-16 rounded border border-border px-2 text-xs" />
                          <select name="type" defaultValue={entry.type} className="h-8 rounded border border-border px-2 text-xs">
                            <option value="vacation">Vacation</option>
                            <option value="sick">Sick</option>
                            <option value="holiday">Holiday</option>
                            <option value="personal">Personal</option>
                          </select>
                          <input name="note" defaultValue={entry.note ?? ""} className="h-8 rounded border border-border px-2 text-xs" />
                          <button type="submit" className="h-8 rounded-lg border border-border px-2 text-xs font-semibold">Save</button>
                        </form>
                        <form action={decidePtoEntryAction} className="flex flex-wrap gap-1">
                          <input type="hidden" name="returnPath" value={ptoHref} />
                          <input type="hidden" name="entryId" value={entry.id} />
                          <input name="decisionNote" placeholder="Decision note" className="h-8 rounded border border-border px-2 text-xs" />
                          <button type="submit" name="decision" value="approved" className="h-8 rounded-lg bg-brand px-2 text-xs font-semibold text-white">Approve</button>
                          <button type="submit" name="decision" value="denied" className="h-8 rounded-lg bg-slate-700 px-2 text-xs font-semibold text-white">Deny</button>
                        </form>
                      </div>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
      <Card className="table-wrap">
        <CardTitle>PTO Totals (Approved)</CardTitle>
        <table className="mt-3">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Approved PTO Hours</th>
            </tr>
          </thead>
          <tbody>
            {workspace.ptoTotalsByEmployee.length === 0 ? (
              <tr>
                <td colSpan={2} className="text-sm text-muted">No approved PTO totals for this period.</td>
              </tr>
            ) : (
              workspace.ptoTotalsByEmployee.map((row) => (
                <tr key={row.employee_id}>
                  <td>{row.employee_name}</td>
                  <td>{row.approved_hours.toFixed(2)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </>
  );
}
