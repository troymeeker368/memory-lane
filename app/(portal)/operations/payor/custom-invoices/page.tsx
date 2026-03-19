import Link from "next/link";

import { Card, CardTitle } from "@/components/ui/card";
import { BillingCustomInvoiceForms } from "@/components/forms/billing-custom-invoice-forms";
import {
  getBillingMemberPayorLookups,
  getCustomInvoices
} from "@/lib/services/billing-read";
import { listMemberNameLookupSupabase } from "@/lib/services/member-command-center-supabase";

import { finalizeInvoiceAction } from "@/app/(portal)/operations/payor/actions";

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function endOfCurrentMonth() {
  const now = new Date();
  now.setUTCMonth(now.getUTCMonth() + 1, 0);
  return now.toISOString().slice(0, 10);
}

export default async function CustomInvoicesPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const errorMessage = Array.isArray(query.error) ? query.error[0] : query.error;
  const [lookups, draftInvoices, finalizedInvoices, members] = await Promise.all([
    getBillingMemberPayorLookups(),
    getCustomInvoices({ status: "Draft" }),
    getCustomInvoices({ status: "Finalized" }),
    listMemberNameLookupSupabase({ status: "active" })
  ]);
  const memberName = new Map(members.map((row) => [row.id, row.display_name] as const));

  return (
    <div className="space-y-4">
      {errorMessage ? (
        <Card className="border-rose-200 bg-rose-50">
          <CardTitle>Unable to Complete Invoice Action</CardTitle>
          <p className="mt-1 text-sm text-rose-700">{errorMessage}</p>
        </Card>
      ) : null}

      <Card>
        <CardTitle>Create Custom Invoice</CardTitle>
        <p className="mt-1 text-sm text-muted">
          Use for prorated enrollments and one-off arrangements outside standard monthly batch generation.
        </p>
        <BillingCustomInvoiceForms
          members={members.map((member) => ({ id: member.id, displayName: member.display_name }))}
          payorByMember={lookups.payorByMember}
          today={todayDate()}
          endOfMonth={endOfCurrentMonth()}
        />
      </Card>

      <Card className="table-wrap">
        <CardTitle>Draft Custom Invoices</CardTitle>
        <table className="mt-3">
          <thead>
            <tr>
              <th>Invoice #</th>
              <th>Member</th>
              <th>Payor</th>
              <th>Period</th>
              <th>Total</th>
              <th>Status</th>
              <th>Action</th>
              <th>PDF</th>
            </tr>
          </thead>
          <tbody>
            {draftInvoices.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-sm text-muted">No draft custom invoices.</td>
              </tr>
            ) : (
              draftInvoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td>{invoice.invoice_number}</td>
                  <td>{memberName.get(invoice.member_id) ?? "Unknown"}</td>
                  <td>{lookups.payorByMember[invoice.member_id]?.displayName ?? "No payor contact designated"}</td>
                  <td>{invoice.base_period_start} - {invoice.base_period_end}</td>
                  <td>${invoice.total_amount.toFixed(2)}</td>
                  <td>{invoice.invoice_status}</td>
                  <td>
                    <form action={finalizeInvoiceAction}>
                      <input type="hidden" name="invoiceId" value={invoice.id} />
                      <input type="hidden" name="returnPath" value="/operations/payor/custom-invoices" />
                      <button type="submit" className="text-xs font-semibold text-brand">Finalize</button>
                    </form>
                  </td>
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

      <Card className="table-wrap">
        <CardTitle>Finalized Custom Invoices</CardTitle>
        <table className="mt-3">
          <thead>
            <tr>
              <th>Invoice #</th>
              <th>Member</th>
              <th>Payor</th>
              <th>Period</th>
              <th>Total</th>
              <th>Status</th>
              <th>PDF</th>
            </tr>
          </thead>
          <tbody>
            {finalizedInvoices.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-sm text-muted">No finalized custom invoices.</td>
              </tr>
            ) : (
              finalizedInvoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td>{invoice.invoice_number}</td>
                  <td>{memberName.get(invoice.member_id) ?? "Unknown"}</td>
                  <td>{lookups.payorByMember[invoice.member_id]?.displayName ?? "No payor contact designated"}</td>
                  <td>{invoice.base_period_start} - {invoice.base_period_end}</td>
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
    </div>
  );
}
