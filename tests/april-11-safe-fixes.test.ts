import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("sales form lookups only preload referral sources when a partner is already scoped", () => {
  const source = readWorkspaceFile("lib/services/sales-crm-read-model.ts");

  assert.equal(source.includes("const requestedReferralSourceId = clean(options?.includeReferralSourceId);"), true);
  assert.equal(
    source.includes("const shouldPrefetchReferralSources = shouldLoadReferralSources && Boolean(referralPartner?.id);"),
    true
  );
  assert.equal(source.includes("shouldPrefetchReferralSources"), true);
  assert.equal(
    source.includes("requestedReferralSourceId && !referralRows.some((row) => row.id === requestedReferralSourceId)"),
    true
  );
});
