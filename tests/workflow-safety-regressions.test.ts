import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("member file delete removes storage before the database row", () => {
  const source = readWorkspaceFile("lib/services/member-files.ts");
  const storageDeleteIndex = source.indexOf("await deleteMemberDocumentObject(storageObjectPath);");
  const rowDeleteIndex = source.indexOf("await deleteMemberFileRecord(memberFileId);");

  assert.notEqual(storageDeleteIndex, -1);
  assert.notEqual(rowDeleteIndex, -1);
  assert.equal(storageDeleteIndex < rowDeleteIndex, true);
  assert.equal(
    source.includes("Member file delete stopped before removing the database row because storage cleanup failed."),
    true
  );
});

test("MAR actions keep local service-role audit logging but make it non-throwing", () => {
  const source = readWorkspaceFile("app/(portal)/health/mar/actions-impl.ts");

  assert.equal(source.includes('serviceRole: true'), true);
  assert.equal(source.includes('[mar-actions] audit log insert failed after committed write'), true);
  assert.equal(source.includes('alertKey: "audit_log_insert_failed"'), true);
});

test("POF post-sign runner reports missing configuration explicitly", () => {
  const source = readWorkspaceFile("app/api/internal/pof-post-sign-sync/route.ts");

  assert.equal(source.includes('alertKey: "pof_post_sign_sync_runner_not_configured"'), true);
  assert.equal(source.includes("runnerConfigured: false"), true);
  assert.equal(source.includes("runnerConfigured: true"), true);
});

test("member file writes preserve committed storage when verification readback misses", () => {
  const source = readWorkspaceFile("lib/services/member-files.ts");

  assert.equal(source.includes("async function loadPersistedMemberFileOrReturnVerificationPending"), true);
  assert.equal(source.includes('alertKey: "member_file_upload_verification_pending"'), true);
  assert.equal(source.includes('alertKey: "generated_member_file_verification_pending"'), true);
  assert.equal(source.includes("return loadPersistedMemberFileOrReturnVerificationPending({"), true);
  assert.equal(source.includes("const updated = await loadPersistedMemberFileOrReturnVerificationPending({"), true);
});
