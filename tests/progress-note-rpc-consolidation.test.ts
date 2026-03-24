import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("progress note tracker service uses one canonical tracker RPC", () => {
  const source = readWorkspaceFile("lib/services/progress-notes-read-model.ts");

  assert.equal(source.includes('"rpc_get_progress_note_tracker"'), true);
  assert.equal(source.includes('"rpc_get_progress_note_tracker_summary"'), false);
  assert.equal(source.includes('"rpc_get_progress_note_tracker_page"'), false);
  assert.equal(source.includes("loadProgressNoteTrackerReadModel"), true);
  assert.equal(source.includes("mapProgressNoteTrackerRows"), true);
});

test("progress note consolidation migration adds the canonical read model and drops split helper RPCs", () => {
  const source = readWorkspaceFile("supabase/migrations/0130_progress_note_tracker_read_model_consolidation.sql");

  assert.equal(source.includes("create or replace function public.rpc_get_progress_note_tracker("), true);
  assert.equal(source.includes("page_rows jsonb"), true);
  assert.equal(source.includes("drop function if exists public.rpc_get_progress_note_tracker_summary(uuid, text);"), true);
  assert.equal(source.includes("drop function if exists public.rpc_get_progress_note_tracker_page(text, uuid, text, integer, integer);"), true);
});
