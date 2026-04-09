import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("MAR reconcile RPC access is centralized in one shared helper", () => {
  const helperSource = readFileSync("lib/services/mar-reconcile.ts", "utf8");
  const workflowSource = readFileSync("lib/services/mar-workflow.ts", "utf8");
  const readSource = readFileSync("lib/services/mar-workflow-read.ts", "utf8");

  assert.equal(helperSource.includes('const MAR_RECONCILE_RPC = "rpc_reconcile_member_mar_state";'), true);
  assert.equal(helperSource.includes("export async function reconcileMarSchedulesForMember"), true);
  assert.equal(workflowSource.includes('import { reconcileMarSchedulesForMember } from "@/lib/services/mar-reconcile";'), true);
  assert.equal(readSource.includes('import { reconcileMarSchedulesForMember } from "@/lib/services/mar-reconcile";'), true);
  assert.equal(workflowSource.includes('const MAR_RECONCILE_RPC = "rpc_reconcile_member_mar_state";'), false);
  assert.equal(readSource.includes('const MAR_RECONCILE_RPC = "rpc_reconcile_member_mar_state";'), false);
});
