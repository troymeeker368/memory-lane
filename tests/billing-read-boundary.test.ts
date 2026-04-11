import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return readFileSync(relativePath, "utf8");
}

test("billing invoice list reads use one paged narrow-field boundary", () => {
  const source = readWorkspaceFile("lib/services/billing-read-supabase.ts");

  assert.equal(source.includes("const BILLING_INVOICE_LIST_DEFAULT_PAGE_SIZE = 50;"), true);
  assert.equal(source.includes("const BILLING_INVOICE_LIST_MAX_PAGE_SIZE = 100;"), true);
  assert.equal(source.includes("const BILLING_INVOICE_LIST_SELECT = ["), true);
  assert.equal(source.includes("loadBillingInvoiceListPage({"), true);
  assert.equal(source.includes('.from("billing_invoices").select("*")'), false);
  assert.equal(source.includes(".range(from, to)"), true);
  assert.equal(source.includes('invoiceStatuses: ["Draft"]'), true);
  assert.equal(source.includes("const FINALIZED_BILLING_INVOICE_STATUSES = ["), true);
  assert.equal(source.includes("invoiceStatuses: [...FINALIZED_BILLING_INVOICE_STATUSES]"), true);
  assert.equal(source.includes('invoiceSource: "Custom"'), true);
  assert.equal(source.includes("export async function listAllDraftInvoiceIds()"), true);
});
