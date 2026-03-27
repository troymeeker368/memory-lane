import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  getCarePlanPostSignReadinessDetail,
  getCarePlanPostSignReadinessLabel
} from "@/lib/services/care-plan-post-sign-readiness";

test("care plan post-sign wording stays plain-English and hides internal repair language", () => {
  assert.equal(getCarePlanPostSignReadinessLabel("signed_pending_snapshot"), "Internal Follow-up Needed");
  assert.equal(
    getCarePlanPostSignReadinessDetail("signed_pending_snapshot"),
    "This care plan still needs internal follow-up before the workflow is fully complete."
  );
  assert.equal(getCarePlanPostSignReadinessDetail("ready"), null);
});

test("care plan detail page does not render raw version-history persistence text", () => {
  const source = readFileSync("app/(portal)/health/care-plans/[carePlanId]/page.tsx", "utf8");

  assert.equal(source.includes("Version and review history persistence still needs to complete."), false);
  assert.equal(source.includes("Signed, but version history repair is still needed"), false);
});
