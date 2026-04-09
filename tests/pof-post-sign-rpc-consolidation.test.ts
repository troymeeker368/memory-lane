import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("signed POF post-sign service routes retries through one physician-order RPC boundary", () => {
  const runtimeSource = readWorkspaceFile("lib/services/physician-order-post-sign-runtime.ts");
  const postSignServiceSource = readWorkspaceFile("lib/services/physician-order-post-sign-service.ts");
  const serviceSource = readWorkspaceFile("lib/services/physician-orders-supabase.ts");

  assert.equal(runtimeSource.includes('const RPC_RUN_SIGNED_POF_POST_SIGN_SYNC = "rpc_run_signed_pof_post_sign_sync"'), true);
  assert.equal(runtimeSource.includes("export async function invokeRunSignedPofPostSignSyncRpc"), true);
  assert.equal(postSignServiceSource.includes("invokeRunSignedPofPostSignSyncRpc({"), true);
  assert.equal(postSignServiceSource.includes("runSignedPofPostSignBoundary"), true);
  assert.equal(serviceSource.includes("processSignedPhysicianOrderPostSignSync({"), true);
  assert.equal(serviceSource.includes("generateMarSchedulesForMember({"), false);
  assert.equal(serviceSource.includes("await syncMemberHealthProfileFromSignedPhysicianOrder(input.pofId"), false);
});

test("signed POF post-sign migration wraps MHP/MCC sync and MAR reconciliation in one replay-safe RPC", () => {
  const migrationSource = readWorkspaceFile("supabase/migrations/0155_signed_pof_post_sign_sync_rpc_consolidation.sql");

  assert.equal(
    migrationSource.includes("create or replace function public.rpc_run_signed_pof_post_sign_sync("),
    true
  );
  assert.equal(
    migrationSource.includes("from public.rpc_sync_signed_pof_to_member_clinical_profile("),
    true
  );
  assert.equal(
    migrationSource.includes("from public.rpc_reconcile_member_mar_state("),
    true
  );
  assert.equal(migrationSource.includes("raise exception 'mhp_mcc:%', SQLERRM using errcode = SQLSTATE;"), true);
  assert.equal(migrationSource.includes("raise exception 'mar_schedules:%', SQLERRM using errcode = SQLSTATE;"), true);
  assert.equal(migrationSource.includes("p_preferred_physician_order_id => p_pof_id"), true);
});
