import Link from "next/link";

import { Card, CardTitle } from "@/components/ui/card";
import { getBillingMemberPayorLookups, getDraftInvoices } from "@/lib/services/billing-read";

export default async function DraftInvoicesPage() {
  const [invoices, lookups] = await Promise.all([getDraftInvoices(), getBillingMemberPayorLookups()]);
  const memberName = new Map(lookups.members.map((row) => [row.id, row.displayName] as const));

  return (
    <Card className="table-wrap">
      <CardTitle>Draft Invoices</CardTitle>
      <p className="mt-1 text-sm text-muted">Draft invoices can be regenerated before batch finalization.</p>
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
            <th>PDF</th>
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
                  <Link href={`/operations/payor/invoices/${invoice.id}/pdf`} className="text-xs font-semibold text-brand" target="_blank">
                    PDF
                  </Link>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </Card>
  );
}
