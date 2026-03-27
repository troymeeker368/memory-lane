import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return readFileSync(relativePath, "utf8");
}

test("care plan caregiver send preflights sent-state finalization before email delivery", () => {
  const source = readWorkspaceFile("lib/services/care-plan-esign.ts");
  const preflightIndex = source.indexOf("await assertCarePlanCaregiverSentStateFinalizationReady({");
  const emailSendIndex = source.indexOf("await sendSignatureEmail({");

  assert.notEqual(preflightIndex, -1);
  assert.notEqual(emailSendIndex, -1);
  assert.equal(preflightIndex < emailSendIndex, true);
});

test("care plan caregiver RPC availability checks require missing-function signals", () => {
  const source = readWorkspaceFile("lib/services/care-plan-esign.ts");

  assert.equal(source.includes('code === "PGRST202"'), true);
  assert.equal(source.includes('code === "42883"'), true);
  assert.equal(source.includes('message.includes("could not find")'), true);
  assert.equal(source.includes('message.includes("does not exist")'), true);
  assert.equal(source.includes('message.includes("schema cache")'), true);
});
