import Link from "next/link";

import { submitPayorAction } from "@/app/(portal)/operations/payor/actions";
import { Card, CardTitle } from "@/components/ui/card";
import { getBillingMemberPayorLookups, getDraftInvoices, listAllDraftInvoiceIds } from "@/lib/services/billing-read";

function money(value: number) {
  return `$${value.toFixed(2)}`;
}

export default async function DraftInvoicesPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const errorMessage = Array.isArray(params.error) ? params.error[0] : params.error;
  const pageParam = Array.isArray(params.page) ? params.page[0] : params.page;
  const page = Math.max(1, Math.trunc(Number(pageParam ?? 1) || 1));
  const [invoicesPage, lookups, allDraftInvoiceIds] = await Promise.all([
    getDraftInvoices({ page }),
    getBillingMemberPayorLookups(),
    listAllDraftInvoiceIds()
  ]);
  const invoices = invoicesPage.rows;
  const memberName = new Map(lookups.members.map((row) => [row.id, row.displayName] as const));
  const totalAmount = invoices.reduce((sum, invoice) => sum + invoice.total_amount, 0);

  return (
    <div className="space-y-4">
      {errorMessage ? (
        <Card className="border-rose-200 bg-rose-50">
          <CardTitle>Unable to Finalize Invoice</CardTitle>
          <p className="mt-1 text-sm text-rose-700">{errorMessage}</p>
        </Card>
      ) : null}

      <Card>
        <CardTitle>Draft Invoices</CardTitle>
        <p className="mt-1 text-sm text-muted">
          Review the drafts below, select the ones that are ready, or finalize all drafts in one batch without scrolling through a wide table.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-border bg-slate-50/60 px-3 py-2">
            <p className="text-xs text-muted">Draft count</p>
            <p className="text-lg font-semibold text-fg">{invoices.length}</p>
          </div>
          <div className="rounded-lg border border-border bg-slate-50/60 px-3 py-2">
            <p className="text-xs text-muted">Draft total</p>
            <p className="text-lg font-semibold text-fg">{money(totalAmount)}</p>
          </div>
          <div className="rounded-lg border border-border bg-slate-50/60 px-3 py-2">
            <p className="text-xs text-muted">Batch actions</p>
            <p className="text-sm font-semibold text-fg">Finalize selected or finalize all drafts</p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <form id="draft-selected-finalize-form" action={submitPayorAction} className="flex flex-wrap gap-2">
            <input type="hidden" name="intent" value="finalizeDraftInvoices" />
            <input type="hidden" name="returnPath" value="/operations/payor/invoices/draft" />
            <button type="submit" className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white">
              Finalize Selected
            </button>
          </form>
          <form action={submitPayorAction} className="flex flex-wrap gap-2">
            <input type="hidden" name="intent" value="finalizeDraftInvoices" />
            <input type="hidden" name="returnPath" value="/operations/payor/invoices/draft" />
            {allDraftInvoiceIds.map((invoiceId) => (
              <input key={invoiceId} type="hidden" name="invoiceIds" value={invoiceId} />
            ))}
            <button type="submit" className="rounded-lg border border-border px-3 py-2 text-sm font-semibold text-brand">
              Finalize All Drafts
            </button>
          </form>
        </div>

        {invoicesPage.hasPreviousPage || invoicesPage.hasNextPage ? (
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
            <span className="text-muted">
              Page {invoicesPage.page} of {Math.max(1, Math.ceil(invoicesPage.totalCount / invoicesPage.pageSize))}
            </span>
            {invoicesPage.hasPreviousPage ? (
              <Link href={`/operations/payor/invoices/draft?page=${invoicesPage.page - 1}`} className="font-semibold text-brand">
                Previous
              </Link>
            ) : null}
            {invoicesPage.hasNextPage ? (
              <Link href={`/operations/payor/invoices/draft?page=${invoicesPage.page + 1}`} className="font-semibold text-brand">
                Next
              </Link>
            ) : null}
          </div>
        ) : null}
      </Card>

      <Card className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="w-10">
                <span className="sr-only">Select</span>
              </th>
              <th>Invoice / Member</th>
              <th>Periods</th>
              <th>Summary</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {invoices.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-sm text-muted">
                  No draft invoices.
                </td>
              </tr>
            ) : (
              invoices.map((invoice) => {
                const payorDisplay = lookups.payorByMember[invoice.member_id]?.displayName ?? "No payor contact designated";
                return (
                  <tr key={invoice.id}>
                    <td className="align-top">
                      <input
                        type="checkbox"
                        name="invoiceIds"
                        value={invoice.id}
                        form="draft-selected-finalize-form"
                        className="mt-1 h-4 w-4"
                      />
                    </td>
                    <td className="align-top">
                      <div className="space-y-1">
                        <p className="font-semibold text-fg">{invoice.invoice_number}</p>
                        <p className="text-sm text-muted">{memberName.get(invoice.member_id) ?? "Unknown"}</p>
                        <p className="text-xs text-muted">{payorDisplay}</p>
                        <p className="text-xs text-muted">
                          {invoice.invoice_source} | {invoice.billing_mode_snapshot}
                        </p>
                      </div>
                    </td>
                    <td className="align-top">
                      <div className="space-y-1 text-sm">
                        <p>
                          Base: {invoice.base_period_start} - {invoice.base_period_end}
                        </p>
                        <p>
                          Variable: {invoice.variable_charge_period_start} - {invoice.variable_charge_period_end}
                        </p>
                      </div>
                    </td>
                    <td className="align-top">
                      <div className="space-y-1 text-sm">
                        <p>Base {money(invoice.base_program_amount)}</p>
                        <p>Transport {money(invoice.transportation_amount)}</p>
                        <p>Ancillary {money(invoice.ancillary_amount)}</p>
                        <p>Adjustments {money(invoice.adjustment_amount)}</p>
                        <p className="font-semibold text-fg">Total {money(invoice.total_amount)}</p>
                      </div>
                    </td>
                    <td className="align-top">
                      <div className="space-y-1 text-sm">
                        <p className="font-semibold text-fg">{invoice.invoice_status}</p>
                        <p className="text-xs text-muted">Ready for review or finalization</p>
                      </div>
                    </td>
                    <td className="align-top">
                      <div className="flex flex-wrap gap-2">
                        <form action={submitPayorAction}>
                          <input type="hidden" name="intent" value="finalizeInvoice" />
                          <input type="hidden" name="invoiceId" value={invoice.id} />
                          <input type="hidden" name="returnPath" value="/operations/payor/invoices/draft" />
                          <button type="submit" className="text-xs font-semibold text-brand">
                            Finalize
                          </button>
                        </form>
                        <Link
                          href={`/operations/payor/invoices/${invoice.id}/pdf`}
                          className="text-xs font-semibold text-brand"
                          target="_blank"
                        >
                          PDF
                        </Link>
                      </div>
                    </td>
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
