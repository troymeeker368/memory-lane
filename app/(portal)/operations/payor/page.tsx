import { Card, CardTitle } from "@/components/ui/card";
import { getBillingModuleIndex } from "@/lib/services/billing";

export default async function OperationsPayorPage() {
  const index = getBillingModuleIndex();

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Billing Workflow Hub</CardTitle>
        <p className="mt-1 text-sm text-muted">
          Coordinator-friendly billing workflow for agreements, schedule-based prebilling, arrears, review, finalization, and exports.
        </p>
      </Card>

      <Card>
        <div className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded border border-border px-3 py-2">
            <p className="text-muted">Active Payors</p>
            <p className="text-lg font-semibold text-fg">{index.payorCount}</p>
          </div>
          <div className="rounded border border-border px-3 py-2">
            <p className="text-muted">Active Member Billing Settings</p>
            <p className="text-lg font-semibold text-fg">{index.memberBillingSettingCount}</p>
          </div>
          <div className="rounded border border-border px-3 py-2">
            <p className="text-muted">Active Schedule Templates</p>
            <p className="text-lg font-semibold text-fg">{index.scheduleTemplateCount}</p>
          </div>
          <div className="rounded border border-border px-3 py-2">
            <p className="text-muted">Current Draft Batch Total</p>
            <p className="text-lg font-semibold text-fg">${index.dashboard.currentDraftBatchTotal.toFixed(2)}</p>
          </div>
        </div>
      </Card>

      <Card>
        <CardTitle>Revenue Snapshot</CardTitle>
        <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded border border-border px-3 py-2">
            <p className="text-muted">Projected Next-Month Base</p>
            <p className="font-semibold">${index.dashboard.projectedNextMonthBaseRevenue.toFixed(2)}</p>
          </div>
          <div className="rounded border border-border px-3 py-2">
            <p className="text-muted">Prior-Month Transport Waiting</p>
            <p className="font-semibold">${index.dashboard.priorMonthTransportationWaiting.toFixed(2)}</p>
          </div>
          <div className="rounded border border-border px-3 py-2">
            <p className="text-muted">Prior-Month Ancillary Waiting</p>
            <p className="font-semibold">${index.dashboard.priorMonthAncillaryWaiting.toFixed(2)}</p>
          </div>
          <div className="rounded border border-border px-3 py-2">
            <p className="text-muted">Latest Batch</p>
            <p className="font-semibold">{index.latestBatch ? `${index.latestBatch.billing_month} (${index.latestBatch.batch_status})` : "No batch yet"}</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
