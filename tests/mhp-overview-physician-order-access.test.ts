import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("mhp overview only loads and renders physician-order data for authorized viewers", () => {
  const readModelSource = readWorkspaceFile("lib/services/member-health-profiles-read.ts");
  const pageSource = readWorkspaceFile("app/(portal)/health/member-health-profiles/[memberId]/page.tsx");

  assert.equal(readModelSource.includes("includeRelatedPhysicianOrders?: boolean;"), true);
  assert.equal(readModelSource.includes("const shouldLoadRelatedPhysicianOrders = options?.includeRelatedPhysicianOrders !== false;"), true);
  assert.equal(readModelSource.includes("includeRelatedPhysicianOrders: options?.includeRelatedPhysicianOrders"), true);
  assert.equal(readModelSource.includes("Promise.resolve([])"), true);

  assert.equal(pageSource.includes("includeRelatedPhysicianOrders: canViewPhysicianOrders"), true);
  assert.equal(pageSource.includes("{canViewPhysicianOrders ? ("), true);
});
