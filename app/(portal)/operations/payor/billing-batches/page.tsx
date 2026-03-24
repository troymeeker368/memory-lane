import Link from "next/link";

import { BillingManualAdjustmentForm } from "@/components/forms/billing-manual-adjustment-form";
import { Card, CardTitle } from "@/components/ui/card";
import { getCurrentProfile } from "@/lib/auth";
import {
  getBillingBatchReviewRows,
  getBillingBatches,
  getBillingGenerationPreview,
  getBillingMemberPayorLookups
} from "@/lib/services/billing-read";
import { normalizeRoleKey } from "@/lib/permissions";
import { toEasternDate } from "@/lib/timezone";

import {
  submitPayorAction
} from "@/app/(portal)/operations/payor/actions";
import { firstSearchParam, parseDateOnlySearchParam, parseEnumSearchParam } from "@/lib/search-params";

function nextMonthStart() {
  const now = new Date();
  now.setUTCDate(1);
  now.setUTCMonth(now.getUTCMonth() + 1);
  return now.toISOString().slice(0, 10);
}

export default async function BillingBatchesPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const billingMonth = parseDateOnlySearchParam(firstSearchParam(params.billingMonth), nextMonthStart());
  const batchType = parseEnumSearchParam(
    firstSearchParam(params.batchType),
    ["Membership", "Monthly", "Mixed", "Custom"] as const,
    "Mixed"
  );
  const selectedBatchId = (firstSearchParam(params.batchId) ?? "").trim();
  const errorMessage = firstSearchParam(params.error);
  const status = parseEnumSearchParam(firstSearchParam(params.status), ["generated"] as const, "" as "" | "generated");
  const [preview, batches, lookup, profile] = await Promise.all([
    getBillingGenerationPreview({
      billingMonth,
      batchType
    }),
    getBillingBatches(),
    getBillingMemberPayorLookups(),
    getCurrentProfile()
  ]);
  const selectedBatch = selectedBatchId ? batches.find((row) => row.id === selectedBatchId) ?? null : batches[0] ?? null;
  const reviewRows = selectedBatch ? await getBillingBatchReviewRows(selectedBatch.id) : [];
  const activeMembers = lookup.members;
  const role = normalizeRoleKey(profile.role);
  const canReopenBatch = role === "admin" || role === "manager";
  const today = toEasternDate();

  return (
    <div className="space-y-4">
      {errorMessage ? (
        <Card className="border-rose-200 bg-rose-50">
          <CardTitle>Unable to Generate Draft Batch</CardTitle>
          <p className="mt-1 text-sm text-rose-700">{errorMessage}</p>
        </Card>
      ) : null}

      {status === "generated" ? (
        <Card className="border-emerald-200 bg-emerald-50">
          <CardTitle>Draft Batch Generated</CardTitle>
          <p className="mt-1 text-sm text-emerald-700">
            Draft batch created successfully. Review invoice rows below before finalizing.
          </p>
        </Card>
      ) : null}

      <Card>
        <CardTitle>Generate Billing Batch</CardTitle>
        <p className="mt-1 text-sm text-muted">
          Membership runs typically use the upcoming month. Monthly mode bills month-behind service periods. Draft invoices include eligible prior-period variable charges and unbilled adjustments.
        </p>
        <form action={submitPayorAction} className="mt-3 grid gap-2 md:grid-cols-5">
          <input type="hidden" name="intent" value="generateBillingBatch" />
          <input type="hidden" name="returnPath" value="/operations/payor/billing-batches" />
          <label className="space-y-1 text-xs">
            <span className="font-semibold text-muted">Batch Type</span>
            <select name="batchType" defaultValue={batchType} className="h-10 w-full rounded-lg border border-border px-3">
              <option value="Membership">Membership</option>
              <option value="Monthly">Monthly</option>
              <option value="Mixed">Mixed</option>
            </select>
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-semibold text-muted">Invoice Month (First of Month)</span>
            <input type="date" name="billingMonth" defaultValue={billingMonth} className="h-10 w-full rounded-lg border border-border px-3" />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-semibold text-muted">Run Date</span>
            <input type="date" name="runDate" defaultValue={today} className="h-10 w-full rounded-lg border border-border px-3" />
          </label>
          <div className="rounded-lg border border-border px-3 py-2 text-xs">
            <p className="font-semibold text-muted">Draft Preview Total</p>
            <p className="mt-1 text-lg font-semibold text-fg">${preview.totalAmount.toFixed(2)}</p>
            <p className="text-muted">{preview.rows.length} member invoice(s)</p>
          </div>
          <div className="flex items-end">
            <button type="submit" className="h-10 rounded-lg bg-brand px-4 text-sm font-semibold text-white">
              Generate Draft Batch
            </button>
          </div>
        </form>
      </Card>

      <Card>
        <CardTitle>Add Manual Adjustment</CardTitle>
        <BillingManualAdjustmentForm
          members={activeMembers}
          payorByMember={lookup.payorByMember}
          defaultAdjustmentDate={today}
        />
      </Card>

      <Card className="table-wrap">
        <CardTitle>Billing Batches</CardTitle>
        <table className="mt-3">
          <thead>
            <tr>
              <th>Type</th>
              <th>Month</th>
              <th>Run Date</th>
              <th>Status</th>
              <th>Invoice Count</th>
              <th>Total</th>
              <th>Renewal Tracking</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {batches.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-sm text-muted">No billing batches yet.</td>
              </tr>
            ) : (
              batches.map((batch) => (
                <tr key={batch.id}>
                  <td>{batch.batch_type}</td>
                  <td>{batch.billing_month}</td>
                  <td>{batch.run_date}</td>
                  <td>{batch.batch_status}</td>
                  <td>{batch.invoice_count}</td>
                  <td>${batch.total_amount.toFixed(2)}</td>
                  <td>
                    {batch.completion_date ? (
                      <span>{batch.completion_date} / {batch.next_due_date ?? "-"}</span>
                    ) : (
                      <span>{batch.dueState}</span>
                    )}
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-2">
                      <Link href={`/operations/payor/billing-batches?batchId=${batch.id}`} className="text-xs font-semibold text-brand">
                        Review
                      </Link>
                      {batch.batch_status === "Draft" || batch.batch_status === "Reviewed" ? (
                        <form action={submitPayorAction}>
                          <input type="hidden" name="intent" value="finalizeBillingBatch" />
                          <input type="hidden" name="billingBatchId" value={batch.id} />
                          <input type="hidden" name="returnPath" value="/operations/payor/billing-batches" />
                          <button type="submit" className="text-xs font-semibold text-brand">Finalize</button>
                        </form>
                      ) : null}
                      {canReopenBatch &&
                      (batch.batch_status === "Finalized" ||
                        batch.batch_status === "Exported" ||
                        batch.batch_status === "Closed") ? (
                        <form action={submitPayorAction}>
                          <input type="hidden" name="intent" value="reopenBillingBatch" />
                          <input type="hidden" name="billingBatchId" value={batch.id} />
                          <input type="hidden" name="returnPath" value="/operations/payor/billing-batches" />
                          <button type="submit" className="text-xs font-semibold text-brand">Reopen</button>
                        </form>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      {selectedBatch ? (
        <Card className="table-wrap">
          <CardTitle>Coordinator Review - {selectedBatch.billing_month}</CardTitle>
          <p className="mt-1 text-xs text-muted">
            Review draft invoices, add/exclude variable charges from the queue page, and finalize when ready.
          </p>
          <table className="mt-3">
            <thead>
              <tr>
                <th>Member</th>
                <th>Payor</th>
              <th>Source</th>
              <th>Billing Mode</th>
              <th>Base Program</th>
              <th>Base Detail</th>
              <th>Prior-Month Transport</th>
              <th>Prior-Month Ancillary</th>
              <th>Prior-Month Adjustments</th>
              <th>Billing Periods</th>
              <th>Total</th>
              <th>Method</th>
              <th>Invoice Status</th>
            </tr>
          </thead>
          <tbody>
            {reviewRows.length === 0 ? (
              <tr>
                <td colSpan={13} className="text-sm text-muted">No invoices in selected batch.</td>
              </tr>
            ) : (
              reviewRows.map((row) => (
                <tr key={row.invoiceId}>
                  <td>{row.memberName}</td>
                  <td>{row.payorName}</td>
                  <td>{row.invoiceSource}</td>
                  <td>{row.billingMode}</td>
                  <td>${row.baseProgramAmount.toFixed(2)}</td>
                  <td>
                    <div className="text-xs">
                      <p>{row.baseProgramBilledDays} day(s)</p>
                      <p>
                        Rate: $
                        {(row.baseProgramDayRate ?? row.memberDailyRateSnapshot ?? 0).toFixed(2)}
                      </p>
                      <p className="text-muted">Transport: {row.transportationBillingStatusSnapshot}</p>
                    </div>
                  </td>
                  <td>${row.transportationAmount.toFixed(2)}</td>
                  <td>${row.ancillaryAmount.toFixed(2)}</td>
                  <td>${row.adjustmentAmount.toFixed(2)}</td>
                  <td className="text-xs">
                    <p>Base: {row.basePeriodStart} to {row.basePeriodEnd}</p>
                    <p>Variable: {row.variableChargePeriodStart} to {row.variableChargePeriodEnd}</p>
                  </td>
                  <td>${row.totalAmount.toFixed(2)}</td>
                  <td>{row.billingMethod}</td>
                  <td>{row.invoiceStatus}</td>
                </tr>
              ))
              )}
            </tbody>
          </table>
        </Card>
      ) : null}
    </div>
  );
}
