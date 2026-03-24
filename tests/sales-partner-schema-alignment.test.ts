import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("sales partner detail readers only select schema-backed partner columns", () => {
  const leadDetailSource = readWorkspaceFile("lib/services/lead-detail-read-model.ts");
  const partnerDetailSource = readWorkspaceFile("lib/services/partner-detail-read-model.ts");

  assert.equal(
    leadDetailSource.includes('const PARTNER_DETAIL_SELECT = "id, partner_id, organization_name, category, location, primary_phone, primary_email, notes, last_touched";'),
    true
  );
  assert.equal(
    partnerDetailSource.includes('const PARTNER_DETAIL_SELECT = "id, partner_id, organization_name, category, location, primary_phone, primary_email, notes, last_touched";'),
    true
  );
  assert.equal(leadDetailSource.includes("category, referral_source_category"), false);
  assert.equal(partnerDetailSource.includes("category, referral_source_category"), false);
  assert.equal(leadDetailSource.includes("category, location, primary_phone, primary_email, notes, last_touched"), true);
  assert.equal(partnerDetailSource.includes("category, location, primary_phone, primary_email, notes, last_touched"), true);
});
