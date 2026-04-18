import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return readFileSync(relativePath, "utf8");
}

test("operational and billing write policies require operations can_edit permission", () => {
  const migration = readWorkspaceFile("supabase/migrations/0213_operational_write_policy_permission_hardening.sql");

  assert.equal(migration.includes("attendance_records_insert"), true);
  assert.equal(migration.includes("member_holds_insert"), true);
  assert.equal(migration.includes("schedule_changes_insert"), true);
  assert.equal(migration.includes("transportation_manifest_adjustments_insert"), true);
  assert.equal(migration.includes("center_closures_insert"), true);
  assert.equal(migration.includes("payors_insert"), true);
  assert.equal(migration.includes("member_billing_settings_insert"), true);
  assert.equal(migration.includes("billing_schedule_templates_insert"), true);
  assert.equal(migration.includes("billing_adjustments_insert"), true);
  assert.equal(migration.includes("public.current_profile_has_permission('operations', 'can_edit')"), true);
});
