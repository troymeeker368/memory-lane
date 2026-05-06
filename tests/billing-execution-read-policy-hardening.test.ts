import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("billing execution read policies require operations can_view", () => {
  const migrationSource = read("supabase/migrations/0220_billing_execution_read_policy_hardening.sql");

  assert.equal(migrationSource.includes('create policy "billing_batches_select"'), true);
  assert.equal(migrationSource.includes('create policy "billing_invoices_select"'), true);
  assert.equal(migrationSource.includes('create policy "billing_invoice_lines_select"'), true);
  assert.equal(migrationSource.includes('create policy "billing_coverages_select"'), true);
  assert.equal(migrationSource.includes('create policy "billing_export_jobs_select"'), true);
  assert.equal(migrationSource.includes("public.current_profile_has_permission('operations', 'can_view')"), true);
});