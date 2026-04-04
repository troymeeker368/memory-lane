import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return readFileSync(relativePath, "utf8");
}

test("public POF signing verifies committed state before cleaning staged artifacts after finalize errors", () => {
  const source = readWorkspaceFile("lib/services/pof-esign-public.ts");

  assert.equal(source.includes("async function verifyCommittedPofSignatureAfterFinalizeError"), true);
  assert.equal(source.includes('alertKey: "pof_signature_finalize_verification_pending"'), true);
  assert.equal(source.includes("expectedMemberFileId"), true);
  assert.equal(source.includes("expectedSignedPdfStorageUrl"), true);
  assert.equal(source.includes("return buildCommittedPofFinalizeReplayResult(verification.request);"), true);
});

test("public care plan caregiver signing preserves committed files by reloading canonical state before cleanup", () => {
  const source = readWorkspaceFile("lib/services/care-plan-esign-public.ts");

  assert.equal(source.includes("async function verifyCommittedCarePlanCaregiverSignatureAfterFinalizeError"), true);
  assert.equal(source.includes('alertKey: "care_plan_signature_finalize_verification_pending"'), true);
  assert.equal(source.includes("expectedFinalMemberFileId"), true);
  assert.equal(source.includes('if (finalizeVerification?.kind === "committed"'), true);
  assert.equal(source.includes("finalized = {"), true);
});

test("public care plan caregiver signing keeps committed caregiver success when post-sign follow-up fails", () => {
  const source = readWorkspaceFile("lib/services/care-plan-esign-public.ts");

  assert.equal(source.includes("async function buildCommittedCarePlanPostCommitFollowUpResult"), true);
  assert.equal(source.includes('actionNeeded: true,'), true);
  assert.equal(source.includes('return buildCommittedCarePlanPostCommitFollowUpResult({'), true);
  assert.equal(source.includes('fallbackPostSignReadinessStatus: detail.carePlan.postSignReadinessStatus'), true);
});

test("intake signature finalization reloads canonical signature state before deleting captured artifacts", () => {
  const source = readWorkspaceFile("lib/services/intake-assessment-esign.ts");

  assert.equal(source.includes("async function verifyCommittedIntakeSignatureAfterFinalizeError"), true);
  assert.equal(source.includes('alertKey: "intake_assessment_signature_finalize_verification_pending"'), true);
  assert.equal(source.includes("expectedSignatureArtifactStoragePath"), true);
  assert.equal(source.includes("expectedSignatureArtifactMemberFileId"), true);
  assert.equal(source.includes("toFinalizedIntakeAssessmentSignatureRowFromState(verification.state)"), true);
});

test("care plan nurse signature finalization reloads canonical signature state before deleting captured artifacts", () => {
  const source = readWorkspaceFile("lib/services/care-plan-nurse-esign.ts");

  assert.equal(source.includes("async function verifyCommittedCarePlanNurseSignatureAfterFinalizeError"), true);
  assert.equal(source.includes('alertKey: "care_plan_nurse_signature_finalize_verification_pending"'), true);
  assert.equal(source.includes("expectedSignatureArtifactStoragePath"), true);
  assert.equal(source.includes("expectedSignatureArtifactMemberFileId"), true);
  assert.equal(source.includes("toFinalizedCarePlanNurseSignatureRowFromState(verification.state)"), true);
});

test("public enrollment packet completion verifies finalized batch rows before staged cleanup on finalize errors", () => {
  const runtimeSource = readWorkspaceFile("lib/services/enrollment-packets-public-runtime.ts");
  const finalizeSource = readWorkspaceFile("lib/services/enrollment-packets-public-runtime-finalize.ts");

  assert.equal(finalizeSource.includes("export async function verifyCommittedEnrollmentPacketFinalizeAfterError"), true);
  assert.equal(finalizeSource.includes('alertKey: "enrollment_packet_finalize_verification_pending"'), true);
  assert.equal(finalizeSource.includes("hasExpectedFinalizedArtifacts"), true);
  assert.equal(finalizeSource.includes("expectedArtifacts.length === 0 || hasExpectedFinalizedArtifacts"), true);
  assert.equal(runtimeSource.includes("finalizeAttempted = true;"), true);
  assert.equal(runtimeSource.includes("verifyCommittedEnrollmentPacketFinalizeAfterError({"), true);
  assert.equal(runtimeSource.includes("return buildCommittedEnrollmentPacketReplayResult({"), true);
});

test("public enrollment packet completion finalizes before staging artifacts so replay losers avoid pre-finalize upload work", () => {
  const runtimeSource = readWorkspaceFile("lib/services/enrollment-packets-public-runtime.ts");
  const artifactSource = readWorkspaceFile("lib/services/enrollment-packets-public-runtime-artifacts.ts");
  const finalizeIndex = runtimeSource.indexOf("finalizedSubmission = await invokeFinalizeEnrollmentPacketCompletionRpc({");
  const replayIndex = runtimeSource.indexOf("if (finalizedSubmission.wasAlreadyFiled) {");
  const postCommitIndex = runtimeSource.indexOf("return completeCommittedPublicEnrollmentPacketPostCommitWork({");
  const signatureArtifactIndex = artifactSource.indexOf("const signatureArtifact = await artifactOps.insertUploadAndFile({");
  const batchIndex = artifactSource.indexOf("const uploadBatchId = randomUUID();");

  assert.equal(finalizeIndex > -1, true);
  assert.equal(replayIndex > -1, true);
  assert.equal(postCommitIndex > -1, true);
  assert.equal(signatureArtifactIndex > -1, true);
  assert.equal(batchIndex > -1, true);
  assert.equal(finalizeIndex < postCommitIndex, true);
  assert.equal(replayIndex < postCommitIndex, true);
  assert.equal(batchIndex < signatureArtifactIndex, true);
});

test("post-commit enrollment packet artifacts persist as finalized rows after the RPC commit", () => {
  const runtimeSource = readWorkspaceFile("lib/services/enrollment-packets-public-runtime-artifacts.ts");
  const artifactSource = readWorkspaceFile("lib/services/enrollment-packet-artifacts.ts");

  assert.equal(runtimeSource.includes('finalizationStatus: "finalized"'), true);
  assert.equal(artifactSource.includes('finalizationStatus?: "staged" | "finalized";'), true);
  assert.equal(artifactSource.includes("finalization_status: finalizationStatus,"), true);
  assert.equal(
    artifactSource.includes('if (finalizationStatus === "finalized" && existingFinalizationStatus !== "finalized") {'),
    true
  );
});

test("public enrollment packet completion returns a committed follow-up result when post-commit writes fail", () => {
  const orchestratorSource = readWorkspaceFile("lib/services/enrollment-packets-public-runtime-post-commit.ts");
  const followUpSource = readWorkspaceFile("lib/services/enrollment-packets-public-runtime-follow-up.ts");

  assert.equal(followUpSource.includes("export function buildEnrollmentPacketPostCommitFollowUpMessage"), true);
  assert.equal(followUpSource.includes("export async function recordEnrollmentPacketPostCommitFollowUpFailure"), true);
  assert.equal(followUpSource.includes('alertKey: "enrollment_packet_post_commit_follow_up_failed"'), true);
  assert.equal(followUpSource.includes("completionFollowUpStatus: \"action_required\""), true);
  assert.equal(
    followUpSource.includes("post-commit follow-up failed after enrollment packet finalization"),
    true
  );
  assert.equal(
    orchestratorSource.includes("buildEnrollmentPacketPostCommitFailureResult({"),
    true
  );
});
