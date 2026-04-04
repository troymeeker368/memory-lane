import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return readFileSync(relativePath, "utf8");
}

test("billing finalization flows delegate batch finalize, reopen, and invoice finalize through billing RPC helpers", () => {
  const billingServiceSource = readWorkspaceFile("lib/services/billing-supabase.ts");
  const billingRpcSource = readWorkspaceFile("lib/services/billing-rpc.ts");

  assert.equal(billingServiceSource.includes("invokeFinalizeBillingBatchRpc"), true);
  assert.equal(billingServiceSource.includes("invokeReopenBillingBatchRpc"), true);
  assert.equal(billingServiceSource.includes("invokeFinalizeBillingInvoicesRpc"), true);
  assert.equal(billingServiceSource.includes("for (const invoice of"), false);
  assert.equal(billingServiceSource.includes("for (const line of"), false);

  assert.equal(billingRpcSource.includes('const RPC_FINALIZE_BILLING_BATCH = "rpc_finalize_billing_batch";'), true);
  assert.equal(billingRpcSource.includes('const RPC_REOPEN_BILLING_BATCH = "rpc_reopen_billing_batch";'), true);
  assert.equal(billingRpcSource.includes('const RPC_FINALIZE_BILLING_INVOICES = "rpc_finalize_billing_invoices";'), true);
  assert.equal(billingRpcSource.includes("0190_billing_finalize_reopen_atomicity.sql"), true);
});

test("billing finalization hardening migration adds atomic RPC boundaries and state guards", () => {
  const migrationSource = readWorkspaceFile("supabase/migrations/0190_billing_finalize_reopen_atomicity.sql");

  assert.equal(migrationSource.includes("create or replace function public.finalize_billing_invoice_set("), true);
  assert.equal(migrationSource.includes("create or replace function public.rpc_finalize_billing_invoices("), true);
  assert.equal(migrationSource.includes("create or replace function public.rpc_finalize_billing_batch("), true);
  assert.equal(migrationSource.includes("create or replace function public.rpc_reopen_billing_batch("), true);
  assert.equal(migrationSource.includes("for update"), true);
  assert.equal(migrationSource.includes("invoice_status not in ('Draft', 'Finalized')"), true);
  assert.equal(migrationSource.includes("batch_status = 'Finalized'"), true);
  assert.equal(migrationSource.includes("batch_status = 'Reviewed'"), true);
  assert.equal(migrationSource.includes("where invoice_id = any(v_invoice_ids)"), true);
  assert.equal(migrationSource.includes("grant execute on function public.rpc_finalize_billing_invoices"), true);
  assert.equal(migrationSource.includes("grant execute on function public.rpc_finalize_billing_batch"), true);
  assert.equal(migrationSource.includes("grant execute on function public.rpc_reopen_billing_batch"), true);
});
