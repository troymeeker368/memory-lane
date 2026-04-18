import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("enrollment packet completion follow-up truth includes notification and artifact linkage checks", () => {
  const followUpSource = readFileSync("lib/services/enrollment-packets-public-runtime-follow-up.ts", "utf8");
  const cascadeSource = readFileSync("lib/services/enrollment-packets-public-runtime-cascade.ts", "utf8");
  const listSupportSource = readFileSync("lib/services/enrollment-packet-list-support.ts", "utf8");
  const pageSource = readFileSync("app/(portal)/sales/new-entries/completed-enrollment-packets/page.tsx", "utf8");
  const listingSource = readFileSync("lib/services/enrollment-packets-listing.ts", "utf8");
  const pipelinePageSource = readFileSync("app/(portal)/sales/pipeline/enrollment-packets/page.tsx", "utf8");
  const detailPageSource = readFileSync("app/(portal)/sales/pipeline/enrollment-packets/[packetId]/page.tsx", "utf8");
  const leadPageSource = readFileSync("app/(portal)/sales/leads/[leadId]/page.tsx", "utf8");

  assert.equal(followUpSource.includes("sender notification did not finalize"), true);
  assert.equal(followUpSource.includes("completed packet artifact linkage did not finalize"), true);
  assert.equal(followUpSource.includes("completionFollowUpStatus = \"action_required\""), true);
  assert.equal(cascadeSource.includes("senderNotificationDelivered"), true);
  assert.equal(cascadeSource.includes("completedPacketArtifactLinked"), true);
  assert.equal(listSupportSource.includes("completionFollowUpStatus"), true);
  assert.equal(pageSource.includes("Follow-up:"), true);
  assert.equal(listingSource.includes('.eq("completion_follow_up_status", "completed")'), true);
  assert.equal(listingSource.includes('and(mapping_sync_status.eq.completed,completion_follow_up_status.neq.completed)'), true);
  assert.equal(pipelinePageSource.includes("Workflow Readiness"), true);
  assert.equal(pipelinePageSource.includes("completionFollowUpStatus"), true);
  assert.equal(detailPageSource.includes("Workflow Readiness"), true);
  assert.equal(detailPageSource.includes("completionFollowUpStatus"), true);
  assert.equal(leadPageSource.includes("Workflow Readiness"), true);
  assert.equal(leadPageSource.includes("completionFollowUpStatus"), true);
});
