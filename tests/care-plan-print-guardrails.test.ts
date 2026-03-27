import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("care plan detail print path hides workflow-only and editable sections", () => {
  const source = readFileSync("app/(portal)/health/care-plans/[carePlanId]/page.tsx", "utf8");

  assert.equal(source.includes('<Card id="review-update" className="print-hide">'), true);
  assert.equal(source.includes('<Card className="print-hide">'), true);
  assert.equal(source.includes('<Card className="print-hide table-wrap">'), true);
  assert.equal(source.includes('className="print-hide mt-3 text-sm"'), true);
  assert.equal(source.includes('className={`print-hide rounded-lg border p-3 text-sm ${postSignReadinessTone(detail.carePlan.postSignReadinessStatus)}`}'), true);
});

test("dev auth bootstrap section is hidden from print output", () => {
  const source = readFileSync("components/auth/dev-auth-bootstrap-section.tsx", "utf8");

  assert.equal(source.includes('className="print-hide space-y-2 rounded-lg border border-border bg-white px-3 py-3"'), true);
});
