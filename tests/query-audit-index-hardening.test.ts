import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("april 11 query audit indexes are captured in one forward-only migration", () => {
  const migrationSource = readFileSync("supabase/migrations/0210_query_audit_missing_indexes.sql", "utf8");

  assert.equal(migrationSource.includes("idx_lead_activities_activity_at_desc"), true);
  assert.equal(migrationSource.includes("lead_activities(activity_at desc)"), true);
  assert.equal(migrationSource.includes("idx_member_files_member_id_file_name"), true);
  assert.equal(migrationSource.includes("member_files(member_id, file_name)"), true);
  assert.equal(migrationSource.includes("idx_billing_invoices_status_month_created_desc"), true);
  assert.equal(migrationSource.includes("billing_invoices(invoice_status, invoice_month desc, created_at desc)"), true);
  assert.equal(migrationSource.includes("idx_billing_invoices_source_status_month_created_desc"), true);
  assert.equal(
    migrationSource.includes("billing_invoices(invoice_source, invoice_status, invoice_month desc, created_at desc)"),
    true
  );
});
