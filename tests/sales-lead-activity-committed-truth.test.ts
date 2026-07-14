import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("sales lead activity action preserves committed conversion truth on post-conversion activity failure", () => {
  const serviceSource = readFileSync("lib/services/sales-lead-activities.ts", "utf8");
  const actionSource = readFileSync("app/sales-lead-actions.ts", "utf8");

  assert.equal(serviceSource.includes("export class CommittedLeadActivityFollowUpError extends Error"), true);
  assert.equal(serviceSource.includes("throw new CommittedLeadActivityFollowUpError({"), true);
  assert.equal(actionSource.includes("if (error instanceof CommittedLeadActivityFollowUpError) {"), true);
  assert.equal(actionSource.includes("buildCommittedWorkflowActionState({"), true);
  assert.equal(actionSource.includes("actionNeededMessage: error.message"), true);
});
