import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return readFileSync(relativePath, "utf8");
}

test("public completed/signed readers use canonical readiness helpers instead of raw terminal states", () => {
  const enrollmentRuntimeSource = readWorkspaceFile("lib/services/enrollment-packets-public-runtime.ts");
  const enrollmentConfirmationSource = readWorkspaceFile("app/sign/enrollment-packet/[token]/confirmation/page.tsx");
  const pofRuntimeSource = readWorkspaceFile("lib/services/pof-esign-public.ts");
  const pofPageSource = readWorkspaceFile("app/sign/pof/[token]/page.tsx");
  const carePlanRuntimeSource = readWorkspaceFile("lib/services/care-plan-esign-public.ts");
  const carePlanPageSource = readWorkspaceFile("app/sign/care-plan/[token]/page.tsx");

  assert.equal(enrollmentRuntimeSource.includes("buildPublicEnrollmentPacketSubmitResult({"), true);
  assert.equal(enrollmentConfirmationSource.includes("const followUpRequired = queryIndicatesFollowUp || context.actionNeeded;"), true);
  assert.equal(enrollmentConfirmationSource.includes("context.actionNeededMessage ??"), true);

  assert.equal(pofRuntimeSource.includes("postSignOutcome: await loadPublicPofPostSignOutcome"), true);
  assert.equal(pofPageSource.includes("context.postSignOutcome.actionNeeded"), true);
  assert.equal(pofPageSource.includes("context.postSignOutcome.actionNeededMessage"), true);

  assert.equal(carePlanRuntimeSource.includes("buildCarePlanPublicCompletionOutcome"), true);
  assert.equal(carePlanPageSource.includes("context.completedOutcome.actionNeeded"), true);
  assert.equal(carePlanPageSource.includes("context.completedOutcome.actionNeededMessage"), true);
});
