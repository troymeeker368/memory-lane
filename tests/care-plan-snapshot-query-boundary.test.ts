import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("care-plan snapshot callers avoid preview exact counts", () => {
  const carePlanSource = readWorkspaceFile("lib/services/care-plans-read-model.ts");
  const mhpSource = readWorkspaceFile("lib/services/member-health-profiles-read.ts");

  assert.equal(carePlanSource.includes('resolveCarePlanMemberId(memberId, "getMemberCarePlanSnapshot", options)'), true);
  assert.equal(carePlanSource.includes("const preview = await getMemberCarePlanPreview(memberId, options);"), false);
  assert.equal(mhpSource.includes("getMemberCarePlanSnapshot(canonicalMemberId, {"), true);
});
