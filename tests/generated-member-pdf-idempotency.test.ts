import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("stable generated member PDFs replace the canonical document-source row", () => {
  const pofActionSource = readWorkspaceFile("app/(portal)/health/physician-orders/actions.ts");
  const dietCardActionSource = readWorkspaceFile("app/(portal)/members/[memberId]/diet-card/actions.ts");
  const nameBadgeActionSource = readWorkspaceFile("app/(portal)/members/[memberId]/name-badge/actions.ts");

  assert.equal(pofActionSource.includes("replaceExistingByDocumentSource: true"), true);
  assert.equal(dietCardActionSource.includes("replaceExistingByDocumentSource: true"), true);
  assert.equal(nameBadgeActionSource.includes("replaceExistingByDocumentSource: true"), true);
});

test("generated member PDF replacement only cleans up superseded storage after verified persistence", () => {
  const memberFilesSource = readWorkspaceFile("lib/services/member-files.ts");

  assert.equal(memberFilesSource.includes("loadMemberFileRowByDocumentSource({"), true);
  assert.equal(memberFilesSource.includes("async function cleanupSupersededGeneratedPdfObject"), true);
  assert.equal(
    memberFilesSource.includes('alertKey: "generated_member_file_replaced_storage_cleanup_failed"'),
    true
  );
  assert.equal(memberFilesSource.includes("if (!input.verifiedPersisted) return;"), true);
  assert.equal(memberFilesSource.includes("await cleanupSupersededGeneratedPdfObject({"), true);
});
