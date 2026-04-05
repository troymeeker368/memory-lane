import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("documentation and reports reuse the shared documentation tracker progress helper", () => {
  const documentationSource = readWorkspaceFile("lib/services/documentation.ts");
  const reportsSource = readWorkspaceFile("lib/services/reports.ts");
  const helperSource = readWorkspaceFile("lib/services/documentation-tracker-progress.ts");

  assert.equal(documentationSource.includes("enrichDocumentationTrackerProgressRows"), true);
  assert.equal(documentationSource.includes('count: "exact"'), true);
  assert.equal(documentationSource.includes(".range(rangeStart, rangeEnd)"), true);
  assert.equal(reportsSource.includes("getDocumentationTracker"), true);
  assert.equal(reportsSource.includes('.from("documentation_tracker")'), false);
  assert.equal(helperSource.includes("getProgressNoteReminderRows"), true);
  assert.equal(helperSource.includes('.from("progress_notes")'), false);
  assert.equal(helperSource.includes("computeProgressNoteComplianceStatus"), true);
});
