import { Card, CardTitle } from "@/components/ui/card";
import { firstSearchParam, parseDateOnlySearchParam } from "@/lib/search-params";
import { getVariableChargesQueue } from "@/lib/services/billing-read";

import { setVariableChargeStatusAction } from "@/app/(portal)/operations/payor/actions";

function previousMonthStart() {
  const now = new Date();
  now.setUTCDate(1);
  now.setUTCMonth(now.getUTCMonth() - 1);
  return now.toISOString().slice(0, 10);
}

export default async function VariableChargesQueuePage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const month = parseDateOnlySearchParam(firstSearchParam(params.month), previousMonthStart());
  const queue = await getVariableChargesQueue({ month });

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Variable Charges Queue</CardTitle>
        <p className="mt-1 text-sm text-muted">
          Review transportation, ancillary, and adjustment arrears before draft invoice generation/finalization.
        </p>
        <form className="mt-3 flex flex-wrap items-end gap-2" method="get">
          <label className="space-y-1 text-xs">
            <span className="font-semibold text-muted">Arrears Month</span>
            <input type="date" name="month" defaultValue={month} className="h-10 rounded-lg border border-border px-3" />
          </label>
          <button type="submit" className="h-10 rounded-lg bg-brand px-3 text-sm font-semibold text-white">
            Apply
          </button>
        </form>
      </Card>

      <Card className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Member</th>
              <th>Date</th>
              <th>Description</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Exclude Reason</th>
              <th>Update</th>
            </tr>
          </thead>
          <tbody>
            {queue.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-sm text-muted">No variable charges for selected month.</td>
              </tr>
            ) : (
              queue.map((row) => (
                <tr key={`${row.type}-${row.id}`}>
                  <td>{row.type}</td>
                  <td>{row.memberName}</td>
                  <td>{row.chargeDate}</td>
                  <td>{row.description}</td>
                  <td>${row.amount.toFixed(2)}</td>
                  <td>{row.billingStatus}</td>
                  <td>{row.exclusionReason ?? "-"}</td>
                  <td>
                    <form action={setVariableChargeStatusAction} className="flex flex-wrap gap-2">
                      <input type="hidden" name="table" value={row.type === "Adjustment" ? "billingAdjustments" : row.type === "Ancillary" ? "ancillaryLogs" : "transportationLogs"} />
                      <input type="hidden" name="id" value={row.id} />
                      <select name="billingStatus" defaultValue={row.billingStatus} className="h-8 rounded border border-border px-2 text-xs">
                        <option value="Unbilled">Unbilled</option>
                        <option value="Excluded">Excluded</option>
                        <option value="Billed">Billed</option>
                      </select>
                      <input name="exclusionReason" placeholder="Reason (optional)" className="h-8 rounded border border-border px-2 text-xs" />
                      <button type="submit" className="h-8 rounded bg-brand px-2 text-xs font-semibold text-white">Save</button>
                    </form>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
