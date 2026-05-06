import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return readFileSync(relativePath, "utf8");
}

test("transportation and bus stop policies require operations permission checks", () => {
  const migration = readWorkspaceFile("supabase/migrations/0223_transportation_and_bus_stop_policy_permission_hardening.sql");

  assert.equal(migration.includes("transportation_runs_select"), true);
  assert.equal(migration.includes("transportation_run_results_select"), true);
  assert.equal(migration.includes("bus_stop_directory_select"), true);
  assert.equal(migration.includes("bus_stop_directory_insert"), true);
  assert.equal(migration.includes("bus_stop_directory_update"), true);
  assert.equal(migration.includes("public.current_profile_has_permission('operations', 'can_view')"), true);
  assert.equal(migration.includes("public.current_profile_has_permission('operations', 'can_edit')"), true);
});
