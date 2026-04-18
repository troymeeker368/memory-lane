import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return readFileSync(relativePath, "utf8");
}

test("billing invoice list reads use one paged narrow-field boundary", () => {
  const source = readWorkspaceFile("lib/services/billing-read-supabase.ts");
  const draftPageSource = readWorkspaceFile("app/(portal)/operations/payor/invoices/draft/page.tsx");
  const exportsPageSource = readWorkspaceFile("app/(portal)/operations/payor/exports/page.tsx");
  const batchesPageSource = readWorkspaceFile("app/(portal)/operations/payor/billing-batches/page.tsx");
  const actionsSource = readWorkspaceFile("app/(portal)/operations/payor/actions-impl.ts");

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
  assert.equal(source.includes("export async function getBillingBatches(input?: {"), true);
  assert.equal(source.includes("export async function getBillingExports(input?: { limit?: number })"), true);
  assert.equal(draftPageSource.includes("listAllDraftInvoiceIds()"), false);
  assert.equal(draftPageSource.includes('name="finalizeScope" value="all"'), true);
  assert.equal(actionsSource.includes('if (invoiceIds.length === 0 && asString(formData, "finalizeScope") === "all")'), true);
  assert.equal(exportsPageSource.includes("getBillingBatches({ limit: 50 })"), true);
  assert.equal(exportsPageSource.includes("getBillingExports({ limit: 50 })"), true);
  assert.equal(batchesPageSource.includes("getBillingBatches({"), true);
  assert.equal(batchesPageSource.includes("limit: 50,"), true);
});
