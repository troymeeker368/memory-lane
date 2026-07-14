import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return readFileSync(relativePath, "utf8");
}

test("admin revenue summary excludes void ancillary rows in SQL", () => {
  const source = readWorkspaceFile("lib/services/admin-reporting-foundation.ts");

  assert.equal(
    source.includes('const NON_VOID_ANCILLARY_RECONCILIATION_SQL_FILTER = "reconciliation_status.is.null,reconciliation_status.neq.void";'),
    true
  );
  assert.equal(source.includes(".or(NON_VOID_ANCILLARY_RECONCILIATION_SQL_FILTER);"), true);
  assert.equal(source.includes('const reconciliationStatus = String(row.reconciliation_status ?? "open").toLowerCase();'), false);
  assert.equal(source.includes('if (reconciliationStatus === "void") return;'), false);
});
