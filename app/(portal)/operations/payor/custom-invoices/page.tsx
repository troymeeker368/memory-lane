import { Card, CardTitle } from "@/components/ui/card";
import { BillingCustomInvoiceForms } from "@/components/forms/billing-custom-invoice-forms";
import { getMockDb } from "@/lib/mock-repo";
import { getCustomInvoices } from "@/lib/services/billing";

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
  const db = getMockDb();
  const members = db.members.filter((row) => row.status === "active");
  const payors = db.payors.filter((row) => row.status === "active");
  const memberPayorIdsByMember = members.reduce<Record<string, string[]>>((acc, member) => {
    const activePayorIds = Array.from(
      new Set(
        db.memberBillingSettings
          .filter((row) => row.member_id === member.id)
          .filter((row) => row.active)
          .map((row) => row.payor_id)
          .filter((row): row is string => Boolean(row))
      )
    );
    const fallbackPayorIds =
      activePayorIds.length > 0
        ? activePayorIds
        : Array.from(
            new Set(
              db.memberBillingSettings
                .filter((row) => row.member_id === member.id)
                .map((row) => row.payor_id)
                .filter((row): row is string => Boolean(row))
            )
          );
    acc[member.id] = fallbackPayorIds;
    return acc;
  }, {});
  const draftInvoices = getCustomInvoices({ status: "Draft" });
  const finalizedInvoices = getCustomInvoices({ status: "Finalized" });
  const memberName = new Map(db.members.map((row) => [row.id, row.display_name] as const));
  const payorName = new Map(db.payors.map((row) => [row.id, row.payor_name] as const));

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
          payors={payors.map((payor) => ({ id: payor.id, payorName: payor.payor_name }))}
          memberPayorIdsByMember={memberPayorIdsByMember}
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
            </tr>
          </thead>
          <tbody>
            {draftInvoices.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-sm text-muted">No draft custom invoices.</td>
              </tr>
            ) : (
              draftInvoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td>{invoice.invoice_number}</td>
                  <td>{memberName.get(invoice.member_id) ?? "Unknown"}</td>
                  <td>{invoice.payor_id ? payorName.get(invoice.payor_id) ?? "Unknown" : "-"}</td>
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
            </tr>
          </thead>
          <tbody>
            {finalizedInvoices.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-sm text-muted">No finalized custom invoices.</td>
              </tr>
            ) : (
              finalizedInvoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td>{invoice.invoice_number}</td>
                  <td>{memberName.get(invoice.member_id) ?? "Unknown"}</td>
                  <td>{invoice.payor_id ? payorName.get(invoice.payor_id) ?? "Unknown" : "-"}</td>
                  <td>{invoice.base_period_start} - {invoice.base_period_end}</td>
                  <td>${invoice.total_amount.toFixed(2)}</td>
                  <td>{invoice.invoice_status}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
