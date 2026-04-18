import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("sales form lookups only preload partner options when explicitly requested", () => {
  const source = readWorkspaceFile("lib/services/sales-crm-read-model.ts");

  assert.equal(source.includes("prefetchPartnerOptions?: boolean;"), true);
  assert.equal(
    source.includes('const shouldLoadPartners = options?.includePartners === true && options?.prefetchPartnerOptions === true;'),
    true
  );
  assert.equal(source.includes("requestedPartnerId && !partnerRows.some((row) => row.id === requestedPartnerId || row.partner_id === requestedPartnerId)"), true);
});

test("sales partner picker is wired through the canonical lookup action", () => {
  const actionSource = readWorkspaceFile("app/lookup-actions.ts");
  const pickerSource = readWorkspaceFile("components/forms/sales-partner-search-picker.tsx");

  assert.equal(actionSource.includes("export async function searchSalesPartnersAction"), true);
  assert.equal(actionSource.includes("return listSalesPartnerPickerOptions({"), true);
  assert.equal(pickerSource.includes("searchSalesPartnersAction"), true);
});
