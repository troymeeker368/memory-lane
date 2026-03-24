import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("activity snapshot service uses canonical snapshot read-model RPCs", () => {
  const source = readWorkspaceFile("lib/services/activity-snapshots.ts");

  assert.equal(source.includes('"rpc_get_staff_activity_snapshot"'), true);
  assert.equal(source.includes('"rpc_get_member_activity_snapshot"'), true);
  assert.equal(source.includes('"rpc_get_staff_activity_snapshot_counts"'), false);
  assert.equal(source.includes('"rpc_get_staff_activity_snapshot_rows"'), false);
  assert.equal(source.includes('"rpc_get_member_activity_snapshot_counts"'), false);
  assert.equal(source.includes('"rpc_get_member_activity_snapshot_rows"'), false);
});

test("activity snapshot consolidation migration adds canonical read models and retires split helpers", () => {
  const source = readWorkspaceFile("supabase/migrations/0132_activity_snapshot_read_model_consolidation.sql");

  assert.equal(source.includes("create or replace function public.rpc_get_staff_activity_snapshot("), true);
  assert.equal(source.includes("create or replace function public.rpc_get_member_activity_snapshot("), true);
  assert.equal(
    source.includes(
      "drop function if exists public.rpc_get_staff_activity_snapshot_counts(uuid, text, timestamptz, timestamptz, date, date);"
    ),
    true
  );
  assert.equal(
    source.includes(
      "drop function if exists public.rpc_get_member_activity_snapshot_rows(uuid, timestamptz, timestamptz, date, date, integer);"
    ),
    true
  );
});
