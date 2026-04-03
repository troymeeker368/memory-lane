import Link from "next/link";

import { Card, CardTitle } from "@/components/ui/card";
import { getBillingModuleIndex } from "@/lib/services/billing-read";

export default async function OperationsPayorPage() {
  const index = await getBillingModuleIndex();

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Billing Workflow Hub</CardTitle>
        <p className="mt-1 text-sm text-muted">
          Coordinator-friendly billing workflow for setup, arrears review, batch generation, invoice finalization, enrollment proration, and exports.
        </p>
      </Card>

      <Card>
        <CardTitle>Quick Actions</CardTitle>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[
            {
              href: "/operations/payor/billing-batches",
              title: "Billing Batches",
              description: "Generate a batch, review coordinator-ready invoices, and finalize the month."
            },
            {
              href: "/operations/payor/invoices/draft",
              title: "Draft Invoices",
              description: "Finalize individual or bulk-selected draft invoices without hunting through the batch table."
            },
            {
              href: "/operations/payor/variable-charges",
              title: "Variable Charges Queue",
              description: "Review transportation, ancillary, and adjustment arrears before billing is frozen."
            },
            {
              href: "/operations/payor/custom-invoices",
              title: "Custom / Prorated Invoices",
              description: "Create one-off invoices or run the dedicated prorated enrollment workflow."
            },
            {
              href: "/operations/payor/settings",
              title: "Billing Settings",
              description: "Manage payor directory details and member billing overrides."
            },
            {
              href: "/operations/payor/exports",
              title: "Exports",
              description: "Download finalized QuickBooks and internal review exports after billing is complete."
            }
          ].map((item) => (
            <Link key={item.href} href={item.href} className="rounded-xl border border-border bg-white p-4 transition-colors hover:border-brand/40 hover:bg-slate-50">
              <p className="text-sm font-semibold text-fg">{item.title}</p>
              <p className="mt-2 text-sm text-muted">{item.description}</p>
            </Link>
          ))}
        </div>
      </Card>

      <Card>
        <CardTitle>Workflow Snapshot</CardTitle>
        <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded border border-border px-3 py-2">
            <p className="text-muted">Active Payors</p>
            <p className="text-lg font-semibold text-fg">{index.payorCount}</p>
          </div>
          <div className="rounded border border-border px-3 py-2">
            <p className="text-muted">Active Member Billing Settings</p>
            <p className="text-lg font-semibold text-fg">{index.memberBillingSettingCount}</p>
          </div>
          <div className="rounded border border-border px-3 py-2">
            <p className="text-muted">Members with Billing Schedules</p>
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
        {index.latestBatch ? (
          <div className="mt-3 flex flex-wrap gap-3 text-sm">
            <Link href={`/operations/payor/billing-batches?batchId=${index.latestBatch.id}`} className="font-semibold text-brand">
              Open Latest Batch
            </Link>
            <Link href="/operations/payor/invoices/draft" className="font-semibold text-brand">
              Open Draft Invoices
            </Link>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
