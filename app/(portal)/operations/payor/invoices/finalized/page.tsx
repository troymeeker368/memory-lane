import { Card, CardTitle } from "@/components/ui/card";
import { getBillingMemberPayorLookups, getFinalizedInvoices } from "@/lib/services/billing-read";

export default async function FinalizedInvoicesPage() {
  const invoices = await getFinalizedInvoices();
  const lookups = await getBillingMemberPayorLookups();
  const memberName = new Map(lookups.members.map((row) => [row.id, row.displayName] as const));
  const payorName = new Map(lookups.payors.map((row) => [row.id, row.payorName] as const));

  return (
    <Card className="table-wrap">
      <CardTitle>Finalized Invoices</CardTitle>
      <p className="mt-1 text-sm text-muted">
        Finalized invoices are frozen snapshots; exports and future QuickBooks sync should read from these plus invoice lines.
      </p>
      <table className="mt-3">
        <thead>
          <tr>
            <th>Invoice #</th>
            <th>Month</th>
            <th>Source</th>
            <th>Mode</th>
            <th>Member</th>
            <th>Payor</th>
            <th>Invoice Date</th>
            <th>Due Date</th>
            <th>Base Period</th>
            <th>Variable Period</th>
            <th>Total</th>
            <th>Status</th>
            <th>Export Status</th>
          </tr>
        </thead>
        <tbody>
          {invoices.length === 0 ? (
            <tr>
              <td colSpan={13} className="text-sm text-muted">No finalized invoices.</td>
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
                <td>{invoice.invoice_date}</td>
                <td>{invoice.due_date}</td>
                <td>{invoice.base_period_start} - {invoice.base_period_end}</td>
                <td>{invoice.variable_charge_period_start} - {invoice.variable_charge_period_end}</td>
                <td>${invoice.total_amount.toFixed(2)}</td>
                <td>{invoice.invoice_status}</td>
                <td>{invoice.export_status}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </Card>
  );
}
