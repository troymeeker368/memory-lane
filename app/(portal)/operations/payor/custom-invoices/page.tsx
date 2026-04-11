import Link from "next/link";

import { submitPayorAction } from "@/app/(portal)/operations/payor/actions";
import {
  BillingCustomInvoiceForm,
  BillingEnrollmentProratedForm
} from "@/components/forms/billing-custom-invoice-forms";
import { Card, CardTitle } from "@/components/ui/card";
import {
  getBillingMemberPayorLookups,
  getCustomInvoices
} from "@/lib/services/billing-read";
import { listMemberNameLookupSupabase } from "@/lib/services/member-command-center-read";

type WorkspaceTab = "custom-invoice" | "prorated-enrollment" | "drafts-history";
type CustomInvoiceRow = Awaited<ReturnType<typeof getCustomInvoices>>["rows"][number];

const TABS: Array<{ key: WorkspaceTab; label: string }> = [
  { key: "custom-invoice", label: "Custom Invoice" },
  { key: "prorated-enrollment", label: "Prorated Enrollment" },
  { key: "drafts-history", label: "Drafts / History" }
];

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function endOfCurrentMonth() {
  const now = new Date();
  now.setUTCMonth(now.getUTCMonth() + 1, 0);
  return now.toISOString().slice(0, 10);
}

function normalizeTab(value: string | string[] | undefined): WorkspaceTab {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === "prorated-enrollment" || raw === "drafts-history") return raw;
  return "custom-invoice";
}

function buildTabHref(tab: WorkspaceTab) {
  return `/operations/payor/custom-invoices?tab=${tab}`;
}

function formatCurrency(amount: number) {
  return `$${amount.toFixed(2)}`;
}

function getTabDescription(tab: WorkspaceTab) {
  if (tab === "prorated-enrollment") {
    return "Enrollment proration stays in its own compact workflow so it does not feel like a duplicate of custom invoice drafting.";
  }
  if (tab === "drafts-history") {
    return "Review saved custom invoice drafts, finalize the ones that are ready, and reopen PDFs from invoice history.";
  }
  return "Use this workspace for one-off custom invoices outside the standard monthly billing batch flow.";
}

function InvoiceMobileCards({
  invoices,
  memberName,
  payorByMember,
  allowFinalize
}: {
  invoices: CustomInvoiceRow[];
  memberName: Map<string, string>;
  payorByMember: Awaited<ReturnType<typeof getBillingMemberPayorLookups>>["payorByMember"];
  allowFinalize: boolean;
}) {
  return (
    <div className="space-y-3 md:hidden">
      {invoices.map((invoice) => (
        <div key={invoice.id} className="rounded-lg border border-border bg-white p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-fg">{invoice.invoice_number}</p>
              <p className="text-xs text-muted">{memberName.get(invoice.member_id) ?? "Unknown member"}</p>
            </div>
            <p className="text-sm font-semibold text-fg">{formatCurrency(invoice.total_amount)}</p>
          </div>
          <div className="mt-3 space-y-1 text-xs text-muted">
            <p>Billing Recipient: {payorByMember[invoice.member_id]?.displayName ?? "No billing recipient designated"}</p>
            <p>Period: {invoice.base_period_start} to {invoice.base_period_end}</p>
            <p>Status: {invoice.invoice_status}</p>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {allowFinalize ? (
              <form action={submitPayorAction}>
                <input type="hidden" name="intent" value="finalizeInvoice" />
                <input type="hidden" name="invoiceId" value={invoice.id} />
                <input type="hidden" name="returnPath" value={buildTabHref("drafts-history")} />
                <button type="submit" className="rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white">
                  Finalize
                </button>
              </form>
            ) : null}
            <Link
              href={`/operations/payor/invoices/${invoice.id}/pdf`}
              className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-brand"
              target="_blank"
            >
              PDF
            </Link>
          </div>
        </div>
      ))}
    </div>
  );
}

function InvoiceHistorySection({
  title,
  description,
  emptyMessage,
  invoices,
  memberName,
  payorByMember,
  allowFinalize
}: {
  title: string;
  description: string;
  emptyMessage: string;
  invoices: CustomInvoiceRow[];
  memberName: Map<string, string>;
  payorByMember: Awaited<ReturnType<typeof getBillingMemberPayorLookups>>["payorByMember"];
  allowFinalize: boolean;
}) {
  return (
    <section className="rounded-xl border border-border bg-slate-50/40 p-4">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-fg">
            {title} <span className="text-muted">({invoices.length})</span>
          </h4>
          <p className="mt-1 text-xs text-muted">{description}</p>
        </div>
      </div>

      {invoices.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-white px-4 py-8 text-center text-sm text-muted">
          {emptyMessage}
        </div>
      ) : (
        <>
          <InvoiceMobileCards
            invoices={invoices}
            memberName={memberName}
            payorByMember={payorByMember}
            allowFinalize={allowFinalize}
          />
          <div className="table-wrap hidden md:block">
            <table>
              <thead>
                <tr>
                  <th>Invoice #</th>
                  <th>Member</th>
                  <th>Billing Recipient</th>
                  <th>Period</th>
                  <th>Total</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td>{invoice.invoice_number}</td>
                    <td>{memberName.get(invoice.member_id) ?? "Unknown"}</td>
                    <td>{payorByMember[invoice.member_id]?.displayName ?? "No billing recipient designated"}</td>
                    <td>{invoice.base_period_start} - {invoice.base_period_end}</td>
                    <td>{formatCurrency(invoice.total_amount)}</td>
                    <td>{invoice.invoice_status}</td>
                    <td>
                      <div className="flex flex-wrap gap-2">
                        {allowFinalize ? (
                          <form action={submitPayorAction}>
                            <input type="hidden" name="intent" value="finalizeInvoice" />
                            <input type="hidden" name="invoiceId" value={invoice.id} />
                            <input type="hidden" name="returnPath" value={buildTabHref("drafts-history")} />
                            <button type="submit" className="text-xs font-semibold text-brand">
                              Finalize
                            </button>
                          </form>
                        ) : null}
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
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

export default async function CustomInvoicesPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const activeTab = normalizeTab(query.tab);
  const errorMessage = Array.isArray(query.error) ? query.error[0] : query.error;
  const [lookups, draftInvoicesPage, finalizedInvoicesPage, members] = await Promise.all([
    getBillingMemberPayorLookups(),
    getCustomInvoices({ status: "Draft", page: 1, pageSize: 50 }),
    getCustomInvoices({ status: "Finalized", page: 1, pageSize: 50 }),
    listMemberNameLookupSupabase({ status: "active" })
  ]);
  const draftInvoices = draftInvoicesPage.rows;
  const finalizedInvoices = finalizedInvoicesPage.rows;
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
        <CardTitle>Custom Invoices</CardTitle>
        <p className="mt-1 text-sm text-muted">{getTabDescription(activeTab)}</p>

        <div className="mt-4 flex flex-wrap gap-2">
          {TABS.map((tab) => {
            const active = tab.key === activeTab;
            return (
              <Link
                key={tab.key}
                href={buildTabHref(tab.key)}
                className={`rounded-lg border px-3 py-2 text-sm font-semibold ${
                  active ? "border-brand bg-brand text-white" : "border-border bg-white text-brand"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>

        {activeTab === "custom-invoice" ? (
          <BillingCustomInvoiceForm
            members={members.map((member) => ({ id: member.id, displayName: member.display_name }))}
            payorByMember={lookups.payorByMember}
            today={todayDate()}
            endOfMonth={endOfCurrentMonth()}
          />
        ) : null}

        {activeTab === "prorated-enrollment" ? (
          <BillingEnrollmentProratedForm
            members={members.map((member) => ({ id: member.id, displayName: member.display_name }))}
            payorByMember={lookups.payorByMember}
            today={todayDate()}
            endOfMonth={endOfCurrentMonth()}
          />
        ) : null}

        {activeTab === "drafts-history" ? (
          <div className="mt-5 space-y-4">
            {draftInvoicesPage.hasNextPage || finalizedInvoicesPage.hasNextPage ? (
              <div className="rounded-lg border border-border bg-white px-3 py-2 text-xs text-muted">
                Showing the most recent 50 custom invoices per section. Use{" "}
                <Link href="/operations/payor/invoices/draft" className="font-semibold text-brand">
                  Draft Invoices
                </Link>{" "}
                and{" "}
                <Link href="/operations/payor/invoices/finalized" className="font-semibold text-brand">
                  Finalized Invoices
                </Link>{" "}
                for full paged history.
              </div>
            ) : null}
            <InvoiceHistorySection
              title="Draft Custom Invoices"
              description="Drafts can still be reviewed, finalized, and reopened as PDF before they move into finalized history."
              emptyMessage="No custom invoice drafts yet. Save a custom draft or create an enrollment invoice to see it here."
              invoices={draftInvoices}
              memberName={memberName}
              payorByMember={lookups.payorByMember}
              allowFinalize
            />
            <InvoiceHistorySection
              title="Finalized Custom Invoices"
              description="Finalized custom invoices stay available here for reference and PDF retrieval."
              emptyMessage="No finalized custom invoices yet."
              invoices={finalizedInvoices}
              memberName={memberName}
              payorByMember={lookups.payorByMember}
              allowFinalize={false}
            />
          </div>
        ) : null}
      </Card>
    </div>
  );
}
