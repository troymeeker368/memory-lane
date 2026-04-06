import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return readFileSync(relativePath, "utf8");
}

test("near-simultaneous enrollment packet submits recheck committed state before winner-only follow-up work", () => {
  const runtimeSource = readWorkspaceFile("lib/services/enrollment-packets-public-runtime.ts");

  const replayCheckIndex = runtimeSource.indexOf(
    "const replayCheck = await deps.loadRequestByToken(normalizedToken);"
  );
  const completedReplayBranchIndex = runtimeSource.indexOf(
    'if (replayCheck?.request && toStatus(replayCheck.request.status) === "completed") {'
  );
  const senderSignatureIndex = runtimeSource.indexOf(
    "senderSignatureName = await deps.loadPublicEnrollmentPacketSenderSignatureName(request.id);"
  );
  const finalizeIndex = runtimeSource.indexOf(
    "finalizedSubmission = await deps.invokeFinalizeEnrollmentPacketCompletionRpc({"
  );
  const alreadyFiledReplayIndex = runtimeSource.indexOf("if (finalizedSubmission.wasAlreadyFiled) {");
  const memberLoadIndex = runtimeSource.indexOf("member = await deps.getMemberById(request.member_id);");
  const signatureParseIndex = runtimeSource.indexOf(
    "const signature = deps.parseSignatureDataUrl(caregiverSignatureDataUrl);"
  );
  const postCommitIndex = runtimeSource.indexOf(
    "return deps.completeCommittedPublicEnrollmentPacketPostCommitWork({"
  );

  assert.equal(replayCheckIndex > -1, true);
  assert.equal(completedReplayBranchIndex > replayCheckIndex, true);
  assert.equal(senderSignatureIndex > completedReplayBranchIndex, true);
  assert.equal(finalizeIndex > senderSignatureIndex, true);
  assert.equal(alreadyFiledReplayIndex > finalizeIndex, true);
  assert.equal(memberLoadIndex > alreadyFiledReplayIndex, true);
  assert.equal(signatureParseIndex > alreadyFiledReplayIndex, true);
  assert.equal(postCommitIndex > signatureParseIndex, true);
});
