import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("enrollment packet mapping runtime delegates contact/payor writes into the conversion RPC boundary", () => {
  const mappingSource = readWorkspaceFile("lib/services/enrollment-packet-intake-mapping.ts");

  assert.equal(mappingSource.includes("p_contacts: preparedContacts"), true);
  assert.equal(mappingSource.includes('.from("member_contacts").insert('), false);
  assert.equal(mappingSource.includes('.from("member_contacts").update('), false);
});

test("signed intake follow-up is backed by the canonical action-required queue and retry resolution path", () => {
  const intakeActionSource = readWorkspaceFile("app/intake-actions.ts");
  const assessmentActionsSource = readWorkspaceFile("app/(portal)/health/assessment/[assessmentId]/actions.ts");
  const followUpServiceSource = readWorkspaceFile("lib/services/intake-post-sign-follow-up.ts");

  assert.equal(intakeActionSource.includes("queueIntakePostSignFollowUpTask({"), true);
  assert.equal(intakeActionSource.includes('taskType: "draft_pof_creation"'), true);
  assert.equal(intakeActionSource.includes('taskType: "member_file_pdf_persistence"'), true);

  assert.equal(assessmentActionsSource.includes("resolveIntakePostSignFollowUpTask({"), true);
  assert.equal(assessmentActionsSource.includes('taskType: "draft_pof_creation"'), true);
  assert.equal(assessmentActionsSource.includes('taskType: "member_file_pdf_persistence"'), true);

  assert.equal(followUpServiceSource.includes('from("intake_post_sign_follow_up_queue")'), true);
});
