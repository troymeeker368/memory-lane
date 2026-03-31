import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return readFileSync(relativePath, "utf8");
}

test("face sheet regeneration replaces the canonical member-file row without deleting committed storage on verification readback misses", () => {
  const faceSheetActionSource = readWorkspaceFile("app/(portal)/members/[memberId]/face-sheet/actions.ts");
  const memberFilesSource = readWorkspaceFile("lib/services/member-files.ts");

  assert.equal(faceSheetActionSource.includes("replaceExistingByDocumentSource: true"), true);
  assert.equal(memberFilesSource.includes("async function loadPersistedMemberFileOrReturnVerificationPending"), true);
  assert.equal(memberFilesSource.includes("let upserted;"), true);
  assert.equal(memberFilesSource.includes("const updated = await loadPersistedMemberFileOrReturnVerificationPending({"), true);
  assert.equal(memberFilesSource.includes('alertKey: "generated_member_file_verification_pending"'), true);
  assert.equal(
    memberFilesSource.includes("return loadPersistedMemberFileOrReturnVerificationPending({"),
    true
  );
});
