import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return readFileSync(relativePath, "utf8");
}

test("care-plan table policies require health-unit permissions", () => {
  const migration = readWorkspaceFile("supabase/migrations/0218_care_plan_policy_permission_hardening.sql");

  assert.equal(migration.includes("care_plans_select"), true);
  assert.equal(migration.includes("care_plan_sections_select"), true);
  assert.equal(migration.includes("care_plan_versions_select"), true);
  assert.equal(migration.includes("care_plan_review_history_select"), true);
  assert.equal(migration.includes("public.current_profile_has_permission('health-unit', 'can_view')"), true);
  assert.equal(migration.includes("public.current_profile_has_permission('health-unit', 'can_edit')"), true);
});