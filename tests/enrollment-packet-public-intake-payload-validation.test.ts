import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("public enrollment packet action enforces strict intakePayload parsing", () => {
  const actionSource = readWorkspaceFile("app/sign/enrollment-packet/[token]/actions.ts");

  assert.equal(
    actionSource.includes('const raw = asString(formData, "intakePayload");'),
    true
  );
  assert.equal(
    actionSource.includes("if (!raw) {\n    throw new InvalidEnrollmentPacketIntakePayloadError();"),
    true
  );
  assert.equal(
    actionSource.includes("if (!parsed || typeof parsed !== \"object\" || Array.isArray(parsed)) {"),
    true
  );
  assert.equal(
    actionSource.includes('failureType: "invalid_intake_payload_json"'),
    true
  );
});

test("public enrollment packet service rejects malformed intakePayload before persistence and logs canonical guard failure", () => {
  const runtimeSource = readWorkspaceFile("lib/services/enrollment-packets-public-runtime.ts");

  assert.equal(
    runtimeSource.includes("const validateIntakePayload = (payload: unknown): payload is Partial<Record<string, unknown>> =>"),
    true
  );
  assert.equal(
    runtimeSource.includes("if (!validateIntakePayload(input.intakePayload)) {"),
    true
  );
  assert.equal(
    runtimeSource.includes('failureType: "invalid_intake_payload_json"'),
    true
  );
  assert.equal(
    runtimeSource.includes('message: "Public enrollment packet progress included malformed intakePayload JSON."'),
    true
  );
  assert.equal(
    runtimeSource.includes("throw new Error(\"Enrollment packet answers are invalid. Refresh the form and try again.\");"),
    true
  );
});
