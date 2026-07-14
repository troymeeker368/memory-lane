import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return readFileSync(relativePath, "utf8");
}

test("sales read models clamp oversized list page sizes without shrinking lookup defaults", () => {
  const source = readWorkspaceFile("lib/services/sales-crm-read-model.ts");

  assert.equal(source.includes("const MAX_SALES_LIST_PAGE_SIZE = 100;"), true);
  assert.equal(source.includes("const MAX_SALES_LOOKUP_LIMIT = 250;"), true);
  assert.equal(source.includes("function normalizePageSize(rawPageSize?: number | null, fallback = 25, max = MAX_SALES_LOOKUP_LIMIT)"), true);
  assert.equal(source.includes("return Math.min(max, Math.floor(rawPageSize));"), true);
  assert.equal(
    source.includes("normalizePageSize(input?.pageSize ?? input?.limit ?? 25, input?.limit ?? 25, MAX_SALES_LIST_PAGE_SIZE)"),
    true
  );
  assert.equal(source.includes("normalizePageSize(input?.pageSize ?? 25, 25, MAX_SALES_LIST_PAGE_SIZE)"), true);
});

test("physician order index paging clamps oversized page requests", () => {
  const source = readWorkspaceFile("lib/services/physician-orders-read.ts");

  assert.equal(source.includes("const MAX_PHYSICIAN_ORDER_PAGE_SIZE = 100;"), true);
  assert.equal(source.includes("return Math.min(MAX_PHYSICIAN_ORDER_PAGE_SIZE, Math.floor(value));"), true);
});
