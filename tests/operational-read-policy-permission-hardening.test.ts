import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return readFileSync(relativePath, "utf8");
}

test("operational and billing read policies require operations can_view permission", () => {
  const migration = readWorkspaceFile("supabase/migrations/0216_operational_read_policy_permission_hardening.sql");

  assert.equal(migration.includes("attendance_records_select"), true);
  assert.equal(migration.includes("transportation_manifest_adjustments_select"), true);
  assert.equal(migration.includes("closure_rules_select"), true);
  assert.equal(migration.includes("center_closures_select"), true);
  assert.equal(migration.includes("center_billing_settings_select"), true);
  assert.equal(migration.includes("billing_schedule_templates_select"), true);
  assert.equal(migration.includes("payors_select"), true);
  assert.equal(migration.includes("member_billing_settings_select"), true);
  assert.equal(migration.includes("public.current_profile_has_permission('operations', 'can_view')"), true);
});