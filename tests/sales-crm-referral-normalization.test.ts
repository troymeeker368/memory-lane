import assert from "node:assert/strict";
import test from "node:test";

import { normalizeSalesReferralSourcesWithPartnerRows, type SalesReferralSourceRow } from "@/lib/services/sales-crm-read-model";

test("normalizeSalesReferralSourcesWithPartnerRows rewrites internal partner ids to canonical partner codes", () => {
  const referralSources: SalesReferralSourceRow[] = [
    {
      id: "ref-1",
      referral_source_id: "source-1",
      partner_id: "partner-row-1",
      contact_name: "Alice",
      organization_name: "North Clinic",
      active: true,
      last_touched: null
    },
    {
      id: "ref-2",
      referral_source_id: "source-2",
      partner_id: "already-canonical",
      contact_name: "Bob",
      organization_name: "South Clinic",
      active: true,
      last_touched: null
    }
  ];

  const normalized = normalizeSalesReferralSourcesWithPartnerRows(
    [{ id: "partner-row-1", partner_id: "partner-code-1" }],
    referralSources
  );

  assert.equal(normalized[0]?.partner_id, "partner-code-1");
  assert.equal(normalized[1]?.partner_id, "already-canonical");
});
