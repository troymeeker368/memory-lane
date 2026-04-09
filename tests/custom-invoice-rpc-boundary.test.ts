import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return readFileSync(relativePath, "utf8");
}

test("custom invoice service leaves invoice numbering to the canonical RPC boundary", () => {
  const serviceSource = readWorkspaceFile("lib/services/billing-custom-invoices.ts");
  const rpcSource = readWorkspaceFile("lib/services/billing-rpc.ts");

  assert.equal(serviceSource.includes('invoice_number: ""'), true);
  assert.equal(serviceSource.includes("await invokeCreateCustomInvoiceRpc({"), true);
  assert.equal(serviceSource.includes("buildInvoiceNumber("), false);

  assert.equal(rpcSource.includes('const RPC_CREATE_CUSTOM_INVOICE = "rpc_create_custom_invoice";'), true);
  assert.equal(
    rpcSource.includes('const CUSTOM_INVOICE_ATOMIC_WORKFLOW_MIGRATION = "0185_custom_invoice_rpc_source_materialization.sql";'),
    true
  );
});

test("custom invoice RPC materializes variable-source rows under one locked SQL boundary", () => {
  const migration0178 = readWorkspaceFile("supabase/migrations/0178_harden_custom_invoice_rpc_atomicity.sql");
  const migration0185 = readWorkspaceFile("supabase/migrations/0185_custom_invoice_rpc_source_materialization.sql");

  assert.equal(migration0178.includes("pg_advisory_xact_lock("), true);
  assert.equal(migration0178.includes("v_invoice_number"), true);

  assert.equal(migration0185.includes("for update of tl;"), true);
  assert.equal(migration0185.includes("for update of acl;"), true);
  assert.equal(migration0185.includes("for update of ba;"), true);
  assert.equal(migration0185.includes("update public.transportation_logs"), true);
  assert.equal(migration0185.includes("update public.ancillary_charge_logs"), true);
  assert.equal(migration0185.includes("update public.billing_adjustments"), true);
  assert.equal(migration0185.includes("insert into public.billing_invoice_lines ("), true);
  assert.equal(migration0185.includes("insert into public.billing_coverages ("), true);
});
