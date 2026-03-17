import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { buildTransportationPostingScopeKey } from "../lib/services/transportation-run-shared";

function readWorkspaceFile(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("transportation posting scope key is stable by member, date, and shift", () => {
  assert.equal(
    buildTransportationPostingScopeKey({
      memberId: "member-1",
      serviceDate: "2026-03-17",
      shift: "AM"
    }),
    "member-1:2026-03-17:AM"
  );
});

test("transportation run posting stays on the canonical RPC boundary", () => {
  const serviceSource = readWorkspaceFile("lib/services/transportation-run-posting.ts");
  const migrationSource = readWorkspaceFile("supabase/migrations/0081_transportation_run_posting.sql");

  assert.equal(serviceSource.includes('const POST_TRANSPORTATION_RUN_RPC = "rpc_post_transportation_run";'), true);
  assert.equal(serviceSource.includes('createClient({ serviceRole: true })'), true);
  assert.equal(serviceSource.includes("invokeSupabaseRpcOrThrow"), true);
  assert.equal(migrationSource.includes("create table if not exists public.transportation_runs"), true);
  assert.equal(migrationSource.includes("create table if not exists public.transportation_run_results"), true);
  assert.equal(migrationSource.includes("create or replace function public.rpc_post_transportation_run("), true);
  assert.equal(
    migrationSource.includes("grant execute on function public.rpc_post_transportation_run(jsonb, jsonb) to service_role;"),
    true
  );
});

test("legacy transportation documentation entry path is disabled in favor of Transportation Station", () => {
  const pageSource = readWorkspaceFile("app/(portal)/documentation/transportation/page.tsx");
  const actionsSource = readWorkspaceFile("app/documentation-actions-impl.ts");

  assert.equal(pageSource.includes("TransportationLogFormShell"), false);
  assert.equal(pageSource.includes("QuickEditTransportation"), false);
  assert.equal(pageSource.includes("Open Transportation Station"), true);
  assert.equal(
    actionsSource.includes("Individual transportation log entry is disabled. Use Transportation Station to post the run manifest in one batch."),
    true
  );
  assert.equal(
    actionsSource.includes("Transportation corrections should be handled through Transportation Station so run history and billing stay aligned."),
    true
  );
});

test("billing transport charges now trust posted transportation facts instead of current member setting gates", () => {
  const billingSource = readWorkspaceFile("lib/services/billing-supabase.ts");

  assert.equal(
    billingSource.includes('const transportChargeLines = transportBillingStatus === "BillNormally" ? transportLines : [];'),
    false
  );
  assert.equal(
    billingSource.includes('if (input.includeTransportation && transportBillingStatus === "BillNormally") {'),
    false
  );
  assert.equal(billingSource.includes("const transportChargeLines = transportLines;"), true);
  assert.equal(billingSource.includes("if (input.includeTransportation) {"), true);
});
