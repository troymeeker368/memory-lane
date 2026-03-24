import Link from "next/link";

import { submitPayorAction } from "@/app/(portal)/operations/payor/actions";
import { Card, CardTitle } from "@/components/ui/card";
import { getBillingMemberPayorLookups, getDraftInvoices } from "@/lib/services/billing-read";

export default async function DraftInvoicesPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const errorMessage = Array.isArray(params.error) ? params.error[0] : params.error;
  const [invoices, lookups] = await Promise.all([getDraftInvoices(), getBillingMemberPayorLookups()]);
  const memberName = new Map(lookups.members.map((row) => [row.id, row.displayName] as const));

  return (
    <div className="space-y-4">
      {errorMessage ? (
        <Card className="border-rose-200 bg-rose-50">
          <CardTitle>Unable to Finalize Invoice</CardTitle>
          <p className="mt-1 text-sm text-rose-700">{errorMessage}</p>
        </Card>
      ) : null}

      <Card className="table-wrap">
        <CardTitle>Draft Invoices</CardTitle>
        <p className="mt-1 text-sm text-muted">Draft invoices can be reviewed individually, finalized when ready, or regenerated before batch finalization.</p>
        <table className="mt-3">
          <thead>
            <tr>
              <th>Invoice #</th>
              <th>Month</th>
              <th>Source</th>
              <th>Mode</th>
              <th>Member</th>
              <th>Payor</th>
              <th>Base Period</th>
              <th>Variable Period</th>
              <th>Base</th>
              <th>Transport</th>
              <th>Ancillary</th>
              <th>Adjustments</th>
              <th>Total</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {invoices.length === 0 ? (
              <tr>
                <td colSpan={15} className="text-sm text-muted">No draft invoices.</td>
              </tr>
            ) : (
              invoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td>{invoice.invoice_number}</td>
                  <td>{invoice.invoice_month}</td>
                  <td>{invoice.invoice_source}</td>
                  <td>{invoice.billing_mode_snapshot}</td>
                  <td>{memberName.get(invoice.member_id) ?? "Unknown"}</td>
                  <td>{lookups.payorByMember[invoice.member_id]?.displayName ?? "No payor contact designated"}</td>
                  <td>{invoice.base_period_start} - {invoice.base_period_end}</td>
                  <td>{invoice.variable_charge_period_start} - {invoice.variable_charge_period_end}</td>
                  <td>${invoice.base_program_amount.toFixed(2)}</td>
                  <td>${invoice.transportation_amount.toFixed(2)}</td>
                  <td>${invoice.ancillary_amount.toFixed(2)}</td>
                  <td>${invoice.adjustment_amount.toFixed(2)}</td>
                  <td>${invoice.total_amount.toFixed(2)}</td>
                  <td>{invoice.invoice_status}</td>
                  <td>
                    <div className="flex flex-wrap gap-2">
                      <form action={submitPayorAction}>
                        <input type="hidden" name="intent" value="finalizeInvoice" />
                        <input type="hidden" name="invoiceId" value={invoice.id} />
                        <input type="hidden" name="returnPath" value="/operations/payor/invoices/draft" />
                        <button type="submit" className="text-xs font-semibold text-brand">
                          Finalize
                        </button>
                      </form>
                      <Link href={`/operations/payor/invoices/${invoice.id}/pdf`} className="text-xs font-semibold text-brand" target="_blank">
                        PDF
                      </Link>
                    </div>
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
