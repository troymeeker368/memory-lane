import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("partner detail read model reuses the shared sales partner and referral service boundary", () => {
  const salesReadSource = read("lib/services/sales-crm-read-model.ts");
  const partnerDetailSource = read("lib/services/partner-detail-read-model.ts");

  assert.equal(salesReadSource.includes('const SALES_PARTNER_DETAIL_SELECT ='), true);
  assert.equal(salesReadSource.includes('const SALES_REFERRAL_SOURCE_DETAIL_SELECT ='), true);
  assert.equal(salesReadSource.includes("return data ? normalizeSalesPartnerRow(data as Record<string, unknown>) : null;"), true);
  assert.equal(salesReadSource.includes("return data ? normalizeSalesReferralSourceRow(data as Record<string, unknown>) : null;"), true);

  assert.equal(
    partnerDetailSource.includes('import {\n  getSalesPartnerByIdOrCodeSupabase,\n  getSalesReferralSourceByIdOrCodeSupabase,\n  getSalesReferralSourcesForPartnerIdsSupabase,'),
    true
  );
  assert.equal(partnerDetailSource.includes("normalizePartnerDetailRow(await getSalesPartnerByIdOrCodeSupabase(partnerId))"), true);
  assert.equal(partnerDetailSource.includes("await getSalesReferralSourcesForPartnerIdsSupabase([partner.id])"), true);
  assert.equal(partnerDetailSource.includes("await getSalesReferralSourceByIdOrCodeSupabase(sourceId)"), true);
  assert.equal(partnerDetailSource.includes('.from("community_partner_organizations")'), false);
  assert.equal(partnerDetailSource.includes('.from("referral_sources")'), false);
});
