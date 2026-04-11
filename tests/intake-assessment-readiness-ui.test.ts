import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("assessment history uses post-sign readiness as the operational readiness source of truth", () => {
  const pageSource = readFileSync("app/(portal)/health/assessment/page.tsx", "utf8");

  assert.equal(pageSource.includes("getIntakePostSignWorkflowReadinessLabel"), true);
  assert.equal(pageSource.includes("Workflow Readiness"), true);
  assert.equal(pageSource.includes("getIntakePostSignWorkflowReadinessLabel(row.post_sign_readiness_status)"), true);
  assert.equal(pageSource.includes('row.complete ? "Yes" : "No"'), false);
});

test("assessment form does not overstate downstream readiness on save", () => {
  const formSource = readFileSync("components/forms/assessment-form.tsx", "utf8");

  assert.equal(
    formSource.includes("Saving commits the Intake Assessment first, then verifies draft POF and member-file follow-up."),
    true
  );
  assert.equal(formSource.includes("Saving creates an Intake Assessment PDF and adds it to member files."), false);
});
