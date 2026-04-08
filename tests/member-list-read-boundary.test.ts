import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("member directory paging/search boundary is shared between MCC and MHP indexes", () => {
  const sharedSource = readFileSync("lib/services/member-list-read.ts", "utf8");
  const mccSource = readFileSync("lib/services/member-command-center-runtime.ts", "utf8");
  const mhpSource = readFileSync("lib/services/member-health-profiles-supabase.ts", "utf8");

  assert.equal(sharedSource.includes("export async function listSharedMemberIndexPageSupabase"), true);
  assert.equal(mccSource.includes("listSharedMemberIndexPageSupabase"), true);
  assert.equal(mhpSource.includes("listSharedMemberIndexPageSupabase"), true);
  assert.equal(sharedSource.includes("includeLockerSearch"), true);
});
