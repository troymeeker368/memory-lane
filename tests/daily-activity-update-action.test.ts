import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("daily activity update action scopes update by id and guards affected row count", () => {
  const source = readFileSync("app/actions.ts", "utf8");

  assert.equal(source.includes('.from("daily_activity_logs")'), true);
  assert.equal(source.includes('.eq("id", payload.data.id)'), true);
  assert.equal(source.includes('.select("id");'), true);
  assert.equal(source.includes("const updatedCount = updatedRows?.length ?? 0;"), true);
  assert.equal(source.includes("if (updatedCount === 0) {"), true);
  assert.equal(source.includes("if (updatedCount > 1) {"), true);
  assert.equal(source.includes("Daily activity log update failed: no row found for id"), true);
  assert.equal(source.includes("Daily activity log update failed: expected exactly one row for id"), true);
});
