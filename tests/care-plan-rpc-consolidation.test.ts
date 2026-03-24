import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("care plan list service uses one canonical list read-model RPC", () => {
  const source = readWorkspaceFile("lib/services/care-plans-read-model.ts");

  assert.equal(source.includes('"rpc_get_care_plan_list"'), true);
  assert.equal(source.includes('"rpc_get_care_plan_summary_counts"'), false);
  assert.equal(source.includes("mapCarePlanListRows"), true);
});

test("care plan consolidation migration adds list read model and drops summary helper RPC", () => {
  const source = readWorkspaceFile("supabase/migrations/0131_care_plan_list_read_model_consolidation.sql");

  assert.equal(source.includes("create or replace function public.rpc_get_care_plan_list("), true);
  assert.equal(source.includes("page_rows jsonb"), true);
  assert.equal(source.includes("drop function if exists public.rpc_get_care_plan_summary_counts(uuid, text, uuid[], date);"), true);
});
