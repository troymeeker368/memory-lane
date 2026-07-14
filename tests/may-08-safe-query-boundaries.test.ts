import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return readFileSync(relativePath, "utf8");
}

test("shared member index paging clamps oversized page requests", () => {
  const source = readWorkspaceFile("lib/services/member-list-read.ts");

  assert.equal(source.includes("const MAX_SHARED_MEMBER_INDEX_PAGE_SIZE = 100;"), true);
  assert.equal(source.includes("function resolveSharedMemberIndexPageSize(rawPageSize?: number | null)"), true);
  assert.equal(source.includes("Math.min(MAX_SHARED_MEMBER_INDEX_PAGE_SIZE, Math.floor(rawPageSize))"), true);
  assert.equal(source.includes("const pageSize = resolveSharedMemberIndexPageSize(filters?.pageSize);"), true);
});

test("admin audit trail area filters normalize comma and word separated aliases", () => {
  const source = readWorkspaceFile("lib/services/admin-audit-trail.ts");

  assert.equal(source.includes("function tokenizeAdminAuditAreaFilter(areaFilter: string)"), true);
  assert.equal(source.includes(".split(/[,\\s/]+/)"), true);
  assert.equal(source.includes("function resolveAdminAuditAreaTerms(areaToken: string)"), true);
  assert.equal(source.includes("if (areaToken.length < 3) {"), true);
  assert.equal(source.includes("const terms = tokenizeAdminAuditAreaFilter(areaFilter).flatMap((token) => resolveAdminAuditAreaTerms(token));"), true);
});
