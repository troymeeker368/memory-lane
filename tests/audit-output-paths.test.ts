import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  AUDIT_OUTPUT_DIR_RELATIVE,
  buildAuditOutputPath,
  ensureAuditOutputDir,
  getAuditOutputDir,
  getProjectRoot,
} from "../lib/config/audit-paths";

test("audit output directory resolves from the project root", () => {
  const projectRoot = getProjectRoot();
  const auditOutputDir = getAuditOutputDir();

  assert.equal(auditOutputDir, path.join(projectRoot, "docs", "audits"));
});

test("ensureAuditOutputDir creates the canonical audit folder", () => {
  const ensuredDir = ensureAuditOutputDir();
  assert.equal(ensuredDir, getAuditOutputDir());
});

test("buildAuditOutputPath keeps audit files inside the canonical directory", () => {
  const outputPath = buildAuditOutputPath("nested/report.md");
  assert.equal(outputPath, path.join(getAuditOutputDir(), "nested", "report.md"));
});

test("buildAuditOutputPath rejects traversal outside the canonical directory", () => {
  assert.throws(
    () => buildAuditOutputPath(path.join("..", "outside.md")),
    /Audit output must stay within/,
  );
});
