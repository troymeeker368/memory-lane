import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return readFileSync(relativePath, "utf8");
}

test("member holds and billing adjustments reads require operations can_view permission", () => {
  const migration = readWorkspaceFile(
    "supabase/migrations/0217_member_holds_and_billing_adjustments_read_policy_hardening.sql"
  );

  assert.equal(migration.includes("member_holds_read"), true);
  assert.equal(migration.includes("billing_adjustments_select"), true);
  assert.equal(migration.includes("public.current_profile_has_permission('operations', 'can_view')"), true);
});