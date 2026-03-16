import { Card, CardTitle } from "@/components/ui/card";
import { getBillingDashboardSummary } from "@/lib/services/billing-read";

export default async function BillingRevenueDashboardPage() {
  const summary = await getBillingDashboardSummary();

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Revenue Dashboard</CardTitle>
        <p className="mt-1 text-sm text-muted">
          Practical operational billing context for next run planning and arrears cleanup.
        </p>
        <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded border border-border px-3 py-2">
            <p className="text-muted">Projected Next-Month Base Revenue</p>
            <p className="text-lg font-semibold text-fg">${summary.projectedNextMonthBaseRevenue.toFixed(2)}</p>
          </div>
          <div className="rounded border border-border px-3 py-2">
            <p className="text-muted">Prior-Month Transportation Waiting</p>
            <p className="text-lg font-semibold text-fg">${summary.priorMonthTransportationWaiting.toFixed(2)}</p>
          </div>
          <div className="rounded border border-border px-3 py-2">
            <p className="text-muted">Prior-Month Ancillary Waiting</p>
            <p className="text-lg font-semibold text-fg">${summary.priorMonthAncillaryWaiting.toFixed(2)}</p>
          </div>
          <div className="rounded border border-border px-3 py-2">
            <p className="text-muted">Current Draft Batch Total</p>
            <p className="text-lg font-semibold text-fg">${summary.currentDraftBatchTotal.toFixed(2)}</p>
          </div>
        </div>
      </Card>

      <Card className="table-wrap">
        <CardTitle>Finalized Batch Totals by Month</CardTitle>
        <table className="mt-3">
          <thead>
            <tr>
              <th>Billing Month</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {summary.finalizedBatchTotalsByMonth.length === 0 ? (
              <tr>
                <td colSpan={2} className="text-sm text-muted">No finalized batches yet.</td>
              </tr>
            ) : (
              summary.finalizedBatchTotalsByMonth.map((row) => (
                <tr key={row.billingMonth}>
                  <td>{row.billingMonth}</td>
                  <td>${row.totalAmount.toFixed(2)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
