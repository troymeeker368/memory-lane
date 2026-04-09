import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("member list non-paged reads use the shared member list boundary", () => {
  const sharedSource = readFileSync("lib/services/member-list-read.ts", "utf8");
  const mccRuntimeSource = readFileSync("lib/services/member-command-center-runtime.ts", "utf8");

  assert.equal(sharedSource.includes("export async function listSharedMemberRowsSupabase"), true);
  assert.equal(mccRuntimeSource.includes("return listSharedMemberRowsSupabase({"), true);
});
