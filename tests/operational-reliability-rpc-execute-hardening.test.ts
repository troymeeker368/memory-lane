import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("operational reliability snapshot RPC execute grants are service_role only", () => {
  const migrationSource = readFileSync(
    "supabase/migrations/0221_operational_reliability_rpc_execute_hardening.sql",
    "utf8"
  );

  assert.equal(
    migrationSource.includes(
      "revoke execute on function public.rpc_get_operational_reliability_snapshot(integer, integer, integer, integer) from authenticated;"
    ),
    true
  );
  assert.equal(
    migrationSource.includes(
      "grant execute on function public.rpc_get_operational_reliability_snapshot(integer, integer, integer, integer) to service_role;"
    ),
    true
  );
});
