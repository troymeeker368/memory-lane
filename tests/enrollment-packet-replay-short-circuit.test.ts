import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("public enrollment packet submission short-circuits replay losers before progress save work", () => {
  const submissionSource = readFileSync("lib/services/enrollment-packets-public-runtime-submission.ts", "utf8");
  const runtimeSource = readFileSync("lib/services/enrollment-packets-public-runtime.ts", "utf8");

  const preSaveReplayCheckIndex = submissionSource.indexOf(
    "const replayCheck = await loadRequestByToken(input.token);"
  );
  const replayThrowIndex = submissionSource.indexOf(
    "throw new PublicEnrollmentPacketReplayDetectedError(replayCheck.request);"
  );
  const saveProgressIndex = submissionSource.indexOf("const savedProgress = await savePublicEnrollmentPacketProgress(input);");

  assert.equal(submissionSource.includes("export class PublicEnrollmentPacketReplayDetectedError extends Error"), true);
  assert.equal(preSaveReplayCheckIndex > -1, true);
  assert.equal(replayThrowIndex > preSaveReplayCheckIndex, true);
  assert.equal(saveProgressIndex > replayThrowIndex, true);
  assert.equal(runtimeSource.includes("if (error instanceof PublicEnrollmentPacketReplayDetectedError) {"), true);
  assert.equal(runtimeSource.includes("return deps.buildCommittedEnrollmentPacketReplayResult({"), true);
});
