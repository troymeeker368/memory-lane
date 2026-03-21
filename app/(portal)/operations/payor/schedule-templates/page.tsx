import { Card, CardTitle } from "@/components/ui/card";
import { listBillingScheduleTemplates } from "@/lib/services/billing-read";
import { listMemberNameLookupSupabase } from "@/lib/services/member-command-center-read";

import { submitPayorAction } from "@/app/(portal)/operations/payor/actions";

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

export default async function BillingScheduleTemplatesPage() {
  const [members, rows] = await Promise.all([
    listMemberNameLookupSupabase({ status: "active" }),
    listBillingScheduleTemplates()
  ]);

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Schedule Templates</CardTitle>
        <p className="mt-1 text-sm text-muted">
          Contracted attendance templates drive base prebilling counts for upcoming-month invoices.
        </p>
        <form action={submitPayorAction} className="mt-3 grid gap-2 md:grid-cols-8">
          <input type="hidden" name="intent" value="saveBillingScheduleTemplate" />
          <select name="memberId" className="h-10 rounded-lg border border-border px-3 md:col-span-2" required>
            <option value="">Member</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>{member.display_name}</option>
            ))}
          </select>
          <input name="effectiveStartDate" type="date" defaultValue={todayDate()} className="h-10 rounded-lg border border-border px-3" />
          <input name="effectiveEndDate" type="date" className="h-10 rounded-lg border border-border px-3" />
          <label className="flex items-center gap-2 rounded-lg border border-border px-2 text-xs"><input type="checkbox" name="monday" value="true" />Mon</label>
          <label className="flex items-center gap-2 rounded-lg border border-border px-2 text-xs"><input type="checkbox" name="tuesday" value="true" />Tue</label>
          <label className="flex items-center gap-2 rounded-lg border border-border px-2 text-xs"><input type="checkbox" name="wednesday" value="true" />Wed</label>
          <label className="flex items-center gap-2 rounded-lg border border-border px-2 text-xs"><input type="checkbox" name="thursday" value="true" />Thu</label>
          <label className="flex items-center gap-2 rounded-lg border border-border px-2 text-xs"><input type="checkbox" name="friday" value="true" />Fri</label>
          <label className="flex items-center gap-2 rounded-lg border border-border px-2 text-xs"><input type="checkbox" name="saturday" value="true" />Sat</label>
          <label className="flex items-center gap-2 rounded-lg border border-border px-2 text-xs"><input type="checkbox" name="sunday" value="true" />Sun</label>
          <label className="flex items-center gap-2 rounded-lg border border-border px-2 text-xs"><input type="checkbox" name="active" value="true" defaultChecked />Active</label>
          <input name="notes" placeholder="Notes" className="h-10 rounded-lg border border-border px-3 md:col-span-3" />
          <button type="submit" className="h-10 rounded-lg bg-brand px-3 text-sm font-semibold text-white md:col-span-2">
            Add Schedule Template
          </button>
        </form>
      </Card>

      <Card className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Member</th>
              <th>Days</th>
              <th>Effective Start</th>
              <th>Effective End</th>
              <th>Active</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-sm text-muted">No schedule templates available.</td>
              </tr>
            ) : (
              rows.map((row) => {
                const days = [
                  row.monday ? "Mon" : null,
                  row.tuesday ? "Tue" : null,
                  row.wednesday ? "Wed" : null,
                  row.thursday ? "Thu" : null,
                  row.friday ? "Fri" : null,
                  row.saturday ? "Sat" : null,
                  row.sunday ? "Sun" : null
                ]
                  .filter(Boolean)
                  .join(", ");
                return (
                  <tr key={row.id}>
                    <td>{row.member_name}</td>
                    <td>{days || "-"}</td>
                    <td>{row.effective_start_date}</td>
                    <td>{row.effective_end_date ?? "Open"}</td>
                    <td>{row.active ? "Yes" : "No"}</td>
                    <td>{row.notes ?? "-"}</td>
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
