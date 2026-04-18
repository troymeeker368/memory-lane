import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("sales form lookups do not broad-preload partner options unless explicitly opted in", () => {
  const source = readWorkspaceFile("lib/services/sales-crm-read-model.ts");

  assert.equal(source.includes("prefetchPartnerOptions?: boolean;"), true);
  assert.equal(
    source.includes("const shouldLoadPartners = options?.includePartners === true && options?.prefetchPartnerOptions === true;"),
    true
  );
  assert.equal(source.includes("requestedPartnerId && !partnerRows.some((row) => row.id === requestedPartnerId || row.partner_id === requestedPartnerId)"), true);
});

test("sales partner-facing forms use the shared search-first partner picker", () => {
  const inquiryForm = readWorkspaceFile("components/forms/sales-inquiry-form.tsx");
  const partnerActivityForm = readWorkspaceFile("components/forms/sales-partner-activity-form.tsx");
  const referralSourceForm = readWorkspaceFile("components/forms/sales-partner-source-forms.tsx");

  assert.equal(inquiryForm.includes("SalesPartnerSearchPicker"), true);
  assert.equal(partnerActivityForm.includes("SalesPartnerSearchPicker"), true);
  assert.equal(referralSourceForm.includes("SalesPartnerSearchPicker"), true);
});
