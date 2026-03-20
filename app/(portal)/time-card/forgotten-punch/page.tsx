import Link from "next/link";

import { Card, CardTitle } from "@/components/ui/card";
import { getCurrentProfile, requireModuleAccess } from "@/lib/auth";
import { getEmployeeForgottenPunchRequests } from "@/lib/services/director-timecards";
import { formatDate, formatDateTime } from "@/lib/utils";

import { submitDirectorTimecardAction } from "@/app/(portal)/time-card/director/actions";

function firstString(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ForgottenPunchPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireModuleAccess("time-card");
  const query = searchParams ? await searchParams : {};
  const successMessage = firstString(query.success);
  const errorMessage = firstString(query.error);
  const profile = await getCurrentProfile();
  const requests = await getEmployeeForgottenPunchRequests(profile.id);

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
            <CardTitle>Forgotten Punch Request</CardTitle>
            <p className="mt-1 text-sm text-muted">
              Submit a missing or corrected punch request for director review.
            </p>
          </div>
          <Link href="/time-card" className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-brand">
            Back to Time Clock
          </Link>
        </div>
      </Card>

      <Card>
        <CardTitle>New Request</CardTitle>
        <form action={submitDirectorTimecardAction} className="mt-3 grid gap-2 md:grid-cols-6">
          <input type="hidden" name="intent" value="submitForgottenPunchRequest" />
          <input type="hidden" name="returnPath" value="/time-card/forgotten-punch" />
          <input type="date" name="workDate" className="h-10 rounded-lg border border-border px-3 text-sm" required />
          <select name="requestType" defaultValue="missing_out" className="h-10 rounded-lg border border-border px-3 text-sm">
            <option value="missing_in">Missing IN</option>
            <option value="missing_out">Missing OUT</option>
            <option value="full_shift">Full Shift</option>
            <option value="edit_shift">Edit Shift</option>
          </select>
          <input type="time" name="requestedIn" className="h-10 rounded-lg border border-border px-3 text-sm" />
          <input type="time" name="requestedOut" className="h-10 rounded-lg border border-border px-3 text-sm" />
          <input name="reason" placeholder="Reason" className="h-10 rounded-lg border border-border px-3 text-sm" required />
          <button type="submit" className="h-10 rounded-lg bg-brand px-3 text-sm font-semibold text-white">Submit</button>
          <textarea name="employeeNote" placeholder="Optional note" rows={2} className="md:col-span-6 rounded-lg border border-border px-3 py-2 text-sm" />
        </form>
      </Card>

      <Card className="table-wrap">
        <CardTitle>My Requests</CardTitle>
        <table className="mt-3">
          <thead>
            <tr>
              <th>Submitted</th>
              <th>Work Date</th>
              <th>Type</th>
              <th>Requested In</th>
              <th>Requested Out</th>
              <th>Reason</th>
              <th>Status</th>
              <th>Director Note</th>
            </tr>
          </thead>
          <tbody>
            {requests.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-sm text-muted">No forgotten punch requests submitted yet.</td>
              </tr>
            ) : (
              requests.map((row) => (
                <tr key={row.id}>
                  <td>{formatDateTime(row.created_at)}</td>
                  <td>{formatDate(row.work_date)}</td>
                  <td>{row.request_type}</td>
                  <td>{row.requested_in ?? "-"}</td>
                  <td>{row.requested_out ?? "-"}</td>
                  <td>{row.reason}</td>
                  <td>{row.status}</td>
                  <td>{row.director_decision_note ?? "-"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
