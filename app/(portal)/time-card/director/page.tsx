import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { requireRoles } from "@/lib/auth";
import { normalizeRoleKey } from "@/lib/permissions";
import { getDirectorTimecardsWorkspace } from "@/lib/services/director-timecards";
import { formatDate, formatDateTime } from "@/lib/utils";

import {
  addDirectorCorrectionPunchAction,
  addPtoEntryAction,
  approveDailyTimecardAction,
  decideForgottenPunchRequestAction,
  decidePtoEntryAction,
  markNeedsReviewTimecardAction,
  setPayPeriodClosedAction,
  updatePendingPtoEntryAction
} from "@/app/(portal)/time-card/director/actions";

const TABS = [
  { key: "pending", label: "Pending Approvals" },
  { key: "daily", label: "Daily Timecards" },
  { key: "forgotten", label: "Forgotten Punch Requests" },
  { key: "pto", label: "PTO Management" },
  { key: "summary", label: "Pay Period Summary" },
  { key: "export", label: "Payroll Export" }
] as const;

type TabKey = (typeof TABS)[number]["key"];

function firstString(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function statusBadge(status: string) {
  if (status === "approved") return "rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700";
  if (status === "needs_review") return "rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-700";
  if (status === "corrected") return "rounded-full bg-sky-100 px-2 py-1 text-xs font-semibold text-sky-700";
  return "rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700";
}

export default async function DirectorTimecardsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const profile = await requireRoles(["admin", "director", "manager"]);
  const role = normalizeRoleKey(profile.role);
  const query = await searchParams;
  const tab = (firstString(query.tab) ?? "pending") as TabKey;
  const activeTab = TABS.some((item) => item.key === tab) ? tab : "pending";
  const payPeriodId = firstString(query.payPeriodId) ?? null;
  const employeeId = firstString(query.employeeId) ?? null;
  const status = firstString(query.status) ?? "all";
  const exceptionOnly = firstString(query.exceptionOnly) === "1";
  const successMessage = firstString(query.success);
  const errorMessage = firstString(query.error);
  const canLockPayPeriod = role === "admin" || role === "director";

  const workspace = await getDirectorTimecardsWorkspace({
    payPeriodId,
    employeeId,
    status,
    exceptionOnly
  });

  const buildTabHref = (tabKey: TabKey) => {
    const params = new URLSearchParams();
    params.set("tab", tabKey);
    params.set("payPeriodId", workspace.selectedPayPeriod.id);
    if (employeeId) params.set("employeeId", employeeId);
    if (status && status !== "all") params.set("status", status);
    if (exceptionOnly) params.set("exceptionOnly", "1");
    return `/time-card/director?${params.toString()}`;
  };
  const pendingHref = buildTabHref("pending");
  const forgottenHref = buildTabHref("forgotten");
  const ptoHref = buildTabHref("pto");
  const exportHref = buildTabHref("export");

  return (
    <div className="space-y-4">
      {successMessage ? (
        <Card className="border-emerald-200 bg-emerald-50">
          <p className="text-sm font-semibold text-emerald-700">{successMessage}</p>
        </Card>
      ) : null}
      {errorMessage ? (
        <Card className="border-rose-200 bg-rose-50">
          <p className="text-sm font-semibold text-rose-700">{errorMessage}</p>
        </Card>
      ) : null}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Director Timecards</CardTitle>
            <p className="mt-1 text-sm text-muted">
              Review, correct, approve, manage PTO, and export payroll-ready details by pay period.
            </p>
          </div>
          <Link href="/time-card" className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-brand">
            Back to Time Clock
          </Link>
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap gap-2">
          {TABS.map((item) => (
            <Link
              key={item.key}
              href={buildTabHref(item.key)}
              className={`rounded-lg border px-3 py-2 text-xs font-semibold ${activeTab === item.key ? "border-brand bg-brand text-white" : "border-border text-brand"}`}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </Card>

      <Card>
        <CardTitle>Filters</CardTitle>
        <form className="mt-3 grid gap-2 md:grid-cols-6" method="get">
          <input type="hidden" name="tab" value={activeTab} />
          <select name="payPeriodId" defaultValue={workspace.selectedPayPeriod.id} className="h-10 rounded-lg border border-border px-3 text-sm">
            {workspace.payPeriods.map((period) => (
              <option key={period.id} value={period.id}>
                {period.label} {period.is_closed ? "(Closed)" : ""}
              </option>
            ))}
          </select>
          <select name="employeeId" defaultValue={employeeId ?? ""} className="h-10 rounded-lg border border-border px-3 text-sm">
            <option value="">All employees</option>
            {workspace.availableEmployees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.name}
              </option>
            ))}
          </select>
          <select name="status" defaultValue={status} className="h-10 rounded-lg border border-border px-3 text-sm">
            <option value="all">All statuses</option>
            <option value="pending">Pending</option>
            <option value="needs_review">Needs review</option>
            <option value="approved">Approved</option>
            <option value="corrected">Corrected</option>
          </select>
          <label className="flex items-center gap-2 rounded-lg border border-border px-3 text-sm">
            <input type="checkbox" name="exceptionOnly" value="1" defaultChecked={exceptionOnly} />
            Exceptions only
          </label>
          <button type="submit" className="h-10 rounded-lg bg-brand px-3 text-sm font-semibold text-white">
            Apply
          </button>
        </form>
      </Card>

      {activeTab === "pending" ? (
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
                        <form action={approveDailyTimecardAction}>
                          <input type="hidden" name="timecardId" value={row.id} />
                          <input type="hidden" name="returnPath" value={pendingHref} />
                          <Button type="submit" className="h-8 px-3 text-xs">Approve</Button>
                        </form>
                        <form action={markNeedsReviewTimecardAction}>
                          <input type="hidden" name="timecardId" value={row.id} />
                          <input type="hidden" name="returnPath" value={pendingHref} />
                          <Button type="submit" className="h-8 bg-slate-700 px-3 text-xs">Needs Review</Button>
                        </form>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <form action={addDirectorCorrectionPunchAction} className="flex flex-wrap gap-1">
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
                        <form action={addPtoEntryAction} className="flex flex-wrap gap-1">
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
      ) : null}

      {activeTab === "daily" ? (
        <Card className="table-wrap">
          <CardTitle>Daily Timecards</CardTitle>
          <table className="mt-3">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Work Date</th>
                <th>First In</th>
                <th>Last Out</th>
                <th>Raw</th>
                <th>Meal</th>
                <th>Worked</th>
                <th>PTO</th>
                <th>OT</th>
                <th>Total Paid</th>
                <th>Status</th>
                <th>Approved By</th>
                <th>Approved At</th>
              </tr>
            </thead>
            <tbody>
              {workspace.dailyTimecards.length === 0 ? (
                <tr>
                  <td colSpan={13} className="text-sm text-muted">No daily timecards for selected filters.</td>
                </tr>
              ) : (
                workspace.dailyTimecards.map((row) => (
                  <tr key={row.id} className={row.has_exception ? "bg-amber-50" : undefined}>
                    <td>{row.employee_name}</td>
                    <td>{formatDate(row.work_date)}</td>
                    <td>{row.first_in ? formatDateTime(row.first_in) : "-"}</td>
                    <td>{row.last_out ? formatDateTime(row.last_out) : "-"}</td>
                    <td>{row.raw_hours.toFixed(2)}</td>
                    <td>{row.meal_deduction_hours.toFixed(2)}</td>
                    <td>{row.worked_hours.toFixed(2)}</td>
                    <td>{row.pto_hours.toFixed(2)}</td>
                    <td>{row.overtime_hours.toFixed(2)}</td>
                    <td>{row.total_paid_hours.toFixed(2)}</td>
                    <td><span className={statusBadge(row.status)}>{row.status}</span></td>
                    <td>{row.approved_by ?? "-"}</td>
                    <td>{row.approved_at ? formatDateTime(row.approved_at) : "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>
      ) : null}

      {activeTab === "forgotten" ? (
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
                        <form action={decideForgottenPunchRequestAction} className="flex flex-wrap gap-2">
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
      ) : null}

      {activeTab === "pto" ? (
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
      ) : null}

      {activeTab === "summary" ? (
        <Card className="table-wrap">
          <CardTitle>Pay Period Summary</CardTitle>
          <table className="mt-3">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Regular Hours</th>
                <th>Overtime Hours</th>
                <th>PTO Hours</th>
                <th>Total Paid Hours</th>
                <th>Exception Count</th>
                <th>Approval State</th>
              </tr>
            </thead>
            <tbody>
              {workspace.payPeriodSummary.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-sm text-muted">No summary data for this period.</td>
                </tr>
              ) : (
                workspace.payPeriodSummary.map((row) => (
                  <tr key={row.employee_name}>
                    <td>{row.employee_name}</td>
                    <td>{row.regular_hours.toFixed(2)}</td>
                    <td>{row.overtime_hours.toFixed(2)}</td>
                    <td>{row.pto_hours.toFixed(2)}</td>
                    <td>{row.total_paid_hours.toFixed(2)}</td>
                    <td>{row.exception_count}</td>
                    <td><span className={statusBadge(row.approval_state)}>{row.approval_state}</span></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>
      ) : null}

      {activeTab === "export" ? (
        <>
          <Card>
            <CardTitle>Payroll Export</CardTitle>
            <p className="mt-1 text-sm text-muted">
              Export includes employee, pay period, daily punches, hours, status, and director approval data.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {workspace.payrollExport.csvDataUrl ? (
                <a href={workspace.payrollExport.csvDataUrl} download={workspace.payrollExport.fileName} className="rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white">
                  Download CSV
                </a>
              ) : (
                <span className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
                  {workspace.payrollExport.error ?? "Export unavailable."}
                </span>
              )}
              <Link
                href={`/time-card/director/payroll-print?payPeriodId=${encodeURIComponent(workspace.selectedPayPeriod.id)}${employeeId ? `&employeeId=${encodeURIComponent(employeeId)}` : ""}`}
                className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-brand"
              >
                Open Printable View
              </Link>
              {canLockPayPeriod ? (
                <form action={setPayPeriodClosedAction}>
                  <input type="hidden" name="returnPath" value={exportHref} />
                  <input type="hidden" name="payPeriodId" value={workspace.selectedPayPeriod.id} />
                  <input type="hidden" name="isClosed" value={workspace.selectedPayPeriod.is_closed ? "false" : "true"} />
                  <button type="submit" className="rounded-lg border border-border px-3 py-2 text-xs font-semibold">
                    {workspace.selectedPayPeriod.is_closed ? "Reopen Pay Period" : "Close Pay Period"}
                  </button>
                </form>
              ) : null}
            </div>
          </Card>
          <Card className="table-wrap">
            <CardTitle>Export Preview</CardTitle>
            <table className="mt-3">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Pay Period</th>
                  <th>Work Date</th>
                  <th>First In</th>
                  <th>Last Out</th>
                  <th>Raw</th>
                  <th>Meal</th>
                  <th>Worked</th>
                  <th>PTO</th>
                  <th>OT</th>
                  <th>Total Paid</th>
                  <th>Status</th>
                  <th>Approval</th>
                </tr>
              </thead>
              <tbody>
                {workspace.payrollExport.rows.length === 0 ? (
                  <tr>
                    <td colSpan={13} className="text-sm text-muted">No export rows for selected filters.</td>
                  </tr>
                ) : (
                  workspace.payrollExport.rows.map((row, index) => (
                    <tr key={`${row.employee_name}-${row.work_date}-${index}`}>
                      <td>{row.employee_name}</td>
                      <td>{row.pay_period_label}</td>
                      <td>{formatDate(row.work_date)}</td>
                      <td>{row.first_in ? formatDateTime(row.first_in) : "-"}</td>
                      <td>{row.last_out ? formatDateTime(row.last_out) : "-"}</td>
                      <td>{row.raw_hours.toFixed(2)}</td>
                      <td>{row.meal_deduction_hours.toFixed(2)}</td>
                      <td>{row.worked_hours.toFixed(2)}</td>
                      <td>{row.pto_hours.toFixed(2)}</td>
                      <td>{row.overtime_hours.toFixed(2)}</td>
                      <td>{row.total_paid_hours.toFixed(2)}</td>
                      <td><span className={statusBadge(row.status)}>{row.status}</span></td>
                      <td>{row.approved_by ? `${row.approved_by}${row.approved_at ? ` (${formatDateTime(row.approved_at)})` : ""}` : "-"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </Card>
        </>
      ) : null}
    </div>
  );
}
