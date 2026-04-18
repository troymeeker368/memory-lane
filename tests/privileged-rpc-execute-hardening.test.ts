import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("privileged rpc execute grants are restricted to service_role", () => {
  const migrationSource = readFileSync("supabase/migrations/0214_privileged_rpc_execute_hardening.sql", "utf8");

  assert.equal(
    migrationSource.includes("revoke execute on function public.rpc_list_member_files(uuid) from authenticated;"),
    true
  );
  assert.equal(
    migrationSource.includes("grant execute on function public.rpc_list_member_files(uuid) to service_role;"),
    true
  );
  assert.equal(
    migrationSource.includes("revoke execute on function public.rpc_reconcile_expired_pof_requests(integer) from authenticated;"),
    true
  );
  assert.equal(
    migrationSource.includes("grant execute on function public.rpc_reconcile_expired_pof_requests(integer) to service_role;"),
    true
  );
});
