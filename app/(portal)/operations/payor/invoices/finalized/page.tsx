import Link from "next/link";

import { Card, CardTitle } from "@/components/ui/card";
import { getBillingMemberPayorLookups, getFinalizedInvoices } from "@/lib/services/billing-read";

export default async function FinalizedInvoicesPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const pageParam = Array.isArray(params.page) ? params.page[0] : params.page;
  const page = Math.max(1, Math.trunc(Number(pageParam ?? 1) || 1));
  const [invoicesPage, lookups] = await Promise.all([getFinalizedInvoices({ page }), getBillingMemberPayorLookups()]);
  const invoices = invoicesPage.rows;
  const memberName = new Map(lookups.members.map((row) => [row.id, row.displayName] as const));

  return (
    <Card className="table-wrap">
      <CardTitle>Finalized Invoices</CardTitle>
      <p className="mt-1 text-sm text-muted">
        Finalized invoices are frozen snapshots; exports and future QuickBooks sync should read from these plus invoice lines.
      </p>
      {invoicesPage.hasPreviousPage || invoicesPage.hasNextPage ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <span className="text-muted">
            Page {invoicesPage.page} of {Math.max(1, Math.ceil(invoicesPage.totalCount / invoicesPage.pageSize))}
          </span>
          {invoicesPage.hasPreviousPage ? (
            <Link href={`/operations/payor/invoices/finalized?page=${invoicesPage.page - 1}`} className="font-semibold text-brand">
              Previous
            </Link>
          ) : null}
          {invoicesPage.hasNextPage ? (
            <Link href={`/operations/payor/invoices/finalized?page=${invoicesPage.page + 1}`} className="font-semibold text-brand">
              Next
            </Link>
          ) : null}
        </div>
      ) : null}
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
            <th>PDF</th>
          </tr>
        </thead>
        <tbody>
          {invoices.length === 0 ? (
            <tr>
              <td colSpan={14} className="text-sm text-muted">No finalized invoices.</td>
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
                <td>{invoice.invoice_date}</td>
                <td>{invoice.due_date}</td>
                <td>{invoice.base_period_start} - {invoice.base_period_end}</td>
                <td>{invoice.variable_charge_period_start} - {invoice.variable_charge_period_end}</td>
                <td>${invoice.total_amount.toFixed(2)}</td>
                <td>{invoice.invoice_status}</td>
                <td>{invoice.export_status}</td>
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
