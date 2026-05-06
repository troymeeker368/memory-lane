import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("member-file list flow prevents non-clinical metadata leakage", () => {
  const filesActionSource = read("app/(portal)/operations/member-command-center/_actions/files.ts");
  const detailReadSource = read("lib/services/member-command-center-detail-read-model.ts");
  const migrationSource = read("supabase/migrations/0219_member_files_policy_permission_hardening.sql");

  assert.equal(filesActionSource.includes("canAccessClinicalMemberFiles"), true);
  assert.equal(filesActionSource.includes("includeClinicalCategories: canAccessClinicalMemberFiles"), true);

  assert.equal(detailReadSource.includes("canViewMemberFileCategory"), true);
  assert.equal(detailReadSource.includes("detail.files.filter"), true);

  assert.equal(migrationSource.includes('create policy "member_files_select"'), true);
  assert.equal(migrationSource.includes("category not in ('Assessment', 'Care Plan', 'Orders / POF', 'Health Unit')"), true);
});