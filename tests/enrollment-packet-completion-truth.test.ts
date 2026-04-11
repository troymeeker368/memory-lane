import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("enrollment packet completion follow-up truth includes notification and artifact linkage checks", () => {
  const followUpSource = readFileSync("lib/services/enrollment-packets-public-runtime-follow-up.ts", "utf8");
  const cascadeSource = readFileSync("lib/services/enrollment-packets-public-runtime-cascade.ts", "utf8");
  const listSupportSource = readFileSync("lib/services/enrollment-packet-list-support.ts", "utf8");
  const pageSource = readFileSync("app/(portal)/sales/new-entries/completed-enrollment-packets/page.tsx", "utf8");

  assert.equal(followUpSource.includes("sender notification did not finalize"), true);
  assert.equal(followUpSource.includes("completed packet artifact linkage did not finalize"), true);
  assert.equal(followUpSource.includes("completionFollowUpStatus = \"action_required\""), true);
  assert.equal(cascadeSource.includes("senderNotificationDelivered"), true);
  assert.equal(cascadeSource.includes("completedPacketArtifactLinked"), true);
  assert.equal(listSupportSource.includes("completionFollowUpStatus"), true);
  assert.equal(pageSource.includes("Follow-up:"), true);
});
