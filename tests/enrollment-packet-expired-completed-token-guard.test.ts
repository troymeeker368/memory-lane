import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("completed enrollment packet context checks parent-token expiry before treating active tokens as completed", () => {
  const contextSource = readFileSync("lib/services/enrollment-packets-public-runtime-context.ts", "utf8");
  const runtimeSource = readFileSync("lib/services/enrollment-packets-public-runtime.ts", "utf8");

  assert.equal(
    contextSource.includes('if (tokenExpired && matched.tokenMatch !== "consumed") {'),
    true
  );
  assert.equal(
    runtimeSource.includes('if (isExpired(request.token_expires_at) && matchedRequest.tokenMatch !== "consumed") {'),
    true
  );
  assert.equal(contextSource.indexOf('if (tokenExpired && matched.tokenMatch !== "consumed") {') < contextSource.indexOf('if (toStatus(request.status) === "completed") {'), true);
  assert.equal(runtimeSource.indexOf('if (isExpired(request.token_expires_at) && matchedRequest.tokenMatch !== "consumed") {') < runtimeSource.indexOf('if (matchedRequest.tokenMatch === "consumed" && status === "completed") {'), true);
});

test("enrollment packet follow-up truth throws when follow-up state persistence fails", () => {
  const cascadeSource = readFileSync("lib/services/enrollment-packets-public-runtime-cascade.ts", "utf8");
  const followUpSource = readFileSync("lib/services/enrollment-packets-public-runtime-follow-up.ts", "utf8");

  assert.equal(cascadeSource.includes("const persistedFollowUpState = await persistEnrollmentPacketCompletionFollowUpState({"), true);
  assert.equal(cascadeSource.includes("if (!persistedFollowUpState.ok) {"), true);
  assert.equal(cascadeSource.includes("throw new Error(persistedTruthMessage);"), true);
  assert.equal(followUpSource.includes("return {\n      ok: false as const,"), true);
});
