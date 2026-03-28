import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return readFileSync(relativePath, "utf8");
}

test("face sheet regeneration replaces the canonical member-file row instead of creating a broken duplicate object path", () => {
  const faceSheetActionSource = readWorkspaceFile("app/(portal)/members/[memberId]/face-sheet/actions.ts");
  const memberFilesSource = readWorkspaceFile("lib/services/member-files.ts");

  assert.equal(faceSheetActionSource.includes("replaceExistingByDocumentSource: true"), true);
  assert.equal(memberFilesSource.includes("const upserted = await upsertMemberFileByDocumentSource({"), true);
  assert.equal(memberFilesSource.includes('const persistedMemberFileId = String(upserted.id ?? memberFileId).trim() || memberFileId;'), true);
  assert.equal(memberFilesSource.includes('.eq("id", persistedMemberFileId).single();'), true);
});
