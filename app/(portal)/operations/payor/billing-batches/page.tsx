import Link from "next/link";
import { Fragment } from "react";

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

import { submitPayorAction } from "@/app/(portal)/operations/payor/actions";
import { firstSearchParam, parseDateOnlySearchParam, parseEnumSearchParam } from "@/lib/search-params";

function nextMonthStart() {
  const now = new Date();
  now.setUTCDate(1);
  now.setUTCMonth(now.getUTCMonth() + 1);
  return now.toISOString().slice(0, 10);
}

function money(amount: number) {
  return `$${amount.toFixed(2)}`;
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
    getBillingBatches({
      limit: 50,
      includeBatchId: selectedBatchId || null
    }),
    getBillingMemberPayorLookups(),
    getCurrentProfile()
  ]);
  const selectedBatch = selectedBatchId ? batches.find((row) => row.id === selectedBatchId) ?? null : batches[0] ?? null;
  const reviewRows = selectedBatch ? await getBillingBatchReviewRows(selectedBatch.id) : [];
  const activeMembers = lookup.members;
  const role = normalizeRoleKey(profile.role);
  const canReopenBatch = role === "admin" || role === "manager";
  const today = toEasternDate();
  const reviewTotal = reviewRows.reduce((sum, row) => sum + row.totalAmount, 0);

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
            <p className="mt-1 text-lg font-semibold text-fg">{money(preview.totalAmount)}</p>
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
                <td colSpan={8} className="text-sm text-muted">
                  No billing batches yet.
                </td>
              </tr>
            ) : (
              batches.map((batch) => (
                <tr key={batch.id}>
                  <td>{batch.batch_type}</td>
                  <td>{batch.billing_month}</td>
                  <td>{batch.run_date}</td>
                  <td>{batch.batch_status}</td>
                  <td>{batch.invoice_count}</td>
                  <td>{money(batch.total_amount)}</td>
                  <td>
                    {batch.completion_date ? (
                      <span>
                        {batch.completion_date} / {batch.next_due_date ?? "-"}
                      </span>
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
                          <button type="submit" className="text-xs font-semibold text-brand">
                            Finalize
                          </button>
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
                          <button type="submit" className="text-xs font-semibold text-brand">
                            Reopen
                          </button>
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
        <Card className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-1">
              <CardTitle>Coordinator Review - {selectedBatch.billing_month}</CardTitle>
              <p className="text-sm text-muted">
                A compact batch review surface that keeps the important fields visible and pushes lower-priority detail into expandable rows.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {selectedBatch.batch_status === "Draft" || selectedBatch.batch_status === "Reviewed" ? (
                <form action={submitPayorAction}>
                  <input type="hidden" name="intent" value="finalizeBillingBatch" />
                  <input type="hidden" name="billingBatchId" value={selectedBatch.id} />
                  <input type="hidden" name="returnPath" value="/operations/payor/billing-batches" />
                  <button type="submit" className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white">
                    Finalize Batch
                  </button>
                </form>
              ) : null}
              {canReopenBatch &&
              (selectedBatch.batch_status === "Finalized" ||
                selectedBatch.batch_status === "Exported" ||
                selectedBatch.batch_status === "Closed") ? (
                <form action={submitPayorAction}>
                  <input type="hidden" name="intent" value="reopenBillingBatch" />
                  <input type="hidden" name="billingBatchId" value={selectedBatch.id} />
                  <input type="hidden" name="returnPath" value="/operations/payor/billing-batches" />
                  <button type="submit" className="rounded-lg border border-border px-3 py-2 text-sm font-semibold text-brand">
                    Reopen Batch
                  </button>
                </form>
              ) : null}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-lg border border-border bg-slate-50/60 px-3 py-2">
              <p className="text-xs text-muted">Invoice count</p>
              <p className="text-lg font-semibold text-fg">{selectedBatch.invoice_count}</p>
            </div>
            <div className="rounded-lg border border-border bg-slate-50/60 px-3 py-2">
              <p className="text-xs text-muted">Batch total</p>
              <p className="text-lg font-semibold text-fg">{money(selectedBatch.total_amount)}</p>
            </div>
            <div className="rounded-lg border border-border bg-slate-50/60 px-3 py-2">
              <p className="text-xs text-muted">Batch status</p>
              <p className="text-lg font-semibold text-fg">{selectedBatch.batch_status}</p>
            </div>
            <div className="rounded-lg border border-border bg-slate-50/60 px-3 py-2">
              <p className="text-xs text-muted">Review total</p>
              <p className="text-lg font-semibold text-fg">{money(reviewTotal)}</p>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>Member</th>
                <th>Payor / Source</th>
                <th>Periods</th>
                <th>Total</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {reviewRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-sm text-muted">
                    No invoices in selected batch.
                  </td>
                </tr>
              ) : (
                reviewRows.map((row) => (
                  <Fragment key={row.invoiceId}>
                    <tr>
                      <td className="align-top">
                        <div className="space-y-1">
                          <p className="font-semibold text-fg">{row.memberName}</p>
                          <p className="text-xs text-muted">{row.billingMode}</p>
                        </div>
                      </td>
                      <td className="align-top">
                        <div className="space-y-1">
                          <p className="text-sm text-fg">{row.payorName}</p>
                          <p className="text-xs text-muted">{row.invoiceSource}</p>
                        </div>
                      </td>
                      <td className="align-top text-sm">
                        <p>
                          Base {row.basePeriodStart} - {row.basePeriodEnd}
                        </p>
                        <p>
                          Variable {row.variableChargePeriodStart} - {row.variableChargePeriodEnd}
                        </p>
                      </td>
                      <td className="align-top">
                        <div className="space-y-1 text-sm">
                          <p className="font-semibold text-fg">{money(row.totalAmount)}</p>
                          <p className="text-xs text-muted">Base {money(row.baseProgramAmount)}</p>
                          <p className="text-xs text-muted">Transport {money(row.transportationAmount)}</p>
                          <p className="text-xs text-muted">Ancillary {money(row.ancillaryAmount)}</p>
                          <p className="text-xs text-muted">Adjustments {money(row.adjustmentAmount)}</p>
                        </div>
                      </td>
                      <td className="align-top">
                        <div className="space-y-1 text-sm">
                          <p className="font-semibold text-fg">{row.invoiceStatus}</p>
                          <p className="text-xs text-muted">{row.billingMethod}</p>
                        </div>
                      </td>
                      <td className="align-top">
                        <div className="flex flex-wrap gap-2">
                          <Link href={`/operations/payor/invoices/${row.invoiceId}/pdf`} className="text-xs font-semibold text-brand" target="_blank">
                            PDF
                          </Link>
                          {row.invoiceStatus === "Draft" ? (
                            <form action={submitPayorAction}>
                              <input type="hidden" name="intent" value="finalizeInvoice" />
                              <input type="hidden" name="invoiceId" value={row.invoiceId} />
                              <input type="hidden" name="returnPath" value="/operations/payor/billing-batches" />
                              <button type="submit" className="text-xs font-semibold text-brand">
                                Finalize
                              </button>
                            </form>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <td colSpan={6} className="border-b border-border bg-slate-50/40 px-4 py-3">
                        <details className="group">
                          <summary className="cursor-pointer list-none text-xs font-semibold uppercase tracking-wide text-muted">
                            Open review detail
                          </summary>
                          <div className="mt-3 grid gap-3 md:grid-cols-3">
                            <div className="rounded-lg border border-border bg-white px-3 py-2 text-sm">
                              <p className="text-xs text-muted">Base detail</p>
                              <p>{row.baseProgramBilledDays} day(s)</p>
                              <p>Rate {money(row.baseProgramDayRate ?? row.memberDailyRateSnapshot ?? 0)}</p>
                              <p className="text-xs text-muted">Transport billing: {row.transportationBillingStatusSnapshot}</p>
                            </div>
                            <div className="rounded-lg border border-border bg-white px-3 py-2 text-sm">
                              <p className="text-xs text-muted">Variable totals</p>
                              <p>Transport {money(row.transportationAmount)}</p>
                              <p>Ancillary {money(row.ancillaryAmount)}</p>
                              <p>Adjustments {money(row.adjustmentAmount)}</p>
                            </div>
                            <div className="rounded-lg border border-border bg-white px-3 py-2 text-sm">
                              <p className="text-xs text-muted">Invoice status</p>
                              <p>{row.invoiceStatus}</p>
                              <p>{row.billingMethod}</p>
                              <p className="text-xs text-muted">Batch review uses canonical invoice snapshots.</p>
                            </div>
                          </div>
                        </details>
                      </td>
                    </tr>
                  </Fragment>
                ))
              )}
            </tbody>
          </table>
        </Card>
      ) : null}
    </div>
  );
}
