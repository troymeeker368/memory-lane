import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return readFileSync(relativePath, "utf8");
}

test("reports home consumers delegate to the shared admin reporting foundation", () => {
  const foundationSource = readWorkspaceFile("lib/services/admin-reporting-foundation.ts");
  const reportsSource = readWorkspaceFile("lib/services/reports.ts");
  const reportsOpsSource = readWorkspaceFile("lib/services/reports-ops.ts");
  const reportsPageSource = readWorkspaceFile("app/(portal)/reports/page.tsx");

  assert.equal(foundationSource.includes("export async function getReportsHomeDocumentationSnapshot()"), true);
  assert.equal(foundationSource.includes("export async function getReportsHomeOperationsSnapshot()"), true);
  assert.equal(foundationSource.includes("export const REPORTS_HOME_AGGREGATES_WINDOW_LABEL"), true);
  assert.equal(reportsSource.includes("return getReportsHomeDocumentationSnapshot();"), true);
  assert.equal(reportsOpsSource.includes("return getReportsHomeOperationsSnapshot();"), true);
  assert.equal(reportsPageSource.includes('from "@/lib/services/reports"'), true);
  assert.equal(reportsPageSource.includes('from "@/lib/services/reports-ops"'), true);
});
