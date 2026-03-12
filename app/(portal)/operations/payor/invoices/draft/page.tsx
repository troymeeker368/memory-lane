import { Card, CardTitle } from "@/components/ui/card";
import { getBillingMemberPayorLookups, getDraftInvoices } from "@/lib/services/billing-supabase";

export default async function DraftInvoicesPage() {
  const invoices = await getDraftInvoices();
  const lookups = await getBillingMemberPayorLookups();
  const memberName = new Map(lookups.members.map((row) => [row.id, row.displayName] as const));
  const payorName = new Map(lookups.payors.map((row) => [row.id, row.payorName] as const));

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
          </tr>
        </thead>
        <tbody>
          {invoices.length === 0 ? (
            <tr>
              <td colSpan={14} className="text-sm text-muted">No draft invoices.</td>
            </tr>
          ) : (
            invoices.map((invoice) => (
              <tr key={invoice.id}>
                <td>{invoice.invoice_number}</td>
                <td>{invoice.invoice_month}</td>
                <td>{invoice.invoice_source}</td>
                <td>{invoice.billing_mode_snapshot}</td>
                <td>{memberName.get(invoice.member_id) ?? "Unknown"}</td>
                <td>{invoice.payor_id ? payorName.get(invoice.payor_id) ?? "Unknown" : "-"}</td>
                <td>{invoice.base_period_start} - {invoice.base_period_end}</td>
                <td>{invoice.variable_charge_period_start} - {invoice.variable_charge_period_end}</td>
                <td>${invoice.base_program_amount.toFixed(2)}</td>
                <td>${invoice.transportation_amount.toFixed(2)}</td>
                <td>${invoice.ancillary_amount.toFixed(2)}</td>
                <td>${invoice.adjustment_amount.toFixed(2)}</td>
                <td>${invoice.total_amount.toFixed(2)}</td>
                <td>{invoice.invoice_status}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </Card>
  );
}
