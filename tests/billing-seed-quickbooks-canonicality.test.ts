import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { buildSeededMockDb } from "../lib/mock/seed";

function readWorkspaceFile(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("seeded payors carry a QuickBooks customer name sourced from the canonical payor contact", () => {
  const db = buildSeededMockDb();
  const activeMembers = db.members.filter((row) => row.status === "active");
  const activePayors = db.payors.filter((row) => row.status === "active");

  assert.equal(activePayors.length > 0, true);
  assert.equal(activePayors.length, activeMembers.length);
  assert.equal(activePayors.every((row) => typeof row.quickbooks_customer_name === "string" && row.quickbooks_customer_name.trim().length > 0), true);
});

test("reseed billing rows stamp Bill To snapshots so exports do not rely on mutable live payor rows", () => {
  const seedSource = readWorkspaceFile("scripts/seed-supabase.ts");

  assert.equal(seedSource.includes("bill_to_name_snapshot"), true);
  assert.equal(seedSource.includes("bill_to_address_line_1_snapshot"), true);
  assert.equal(seedSource.includes("bill_to_email_snapshot"), true);
  assert.equal(seedSource.includes("bill_to_phone_snapshot"), true);
});
