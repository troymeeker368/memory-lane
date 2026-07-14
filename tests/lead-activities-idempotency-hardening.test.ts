import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return readFileSync(relativePath, "utf8");
}

test("lead activities enforce DB-backed idempotency key uniqueness", () => {
  const migration = readWorkspaceFile("supabase/migrations/0222_lead_activity_idempotency_hardening.sql");
  const mappingRuntime = readWorkspaceFile("lib/services/enrollment-packet-mapping-runtime.ts");

  assert.equal(migration.includes("alter table public.lead_activities"), true);
  assert.equal(migration.includes("add column if not exists idempotency_key text"), true);
  assert.equal(migration.includes("create unique index if not exists idx_lead_activities_idempotency_key"), true);
  assert.equal(migration.includes("where idempotency_key is not null"), true);
  assert.equal(mappingRuntime.includes("const activityReplayKey = buildLeadActivityReplayKey(normalizedReplayInput);"), true);
  assert.equal(mappingRuntime.includes("idempotency_key: activityReplayKey"), true);
  assert.equal(mappingRuntime.includes('.eq("idempotency_key", activityReplayKey)'), true);
});
