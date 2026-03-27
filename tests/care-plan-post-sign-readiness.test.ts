import assert from "node:assert/strict";
import test from "node:test";

import { resolveCarePlanPostSignReadiness } from "@/lib/services/care-plan-model";
import { readFileSync } from "node:fs";

test("signed and filed care plans resolve to ready even if stored readiness is stale", () => {
  const readiness = resolveCarePlanPostSignReadiness({
    status: "not_started",
    reason: "Old stale value.",
    caregiverSignatureStatus: "signed",
    finalMemberFileId: "mf_123"
  });

  assert.equal(readiness.status, "ready");
  assert.equal(readiness.reason, null);
});

test("caregiver workflow panel no longer duplicates the post-sign readiness warning", () => {
  const source = readFileSync("components/care-plans/care-plan-caregiver-esign-actions.tsx", "utf8");

  assert.equal(
    source.includes("Caregiver signature was captured, but post-sign follow-up is still incomplete."),
    false
  );
});
