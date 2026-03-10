import { Card, CardTitle } from "@/components/ui/card";
import { CENTER_CLOSURE_TYPE_OPTIONS, listCenterClosures } from "@/lib/services/billing";

import { saveCenterClosureAction } from "@/app/(portal)/operations/payor/actions";

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

export default async function CenterClosuresPage() {
  const closures = listCenterClosures();

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Center Closures / Holiday Calendar</CardTitle>
        <p className="mt-1 text-sm text-muted">
          Schedule prebilling excludes active closure dates by default. Set Billable Override only when a closure date should remain billable.
        </p>
      </Card>

      <Card>
        <form action={saveCenterClosureAction} className="grid gap-2 md:grid-cols-6">
          <label className="space-y-1 text-xs">
            <span className="font-semibold text-muted">Closure Date</span>
            <input name="closureDate" type="date" defaultValue={todayDate()} className="h-10 w-full rounded-lg border border-border px-3" required />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-semibold text-muted">Closure Name</span>
            <input name="closureName" placeholder="Christmas Day" className="h-10 w-full rounded-lg border border-border px-3" required />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-semibold text-muted">Closure Type</span>
            <select name="closureType" className="h-10 w-full rounded-lg border border-border px-3">
              {CENTER_CLOSURE_TYPE_OPTIONS.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs md:col-span-2">
            <span className="font-semibold text-muted">Notes</span>
            <input name="notes" placeholder="Optional context" className="h-10 w-full rounded-lg border border-border px-3" />
          </label>
          <div className="flex items-end gap-4">
            <label className="flex items-center gap-2 text-xs font-semibold text-muted">
              <input name="active" type="checkbox" value="true" defaultChecked />
              Active
            </label>
            <label className="flex items-center gap-2 text-xs font-semibold text-muted">
              <input name="billableOverride" type="checkbox" value="true" />
              Billable Override
            </label>
          </div>
          <div className="md:col-span-6">
            <button type="submit" className="h-10 rounded-lg bg-brand px-4 text-sm font-semibold text-white">
              Save Center Closure
            </button>
          </div>
        </form>
      </Card>

      <Card className="table-wrap">
        <CardTitle>Configured Closure Dates</CardTitle>
        <table className="mt-3">
          <thead>
            <tr>
              <th>Date</th>
              <th>Name</th>
              <th>Type</th>
              <th>Billable Override</th>
              <th>Active</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {closures.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-sm text-muted">No closure dates configured.</td>
              </tr>
            ) : (
              closures.map((row) => (
                <tr key={row.id}>
                  <td>{row.closure_date}</td>
                  <td>{row.closure_name}</td>
                  <td>{row.closure_type}</td>
                  <td>{row.billable_override ? "Yes" : "No"}</td>
                  <td>{row.active ? "Yes" : "No"}</td>
                  <td>{row.notes ?? "-"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

