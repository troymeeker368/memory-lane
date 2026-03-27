import assert from "node:assert/strict";
import test from "node:test";

import { buildCarePlanSignatureRequestTemplate } from "@/lib/email/templates/care-plan-signature-request";
import { facilityBranding } from "@/lib/config/facility-branding";

test("care plan signature emails use facility branding like other caregiver/provider workflows", () => {
  const template = buildCarePlanSignatureRequestTemplate({
    caregiverName: "Jane Caregiver",
    nurseName: "Nurse Jackie",
    memberName: "Howard Brown",
    requestUrl: "https://example.com/sign/care-plan/token",
    expiresAt: "2026-03-31T23:59:59.999Z",
    optionalMessage: "Please review before the next visit."
  });

  assert.equal(template.subject, `Care Plan Signature Request - ${facilityBranding.facilityName}`);
  assert.equal(template.fromDisplayName, facilityBranding.facilityName);
  assert.equal(template.html.includes("Open Secure Care Plan"), true);
  assert.equal(template.html.includes("Howard Brown"), true);
  assert.equal(template.html.includes(`from ${facilityBranding.facilityName}`), true);
  assert.equal(template.text.includes("Additional message: Please review before the next visit."), true);
});
